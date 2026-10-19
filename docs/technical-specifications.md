# UBX Mobile — Technical Specification

| | |
|---|---|
| Document | Technical Specification |
| Status | Draft v0.1 |
| Date | 2026-10-18 |
| Implements | [requirements.md](requirements.md), [functional-specifications.md](functional-specifications.md) |

---

## 1. Technology stack

| Concern | Choice | Notes / rationale |
|---|---|---|
| Framework | **React Native (New Architecture)** via **Expo SDK** (latest stable at project start), using **development builds** (`expo-dev-client`) and **Continuous Native Generation** (`expo prebuild`) | Expo Modules API is the simplest way to write Kotlin native modules with typed TS bindings. Config plugins keep `AndroidManifest.xml` changes declarative. Expo Go **cannot** be used because of the custom native code. |
| Language | TypeScript (`strict: true`), Kotlin for native modules | |
| JS engine | Hermes | Default. |
| Navigation | **Expo Router** (file-based): JavaScript `Tabs` (`expo-router/tabs`) inside a root `Stack` | JS tabs rather than `NativeTabs`, because every main screen needs a header bar with the source status chip (`headerRight`). Tab icons come from `@expo/vector-icons` (MaterialCommunityIcons). |
| State | **Zustand** (+ `subscribeWithSelector`) | Small and fast. Works with an imperative accumulator outside React (§7). |
| Lists | **@shopify/flash-list** | Virtualised satellite list and console. |
| Graphics | **react-native-svg** | Sky plot, C/N0 gauge, signal chart. Re-evaluate **@shopify/react-native-skia** if profiling shows SVG is a bottleneck (heatmap, trails). |
| Sheets | Expo Router routes with `presentation: 'formSheet'` (native Android bottom sheet) | Receiver sheet (`src/app/source.tsx`) and satellite detail (`src/app/satellite/[key].tsx`). No extra library. Android form sheets have no header, so titles and close buttons are part of the content. |
| Animation / gestures | react-native-reanimated, react-native-gesture-handler | Navigation and gestures; smooth heading rotation (M6). |
| Persistence | **react-native-mmkv** v4 (+ `react-native-nitro-modules`) | Synchronous key-value store for settings and remembered source, used through zustand `persist` with a versioned schema. |
| Compass heading | `expo-location` `watchHeadingAsync` | True heading. Needs location permission, which the app already has. |
| Files / sharing | `expo-file-system`, `expo-sharing`, `expo-document-picker`, `expo-clipboard` | Logs, replay, share device info. |
| Keep awake | `expo-keep-awake` | REQ-SET-03. |
| i18n | `i18next` + `react-i18next` | English only in v1 (REQ-NFR-12). |
| USB serial (native) | **[usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android)** (mik3y, MIT), wrapped in a local Expo module | Mature drivers for CDC-ACM, FTDI, CP210x, PL2303, CH34x. |
| Phone GNSS (native) | Android `LocationManager` / `GnssStatus` / `OnNmeaMessageListener` / `GnssCapabilities`, wrapped in a local Expo module | No existing RN library exposes `GnssStatus`. |
| Unit tests | Jest (`jest-expo` preset), @testing-library/react-native | |
| E2E tests | **Maestro** | Runs against the Replay source for deterministic data. |
| Lint / format | ESLint (expo config + `@typescript-eslint`), Prettier | |

Library versions are pinned in `package.json`. The project was created on **Expo SDK 58 / React Native 0.88 / React 19.3 / TypeScript 6.0**. Upgrades follow Expo SDK releases and always go through `npx expo install`.

**Considered and rejected**

- *Bare React Native CLI*: also viable, but more manual native wiring and harder upgrades. Expo prebuild keeps the `android/` folder generated and reproducible.
- *Community RN USB serial packages*: most wrap the same Java library but are thinly maintained and lag behind New Architecture support. A small local module (~300 lines of Kotlin) is lower risk.
- *Parsing in Kotlin*: faster, but harder to unit-test and to reuse for the Replay source. Parsing in TS is chosen; see §7.4 for the fallback plan.

---

## 2. Architecture overview

```
┌──────────────────────────────── UI layer (React) ────────────────────────────────┐
│ Status   Satellites   Sky   Device   Console   Settings      (Expo Router screens)│
│        ▲ reads throttled snapshots via selectors                                 │
└────────┼─────────────────────────────────────────────────────────────────────────┘
         │
┌────────┴───────────────────────── State layer ───────────────────────────────────┐
│ gnssStore (Zustand)  ◄── commit @ UI refresh rate (1–5 Hz) ── GnssAccumulator    │
│ settingsStore (Zustand + MMKV)        consoleStore (ring buffer)                 │
└──────────────────────────────────────────────────────────▲───────────────────────┘
                                                           │ GnssEvent (normalised)
┌─────────────────────────────── Source layer (TS) ────────┴───────────────────────┐
│ SourceManager — owns at most one active GnssSource, lifecycle, AppState handling │
│                                                                                  │
│  AndroidLocationSource        UsbSerialSource                  ReplaySource       │
│    │                            │  ├─ ReceiverDetector / AutoBaud   │             │
│    │                            │  ├─ UbxClient (polls, ACK, cmds)  │             │
│    │                            │  └─ StreamDecoder ◄───────────────┘ (bytes)     │
│    │                            │        ├─ NmeaParser → NmeaAssembler            │
│    │                            │        └─ UbxParser  → UbxInterpreter           │
└────┼────────────────────────────┼────────────────────────────────────────────────┘
     │ events (JSON)              │ events (base64 byte chunks) / write()
┌────┴──────────────┐   ┌─────────┴───────────────┐
│ modules/          │   │ modules/usb-serial      │   Native (Kotlin, Expo Modules API)
│ android-gnss      │   │ usb-serial-for-android  │
│ LocationManager   │   │ UsbManager              │
└───────────────────┘   └─────────────────────────┘
```

Principles:

1. **Sources emit normalised `GnssEvent`s** (REQ-ARC-01). The UI never sees NMEA, UBX or Android types.
2. **Protocol code is pure TS** with no React and no native imports (REQ-ARC-02, REQ-NFR-11). It is unit-testable in Node.
3. **High-rate data never goes straight into React state.** It goes into a mutable `GnssAccumulator`, which a timer snapshots into Zustand at the UI refresh rate (REQ-NFR-03).

---

## 3. Project structure

```
ubx-mobile/
├─ src/
│  ├─ app/                           # Expo Router routes — every file is a screen (no tests here)
│  │  ├─ _layout.tsx                 # providers: theme, i18n, gesture root; sheet routes; restores last source
│  │  ├─ index.tsx                   # redirects to the default tab
│  │  ├─ (tabs)/
│  │  │  ├─ _layout.tsx              # bottom tabs + header with StatusChip
│  │  │  ├─ status.tsx
│  │  │  ├─ satellites.tsx
│  │  │  ├─ sky.tsx
│  │  │  ├─ device.tsx
│  │  │  └─ more.tsx
│  │  ├─ config/                     # receiver configuration stack (FS §11)
│  │  │  ├─ index.tsx                # overview
│  │  │  ├─ [section].tsx            # rate, port, gnss, messages, navigation, nmea, power
│  │  │  ├─ advanced.tsx             # all-keys browser/editor
│  │  │  └─ backups.tsx
│  │  ├─ console.tsx
│  │  ├─ settings.tsx
│  │  └─ about.tsx
│  ├─ __tests__/                     # screen-level tests
│  ├─ domain/                        # types + pure helpers shared by everything
│  │  ├─ types.ts                    # Constellation, Satellite, Signal, Fix, ReceiverInfo…
│  │  ├─ events.ts                   # GnssEvent contract (§7.1)
│  │  ├─ constellations.ts           # metadata: shapes, prefixes, colour tokens, SV labels
│  │  ├─ signals.ts                  # band/sigId/frequency tables
│  │  └─ satKey.ts                   # identity normalisation (§6.3)
│  ├─ protocols/
│  │  ├─ pipeline.ts                 # bytes → frames → events (USB + replay sources)
│  │  ├─ stream/StreamDecoder.ts     # byte demux: NMEA / UBX / RTCM3 / junk
│  │  ├─ nmea/{checksum,parser,sentences,interpreter}.ts
│  │  ├─ ubx/{checksum,builder,ids,messages,interpreter}.ts
│  │  └─ rtcm/crc24q.ts
│  ├─ sources/
│  │  ├─ GnssSource.ts               # interface + shared types
│  │  ├─ SourceManager.ts
│  │  ├─ android/AndroidLocationSource.ts
│  │  ├─ usb/{UsbSerialSource,UbxClient,ReceiverDetector,AutoBaud}.ts
│  │  ├─ index.ts                    # app-wide SourceManager, startSource/stopSource/restoreLastSource
│  │  └─ replay/{ReplaySource,epochs,demoLog}.ts  # log playback; demo log = simulated u-blox M10
│  ├─ config/                        # receiver configuration (§13)
│  │  ├─ keys/                       # CFG key database (generated tables + hand-written UI metadata)
│  │  ├─ valCodec.ts                 # key-ID size rules, value encode/decode, VALGET/VALSET/VALDEL builders
│  │  ├─ ConfigService.ts            # read layers, apply transactions, verify, save, revert, reset, baud change
│  │  ├─ configStore.ts              # loaded values per layer, staged edits, unsaved diff
│  │  ├─ rules.ts                    # lock-out rules, rate/throughput limits, constellation constraints
│  │  └─ backups.ts                  # JSON backup format, auto-backups, restore diff
│  ├─ state/{GnssAccumulator,gnssStore,selectors,settingsStore,storage,consoleStore}.ts
│  ├─ ui/
│  │  ├─ components/                 # StatusChip, Card, KeyValueRow, ConstellationBadge, Cn0Bar…
│  │  ├─ satellites/                 # SatelliteRow, SatelliteTable, SatelliteDetailSheet, FilterBar
│  │  ├─ sky/                        # SkyPlot, SkyGrid, SatMarker, Cn0Gauge, Legend, projection.ts
│  │  ├─ chart/SignalChart.tsx
│  │  └─ theme/{tokens,ThemeProvider}.ts
│  └─ i18n/en.json
├─ modules/
│  ├─ android-gnss/                  # local Expo module (Kotlin)
│  └─ usb-serial/                    # local Expo module (Kotlin)
├─ plugins/withUsbHost.ts            # config plugin: manifest + device_filter.xml
├─ assets/sample-logs/               # bundled replay logs (Could)
├─ test/fixtures/{nmea,ubx}/         # recorded + synthetic protocol fixtures
└─ e2e/                              # Maestro flows
```

