# UBX Mobile — Requirements

| | |
|---|---|
| Document | Software Requirements |
| Status | Draft v0.1 |
| Date | 2026-10-18 |
| Related | [functional-specifications.md](functional-specifications.md), [technical-specifications.md](technical-specifications.md), [implementation-plan.md](implementation-plan.md) |

---

## 1. Purpose

UBX Mobile is an Android app, built with React Native, that does some of what u-blox u-center does on the desktop. It lets a user inspect GNSS (GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC, SBAS) reception on a phone, either from:

- the **phone's built-in GNSS chipset** (through the Android Location / GNSS APIs), or
- an **external GNSS receiver connected over USB serial** (USB OTG), mainly u-blox modules that speak UBX and NMEA, and also generic NMEA-only receivers.

The app is a **monitoring and diagnostics tool**. It shows what the receiver sees (satellites, signal strength, sky geometry, fix quality) and what the receiver is (model, firmware, capabilities).

## 2. Scope

### 2.1 In scope (v1)

1. Data acquisition from two sources: Android Location API and USB serial.
2. Device information for the active source.
3. Satellite list with per-satellite status.
4. Sky ("radar" / polar) view of satellite positions.
5. Position, time and fix status summary.
6. Mobile-friendly UI in portrait and landscape, phones and tablets, light and dark themes.
7. **Configuration of u-blox receivers** (§6.10): rates, baud rate and protocols, constellations, message output, navigation settings, receiver restarts, saving to flash, backup/restore and factory reset.
8. **Map** (§6.11): the current position and the session's track on an OpenStreetMap map. This is the only feature that uses the network.

### 2.2 Out of scope (v1)

| Item | Rationale |
|---|---|
| iOS | iOS gives apps no access to raw satellite status or USB serial devices. |
| Receiver firmware update (UPD-*, flashing) | Risk of bricking the receiver. Configuration *is* in scope (§6.10). |
| Configuring non-u-blox receivers (vendor-specific commands such as MediaTek `$PMTK`) | Command sets vary by vendor. Generic NMEA receivers stay monitor-only. |
| Bluetooth SPP / BLE / TCP / NTRIP sources | Not planned (confirmed Q4). |
| RTK correction input, AssistNow online/offline upload | Needs network services and writes to the receiver. |
| Offline map packages, vector maps, routing, map search | The map (§6.11) shows online OpenStreetMap raster tiles only. |

## 3. Users and use cases

| Persona | Typical use |
|---|---|
| Field technician / integrator | Plugs a u-blox module into a phone in the field to check antenna placement, satellite count and C/N0 without a laptop. |
| Developer / hardware engineer | Checks a new board: firmware version, protocol version, which constellations and signals are tracked. |
| Enthusiast / surveyor | Compares the phone's GNSS with an external receiver and watches sky coverage and DOP. |

Primary use cases:

- **UC-1 Check the phone's GNSS**: open the app, grant location permission, see satellites and the sky view within seconds.
- **UC-2 Check an external receiver**: plug in the receiver over OTG, accept the USB permission prompt, see the receiver's identity, satellites and sky view.
- **UC-3 Diagnose bad reception**: look at C/N0 per satellite, the used-in-fix flags, the sky distribution of low-signal satellites, and the antenna status (u-blox).
- **UC-4 Identify a receiver**: read hardware/firmware/protocol version, supported GNSS and USB identifiers from the Device screen, and copy or share them.
- **UC-5 Configure a receiver**: change the update rate, baud rate, enabled constellations, output messages or navigation model of a u-blox receiver, try the change, then save it to flash or revert it. Also restart the receiver (hot/warm/cold) to measure TTFF.

## 4. Definitions

| Term | Meaning |
|---|---|
| GNSS | Global Navigation Satellite System (GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC, plus SBAS augmentation). |
| SV | Space Vehicle, i.e. one satellite. Identified by constellation + SV number (e.g. `G12`, `E16`, `B25`). |
| C/N0 | Carrier-to-noise density ratio in dB-Hz. The main signal-strength metric. |
| Elevation / Azimuth | Satellite angle above the horizon (0–90°) and bearing from true north (0–360°). |
| UBX | u-blox's binary protocol. |
| NMEA 0183 | Standard ASCII GNSS sentence protocol (`$GPGGA`, `$GPGSV`, ...). |
| Source | A provider of GNSS data: the *Android Location* source or the *USB Serial* source. |
| Fix | A computed position solution (none / 2D / 3D / DR / RTK float / RTK fixed, etc.). |
| DOP | Dilution of Precision (PDOP, HDOP, VDOP, GDOP, TDOP). |
| TTFF | Time To First Fix. |
| OTG | USB On-The-Go, which lets a phone act as a USB host. |

