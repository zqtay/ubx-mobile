package com.ubxmobile.usbserial

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.Ch34xSerialDriver
import com.hoho.android.usbserial.driver.Cp21xxSerialDriver
import com.hoho.android.usbserial.driver.FtdiSerialDriver
import com.hoho.android.usbserial.driver.ProbeTable
import com.hoho.android.usbserial.driver.ProlificSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.ByteArrayOutputStream
import java.util.UUID

class OpenOptions : Record {
  @Field val portIndex: Int = 0

  @Field val baudRate: Int = 38400

  @Field val dataBits: Int = 8

  @Field val stopBits: Double = 1.0

  @Field val parity: String = "none"

  @Field val dtr: Boolean = true

  @Field val rts: Boolean = true

  @Field val readFlushMs: Long = 30

  @Field val readFlushBytes: Int = 16384
}

class LineParameters : Record {
  @Field val baudRate: Int = 38400

  @Field val dataBits: Int = 8

  @Field val stopBits: Double = 1.0

  @Field val parity: String = "none"
}

private const val ACTION_USB_PERMISSION = "com.ubxmobile.usbserial.USB_PERMISSION"

/** u-blox native USB receivers enumerate as CDC-ACM (VID 0x1546); not all are in the default table. */
private const val UBLOX_VID = 0x1546
private val UBLOX_PIDS = intArrayOf(0x01a5, 0x01a6, 0x01a7, 0x01a8, 0x01a9)

private class Session(
  val id: String,
  val device: UsbDevice,
  val port: UsbSerialPort,
  val io: SerialInputOutputManager,
  val buffer: ByteArrayOutputStream,
  val flushMs: Long,
  val flushBytes: Int,
  var flushScheduled: Boolean = false,
)

/**
 * USB serial access for external GNSS receivers (technical spec §5.2), using
 * usb-serial-for-android. Reads are batched and sent to JS as base64 `onData` events.
 */
class UsbSerialModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("E_NO_CONTEXT", "React context is not available", null)

  private val usbManager: UsbManager
    get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

  private val sessions = HashMap<String, Session>()
  private val pendingPermissions = HashMap<Int, MutableList<Promise>>()
  private var receiver: BroadcastReceiver? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null

  override fun definition() = ModuleDefinition {
    Name("UsbSerial")

    Events("onData", "onError", "onAttached", "onDetached")

    OnCreate { registerReceiver() }

    OnDestroy {
      sessions.keys.toList().forEach { closeSession(it) }
      receiver?.let { r -> runCatching { context.unregisterReceiver(r) } }
      receiver = null
      thread?.quitSafely()
    }

    Function("isUsbHostSupported") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST)
    }

    AsyncFunction("listDevices") { findDrivers().map { deviceMap(it) } }

    AsyncFunction("requestPermission") { deviceId: Int, promise: Promise ->
      val device = usbManager.deviceList.values.firstOrNull { it.deviceId == deviceId }
      if (device == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      if (usbManager.hasPermission(device)) {
        promise.resolve(true)
        return@AsyncFunction
      }
      synchronized(pendingPermissions) {
        pendingPermissions.getOrPut(deviceId) { mutableListOf() }.add(promise)
      }
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      // Android 14 requires mutable PendingIntents to be explicit.
      val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
      usbManager.requestPermission(device, PendingIntent.getBroadcast(context, deviceId, intent, flags))
    }

    AsyncFunction("open") { deviceId: Int, options: OpenOptions -> open(deviceId, options) }

    AsyncFunction("setParameters") { sessionId: String, params: LineParameters ->
      val session = sessions[sessionId] ?: throw CodedException("E_NO_SESSION", "Port is not open", null)
      setLine(session.port, params.baudRate, params.dataBits, params.stopBits, params.parity)
    }

    AsyncFunction("write") { sessionId: String, dataBase64: String ->
      val session = sessions[sessionId] ?: throw CodedException("E_NO_SESSION", "Port is not open", null)
      val bytes = Base64.decode(dataBase64, Base64.NO_WRAP)
      try {
        session.port.write(bytes, 500)
      } catch (e: Exception) {
        throw CodedException("E_IO", e.message ?: "Write failed", e)
      }
      bytes.size
    }

    AsyncFunction("close") { sessionId: String -> closeSession(sessionId) }

    AsyncFunction("getLaunchDevice") {
      val intent = appContext.currentActivity?.intent ?: return@AsyncFunction null
      deviceFromIntent(intent)?.let { device -> findDrivers().firstOrNull { it.device.deviceId == device.deviceId } }
        ?.let { deviceMap(it) }
    }

    OnNewIntent { intent ->
      if (intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
        deviceFromIntent(intent)?.let { emitAttached(it) }
      }
    }
  }

  private fun ioHandler(): Handler {
    handler?.let { return it }
    val t = HandlerThread("UsbSerial").apply { start() }
    thread = t
    return Handler(t.looper).also { handler = it }
  }

  private fun prober(): UsbSerialProber {
    val table = UsbSerialProber.getDefaultProbeTable()
    UBLOX_PIDS.forEach { pid -> table.addProduct(UBLOX_VID, pid, CdcAcmSerialDriver::class.java) }
    return UsbSerialProber(table)
  }

  private fun findDrivers(): List<UsbSerialDriver> = prober().findAllDrivers(usbManager)

  private fun driverName(driver: UsbSerialDriver): String = when (driver) {
    is CdcAcmSerialDriver -> "cdc-acm"
    is FtdiSerialDriver -> "ftdi"
    is Cp21xxSerialDriver -> "cp210x"
    is ProlificSerialDriver -> "pl2303"
    is Ch34xSerialDriver -> "ch34x"
    else -> "unknown"
  }

  /** Manufacturer/product/serial strings need permission on Android 10+, so they may be null. */
  private fun deviceMap(driver: UsbSerialDriver): Map<String, Any?> {
    val d = driver.device
    val permitted = usbManager.hasPermission(d)
    return mapOf(
      "deviceId" to d.deviceId,
      "deviceName" to d.deviceName,
      "vendorId" to d.vendorId,
      "productId" to d.productId,
      "manufacturerName" to runCatching { d.manufacturerName }.getOrNull(),
      "productName" to runCatching { d.productName }.getOrNull(),
      "serialNumber" to if (permitted) runCatching { d.serialNumber }.getOrNull() else null,
      "driver" to driverName(driver),
      "portCount" to driver.ports.size,
      "hasPermission" to permitted,
    )
  }

  private fun deviceFromIntent(intent: Intent): UsbDevice? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
    }

  private fun emitAttached(device: UsbDevice) {
    val driver = findDrivers().firstOrNull { it.device.deviceId == device.deviceId } ?: return
    sendEvent("onAttached", deviceMap(driver))
  }

  private fun registerReceiver() {
    val r = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        if (intent == null) return
        val device = deviceFromIntent(intent)
        when (intent.action) {
          ACTION_USB_PERMISSION -> {
            val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            val id = device?.deviceId ?: return
            val promises = synchronized(pendingPermissions) { pendingPermissions.remove(id) } ?: return
            promises.forEach { it.resolve(granted) }
          }
          UsbManager.ACTION_USB_DEVICE_ATTACHED -> device?.let { emitAttached(it) }
          UsbManager.ACTION_USB_DEVICE_DETACHED -> device?.let { onDetached(it) }
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(ACTION_USB_PERMISSION)
      addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
      addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(r, filter)
    }
    receiver = r
  }

  private fun onDetached(device: UsbDevice) {
    sessions.values.filter { it.device.deviceId == device.deviceId }.map { it.id }.forEach { id ->
      sendEvent("onError", mapOf("sessionId" to id, "code" to "E_DETACHED", "message" to "USB device detached"))
      closeSession(id)
    }
    sendEvent(
      "onDetached",
      mapOf("deviceId" to device.deviceId, "vendorId" to device.vendorId, "productId" to device.productId),
    )
  }

  private fun setLine(port: UsbSerialPort, baud: Int, dataBits: Int, stopBits: Double, parity: String) {
    val stop = when (stopBits) {
      1.5 -> UsbSerialPort.STOPBITS_1_5
      2.0 -> UsbSerialPort.STOPBITS_2
      else -> UsbSerialPort.STOPBITS_1
    }
    val par = when (parity) {
      "odd" -> UsbSerialPort.PARITY_ODD
      "even" -> UsbSerialPort.PARITY_EVEN
      "mark" -> UsbSerialPort.PARITY_MARK
      "space" -> UsbSerialPort.PARITY_SPACE
      else -> UsbSerialPort.PARITY_NONE
    }
    try {
      port.setParameters(baud, dataBits, stop, par)
    } catch (e: UnsupportedOperationException) {
      // CDC-ACM devices with native USB may not support line coding; the baud rate is irrelevant there.
    }
  }

  private fun open(deviceId: Int, options: OpenOptions): Map<String, Any?> {
    val driver = findDrivers().firstOrNull { it.device.deviceId == deviceId }
      ?: throw CodedException("E_USB_OPEN", "USB device not found", null)
    if (!usbManager.hasPermission(driver.device)) {
      throw CodedException("E_USB_PERMISSION", "USB permission not granted", null)
    }
    val connection = usbManager.openDevice(driver.device)
      ?: throw CodedException("E_USB_OPEN", "Could not open the USB device", null)
    val port = driver.ports.getOrNull(options.portIndex)
      ?: throw CodedException("E_USB_OPEN", "Port ${options.portIndex} does not exist", null)
    try {
      port.open(connection)
      setLine(port, options.baudRate, options.dataBits, options.stopBits, options.parity)
      runCatching { port.dtr = options.dtr }
      runCatching { port.rts = options.rts }
    } catch (e: Exception) {
      runCatching { port.close() }
      throw CodedException("E_USB_OPEN", e.message ?: "Could not open the serial port", e)
    }

    val id = UUID.randomUUID().toString()
    val buffer = ByteArrayOutputStream()
    val h = ioHandler()
    lateinit var session: Session
    val io = SerialInputOutputManager(port, object : SerialInputOutputManager.Listener {
      override fun onNewData(data: ByteArray) {
        synchronized(session.buffer) {
          session.buffer.write(data)
          if (session.buffer.size() >= session.flushBytes) {
            h.post { flush(session) }
          } else if (!session.flushScheduled) {
            session.flushScheduled = true
            h.postDelayed({ flush(session) }, session.flushMs)
          }
        }
      }

      override fun onRunError(e: Exception) {
        if (sessions.containsKey(id)) {
          sendEvent("onError", mapOf("sessionId" to id, "code" to "E_IO", "message" to (e.message ?: "I/O error")))
          closeSession(id)
        }
      }
    })
    session = Session(id, driver.device, port, io, buffer, options.readFlushMs, options.readFlushBytes)
    sessions[id] = session
    io.start()
    return mapOf("sessionId" to id)
  }

  private fun flush(session: Session) {
    val bytes: ByteArray
    synchronized(session.buffer) {
      session.flushScheduled = false
      if (session.buffer.size() == 0) return
      bytes = session.buffer.toByteArray()
      session.buffer.reset()
    }
    if (!sessions.containsKey(session.id)) return
    sendEvent(
      "onData",
      mapOf("sessionId" to session.id, "dataBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP), "bytes" to bytes.size),
    )
  }

  private fun closeSession(sessionId: String) {
    val session = sessions.remove(sessionId) ?: return
    runCatching { session.io.stop() }
    runCatching { session.port.close() }
  }
}