---

## 4. Domain model (`src/domain/types.ts`)

```ts
export type Constellation =
  | 'GPS' | 'SBAS' | 'GALILEO' | 'BEIDOU' | 'QZSS' | 'GLONASS' | 'NAVIC' | 'IMES' | 'UNKNOWN';

/** Stable identity, e.g. "GPS:14", "GLONASS:5", "GLONASS:fcn-3", "QZSS:194" (§6.3). */
export type SatKey = string;

export type Health = 'healthy' | 'unhealthy' | 'unknown';
export type OrbitSource =
  | 'none' | 'ephemeris' | 'almanac' | 'assistnow-offline' | 'assistnow-autonomous' | 'other';

export interface SignalObs {
  /** Normalised band/signal code, e.g. 'L1CA', 'L2CL', 'L5Q', 'E1C', 'E5bI', 'B1I', 'B2a', 'G1'. */
  code: string;
  /** Human label, e.g. "L1C/A". */
  label: string;
  carrierHz?: number;
  cn0?: number;                // dB-Hz; undefined = not available, 0 = not tracked
  quality?: number;            // UBX qualityInd 0..7
  used?: boolean;              // prUsed
  prResidualM?: number;
  health?: Health;
  corrSource?: string;         // UBX NAV-SIG corrSource name
}

export interface Satellite {
  key: SatKey;
  constellation: Constellation;
  svid: number;                // constellation-native number (PRN/slot), §6.3
  glonassFcn?: number;         // -7..+6 when known
  cn0?: number;                // strongest signal C/N0; 0 = no signal; undefined = n/a
  elevation?: number;          // deg, undefined = unknown
  azimuth?: number;            // deg 0..360, undefined = unknown
  used?: boolean;
  hasEphemeris?: boolean;
  hasAlmanac?: boolean;
  hasAop?: boolean;            // AssistNow Autonomous orbit
  hasAno?: boolean;            // AssistNow Offline orbit
  health?: Health;
  quality?: number;            // 0..7
  prResidualM?: number;
  orbitSource?: OrbitSource;
  diffCorr?: boolean;
  corrections?: { sbas?: boolean; rtcm?: boolean; slas?: boolean; spartn?: boolean; clas?: boolean };
  basebandCn0?: number;        // Android API 30+
  signals: SignalObs[];
  /** Which origin last wrote each group of fields, for precedence (§7.2). */
  origin: SatOrigin;
  lastSeenMs: number;          // monotonic
}

export type SatOrigin = 'android' | 'ubx-nav-sat' | 'ubx-nav-svinfo' | 'nmea';

export type FixType =
  | 'none' | 'dead-reckoning' | '2d' | '3d' | 'gnss-dr' | 'time-only';
export type CarrierSolution = 'none' | 'float' | 'fixed';

export interface Fix {
  fixType: FixType;
  fixOk?: boolean;             // UBX gnssFixOK
  differential?: boolean;
  carrierSolution?: CarrierSolution;
  lat?: number; lon?: number;  // deg
  altEllipsoidM?: number; altMslM?: number;
  hAccM?: number; vAccM?: number;
  speedMps?: number; speedAccMps?: number;
  courseDeg?: number; courseAccDeg?: number;
  numSvUsed?: number;
  utc?: { epochMs: number; dateValid: boolean; timeValid: boolean; fullyResolved?: boolean };
  isMock?: boolean;            // Android
  receivedAtMs: number;
}

export interface Dop { g?: number; p?: number; t?: number; v?: number; h?: number; n?: number; e?: number }

export interface SessionInfo { startedAtMs: number; ttffMs?: number }

export type DeviceInfo = AndroidDeviceInfo | UsbDeviceInfo | ReplayDeviceInfo; // §5.1, §5.2

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting'; detail?: string }
  | { kind: 'detecting' }
  | { kind: 'receiving'; fix: FixType }
  | { kind: 'waiting'; sinceMs: number }
  | { kind: 'disconnected'; atMs: number }
  | { kind: 'error'; code: SourceErrorCode; message: string };

export interface GnssSnapshot {
  source: SourceKind | null;
  connection: ConnectionState;
  fix?: Fix;
  dop?: Dop;
  session?: SessionInfo;
  satellites: Satellite[];     // sorted by key; screens apply sort/filter
  device?: DeviceInfo;
  stats: StreamStats;
  stale: boolean;
}
```

**Rule:** `undefined` means "this source cannot provide the field" and the UI shows `—`. A numeric `0` is a real measured value (REQ-SAT-05).

---

## 5. Native modules

Both modules are **local Expo modules** (`npx create-expo-module@latest --local`), Android only. Their TS facades live in `modules/<name>/index.ts`.

### 5.1 `android-gnss`

```ts
// modules/android-gnss/index.ts
export interface AndroidGnssStartOptions {
  minTimeMs: number;          // location update interval, default 1000
  nmea: boolean;              // register OnNmeaMessageListener
  nmeaBatchMs: number;        // batch NMEA lines before emitting, default 200
}

export interface AndroidDeviceInfo {
  kind: 'android';
  manufacturer: string; model: string; androidRelease: string; sdkInt: number;
  fingerprint: string;
  gnssHardwareModelName?: string | null;     // API 28+
  gnssYearOfHardware?: number | null;        // API 28+
  capabilities?: Record<string, boolean>;    // API 30+, only keys the running API supports
  hasGnssFeature: boolean;                   // PackageManager.FEATURE_LOCATION_GPS
  antennaInfos?: Array<{ carrierHz: number; pcoXmm: number; pcoYmm: number; pcoZmm: number;
                         pcoXUncMm: number; pcoYUncMm: number; pcoZUncMm: number }>; // API 31+
}

export interface AndroidSvStatus {
  constellationType: number;  // GnssStatus.CONSTELLATION_*
  svid: number;
  cn0DbHz: number;
  elevationDeg: number;
  azimuthDeg: number;
  hasAlmanac: boolean;
  hasEphemeris: boolean;
  usedInFix: boolean;
  carrierHz?: number;         // API 26+, if hasCarrierFrequencyHz
  basebandCn0DbHz?: number;   // API 30+, if hasBasebandCn0DbHz
}

declare module AndroidGnss {
  function getDeviceInfo(): Promise<AndroidDeviceInfo>;
  function getProviderState(): Promise<{ locationEnabled: boolean; gpsProviderEnabled: boolean }>;
  function start(opts: AndroidGnssStartOptions): Promise<void>;
  function stop(): Promise<void>;
  function openLocationSettings(): void;

  // Events (Expo EventEmitter)
  // 'onLocation'        → { lat, lon, alt?, altMsl?, acc?, vAcc?, speed?, speedAcc?, bearing?, bearingAcc?, timeMs, elapsedRealtimeNanos, isMock }
  // 'onGnssStatus'      → { sats: AndroidSvStatus[], atMs }
  // 'onFirstFix'        → { ttffMs }
  // 'onGnssStarted' | 'onGnssStopped'
  // 'onNmea'            → { lines: Array<{ timestampMs: number; line: string }> }
  // 'onProviderChanged' → { locationEnabled, gpsProviderEnabled }
}
```