## 5. Requirement conventions

- IDs: `REQ-<AREA>-<NN>`. Priorities use **MoSCoW**: **M**ust, **S**hould, **C**ould.
- "Must" items make up the v1 release. "Should" items are planned for v1 but may slip. "Could" items are stretch goals.
- Each requirement has an acceptance criterion (AC) that can be tested.

---

## 6. Functional requirements

### 6.1 Data sources (REQ-SRC)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-SRC-01 | M | The user can choose the data source: **Phone GNSS (Android Location API)** or **USB Serial receiver**. | Both options appear on the Source screen. Choosing one starts the data flow and the other stops. |
| REQ-SRC-02 | M | Only one source is active at a time. Switching sources stops the previous one cleanly and clears its live data. | After switching, no satellites from the previous source remain in the list or the sky view. |
| REQ-SRC-03 | M | The active source and its connection state (Idle, Connecting, Waiting for data, Receiving, No fix, Fix, Disconnected, Error) are always visible. | A status chip in the app header shows source and state on every main screen. |
| REQ-SRC-04 | S | The app remembers the last used source (and the last USB device and baud rate) and offers to reconnect on launch. | Relaunching after a USB session shows "Reconnect to <device>". |
| REQ-SRC-05 | C | A **Replay** source plays back a recorded NMEA/UBX log file, for demos and testing without hardware. | Opening a bundled sample log fills all screens. |

### 6.2 Android Location source (REQ-AND)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-AND-01 | M | The app requests the runtime location permission (precise / `ACCESS_FINE_LOCATION`) and explains why before it asks. | If the user refuses, a "Permission required" state appears with a button to retry or open system settings. |
| REQ-AND-02 | M | The app detects when device location or the GPS provider is turned off and asks the user to turn it on. | With location off, the screen says so and offers a button that opens location settings. |
| REQ-AND-03 | M | The app receives per-satellite status from the phone: constellation, SV ID, C/N0, elevation, azimuth, almanac/ephemeris availability, used-in-fix and, where available, carrier frequency. | Satellite list and sky view match what GPSTest shows on the same phone (±1 dB-Hz, ±1°). |
| REQ-AND-04 | M | The app receives location fixes: latitude, longitude, altitude, speed, bearing, accuracy estimates and time. | The Status screen updates at least once a second while a fix is held. |
| REQ-AND-05 | S | The app receives the phone's NMEA stream, where the device provides it, to get DOP values and MSL altitude. | PDOP/HDOP/VDOP show on devices that output GSA sentences. Otherwise "—". |
| REQ-AND-06 | M | The app shows TTFF for the current session. | TTFF appears after the first fix since the source started. |
| REQ-AND-07 | S | The app identifies the signal band per satellite (e.g. L1/E1/B1 vs L5/E5a) from the carrier frequency, so dual-frequency phones show both signals. | On a dual-frequency phone, an SV tracked on L1 and L5 shows two signal entries. |
| REQ-AND-08 | M | The app stops GNSS updates when the source is stopped or the app is backgrounded (unless REQ-NFR-09 applies), to save battery. | The Android location indicator turns off within 5 s of backgrounding. |

