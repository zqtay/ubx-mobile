package com.ubxmobile.androidgnss

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.GnssAntennaInfo
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.OnNmeaMessageListener
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartOptions : Record {
  @Field val minTimeMs: Long = 1000

  @Field val nmea: Boolean = true

  @Field val nmeaBatchMs: Long = 200
}

/**
 * Phone GNSS: location fixes, per-satellite status, first-fix TTFF, NMEA and device
 * capabilities (technical spec §5.1). Permissions are requested by JS (expo-location); this
 * module only checks them. All callbacks run on a dedicated HandlerThread.
 */
class AndroidGnssModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("E_NO_CONTEXT", "React context is not available", null)

  private val locationManager: LocationManager
    get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var locationListener: LocationListener? = null
  private var statusCallback: GnssStatus.Callback? = null
  private var nmeaListener: OnNmeaMessageListener? = null
  private var providerReceiver: BroadcastReceiver? = null
  private var antennaListener: Any? = null
  private var antennaInfos: List<Map<String, Any?>>? = null
  private val nmeaBuffer = ArrayList<Map<String, Any?>>()
  private var nmeaFlushScheduled = false

  override fun definition() = ModuleDefinition {
    Name("AndroidGnss")

    Events(
      "onLocation",
      "onGnssStatus",
      "onFirstFix",
      "onGnssStarted",
      "onGnssStopped",
      "onNmea",
      "onProviderChanged",
    )

    Function("hasFineLocationPermission") { hasFinePermission() }

    AsyncFunction("getDeviceInfo") { deviceInfo() }

    AsyncFunction("getProviderState") { providerState() }

    AsyncFunction("start") { options: StartOptions -> start(options) }

    AsyncFunction("stop") { stop() }

    Function("openLocationSettings") {
      context.startActivity(
        Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    Function("openAppSettings") {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    OnDestroy { stop() }
  }

  private fun hasFinePermission(): Boolean =
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun providerState(): Map<String, Any?> {
    val lm = locationManager
    val locationEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled else true
    val gpsEnabled = runCatching { lm.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)
    return mapOf("locationEnabled" to locationEnabled, "gpsProviderEnabled" to gpsEnabled)
  }

  @Suppress("DEPRECATION")
  private fun start(options: StartOptions) {
    if (!hasFinePermission()) {
      throw CodedException("E_PERMISSION", "Precise location permission is not granted", null)
    }
    if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)) {
      throw CodedException("E_NO_GNSS_HW", "This device has no GNSS receiver", null)
    }
    stop()
    val t = HandlerThread("AndroidGnss").apply { start() }
    val h = Handler(t.looper)
    thread = t
    handler = h
    val lm = locationManager

    registerProviderReceiver()

    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        sendEvent("onLocation", locationMap(location))
      }

      // Required on API < 30, where these were not default methods.
      @Deprecated("Deprecated in Java")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

      override fun onProviderEnabled(provider: String) {}

      override fun onProviderDisabled(provider: String) {}
    }
    locationListener = listener
    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, options.minTimeMs, 0f, listener, t.looper)

    val callback = object : GnssStatus.Callback() {
      override fun onStarted() {
        sendEvent("onGnssStarted", emptyMap<String, Any?>())
      }

      override fun onStopped() {
        sendEvent("onGnssStopped", emptyMap<String, Any?>())
      }

      override fun onFirstFix(ttffMillis: Int) {
        sendEvent("onFirstFix", mapOf("ttffMs" to ttffMillis))
      }

      override fun onSatelliteStatusChanged(status: GnssStatus) {
        sendEvent("onGnssStatus", mapOf("sats" to satellites(status), "atMs" to SystemClock.elapsedRealtime()))
      }
    }
    statusCallback = callback
    lm.registerGnssStatusCallback(callback, h)

    if (options.nmea) {
      val nmea = OnNmeaMessageListener { message, timestamp ->
        synchronized(nmeaBuffer) {
          nmeaBuffer.add(mapOf("timestampMs" to timestamp, "line" to message.trim()))
          if (!nmeaFlushScheduled) {
            nmeaFlushScheduled = true
            h.postDelayed({ flushNmea() }, options.nmeaBatchMs)
          }
        }
      }
      nmeaListener = nmea
      runCatching { lm.addNmeaListener(nmea, h) }
    }

    registerAntennaInfo()
  }

  @Suppress("DEPRECATION")
  private fun stop() {
    val lm = runCatching { locationManager }.getOrNull()
    locationListener?.let { l -> runCatching { lm?.removeUpdates(l) } }
    statusCallback?.let { c -> runCatching { lm?.unregisterGnssStatusCallback(c) } }
    nmeaListener?.let { n -> runCatching { lm?.removeNmeaListener(n) } }
    unregisterAntennaInfo()
    providerReceiver?.let { r -> runCatching { context.unregisterReceiver(r) } }
    locationListener = null
    statusCallback = null
    nmeaListener = null
    providerReceiver = null
    synchronized(nmeaBuffer) {
      nmeaBuffer.clear()
      nmeaFlushScheduled = false
    }
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    handler = null
    thread = null
  }

  private fun flushNmea() {
    val lines: List<Map<String, Any?>>
    synchronized(nmeaBuffer) {
      lines = ArrayList(nmeaBuffer)
      nmeaBuffer.clear()
      nmeaFlushScheduled = false
    }
    if (lines.isNotEmpty()) sendEvent("onNmea", mapOf("lines" to lines))
  }

  private fun registerProviderReceiver() {
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        sendEvent("onProviderChanged", providerState())
      }
    }
    val filter = IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
    providerReceiver = receiver
  }

  private fun satellites(status: GnssStatus): List<Map<String, Any?>> {
    val list = ArrayList<Map<String, Any?>>(status.satelliteCount)
    for (i in 0 until status.satelliteCount) {
      val sat = HashMap<String, Any?>()
      sat["constellationType"] = status.getConstellationType(i)
      sat["svid"] = status.getSvid(i)
      sat["cn0DbHz"] = status.getCn0DbHz(i).toDouble()
      sat["elevationDeg"] = status.getElevationDegrees(i).toDouble()
      sat["azimuthDeg"] = status.getAzimuthDegrees(i).toDouble()
      sat["hasAlmanac"] = status.hasAlmanacData(i)
      sat["hasEphemeris"] = status.hasEphemerisData(i)
      sat["usedInFix"] = status.usedInFix(i)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && status.hasCarrierFrequencyHz(i)) {
        sat["carrierHz"] = status.getCarrierFrequencyHz(i).toDouble()
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && status.hasBasebandCn0DbHz(i)) {
        sat["basebandCn0DbHz"] = status.getBasebandCn0DbHz(i)
      }
      list.add(sat)
    }
    return list
  }

  @Suppress("DEPRECATION")
  private fun locationMap(location: Location): Map<String, Any?> {
    val map = HashMap<String, Any?>()
    map["lat"] = location.latitude
    map["lon"] = location.longitude
    if (location.hasAltitude()) map["alt"] = location.altitude
    if (Build.VERSION.SDK_INT >= 34 && location.hasMslAltitude()) map["altMsl"] = location.mslAltitudeMeters
    if (location.hasAccuracy()) map["acc"] = location.accuracy.toDouble()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasVerticalAccuracy()) {
      map["vAcc"] = location.verticalAccuracyMeters.toDouble()
    }
    if (location.hasSpeed()) map["speed"] = location.speed.toDouble()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasSpeedAccuracy()) {
      map["speedAcc"] = location.speedAccuracyMetersPerSecond.toDouble()
    }
    if (location.hasBearing()) map["bearing"] = location.bearing.toDouble()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasBearingAccuracy()) {
      map["bearingAcc"] = location.bearingAccuracyDegrees.toDouble()
    }
    map["timeMs"] = location.time.toDouble()
    map["elapsedRealtimeNanos"] = location.elapsedRealtimeNanos.toDouble()
    map["isMock"] = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock else location.isFromMockProvider
    return map
  }

  private fun deviceInfo(): Map<String, Any?> {
    val lm = locationManager
    val info = HashMap<String, Any?>()
    info["manufacturer"] = Build.MANUFACTURER
    info["model"] = Build.MODEL
    info["androidRelease"] = Build.VERSION.RELEASE
    info["sdkInt"] = Build.VERSION.SDK_INT
    info["fingerprint"] = Build.FINGERPRINT
    info["hasGnssFeature"] = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info["gnssHardwareModelName"] = runCatching { lm.gnssHardwareModelName }.getOrNull()
      info["gnssYearOfHardware"] = runCatching { lm.gnssYearOfHardware }.getOrNull()
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      info["capabilities"] = capabilities(lm)
    }
    info["antennaInfos"] = antennaInfos
    return info
  }

  /**
   * Reports only the getters that exist on the running API level; a getter missing on an older
   * API (NoSuchMethodError) is caught and the capability left out ("not reported").
   */
  @Suppress("DEPRECATION", "NewApi")
  private fun capabilities(lm: LocationManager): Map<String, Boolean> {
    val caps = runCatching { lm.gnssCapabilities }.getOrNull() ?: return emptyMap()
    val result = LinkedHashMap<String, Boolean>()
    fun put(name: String, vararg getters: () -> Boolean) {
      for (getter in getters) {
        val value = runCatching { getter() }.getOrNull()
        if (value != null) {
          result[name] = value
          return
        }
      }
    }
    put("measurements", { caps.hasMeasurements() })
    put("navigationMessages", { caps.hasNavigationMessages() })
    put("lowPowerMode", { caps.hasLowPowerMode() })
    put("satelliteBlocklist", { caps.hasSatelliteBlocklist() })
    put("measurementCorrections", { caps.hasMeasurementCorrections() })
    put("antennaInfo", { caps.hasAntennaInfo() })
    put("satellitePvt", { caps.hasSatellitePvt() })
    put("measurementCorrelationVectors", { caps.hasMeasurementCorrelationVectors() })
    return result
  }

  @Suppress("NewApi")
  private fun registerAntennaInfo() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    runCatching {
      val listener = GnssAntennaInfo.Listener { infos ->
        antennaInfos = infos.map { a ->
          val pco = a.phaseCenterOffset
          mapOf(
            "carrierHz" to a.carrierFrequencyMHz * 1e6,
            "pcoXmm" to pco.xOffsetMm,
            "pcoYmm" to pco.yOffsetMm,
            "pcoZmm" to pco.zOffsetMm,
            "pcoXUncMm" to pco.xOffsetUncertaintyMm,
            "pcoYUncMm" to pco.yOffsetUncertaintyMm,
            "pcoZUncMm" to pco.zOffsetUncertaintyMm,
          )
        }
      }
      locationManager.registerAntennaInfoListener(context.mainExecutor, listener)
      antennaListener = listener
    }
  }

  @Suppress("NewApi")
  private fun unregisterAntennaInfo() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val listener = antennaListener as? GnssAntennaInfo.Listener ?: return
    runCatching { locationManager.unregisterAntennaInfoListener(listener) }
    antennaListener = null
  }
}