Implementation notes (Kotlin):

- `LocationManager.requestLocationUpdates(GPS_PROVIDER, minTimeMs, 0f, listener, looper)`. Use a dedicated `HandlerThread` looper so the main thread stays free.
- `registerGnssStatusCallback`: the executor overload on API 30+, the handler overload below that.
- `addNmeaListener`: the executor overload on API 30+, the handler overload below that. Lines are batched in a buffer and flushed every `nmeaBatchMs`.
- Altitude MSL: `Location.hasMslAltitude()/getMslAltitudeMeters()` on API 34+. Otherwise JS derives it from NMEA GGA.
- `isMock`: `Location.isMock()` on API 31+, `isFromMockProvider()` below.
- Capabilities: call `LocationManager.getGnssCapabilities()` (API 30+) and report each `has*()` getter that exists on the running API level (`Build.VERSION.SDK_INT` checks).
- Antenna info: `registerAntennaInfoListener` (API 31+) when `capabilities.hasAntennaInfo`.
- Provider changes: `BroadcastReceiver` for `LocationManager.PROVIDERS_CHANGED_ACTION`.
- The module never asks for permissions. JS asks through `expo-location` (`requestForegroundPermissionsAsync`), and the module checks that permission has been granted before `start()` and rejects with `E_PERMISSION` otherwise.
- **As built (M3):** the module lives in `modules/android-gnss` (hand-written from the Expo module template, autolinked as `:android-gnss`). The JS facade uses `requireOptionalNativeModule`, so it is `null` in Jest and the source reports `E_NO_GNSS_HW`. Extra functions: `hasFineLocationPermission()`, `openAppSettings()`. Capability getters are wrapped individually (`runCatching`), so a getter missing on the running API level is reported as "not reported" instead of crashing; the API-30 names `hasNavMessages`/`hasSatelliteBlacklist` are not used (removed from the public SDK). Antenna info uses `registerAntennaInfoListener` (API 30+).
- **`AndroidLocationSource`** (`src/sources/android/`): requests permission via `expo-location` (precise vs approximate via `android.accuracy`); merges dual-frequency GnssStatus entries of one SV into one satellite with per-band signals; applies the unknown-position rule; treats "no satellite used" as no fix (Android has no explicit fix-lost event); feeds the phone's NMEA through `NmeaInterpreter('android')` but keeps only DOP, TXT and MSL altitude (when `Location` has no MSL altitude). On resume after a permission error it re-checks without prompting, so granting permission in the app settings and returning restarts the source. Error banners map `E_PERMISSION` → "Allow location" (re-request, or app settings when blocked/approximate) and `E_PROVIDER_DISABLED` → "Turn on location" (location settings; the source resumes on the provider-changed broadcast).
- `stop()` unregisters every listener. The module also calls it from `OnDestroy`.

### 5.2 `usb-serial`

```ts
// modules/usb-serial/index.ts
export type UsbDriver = 'cdc-acm' | 'ftdi' | 'cp210x' | 'pl2303' | 'ch34x' | 'unknown';

export interface UsbSerialDevice {
  deviceId: number;           // UsbDevice.getDeviceId(), changes on replug
  deviceName: string;         // /dev/bus/usb/…
  vendorId: number; productId: number;
  manufacturerName?: string | null;
  productName?: string | null;
  serialNumber?: string | null;   // readable only after permission is granted
  driver: UsbDriver;
  portCount: number;
  hasPermission: boolean;
}

export interface UsbOpenOptions {
  portIndex?: number;         // default 0
  baudRate: number;           // ignored by CDC-ACM devices in practice
  dataBits?: 5 | 6 | 7 | 8;   // default 8
  stopBits?: 1 | 1.5 | 2;     // default 1
  parity?: 'none' | 'odd' | 'even' | 'mark' | 'space'; // default none
  dtr?: boolean; rts?: boolean;    // default true/true
  readFlushMs?: number;       // emit cadence, default 30
  readFlushBytes?: number;    // emit early above this size, default 16384
}

declare module UsbSerial {
  function isUsbHostSupported(): boolean;
  function listDevices(): Promise<UsbSerialDevice[]>;
  function requestPermission(deviceId: number): Promise<boolean>;
  function open(deviceId: number, opts: UsbOpenOptions): Promise<{ sessionId: string }>;
  function setParameters(sessionId: string, opts: Pick<UsbOpenOptions,'baudRate'|'dataBits'|'stopBits'|'parity'>): Promise<void>;
  function write(sessionId: string, dataBase64: string): Promise<number>;
  function close(sessionId: string): Promise<void>;
  function getLaunchDevice(): Promise<UsbSerialDevice | null>; // device from USB_DEVICE_ATTACHED launch intent

  // Events
  // 'onData'      → { sessionId, dataBase64, bytes }
  // 'onError'     → { sessionId, code: 'E_IO' | 'E_DETACHED', message }
  // 'onAttached'  → UsbSerialDevice
  // 'onDetached'  → { deviceId, vendorId, productId }
}
```

Implementation notes (Kotlin):

- **Prober**: `UsbSerialProber.getDefaultProber()` combined with a custom `ProbeTable` that maps u-blox VID `0x1546` (e.g. PIDs `0x01A7` u-blox 7, `0x01A8` u-blox 8, `0x01A9` u-blox 9/10, to be confirmed against real hardware) to `CdcAcmSerialDriver`. A device that is not in either table but exposes a CDC-ACM interface (class `0x02`/`0x0A`) also uses CDC-ACM.
- **Permission**: `UsbManager.requestPermission(device, pendingIntent)`. On API 31+ the `PendingIntent` must be `FLAG_MUTABLE`, and its intent must be explicit (`setPackage(context.packageName)`) for API 34+. Register the receiver with `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)`.
- **Reading**: `SerialInputOutputManager` (its own thread). `onNewData` appends to a `ByteArrayOutputStream`, and a scheduled flusher emits `onData` every `readFlushMs` or as soon as `readFlushBytes` have collected. Data is passed as **base64** (≤ ~92 KB/s at 921600 baud, so the overhead is acceptable). If profiling shows the bridge costs too much, switch to a JSI `ArrayBuffer`.
- **Writing**: a single-thread executor, `port.write(bytes, 500 ms)`.
- **Attach / detach**: a `BroadcastReceiver` for `UsbManager.ACTION_USB_DEVICE_ATTACHED/DETACHED`. When an open device detaches, emit `onError(E_DETACHED)` and release its resources.
- **Launch intent**: the main activity has an `intent-filter` for `USB_DEVICE_ATTACHED` plus `@xml/device_filter`. `getLaunchDevice()` reads `UsbManager.EXTRA_DEVICE` from the launch intent, and from `onNewIntent` when the activity is `singleTask`.
- **Sessions**: one open port per device. `sessionId` is a UUID. Every session is closed on module destroy.

### 5.3 Config plugin `plugins/withUsbHost.ts`

Adds to the generated `AndroidManifest.xml`:

```xml
<uses-feature android:name="android.hardware.usb.host" android:required="false"/>
<uses-feature android:name="android.hardware.location.gps" android:required="false"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>

<activity android:name=".MainActivity" android:launchMode="singleTask" …>
  <intent-filter>
    <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"/>
  </intent-filter>
  <meta-data android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"
             android:resource="@xml/device_filter"/>
</activity>
```

And writes `res/xml/device_filter.xml` (VIDs in decimal):

```xml
<resources>
  <usb-device vendor-id="5446"/>  <!-- 0x1546 u-blox -->
  <usb-device vendor-id="1027"/>  <!-- 0x0403 FTDI -->
  <usb-device vendor-id="4292"/>  <!-- 0x10C4 Silicon Labs CP210x -->
  <usb-device vendor-id="1659"/>  <!-- 0x067B Prolific PL2303 -->
  <usb-device vendor-id="6790"/>  <!-- 0x1A86 WCH CH34x -->
</resources>
```

Notes:

- `minSdkVersion` 26 (REQ-NFR-01). `targetSdkVersion` follows the Expo SDK default.
- The release build should not need `INTERNET`. If no dependency needs it at runtime, remove it with `android.blockedPermissions`. Verify this during M7.
- The background-recording service (REQ-NFR-09, Could) would add `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`/`_CONNECTED_DEVICE` and `POST_NOTIFICATIONS`. These are not included in v1.

---

## 6. Protocol layer

### 6.1 Stream decoder (`protocols/stream/StreamDecoder.ts`)

Takes `Uint8Array` chunks of any size and emits whole frames. The decoder is a byte-level state machine with a growable buffer (initial 64 KB):

| Lead byte(s) | Frame type | Delimiting | Validation |
|---|---|---|---|
| `$` (0x24) or `!` | NMEA | up to `\n` (accept `\r\n` or `\n`). Max 200 bytes, else drop | `*hh` XOR checksum over the bytes between `$` and `*`. A missing checksum is accepted but counted as `nmeaNoChecksum` |
| `0xB5 0x62` | UBX | 6-byte header + `len` + 2 checksum bytes. `len` > 8192 → resync | 8-bit Fletcher over class..payload |
| `0xD3` | RTCM3 | 3-byte header (10-bit length) + payload + CRC-24Q | CRC-24Q, then count and skip (not decoded in v1) |
| anything else | junk | skip byte, `stats.junkBytes++` | — |

- On a checksum failure, the decoder **resyncs from the byte after the lead byte**, not after the claimed frame end (REQ-NFR-05).
- Output: `{ kind: 'nmea', text, rxMs } | { kind: 'ubx', cls, id, payload: DataView, rxMs } | { kind: 'rtcm3', type, length }`.
- Stats: bytes, frames per type, checksum errors per type, junk bytes, last-frame time. These feed REQ-DEV-08.

### 6.2 NMEA

**Sentences parsed:** GGA, RMC, GSA, GSV, GLL, VTG, GNS, ZDA, TXT (plus GST, Could). Unknown sentences are counted and shown in the Console only.

**Talker → constellation:** `GP` GPS · `GL` GLONASS · `GA` Galileo · `GB`/`BD` BeiDou · `GQ`/`QZ` QZSS · `GI` NavIC · `GN` combined (constellation from SV number or system ID) · `GS`? SBAS (rare).

**GSV assembly** (`nmea/assembler.ts`):

- Field layout: `numMsg, msgNum, numSv, {svid, elev, az, cn0} × 1..4, [signalId]`. The trailing `signalId` (NMEA 4.10+) is present when `(fieldCount − 3) % 4 == 1`.
- Groups are keyed by `(talker, signalId)`. A group is complete when `msgNum == numMsg`. At completion its SVs replace the previous set for that key. An incomplete group is discarded if a new `msgNum == 1` arrives for the same key.
- Empty `elev`/`az` → unknown. Empty `cn0` → `0` (not tracked).

**GSA (used-in-fix):** each GSA lists up to 12 SV numbers used. Under the `GN` talker there is one GSA per system, with a trailing **system ID** in 4.10+ (`1` GPS, `2` GLONASS, `3` Galileo, `4` BeiDou, `5` QZSS, `6` NavIC). The used set for an epoch is the union of all GSAs between two time-bearing sentences (GGA/RMC/GNS) with different timestamps. PDOP/HDOP/VDOP are taken from the last GSA.

**Epoch boundary:** a new UTC time in GGA/RMC/GNS closes the previous epoch, and its fix, DOP and used-set are emitted as one `GnssEvent` batch.

**NMEA version detection** (shown on the Device screen): GSV signal ID or GSA system ID present → `≥ 4.10`. RMC with nav-status field → `4.10+`. Mode indicator in RMC/GLL/VTG → `≥ 2.3`. Otherwise `≤ 2.2 / unknown`.

### 6.3 Satellite identity normalisation (`domain/satKey.ts`)

All sources map to `(constellation, svid)` using the constellation's native numbering:

| Constellation | Native svid used in key | UBX gnssId / svId | Android `CONSTELLATION_*` / svid | NMEA 4.10+ strict (talker + number) | NMEA "extended" numbering (u-blox NMEA 4.0 mode & others) |
|---|---|---|---|---|---|
| GPS | PRN 1–32 | 0 / 1–32 | `GPS`(1) / 1–32 | GP 1–32 | 1–32 |
| SBAS | PRN 120–158 | 1 / 120–158 | `SBAS`(2) / 120–192 | GP/GS 33–64 (PRN − 87) | 33–64, 152–158 |
| Galileo | 1–36 | 2 / 1–36 | `GALILEO`(6) / 1–36 | GA 1–36 | 301–336 |
| BeiDou | 1–63 | 3 / 1–63 | `BEIDOU`(5) / 1–63 | GB 1–63 | 401–437 (some vendors: 201–237) |
| IMES | 1–10 | 4 / 1–10 | — | — | 173–182 |
| QZSS | PRN 193–202 | 5 / 1–10 (→ +192) | `QZSS`(4) / 193–200 | GQ 1–10 (→ +192) | 193–202 |
| GLONASS | slot 1–24 (`fcn-<k>` if slot unknown) | 6 / 1–24, 255 = unknown | `GLONASS`(3) / 1–24 slot, or 93–106 = FCN + 100 | GL 65–96 (− 64) | 65–96 |
| NavIC | 1–14 | 7 / 1–14 | `IRNSS`(7) / 1–14 | GI 1–14 | — |

Legacy **UBX NAV-SVINFO** svid ranges: GPS 1–32, SBAS 120–158, Galileo 211–246, BeiDou 159–163 and 33–64, GLONASS 65–96, QZSS 193–197, unknown 255.

**Display labels** (setting REQ-SET-02):

- u-center style: `G14`, `R5`, `E16`, `B25`, `Q2` (QZSS PRN − 192), `S123`, `N3`.
- RINEX style: `G14`, `R05`, `E16`, `C25`, `J02`, `S23` (PRN − 100), `I03`.

### 6.4 Signal / band identification (`domain/signals.ts`)

**UBX NAV-SIG `(gnssId, sigId)`** → code/label (verify against the u-blox Interface Description of the target firmware):

| gnssId | sigId → signal |
|---|---|
| GPS (0) | 0 L1C/A · 3 L2 CL · 4 L2 CM · 6 L5 I · 7 L5 Q |
| SBAS (1) | 0 L1C/A |
| Galileo (2) | 0 E1 C · 1 E1 B · 3 E5a I · 4 E5a Q · 5 E5b I · 6 E5b Q · 8 E6 B · 9 E6 C · 10 E6 A |
| BeiDou (3) | 0 B1I D1 · 1 B1I D2 · 2 B2I D1 · 3 B2I D2 · 5 B1C · 7 B2a |
| QZSS (5) | 0 L1C/A · 1 L1S · 4 L2 CM · 5 L2 CL · 8 L5 I · 9 L5 Q |
| GLONASS (6) | 0 L1 OF · 2 L2 OF |
| NavIC (7) | 0 L5 A |

**NMEA 4.11 GSV signal ID** (the most common ones; the full table follows NMEA 0183 v4.11):

| Talker | Signal ID → signal |
|---|---|
| GP | 1 L1 C/A · 5 L2C-M · 6 L2C-L · 7 L5-I · 8 L5-Q |
| GL | 1 G1 C/A · 3 G2 C/A |
| GA | 1 E5a · 2 E5b · 6 E1-A · 7 E1-B/C |
| GB | 1 B1I · 3 B1C · 5 B2a · B (hex) B2I |
| GQ | 1 L1 C/A · 4 L1S · 5 L2C-M · 6 L2C-L · 7 L5-I · 8 L5-Q |
| GI | 1 L5-SPS |

**Android carrier frequency** → band. Match within ±1 MHz (GLONASS FDMA uses ranges):

| Frequency (MHz) | GPS / QZSS | Galileo | BeiDou | GLONASS | NavIC / SBAS |
|---|---|---|---|---|---|
| 1575.42 | L1 | E1 | B1C | — | SBAS L1 |
| 1561.098 | — | — | B1I | — | — |
| 1598.0–1606.0 | — | — | — | G1 | — |
| 1227.60 | L2 | — | — | — | — |
| 1242.0–1249.0 | — | — | — | G2 | — |
| 1176.45 | L5 | E5a | B2a | — | NavIC L5, SBAS L5 |
| 1207.14 | — | E5b | B2I/B2b | — | — |
| 1268.52 | — | — | B3I | — | — |
| 1278.75 | QZSS L6 | E6 | — | — | — |

### 6.5 UBX