### 6.3 USB serial source (REQ-SER)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-SER-01 | M | The app lists the USB serial devices that are attached, with name, VID:PID and driver type. | With a u-blox receiver attached over OTG, it appears in the device list. |
| REQ-SER-02 | M | Supported USB interfaces: **CDC-ACM** (u-blox native USB), **FTDI**, **Silicon Labs CP210x**, **Prolific PL2303**, **WCH CH34x**. USB-to-TTL adapters based on these chips are the way to connect UART-only modules such as the Beitian BE-122. | The adapters in the test matrix (implementation plan §4) are tested on hardware. Driver types with no test hardware are listed as "supported, untested" in the release notes. |
| REQ-SER-03 | M | The app requests Android USB permission for the selected device and handles a refusal. | If the user refuses, the screen explains this and offers to retry. |
| REQ-SER-04 | M | The user can set the baud rate (4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600) for UART-bridge devices. | Changing the baud rate re-opens the port at the new rate. |
| REQ-SER-05 | S | **Auto-baud**: the app tries common baud rates until it sees valid NMEA or UBX frames. | A receiver at 38400 is found within 10 s with auto-baud enabled. |
| REQ-SER-06 | M | The app parses **NMEA 0183** (v2.3, v4.0, v4.10, v4.11): GGA, RMC, GSA, GSV, GLL, VTG, GNS, ZDA, TXT, from any talker (GP, GL, GA, GB/BD, GQ, GI, GN). | Recorded fixture logs for each sentence type parse to the expected values in unit tests. |
| REQ-SER-07 | M | The app parses **UBX** binary messages, at least NAV-PVT, NAV-SAT, NAV-DOP, NAV-STATUS, MON-VER and ACK-ACK/NAK. It should also parse NAV-SIG, MON-HW, MON-RF, MON-GNSS, SEC-UNIQID and NAV-SVINFO (legacy). | Unit tests with fixture frames. Frames with bad checksums are dropped and counted. |
| REQ-SER-08 | M | **Receiver-safe monitoring**: monitoring (connecting, detecting, displaying data) only sends UBX *poll* requests (empty payload) and read-only CFG-VALGET. Configuration changes are sent **only** by the Configuration feature (§6.10), each as a direct result of an explicit user action. Firmware commands are never sent. | A test confirms that the monitoring code paths can only build polls/VALGET, and that configuration writes require a user-confirmed request object. Connecting to a receiver and browsing every screen except Configuration leaves its configuration unchanged (config dump before/after). |
| REQ-SER-09 | S | Optionally, with explicit consent, the app enables periodic UBX output (NAV-PVT, NAV-SAT, NAV-SIG, NAV-DOP) on the **RAM layer only**. This setting is lost when the receiver power-cycles. | Settings has a toggle with a warning. After a receiver power cycle the receiver's original configuration is back. |
| REQ-SER-10 | M | When NMEA and UBX both provide data, UBX data wins for the fields it provides. NMEA fills the gaps. | With both streams present, satellite flags such as Health and Orbit source come from NAV-SAT. |
| REQ-SER-11 | M | The app detects a USB detach, shows "Disconnected" and keeps the last known data, greyed out with a "stale" marker. | Unplugging the cable shows the Disconnected state within 2 s. |
| REQ-SER-12 | S | The app reconnects automatically when the same device (same VID, PID and serial number) is plugged in again during the session. | Replugging resumes data without going back to the Source screen (Android may show the permission prompt again). |
| REQ-SER-13 | S | Launching the app by plugging in a supported receiver opens it directly on that device (USB attach intent filter). | Plugging in a u-blox receiver offers "Open with UBX Mobile". |
| REQ-SER-14 | M | Generic, non-u-blox NMEA receivers work, with fewer fields (UBX-only fields show "—"). | An NMEA-only receiver fills the satellite list, the sky view and the Status screen. |

### 6.4 Device information (REQ-DEV)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-DEV-01 | M | A **Device** screen shows the identity and capabilities of the active source. | The screen is reachable from the main navigation and shows the content below for each source. |
| REQ-DEV-02 | M | *Android source*: phone manufacturer and model, Android version/API level, GNSS hardware model name and year of hardware (API 28+), GNSS capabilities (API 30+), supported raw measurements, constellations seen and signal bands seen (single/dual frequency). | Fields the device does not report show "Not reported by device". |
| REQ-DEV-03 | M | *USB source*: USB vendor and product IDs, manufacturer and product strings, USB serial number, driver type, baud rate, protocols detected (NMEA version, UBX yes/no). | Shown as soon as the port opens, before any GNSS data arrives. |
| REQ-DEV-04 | M | *u-blox receivers*: from MON-VER, show software version, hardware version, firmware version (FWVER), protocol version (PROTVER), module name (MOD), and supported/default GNSS. | Matches the values u-center shows for the same receiver. |
| REQ-DEV-05 | S | *u-blox receivers*: chip unique ID (SEC-UNIQID), antenna status and power (MON-HW / MON-RF), jamming indicator, noise level and AGC. Enabled constellations (MON-GNSS). | Antenna status changes to "Open" when the antenna is unplugged (on receivers with antenna supervision). |
| REQ-DEV-06 | S | *Generic NMEA receivers*: show any `$xxTXT` boot/info messages and the talker IDs and NMEA version detected. | TXT lines appear in a list on the Device screen. |
| REQ-DEV-07 | S | The user can copy the device information to the clipboard or share it as plain text. | A Share button produces a readable text report. |
| REQ-DEV-08 | S | The screen shows stream statistics: bytes received, NMEA sentences/s, UBX messages/s, checksum errors, time since last message. | The counters change while data arrives. |