**Framing:** `B5 62 | class | id | len (u16 LE) | payload | CK_A CK_B`. Checksum: 8-bit Fletcher over `class, id, len, payload`. All multi-byte fields are little-endian. Implemented with `DataView` (`getUint16(off, true)`, etc.).

**Messages decoded** (offsets in bytes; scale shown):

| Message | Class/ID | Len | Fields used |
|---|---|---|---|
| NAV-PVT | 01 07 | 92 | `year`4 `month`6 `day`7 `hour`8 `min`9 `sec`10 `valid`11 (bit0 date, bit1 time, bit2 fullyResolved) `tAcc`12 `nano`16 `fixType`20 (0 none, 1 DR, 2 2D, 3 3D, 4 GNSS+DR, 5 time) `flags`21 (bit0 gnssFixOK, bit1 diffSoln, bits6–7 carrSoln) `numSV`23 `lon`24 `lat`28 (1e-7°) `height`32 `hMSL`36 (mm) `hAcc`40 `vAcc`44 (mm) `gSpeed`60 (mm/s) `headMot`64 (1e-5°) `sAcc`68 (mm/s) `headAcc`72 (1e-5°) `pDOP`76 (0.01) |
| NAV-SAT | 01 35 | 8 + 12·n | header: `version`4 `numSvs`5. Block: `gnssId`0 `svId`1 `cno`2 `elev`3 (I1) `azim`4 (I2) `prRes`6 (I2, 0.1 m) `flags`8 (X4, below) |
| NAV-SIG | 01 43 | 8 + 16·n | header: `version`4 `numSigs`5. Block: `gnssId`0 `svId`1 `sigId`2 `freqId`3 `prRes`4 (I2, 0.1 m) `cno`6 `qualityInd`7 `corrSource`8 `ionoModel`9 `sigFlags`10 (X2: bits0–1 health, bit2 prSmoothed, bit3 prUsed, bit4 crUsed, bit5 doUsed, bits6–8 pr/cr/doCorrUsed) |
| NAV-DOP | 01 04 | 18 | `gDOP`4 `pDOP`6 `tDOP`8 `vDOP`10 `hDOP`12 `nDOP`14 `eDOP`16 (U2, 0.01) |
| NAV-STATUS | 01 03 | 16 | `gpsFix`4 `flags`5 `ttff`8 (U4 ms) `msss`12 |
| NAV-SVINFO (legacy) | 01 30 | 8 + 12·n | header: `numCh`4. Block: `svid`1 `flags`2 (bit0 svUsed, bit1 diffCorr, bit2 orbitAvail, bit3 orbitEph, bit4 unhealthy, bit5 orbitAlm, bit6 orbitAop, bit7 smoothed) `quality`3 `cno`4 `elev`5 `azim`6 (I2) `prRes`8 (I4, cm) |
| NAV-TIMELS (Could) | 01 26 | 24 | `currLs`9, `validCurrLs` flag |
| MON-VER | 0A 04 | 40 + 30·n | `swVersion` char[30] at 0, `hwVersion` char[10] at 30, then `extension` char[30] × n (e.g. `ROM BASE …`, `FWVER=HPG 1.32`, `PROTVER=27.31`, `MOD=ZED-F9P`, `GPS;GLO;GAL;BDS`, `SBAS;QZSS`). Null-terminated strings |
| MON-HW (gen ≤ 8) | 0A 09 | 60 | `noisePerMS`16 `agcCnt`18 (0–8191) `aStatus`20 (0 INIT, 1 DONTKNOW, 2 OK, 3 SHORT, 4 OPEN) `aPower`21 (0 OFF, 1 ON, 2 DONTKNOW) `flags`22 (bits2–3 jammingState) `jamInd`45 |
| MON-RF (gen ≥ 9) | 0A 38 | 4 + 24·n | header: `nBlocks`1. Block: `blockId`0 `flags`1 (bits0–1 jammingState) `antStatus`2 `antPower`3 `noisePerMS`12 `agcCnt`14 `jamInd`16 |
| MON-GNSS | 0A 28 | 8 | `supported`1 `defaultGnss`2 `enabled`3 (bit0 GPS, bit1 GLONASS, bit2 BeiDou, bit3 Galileo) `simultaneous`4 |
| SEC-UNIQID | 27 03 | 9 or 10 | `version`0. `uniqueId` 5 bytes (v1) or 6 bytes (v2) at offset 4. Shown as hex |
| ACK-ACK / ACK-NAK | 05 01 / 05 00 | 2 | `clsID`, `msgID` |
| INF-ERROR/WARNING/NOTICE/TEST/DEBUG | 04 00..04 | var | ASCII text → Device "Info messages" + Console |
| CFG-VALGET | 06 8B | var | Poll: `version`0 (=0) `layer`1 (0 RAM, 1 BBR, 2 Flash, 7 Default) `position`2 (U2) + key IDs (U4 × ≤ 64). Response: `version`0 (=1) `layer`1 `position`2 + key/value pairs (value size from the key ID). See §13 |
| CFG-VALSET | 06 8A | var | `version`0 (0 = single message, 1 = with transaction) `layers`1 (bit0 RAM, bit1 BBR, bit2 Flash) `transaction`2 (v1: 0 none, 1 begin, 2 continue, 3 apply/end) + key/value pairs (≤ 64). Configuration channel only, except RAM `CFG-MSGOUT-*` for REQ-SER-09 |
| CFG-VALDEL | 06 8C | var | `version`0 `layers`1 (bit1 BBR, bit2 Flash) `transaction`2 + key IDs. Used for Revert / factory reset |
| CFG-RST | 06 04 | 4 | `navBbrMask`0 (X2: 0x0000 hot, 0x0001 warm, 0xFFFF cold) `resetMode`2 (0x02 = controlled GNSS-only software reset; 0x01 controlled software reset, used after a factory reset) |
| CFG-CFG (legacy, also gen ≥ 9 for clear) | 06 09 | 12/13 | `clearMask` `saveMask` `loadMask` (X4) [`deviceMask`]. Factory reset on gen ≤ 8; save/load on gen ≤ 8 |

**NAV-SAT `flags` (X4) decoding:**

| Bits | Field | Mapping |
|---|---|---|
| 0–2 | qualityInd | 0 no signal · 1 searching · 2 acquired · 3 detected but unusable · 4 code locked & time sync · 5–7 code & carrier locked & time sync |
| 3 | svUsed | `used` |
| 4–5 | health | 0 unknown · 1 healthy · 2 unhealthy |
| 6 | diffCorr | `diffCorr` |
| 7 | smoothed | (detail only) |
| 8–10 | orbitSource | 0 none · 1 ephemeris · 2 almanac · 3 AssistNow Offline · 4 AssistNow Autonomous · 5–7 other |
| 11 / 12 / 13 / 14 | ephAvail / almAvail / anoAvail / aopAvail | booleans |
| 16 / 17 / 18 / 19 | sbasCorrUsed / rtcmCorrUsed / slasCorrUsed / spartnCorrUsed | `corrections.*` |
| 20 / 21 / 22 | prCorrUsed / crCorrUsed / doCorrUsed | detail only |
| 23 | clasCorrUsed | `corrections.clas` |

**UBX builder** (`ubx/builder.ts`): `buildUbx(cls, id, payload?: Uint8Array): Uint8Array`. A poll is `buildUbx(cls, id)` with an empty payload.

### 6.6 `UbxClient` (`sources/usb/UbxClient.ts`)

Handles all outgoing traffic to a u-blox receiver. It has **two channels with separate permissions** (REQ-SER-08):

- **Monitoring channel** (`client.monitor`), used by the source, detector and poll scheduler. It can only send:
  - polls (empty payload) of NAV-PVT, NAV-SAT, NAV-SIG, NAV-DOP, NAV-STATUS, NAV-SVINFO, NAV-TIMELS, MON-VER, MON-HW, MON-RF, MON-GNSS, SEC-UNIQID;
  - CFG-VALGET (read);
  - **only if the user opted in** to REQ-SER-09: CFG-VALSET with `layers = 0x01 (RAM)`, keys restricted to `CFG-MSGOUT-*` (legacy: CFG-MSG 3-byte form, rate 0/1).

  A unit test asserts that the monitoring channel cannot send CFG-VALSET to BBR/Flash, CFG-VALDEL, CFG-CFG, CFG-RST or `UPD-*`.
- **Configuration channel** (`client.configure(request)`), used only by the Configuration feature (§13). It accepts a `ConfigWriteRequest` object that can only be created by the configuration store's user-action handlers (Apply, Save, Revert, Restart, Factory reset, Restore). The request carries the action, the key/value list, the target layers and a timestamp. The channel can send CFG-VALSET (any layer), CFG-VALDEL, CFG-RST (GNSS-only and controlled software resets), and legacy CFG-CFG/CFG-PRT/CFG-RATE/CFG-MSG/CFG-GNSS/CFG-NAV5 (REQ-CFG-19). `UPD-*` and firmware messages are never buildable. Every request is written to the diagnostics log (REQ-CFG-22).
- **Mutual exclusion:** while a configuration request is in flight, the poll scheduler pauses (FS §11.7).
- **Request tracking:** at most one outstanding poll per `(cls, id)`. Timeout 1500 ms, 2 retries. A response is any frame with the same `(cls, id)`. For CFG messages it is ACK-ACK/NAK.
- **Capability learning:** ACK-NAK, or 3 consecutive timeouts → mark `(cls,id)` unsupported for the session. Fallbacks: NAV-SAT → NAV-SVINFO; MON-RF → MON-HW; NAV-SIG → none.
- **Poll scheduler** (Poll mode, the default): every 1000 ms, poll each supported periodic message **unless** that message arrived unsolicited in the last 1500 ms (the receiver already outputs it).
- **Periodic mode** (opt-in): on gen ≥ 9 (detected by an ACKed CFG-VALGET, or by PROTVER ≥ 27), CFG-VALSET RAM with the message-output keys for the **port the app is connected through**: `*_USB` for CDC-ACM devices, `*_UART1` for UART bridges (overridable in Settings). On gen ≤ 8, use CFG-MSG with the 3-byte payload, which sets the rate on the current port. The exact key IDs are taken from the Interface Description of the target firmware and kept in `ubx/ids.ts`.

### 6.7 Receiver detection & auto-baud (`ReceiverDetector`, `AutoBaud`)

```
open(port, baud = remembered ?? 38400 for bridges / n.a. for CDC)   # 38400 = u-blox M10 / BE-122 default
└─ listen 2 s ─┬─ valid frames ≥ 3 ─► probe (if enabled): MON-VER, SEC-UNIQID, MON-GNSS, MON-RF→MON-HW
               │                        ├─ MON-VER reply ─► vendor = u-blox, parse PROTVER/MOD/FWVER
               │                        └─ no reply (3 s) ─► vendor = generic NMEA
               └─ none ─► (bridge && autoBaud) ? next baud in [38400, 9600, 115200, 230400, 460800, 921600, 4800, 19200, 57600]
                                               : state 'waiting' + hint
```

- "Valid frames" means frames that pass their checksum. Junk alone never counts as detection.
- Auto-baud uses `setParameters` without closing the port and listens 1.5 s per rate (≈ 14 s worst case).
- **As built (M4, `src/sources/usb/detection.ts`):** order = remembered baud, then 38400, 115200, 57600, 9600, 230400, 460800, 921600, 4800, 19200. At each rate the detector listens 1.2 s for ≥ 2 valid frames; if the rate is silent and *Probe for UBX* is on, it sends a MON-VER poll and waits 1 s for any UBX frame. Probing is required because a receiver can be configured to output nothing (the BE-122). A fixed baud setting tries only that rate; native USB (CDC-ACM) tries one rate. The detected baud is saved per device (`VID:PID:serial`) in settings v3.
- The detected baud is remembered per device, keyed by `VID:PID:serial`. Many cheap CH34x adapters report no USB serial number, so for those the key falls back to `VID:PID`.

**Reference receiver (Beitian BE-122, u-blox M10) — expected behaviour:**

- It arrives through a UART bridge (CP210x/CH34x/FTDI adapter). The `driver` is the adapter's, and the USB descriptor names the adapter, not the GNSS module. The Device screen must therefore make clear that the **USB device** card describes the adapter and the **Receiver** card describes the module (from MON-VER).
- Its UART runs at 57600 with all output off (see requirements §9): auto-baud finds it at the third rate by probing (about 6 s); after that, the remembered baud finds it on the first try.
- PROTVER ≥ 34 → generation-9+ paths: CFG-VALGET, MON-RF (not MON-HW), NAV-SAT, NAV-SIG (single-band, one L1/E1/B1 signal per SV).
- Periodic-mode keys, if the user opts in: the `*_UART1` variants.

---

## 7. State management & data flow

### 7.1 Event contract

Defined in `src/domain/events.ts` (so protocol code does not depend on the source layer):

```ts
export type GnssEvent =
  | { t: 'fix'; fix: Partial<Fix>; origin: 'android' | 'ubx' | 'nmea' }
  | { t: 'dop'; dop: Dop; origin: 'android-nmea' | 'ubx' | 'nmea' }
  | { t: 'satellites'; origin: SatOrigin; scope: string; sats: SatObservation[] } // scope: 'all' or a GSV group key
  | { t: 'signals'; signals: Array<{ key: SatKey; constellation; svid; glonassFcn? } & SignalObs> } // UBX NAV-SIG
  | { t: 'used'; scope: 'all' | Constellation; keys: SatKey[] }      // NMEA GSA
  | { t: 'ttff'; ms: number }
  | { t: 'receiver'; patch: Partial<ReceiverInfo> }                  // identity learned from the stream
  | { t: 'info'; level: InfoLevel; text: string; origin: string }   // NMEA TXT, UBX-INF
  | { t: 'connection'; state: ConnectionState }
  | { t: 'stats'; stats: StreamStats };
```

Transport-specific device info (Android phone details, USB descriptor) is added by the sources in M3/M4. Console entries are produced from decoder frames by the Console feature (M6), not from this contract.

NMEA interpretation details: GGA/RMC/GNS/VTG/GLL produce partial fix updates immediately. Consecutive GSA sentences form one used-in-fix set, emitted (with DOP) when the next non-GSA sentence arrives, which works for any sentence order. An NMEA-only receiver's TTFF is measured by the accumulator, from session start to the first position fix, until a receiver-reported TTFF (UBX NAV-STATUS, Android `onFirstFix`) replaces it.

```ts
export interface GnssSource {
  readonly kind: 'android' | 'usb' | 'replay';
  start(onEvent: (e: GnssEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
```

### 7.2 `GnssAccumulator` (mutable, outside React)

- Holds the current `Fix`, `Dop`, `Map<SatKey, Satellite>`, `DeviceInfo` and stats, and applies events in O(n).
- **Precedence** (REQ-SER-10): `ubx-nav-sat` > `ubx-nav-svinfo` > `nmea`. A lower-ranked origin may update a satellite only if no higher-ranked origin has updated that satellite in the last `3 s`. Fix and DOP follow the same rule: `ubx` > `nmea`. On the Android source, `android` data wins and `android-nmea` only fills DOP and MSL altitude.
- A `satellites` event with scope `X` replaces the set for scope `X` from that origin. SVs that are in the scope but missing from the event are not deleted immediately. They age out by `lastSeenMs` (satellite timeout).
- `signals` events attach signal lists to existing satellites (or create them), and `cn0` on the satellite becomes the max over its signals when the origin has no per-SV C/N0.
- **Commit:** a `setInterval` at the UI refresh rate builds an immutable `GnssSnapshot` only if a `dirty` flag is set, and calls `gnssStore.setState`. Satellite objects that did not change keep the same reference, so memoised rows skip re-rendering.

### 7.3 Stores

| Store | Content | Persistence |
|---|---|---|
| `gnssStore` | `GnssSnapshot` | none |
| `settingsStore` | All settings (FS §9), satellite sort/filter, remembered source/device/baud | MMKV (versioned schema with migrations) |
| `consoleStore` | Ring buffer of 2,000 `ConsoleEntry` + paused flag + dropped count | none |
| `uiStore` | Selected satellite (detail sheet), sky orientation mode | none |
| `configStore` | Receiver configuration: values per layer, staged edits, apply/save status (§13.3) | Backups only, as files in app storage |

Derived data (filtered and sorted satellite list, per-constellation counts, average C/N0) is computed with memoised selectors in `src/state/selectors.ts`, so the list and the sky view use the same logic.

### 7.4 Performance budget

| Item | Budget | Measured how |
|---|---|---|
| Decode 921600-baud stream (≈ 92 KB/s) | ≤ 15% of the JS thread on the reference mid-range device | Replay at max speed with Hermes sampling profiler |
| Snapshot commit + render (60 SVs) | ≤ 16 ms per commit | React Profiler / Flashlight |
| Sky plot render (60 markers + labels) | ≤ 8 ms | React Profiler |
| Memory | < 200 MB RSS steady state | Android Studio profiler |