### 6.5 Satellite list (REQ-SAT)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-SAT-01 | M | A **Satellites** screen lists all satellites currently known to the source. | The list contains every SV the receiver reports, including SVs that have no signal but are in view. |
| REQ-SAT-02 | M | Each row shows at least: **SV ID** (constellation-prefixed label, e.g. `G14`), **constellation** (colour/shape badge, with a flag as an option), **C/N0** (number and bar), **elevation**, **azimuth**, and **used in fix**. | Matches the reference screenshots `docs/examples/satellite-list-*.jpg` in content. The layout may differ. |
| REQ-SAT-03 | M | Each row shows compact status flags: **Ephemeris (E)**, **Almanac (A)**, **Used (U)**, as in GPSTest, plus **Health** where known. | An SV with ephemeris that is used in the fix shows `E U` (plus `A` if almanac is present). |
| REQ-SAT-04 | M | Tapping a row opens a detail view with all available fields. For u-blox NAV-SAT these are: pseudorange residual, quality indicator (Qi 0–7 with description), orbit source, health, DGNSS/differential correction used, correction sources (SBAS/RTCM/SLAS/SPARTN), EPH/ALM/AOP/ANO availability, and the per-signal list (NAV-SIG). | Every field u-center shows in its satellite table (`satellite-list-ublox.jpg`) is visible in the detail view when NAV-SAT data is present. |
| REQ-SAT-05 | M | Fields the source cannot provide show `—`. The app never shows a fabricated default such as 0. | With the Android source, Residual and Qi show `—`. |
| REQ-SAT-06 | M | **Sorting** by SV ID, constellation, C/N0, elevation, azimuth or used-in-fix. | Each sort order works and survives a restart. |
| REQ-SAT-07 | M | **Filtering** by constellation, plus "Used in fix only" and "Hide SVs without signal". The filter is shared with the Sky view. | Filtering to Galileo shows only `E` satellites on both screens. |
| REQ-SAT-08 | M | A summary header shows the counts *in view / with signal / used* overall and per constellation. | Counts match the rows that are listed. |
| REQ-SAT-09 | S | In landscape or on tablets, the list switches to a multi-column table similar to u-center, with all columns visible or horizontally scrollable. | Rotating a phone to landscape shows the wide table. |
| REQ-SAT-10 | S | Multi-signal receivers (e.g. ZED-F9P, dual-frequency phones) show each signal (L1C/A, L2C, L5, E1, E5a/b, B1I, B2I/B2a, ...) with its own C/N0 under the SV. | An F9P tracking GPS L1 and L2 shows two signal entries for that SV. |
| REQ-SAT-11 | S | A **signal strength bar chart** (C/N0 per SV, coloured by used/unused, as in u-center's Signal view). | The chart is available as a toggle on the Satellites screen. |
| REQ-SAT-12 | M | SVs that are no longer reported are removed after a timeout (default 5 s). | A satellite that sets below the horizon disappears within 5 s of its last report. |

### 6.6 Sky view (REQ-SKY)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-SKY-01 | M | A **Sky** screen shows a polar plot: zenith at the centre, horizon at the outer ring, north up. | Elevation rings (at least 0°, 30°, 60°) and azimuth spokes or ticks with N/E/S/W labels are drawn. |
| REQ-SKY-02 | M | Each SV with a known elevation and azimuth is plotted at the correct position. The radius is linear in (90° − elevation). | An SV at el=45°, az=90° appears halfway between the centre and the horizon, due east. |
| REQ-SKY-03 | M | The marker **shape** encodes the constellation and the marker **fill colour** encodes C/N0, using the same colour scale as the satellite list. | Legend entries match the markers drawn. |
| REQ-SKY-04 | M | **Used in fix** is clear without relying on colour alone (e.g. filled marker with a strong outline vs hollow or faded marker). | It can still be told apart in greyscale. |
| REQ-SKY-05 | M | Each marker carries its SV label (setting: show/hide). | Labels do not overflow the plot area. |
| REQ-SKY-06 | M | Tapping a marker shows that SV's details (same content as in the list). | Tapping G14 opens the G14 detail. |
| REQ-SKY-07 | M | An average C/N0 gauge shows the average over SVs **in view** (with signal) and over SVs **used in fix**, on a colour scale, as in `docs/examples/sky-gpstest.jpg`. | The gauge values equal the arithmetic mean of the listed C/N0 values. |
| REQ-SKY-08 | M | A legend explains shapes (constellations), colours (C/N0) and used/unused. It can be collapsed. | |
| REQ-SKY-09 | S | **Heading-up mode**: the plot rotates with the phone's compass heading, with a north indicator. Toggles with north-up. | Turning the phone rotates the plot. Satellites keep their real-world direction. |
| REQ-SKY-10 | S | **Satellite trails**: show each SV's recent path (configurable: off / 10 min / 1 h). | Trails grow over time while the app is open. |
| REQ-SKY-11 | C | **Signal heatmap mode**, like u-center's Sky View: azimuth/elevation cells coloured by the best or average C/N0 seen over the session. Helps assess antenna obstruction. | After 30 minutes, cells hidden by a building show low or no values. |
| REQ-SKY-12 | C | The receiver's elevation mask (u-blox CFG-NAVSPG-INFIL_MINELEV, read-only) is drawn as a shaded ring. | |

### 6.7 Status / position (REQ-POS)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-POS-01 | M | A **Status** screen shows: fix type, latitude, longitude, altitude (ellipsoid and MSL when available), speed, course/bearing, horizontal/vertical/speed/bearing accuracy, PDOP/HDOP/VDOP, UTC date/time, TTFF, satellites used / with signal / in view. | Matches the field set of the GPSTest Status screen (`satellite-list-gpstest.jpg`). |
| REQ-POS-02 | S | For u-blox receivers, also shows carrier solution (RTK float/fixed), differential solution flag, time validity and leap seconds. | |
| REQ-POS-03 | S | Unit choices: coordinates in decimal degrees or DMS; metric or imperial. | |
| REQ-POS-04 | S | Copy and share the current position. | |

### 6.8 Diagnostics and logging (REQ-LOG)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-LOG-01 | S | A **Console** shows the live message stream (NMEA sentences as text, UBX messages as decoded name + length), with pause, clear and a filter by message type. | |
| REQ-LOG-02 | C | Record the raw stream (USB: raw bytes, Android: NMEA + status) to a file and share it. | The recorded file can be opened in u-center (USB raw `.ubx`) or replayed by REQ-SRC-05. |
| REQ-LOG-03 | M | Errors (permission, USB I/O, parse errors) are logged to an in-app diagnostics log the user can share. | |

### 6.9 Settings (REQ-SET)

These are app settings. Receiver settings are covered in §6.10.

| ID | Pri | Requirement |
|---|---|---|
| REQ-SET-01 | M | Theme: System / Light / Dark. |
| REQ-SET-02 | M | SV label style: u-center style (`G`, `R`, `E`, `B`, `Q`, `S`, `N`) or RINEX style (`G`, `R`, `E`, `C`, `J`, `S`, `I`). |
| REQ-SET-03 | S | Satellite timeout, UI refresh rate (1–5 Hz), keep screen on. |
| REQ-SET-04 | S | USB: default baud rate, auto-baud on/off, probe for UBX on/off (REQ-SER-08), enable periodic UBX output in RAM (REQ-SER-09). |
| REQ-SET-05 | S | Units (REQ-POS-03). |

### 6.10 Receiver configuration (REQ-CFG)

Applies to **u-blox receivers on the USB source**. The primary target is the generation-9+ configuration interface (CFG-VALGET / CFG-VALSET / CFG-VALDEL), which the BE-122 (M10) uses. Generation-8 receivers use the legacy CFG-PRT/RATE/MSG/GNSS/NAV5/CFG messages (Could).

**Safety model** (applies to all REQ-CFG items):

- Reading configuration never changes the receiver.
- Edits are **staged** in the app and sent only when the user taps **Apply**.
- **Apply** writes to the **RAM layer only**, so it takes effect immediately and is lost on power cycle.
- **Save** (writing to BBR + Flash, i.e. persistent) is a separate, explicitly confirmed action.
- Before the first write in a session, the app takes an automatic backup of the current configuration.

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-CFG-01 | M | A **Configuration** screen is available when a u-blox receiver is connected (from the Device screen and More). For other sources it is hidden or shows "Configuration requires a u-blox receiver". | With the BE-122 connected, Configuration opens and shows current values. With the phone source it is not offered. |
| REQ-CFG-02 | M | The app **reads** the current configuration (RAM layer) for every setting it displays, and shows when the RAM value differs from the value stored in Flash/BBR ("unsaved") or from the default. | After changing the rate and applying without saving, the rate setting shows an "unsaved" marker. |
| REQ-CFG-03 | M | **Staged edits**: changed settings are highlighted, a bottom bar shows "N changes · Discard · Apply", and Apply sends all changes as one transaction (all or nothing). | If one key is rejected (NAK), no change is applied and the app names the failing group. |
| REQ-CFG-04 | M | After Apply, the app **verifies** by reading the values back and reports success or a mismatch per setting. | |
| REQ-CFG-05 | M | **Save to flash**: persists the current configuration (BBR + Flash) after a confirmation dialog listing what will become permanent. | After Save and a power cycle, the changed setting remains. |
| REQ-CFG-06 | M | **Revert**: (a) discard staged edits; (b) reload the saved configuration into RAM (undo unsaved applied changes); (c) **factory reset**: restore defaults in BBR/Flash, with a strong confirmation. | After a factory reset and power cycle, the receiver reports default values (e.g. 38400 baud, 1 Hz). |
| REQ-CFG-07 | M | **Measurement / navigation rate**: measurement period (ms) or rate (Hz) and navigation ratio, within the receiver's limits. A warning appears when the chosen rate exceeds what the enabled constellations allow (M10 limits depend on the number of constellations). | Setting 5 Hz makes NAV-PVT arrive at 5 Hz. |
| REQ-CFG-08 | M | **Port settings** for the port the app is connected through (UART1 for UART bridges, USB for native USB): baud rate (UART only) and input/output protocols (UBX, NMEA, RTCM3). | See REQ-CFG-09. |
| REQ-CFG-09 | M | **Safe baud-rate change**: when the baud rate of the connected UART changes, the app switches its own serial port to the new rate and confirms communication. If communication is not confirmed within 3 s, it switches back and tells the user (an unsaved RAM change is undone by a power cycle). | Changing 38400 → 115200 keeps the data flowing without a reconnect. |
| REQ-CFG-10 | M | **Lock-out protection**: the app refuses to apply a change that would cut off its own link to the receiver: disabling UBX input or output on the connected port, or disabling both NMEA and UBX output. It explains why. | The UBX output toggle for the connected port is disabled, with an explanation. |
| REQ-CFG-11 | M | **Constellations / signals**: enable or disable GPS, Galileo, BeiDou (B1I/B1C), GLONASS, QZSS, SBAS (and NavIC where supported), showing the receiver's limits (e.g. max concurrent constellations) and that the GNSS subsystem restarts after the change. | Disabling GLONASS removes R satellites from the list within a few seconds. |
| REQ-CFG-12 | M | **Message output**: per-message output rate on the connected port for common NMEA (GGA, GLL, GSA, GSV, RMC, VTG, ZDA, GNS) and UBX (NAV-PVT, NAV-SAT, NAV-SIG, NAV-DOP, NAV-STATUS…) messages. | Disabling GSV stops GSV sentences in the Console. |
| REQ-CFG-13 | M | **Navigation settings**: dynamic platform model (portable, stationary, pedestrian, automotive, sea, airborne <1g/<2g/<4g, wrist, …), fix mode (2D/3D/auto), minimum elevation, minimum C/N0 for satellites used in the fix. | |
| REQ-CFG-14 | M | **Receiver restart**: hot, warm and cold start (GNSS-only software reset, so the serial link stays up). After a restart the Status screen shows a fresh TTFF. | A cold start clears the satellite list, then TTFF shows when the fix returns. |
| REQ-CFG-15 | S | **NMEA options**: NMEA version (4.0 / 4.10 / 4.11), satellite numbering (strict / extended), high-precision mode, talker ID handling. | |
| REQ-CFG-16 | S | **Backup / restore**: export the full configuration to a JSON file (shared through the Android share sheet), and restore from such a file (to RAM, then optionally save). The automatic pre-change backup can be restored from a list. | A backup taken from the BE-122 and restored after a factory reset gives the same configuration. |
| REQ-CFG-17 | S | **Advanced key editor**: browse and search every configuration key the receiver reports (grouped as in u-center 2), with type, value per layer (RAM/BBR/Flash/Default) and description, and edit any writable key (staged like everything else). | |
| REQ-CFG-18 | C | **Power settings**: operating mode (full power, cyclic tracking, on/off), position update and acquisition periods, on-time, acquisition time limits and the related flags (CFG-PM). The app warns when a power-save mode will make the receiver sleep or conflicts with the measurement rate. | On the BE-122, switching to cyclic tracking and back to full power is applied, verified and reversible without losing contact. |
| REQ-CFG-19 | C | **Legacy (generation ≤ 8) configuration** through CFG-PRT, CFG-RATE, CFG-MSG, CFG-GNSS, CFG-NAV5, CFG-RST, CFG-CFG, for the same settings as REQ-CFG-07…14. | |
| REQ-CFG-20 | C | **Phone GNSS assistance reset**: "Clear aiding data" (cold start) and "Inject time / XTRA" for the phone source, as in GPSTest. | |
| REQ-CFG-21 | C | Import u-center / u-center 2 configuration files. | |
| REQ-CFG-22 | M | Every configuration write is logged (time, keys, old → new values, layers, result) in the diagnostics log. | |

---

### 6.11 Map (REQ-MAP)

| ID | Pri | Requirement | Acceptance criterion |
|---|---|---|---|
| REQ-MAP-01 | M | A **Map** screen shows the current position of the active source on an **OpenStreetMap** map, with a circle for the horizontal accuracy (hAcc) when it is known. | The marker is on the reported coordinates at every zoom level (error ≤ 1 screen pixel against the tile projection). The circle radius equals hAcc at the marker's latitude. |
| REQ-MAP-02 | M | **Follow mode** (on by default) keeps the position centred. Panning the map turns follow mode off. A *My location* button turns it back on. | |
| REQ-MAP-03 | M | The map can be panned by dragging and zoomed by pinching, double-tapping and with +/− buttons, from zoom 2 (world) to 19 (street). | Buttons are ≥ 48 dp (REQ-NFR-02). |
| REQ-MAP-04 | M | The map follows the **OSM tile usage policy**: the attribution "© OpenStreetMap contributors" is always visible and links to the copyright page; requests carry a User-Agent that identifies the app; tiles are cached and never bulk-downloaded or prefetched beyond the visible area; zoom stops at 19. | |
| REQ-MAP-05 | M | Without a fix, the screen says so and shows the last known position (if any) as a hollow marker; with a stale source the marker is hollow and grey (§1.1 data states). | |
| REQ-MAP-06 | M | When tiles cannot be loaded (offline, server error), a plain grid background and the message "Map tiles unavailable" are shown. The position marker, accuracy circle and coordinates still work. | |
| REQ-MAP-07 | S | The **track** of the current session (positions since the source started or the receiver restarted) is drawn as a line. It is held in memory only. | |
| REQ-MAP-08 | S | A course arrow is shown on the marker when the speed is above 0.5 m/s and the course is known. | |
| REQ-MAP-09 | S | An overlay shows latitude/longitude (in the chosen coordinate format), horizontal accuracy and fix type. Long-press copies the coordinates. | |
| REQ-MAP-10 | C | A custom tile server URL (e.g. a self-hosted or commercial provider) can be set in Settings. | |

## 7. Non-functional requirements (REQ-NFR)

| ID | Pri | Requirement |
|---|---|---|
| REQ-NFR-01 | M | **Platform**: Android 8.0 (API 26) or later. Target a current Android API level. Play's target-API rules don't apply because the app ships as an APK, but a current target avoids compatibility-mode behaviour. Phones and tablets. |
| REQ-NFR-14 | M | **Distribution**: a signed release **APK** that can be sideloaded. No Google Play listing. Each release has a version number visible in About. |
| REQ-NFR-02 | M | **Mobile-friendly UI**: one-handed portrait use, touch targets ≥ 48 dp, no horizontal scrolling in portrait (except the optional wide table), readable at system font scale 1.3. |
| REQ-NFR-03 | M | **Responsiveness**: the UI renders data at ≤ 5 Hz (default 2 Hz) whatever the input rate. Scrolling stays at ≥ 55 fps on a mid-range device (e.g. Snapdragon 6-series, 2022) with 60 satellites and a 921600-baud stream at 10 Hz. |
| REQ-NFR-04 | M | **Latency**: data shows on screen ≤ 1 s after it arrives at the device. |
| REQ-NFR-05 | M | **Robustness**: corrupt, truncated or unknown messages never crash the app. The parsers resynchronise on the next valid frame. |
| REQ-NFR-06 | M | **Offline**: everything except the map works without a network connection. The only network traffic is map tile requests (§6.11), made only while the Map screen is visible. No analytics in v1. |
| REQ-NFR-07 | M | **Accessibility**: information is never conveyed by colour alone (shapes, text, icons). Screen-reader labels on interactive elements. Colour contrast meets WCAG AA. |
| REQ-NFR-08 | M | **Battery**: GNSS listening and USB reads stop when the app is not in the foreground (default). |
| REQ-NFR-09 | C | **Background operation**: an optional foreground service keeps a recording running while the app is in the background, with a persistent notification. |
| REQ-NFR-10 | M | **Cold start** to first interactive screen ≤ 2 s on a mid-range device. |
| REQ-NFR-11 | M | **Maintainability**: TypeScript strict mode. Protocol parsers are pure, platform-independent TS modules with ≥ 90% unit-test line coverage. |
| REQ-NFR-12 | S | **Localisation-ready**: all user-visible strings sit in a resource catalogue. English only in v1. |
| REQ-NFR-13 | M | **Privacy**: location data stays on the device. Shared or exported data goes only where the user explicitly sends it. Map tile requests necessarily tell the tile server which area is being viewed (not the exact position). About explains this. |

## 8. Architectural requirements (REQ-ARC)

| ID | Pri | Requirement |
|---|---|---|
| REQ-ARC-01 | M | All data sources (Phone, USB, Replay) implement one source interface and emit one normalised GNSS data model, so the UI does not depend on the source. |
| REQ-ARC-02 | M | Protocol decoding (NMEA, UBX) is independent of the transport. It accepts a byte stream from any source. |
| REQ-ARC-03 | M | Native Android functionality (GNSS status, USB serial) is reached through dedicated native modules with typed TypeScript interfaces. |

## 9. Constraints and assumptions

- **Android only.** The required APIs (`GnssStatus`, `UsbManager`) do not exist on iOS in any equivalent form.
- The phone must support **USB host / OTG** for the serial source. Most modern phones do. An OTG adapter or a USB-C cable may be needed.
- **Bus power**: some receivers draw more current than a phone's OTG port supplies. This is documented in the in-app help, not solved in software.
- Satellite status on the Android source depends on the phone's chipset and vendor implementation. Some phones report no NMEA, no carrier frequency, or capped C/N0 values.
- u-blox receivers from **generation 8 (M8) onwards** are the primary UBX target. Generation 6/7 get best-effort support through NAV-SVINFO.
- **Reference receiver: Beitian BE-122.** According to a reseller listing (no official datasheet found), it is a u-blox **M10 (M10050)** module: single-band L1 (GPS L1C/A, Galileo E1, BeiDou B1I/B1C, QZSS, SBAS), **TTL-level UART only**, default **38400 baud** (4800–921600), 1 Hz default update rate (up to 18 Hz), configuration kept in flash, VCC 3.6–5.5 V. What this means for the app:
  - It has **no USB port**. It connects to the phone as: phone → USB OTG → **USB-to-TTL adapter (CP210x / CH34x / FTDI)** → BE-122 (adapter 5 V → VCC, GND → GND, adapter RX → module TX, adapter TX → module RX). The baud rate matters (REQ-SER-05).
  - **Measured configuration** (u-center 2 dumps, `docs/examples/be-122-dump.txt` and `bz-251-dump.txt`, both firmware SPG 5.10 / PROTVER 34.10, measurement rate 10 Hz, GLONASS disabled):
    - **BE-122:** UART1 at **57600 baud** (not the 38400 of the listing), **NMEA output off and no UBX message enabled** — the module is silent until polled.
    - **Beitian BZ-251:** UART1 at **115200 baud**, outputs NMEA (GGA, GSV, RMC, GSA, GLL, VTG) and UBX NAV-PVT every epoch.
    - Consequences: auto-baud must probe silent rates with a UBX poll, not only listen; in Poll mode all data for the BE-122 comes from UBX polls.
    - Both report the same CFG-PM power keys (full power). The legacy UBX-CFG-PMS presets are acknowledged but change no CFG-PM key (tested on both modules), so power is configured only through CFG-PM (REQ-CFG-18, FS §11.4.1).
  - As an M10 it uses the generation-9+ UBX interface (CFG-VALGET/VALSET, MON-RF, NAV-SAT, NAV-SIG).
  - Because its configuration is stored in flash, saving is the only permanent step and is always confirmed separately (§6.10 safety model).
- Monitoring never changes the receiver's configuration. Changes happen only in the Configuration feature, through explicit user actions (REQ-SER-08, §6.10).

## 10. Open questions

| # | Question | Status / answer |
|---|---|---|
| Q1 | App name and package ID? | **Resolved:** app name **"UBX Mobile"**. Package ID still a placeholder: `com.ubxmobile.app`. |
| Q2 | Distribution? | **Resolved:** signed **APK**, sideloaded (REQ-NFR-14). |
| Q3 | Should the app be able to change the external receiver's own settings (u-center's Configuration View)? | **Resolved: yes.** In scope for v1 (§6.10). |
| Q4 | Bluetooth / network sources? | **Resolved:** not needed. |
| Q5 | Test hardware? | **Resolved:** an Android phone and a **Beitian BE-122** (u-blox M10, TTL UART), see §9. A USB-to-TTL adapter and an OTG adapter are needed; see implementation plan §4. |
| Q6 | Minimum Android version: is API 26 acceptable? | Assumed yes. Raising it to API 28/30 would simplify device-info code paths. |
| Q7 | Map provider? | **Resolved:** OpenStreetMap standard tiles (`tile.openstreetmap.org`), no API key. Their usage policy allows light use by apps that identify themselves and attribute OSM. Heavy use would need another provider (REQ-MAP-10). |