**Fallback if the decoding budget is missed:** move `StreamDecoder` and the parsers onto a background JS runtime (`react-native-worklets-core`), or port only the framing (StreamDecoder) to Kotlin and emit framed messages. The pure-TS design allows either without changing the UI.

---

## 8. UI implementation notes

### 8.1 Sky plot (`ui/sky/`)

- `projection.ts`: `project(el, az, R, rot) → {x, y}` with `r = R·(90 − el)/90`, `x = R + r·sin(az − rot)`, `y = R − r·cos(az − rot)` (angles in radians). Unit-tested for N/E/S/W/zenith/horizon.
- Layers (separate memoised components):
  1. `SkyGrid`: rings and spokes. Re-renders only on size, theme, dense-grid or rotation changes.
  2. `Heatmap` (Could): 24 × 9 annular sectors as SVG `Path`s.
  3. `Trails` (Should): one `Polyline` per SV from a per-key ring buffer, sampled every 10 s.
  4. `Markers`: shapes from `constellations.ts` (`circle`, `rect`, `polygon` paths precomputed per size).
  5. `Labels`: greedy placement. Try below, right, above and left of the marker, and keep the first box that does not collide with earlier boxes or the plot rim.
- The **demo receiver** (`sources/replay/demoLog.ts`) generates a deterministic 3-minute log as a u-blox M10 would output it (NMEA 4.11 + UBX NAV-PVT/SAT/SIG/DOP/STATUS, MON-VER, SEC-UNIQID, MON-RF): 22 satellites in six constellations drifting across the sky, C/N0 rising with elevation, one unhealthy satellite, one without orbit data, one blocked, and a 3 s acquisition before the first fix. `ReplaySource` splits any log into epochs (by UBX iTOW, or NMEA time when there is no UBX; never mixed, because the clocks differ by leap seconds) and plays one epoch per second through the same `ProtocolPipeline` as USB.
- Hit testing: one `Pressable` overlay. On press, find the nearest projected marker within 24 dp (O(n), n ≤ ~150).
- Heading-up: `watchHeadingAsync` → low-pass filter (α = 0.2) → throttle to 10 Hz → `rot`. Labels stay upright because positions are recomputed instead of rotating the whole SVG.

### 8.2 Satellite list

- `FlashList` with stable `keyExtractor = sat.key` and `estimatedItemSize = 56`.
- `SatelliteRow` is wrapped in `React.memo`, comparing `sat` by reference (the accumulator keeps references stable).
- Width ≥ 600 dp → `SatelliteTable` (horizontal `ScrollView` with a pinned first column).
- Re-sorting is held while the user touches the list and for 1 s afterwards (FS §4.5): the previous order is kept and only the row contents update.

### 8.3 Theming

`ui/theme/tokens.ts` defines semantic tokens (`bg`, `surface`, `text`, `textMuted`, `grid`, `fix.*`, `gnss.*`, `cn0.stops`) for light and dark themes. Components use only tokens. Contrast ratios are checked by a unit test for text tokens (WCAG AA 4.5:1).

### 8.4 Lifecycle

- `SourceManager` subscribes to `AppState`. On `background`, it stops the active source and keeps the snapshot as stale. On `active`, it restarts the source (USB only if the device is still attached and permission is held).
- Keep-awake is active while a source is running and the setting is on.

---

## 9. Error handling

| Code | Origin | User-facing handling (FS §10) |
|---|---|---|
| `E_PERMISSION` | Android location permission missing | Permission state + action |
| `E_PROVIDER_DISABLED` | Location/GPS off | Banner + open settings |
| `E_NO_GNSS_HW` | No `FEATURE_LOCATION_GPS` | Disable phone option |
| `E_USB_UNSUPPORTED` | No USB host feature | Disable USB option |
| `E_USB_PERMISSION` | User denied USB permission | Inline error + retry |
| `E_USB_OPEN` | Driver failed to open | Error + retry |
| `E_IO` | Read/write failure | Auto retry ×1, then error |
| `E_DETACHED` | Device unplugged | Disconnected + auto-reconnect |
| `E_NO_DATA` | Nothing valid within the timeout | Waiting + baud hint |

All errors are written to a diagnostics ring log (500 entries) that the user can share from About (REQ-LOG-03). Parser exceptions are caught per frame, counted, and never propagate past the decoder.

---

## 10. Testing strategy

| Level | Scope | Tools | Target |
|---|---|---|---|
| Unit | Checksums, NMEA sentences, GSV assembly, GSA used-sets, UBX message decoders, flag decoding, satKey normalisation, signal tables, projection, cn0 scale, accumulator precedence/ageing, UbxClient channel permissions & retry logic, CFG key encoding/decoding, VALSET transaction chunking, staged-edit diffing, lock-out rules, baud-change state machine, backup/restore round-trip | Jest | ≥ 90% lines in `src/protocols`, `src/domain`, `src/state` |
| Fuzz | StreamDecoder with random bytes, truncated and corrupted frames, interleaved NMEA/UBX/RTCM | Jest + `fast-check` | No exceptions. Valid frames inside noise are all recovered |
| Component | SatelliteRow states, SkyPlot marker placement, Device cards with missing fields | @testing-library/react-native | Key states covered |
| E2E | Launch → demo receiver → verify Status/Satellites/Sky/Device content, filter/sort, rotation (`e2e/demo-receiver.yaml`). Builds for E2E set `EXPO_PUBLIC_DEMO_SOURCE=1` so the demo receiver is offered outside development builds | Maestro on emulator | Runs in CI |
| Hardware | Matrix in the implementation plan (phones × receivers × drivers) | Manual checklist | Before each release |

**Fixtures:**

- Recorded logs: u-center 2 (or u-center classic, if it supports M10) `.ubx` captures (raw byte streams) from the **BE-122** through the same USB-to-TTL adapter on a PC: (a) default output, (b) UBX polls answered, (c) NMEA only. Stored in `test/fixtures` (a few hundred KB each). Logs from other generations (M8, multi-band F9) are covered with synthetic frames unless hardware becomes available.
- Synthetic frames are generated with `ubx/builder.ts` and an NMEA builder helper, so edge cases can be covered (unknown orbit, GLONASS slot 255, NAV-SAT with 0 SVs, max-length frames).
- The expected results for recorded logs are compared against values read in u-center for the same file.

---

## 11. Security & privacy

- No network calls. No analytics or crash reporting SDKs in v1 (REQ-NFR-06).
- Location data is held in memory only, except for user-initiated recordings and exports, which are written to app-private storage and shared through the Android share sheet.
- The two-channel UbxClient (§6.6) guarantees that monitoring never changes the receiver. Configuration writes only originate from explicit user actions, persistent writes need a second confirmation, and every write is logged (§13).
- `android:exported` is set only on the main activity (needed for the launcher and the USB attach intent).

---

## 12. Build & release

- `npx expo prebuild --platform android --clean` generates `android/`, which is **not committed**. Native config lives in `app.config.ts` and the plugins.
- Dev: `npx expo run:android` (dev client).
- Release: EAS Build (local or cloud) or `./gradlew assembleRelease` → signed **APK** for sideloading (REQ-NFR-14). No AAB or Play listing. Versioning: `version` (semver) + auto-incremented `versionCode`. Installing an update requires the same signing key, so the release keystore must be backed up securely; a lost key means users must uninstall before installing a new build.
- CI pipeline (e.g. GitHub Actions): typecheck → lint → unit tests → build debug APK → Maestro E2E on an emulator (API 34) → artifacts.
- **Windows path length:** native C++ modules (e.g. `react-native-nitro-modules`, used by MMKV) generate object paths that repeat the project path. In a deep project folder these exceed 260 characters. The Android Gradle plugin's default CMake 3.22.1 bundles ninja 1.10, which is not long-path aware, so the build fails (`ninja: error: mkdir(...): No such file or directory`). **Fix in place:** the config plugin `plugins/withCmakeVersion.js` pins every Android module to **CMake 3.31.6** (ninja 1.12, long-path aware). It is registered in the root `build.gradle` before the Expo/React Native root plugins evaluate subprojects. Requirements: Windows long paths enabled (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`), and CMake 3.31.6 installed in the SDK (Gradle downloads it if missing, or run `sdkmanager "cmake;3.31.6"`). Mapping the folder with `subst` does **not** work, because some tools resolve it back to the real path and fail on mixed roots.

---

## 13. Receiver configuration subsystem (REQ-CFG, FS §11)

### 13.1 Configuration keys

Generation-9+ receivers expose configuration as typed key/value items. A key ID is a U4:

| Bits | Meaning |
|---|---|
| 28–30 | Value size: 1 = 1 bit (stored as 1 byte, type `L`), 2 = 1 byte, 3 = 2 bytes, 4 = 4 bytes, 5 = 8 bytes |
| 16–23 | Group ID (e.g. CFG-RATE, CFG-UART1, CFG-SIGNAL) |
| 0–11 | Item ID within the group. `0xFFF` = wildcard (all items of a group), used for paged full reads |

The value size can be derived from the ID, so **any** key, even one unknown to the app, can be read, displayed raw and written back. This is what Advanced editing and backup/restore of unknown keys rely on.

**Key database** (`src/config/keys/`): a table of the keys the app knows, generated from the u-blox Interface Description of the target firmware (M10 SPG 5.x first, then F9/M9 if hardware appears):

```ts
interface CfgKeyDef {
  id: number;                 // e.g. 0x30210001
  name: string;               // e.g. 'CFG-RATE-MEAS'
  group: string;              // 'CFG-RATE'
  type: 'L' | 'U1' | 'U2' | 'U4' | 'U8' | 'I1' | 'I2' | 'I4' | 'I8' | 'R4' | 'R8' | 'E1' | 'E2' | 'E4' | 'X1' | 'X2' | 'X4' | 'X8';
  scale?: number; unit?: string;
  enumValues?: Record<number, string>;    // E-types
  bitfield?: Record<string, number>;      // X-types
  description: string;
}
```

The UI sections (FS §11.4) are defined declaratively on top of the database (key name → control type, label, help text, range, visibility conditions), so adding a setting means adding a line rather than a screen. Key IDs are **not** hand-typed in code. They come from the generated table, which a unit test checks against a fixture VALGET dump from the BE-122.

Keys used by the v1 sections (names per the interface description; exact availability depends on the firmware):

| Section | Keys |
|---|---|
| Rate & timing | `CFG-RATE-MEAS`, `CFG-RATE-NAV`, `CFG-RATE-TIMEREF` |
| Port & protocols | `CFG-UART1-BAUDRATE`, `CFG-UART1INPROT-{UBX,NMEA,RTCM3X}`, `CFG-UART1OUTPROT-{UBX,NMEA,RTCM3X}`, `CFG-USBINPROT-*`, `CFG-USBOUTPROT-*` |
| Constellations | `CFG-SIGNAL-{GPS,SBAS,GAL,BDS,QZSS,GLO,NAVIC}_ENA` and per-signal `CFG-SIGNAL-*_ENA` (e.g. `BDS_B1_ENA`, `BDS_B1C_ENA`, `QZSS_L1S_ENA`) |
| Message output | `CFG-MSGOUT-NMEA_ID_{GGA,GLL,GSA,GSV,RMC,VTG,ZDA,GNS}_{UART1,USB}`, `CFG-MSGOUT-UBX_NAV_{PVT,SAT,SIG,DOP,STATUS}_{UART1,USB}` |
| Navigation | `CFG-NAVSPG-DYNMODEL`, `CFG-NAVSPG-FIXMODE`, `CFG-NAVSPG-INFIL_MINELEV`, `CFG-NAVSPG-INFIL_MINCNO`, `CFG-NAVSPG-INFIL_NCNOTHRS`, `CFG-NAVSPG-UTCSTANDARD` |
| NMEA options | `CFG-NMEA-PROTVER`, `CFG-NMEA-SVNUMBERING`, `CFG-NMEA-HIGHPREC`, `CFG-NMEA-MAINTALKERID`, `CFG-NMEA-GSVTALKERID` |
| Power (Could) | `CFG-PM-OPERATEMODE`, `CFG-PM-POSUPDATEPERIOD` |

The **connected port** decides which port-specific keys a section edits: CDC-ACM devices use `*_USB`, UART bridges use `*_UART1` (overridable in Advanced, for modules wired to UART2).

### 13.2 `valCodec.ts`

- `encodeValue(def | rawSize, value) → bytes` and `decodeValue(...)`, little-endian, with scaling and enumerations applied in the UI layer, not the codec.
- `buildValGet(layer, keys, position)`, `buildValSet(layers, items, transaction)`, `buildValDel(layers, keys, transaction)`, `parseValGetResponse(payload) → { layer, position, items[] }`.
- **Chunking:** at most 64 items per message. A change set larger than one message is sent as a **transaction**: VALSET v1 with `transaction = 1` (begin), `2` (continue)… and the last with `3` (apply). The receiver applies nothing unless every message is ACKed (REQ-CFG-03).
- **Full read:** for each group (or the all-groups wildcard), page with `position` until a response returns fewer than 64 items. This runs once per layer (RAM, BBR, Flash, Default) for backup and Advanced, and only RAM + Flash for the regular sections.

### 13.3 `configStore` (Zustand)

```ts
interface ConfigState {
  receiver: { protVer: number; mod?: string; fwVer?: string; port: 'UART1' | 'USB'; generation: 'cfgval' | 'legacy' };
  values: Map<number /*keyId*/, { ram?: CfgValue; flash?: CfgValue; bbr?: CfgValue; def?: CfgValue }>;
  staged: Map<number, CfgValue>;          // edits not yet applied
  status: 'idle' | 'loading' | 'applying' | 'verifying' | 'saving' | 'error';
  lastError?: string;
  // derived (selectors): unsavedKeys = keys where ram !== (bbr ?? flash ?? def); stagedCount
  // actions: load(section|all), stage(key, value), unstage(key), discard(), apply(), save(), revertToSaved(), restart(kind), factoryReset(), restore(backup)
}
```

Only these actions build `ConfigWriteRequest`s (§6.6).

### 13.4 `ConfigService` operations

| Operation | Messages | Verification |
|---|---|---|
| Load section | VALGET RAM + VALGET Flash (and BBR) for the section's keys | — |
| **Apply** | Auto-backup (first write per session) → VALSET `layers = RAM`, transaction if > 64 items | VALGET RAM read-back and compare (REQ-CFG-04) |
| **Save** | VALSET `layers = BBR | Flash` with the current RAM values of the unsaved keys | VALGET Flash read-back |
| **Revert to saved** | VALSET `layers = RAM` with the BBR/Flash (or default) values of the unsaved keys | VALGET RAM read-back |
| **Restart** | CFG-RST `resetMode = 0x02` (GNSS only) with `navBbrMask` 0x0000 / 0x0001 / 0xFFFF | Wait for NAV-STATUS/NAV-PVT to resume. The accumulator clears satellites and TTFF |
| **Factory reset** | VALDEL `layers = BBR | Flash` for all keys (wildcard), or CFG-CFG clear+load for gen ≤ 8, then CFG-RST `resetMode = 0x01` | Re-detect (auto-baud). VALGET RAM equals Default for sampled keys |
| **Baud change** | State machine from FS §11.5. VALSET RAM `CFG-UART1-BAUDRATE` → `UsbSerial.setParameters` → MON-VER poll (3 s) → rollback path | MON-VER reply at the new baud |

**Rules** (`rules.ts`), evaluated on the staged set before Apply:

- **Lock-out:** reject when the result would disable UBX input or output on the connected port, or set both NMEA and UBX output off (REQ-CFG-10).
- **Throughput:** Σ(enabled message size × output rate × nav rate) ≤ 0.8 × baud / 10, otherwise warn (FS §11.7). Message sizes come from a static table (NAV-SAT/NAV-SIG/GSV are estimated from the current SV count).
- **Rate / constellation limits:** per-receiver-family table (M10: maximum measurement rate as a function of enabled constellations, maximum concurrent GNSS), otherwise warn. The receiver's NAK is the final word.

### 13.5 Backup format

```json
{
  "format": "ubx-mobile-config",
  "version": 1,
  "createdAt": "2026-10-18T12:03:15Z",
  "receiver": { "mod": "…", "fwVer": "…", "protVer": "34.10", "uniqueId": "…" },
  "layers": {
    "ram":   [{ "id": "0x30210001", "name": "CFG-RATE-MEAS", "value": 1000 }],
    "flash": [],
    "default": []
  }
}
```

Restore applies `layers.flash` (or `ram`, as chosen in the preview) to RAM. It skips IDs the receiver NAKs (found by bisection) and reports them. Automatic backups are stored in the app's private storage (`backups/`, the last 20 kept).

### 13.6 Legacy receivers (REQ-CFG-19, Could)

A `LegacyConfigAdapter` maps the same section model onto CFG-PRT, CFG-RATE, CFG-MSG, CFG-GNSS, CFG-NAV5 and CFG-CFG. It has no layers: Apply = send the message, and Save = CFG-CFG `saveMask`. The UI hides "value per layer" for these receivers.
