# UBX Mobile — Functional Specification

| | |
|---|---|
| Document | Functional Specification |
| Status | Draft v0.1 |
| Date | 2026-10-18 |
| Implements | [requirements.md](requirements.md) |

This document describes **what the user sees and does**: screens, navigation, layouts, fields, states and interactions. The technical design is in [technical-specifications.md](technical-specifications.md).

The reference screenshots in [examples/](examples/) are a guide, not a template:

| File | What we take from it |
|---|---|
| `satellite-list-ublox.jpg` | u-center classic satellite table: the **field set** (SV, CN0, Residual, Nav, Qi, El, Az, Orbit, Healthy, DGNSS, Corrections, EPH, ALM, AOP, ANO). It is too wide for a phone, so these fields move to an expandable detail view. |
| `satellite-list-gpstest.jpg` | GPSTest Status screen: the **compact, mobile layout**: position card plus a satellite table (ID, GNSS flag, CF, C/N0, Flags, Elev, Azim). |
| `sky-ublox.jpg` | u-center Sky View: polar grid with 10°/15° rings and spokes, cells coloured by signal (→ heatmap mode, REQ-SKY-11). |
| `sky-gpstest.jpg` | GPSTest Sky: **markers shaped by constellation, coloured by C/N0**, avg C/N0 gauge, legend. |

---

## 1. Navigation

```
┌──────────────────────────────────────────┐
│ ☰  Satellites        [● USB · 3D Fix ▾]  │  ← App header + source status chip
├──────────────────────────────────────────┤
│                                          │
│              screen content              │
│                                          │
├──────────────────────────────────────────┤
│ Status │ Satellites │ Sky │ Map │ Device │ ⋯ │  ← Bottom tab bar
└──────────────────────────────────────────┘
```

> **Terminology:** user-facing text calls a source a **GNSS receiver** ("Choose a GNSS receiver", "No receiver"). "GPS" is used only for the GPS constellation itself, never as a synonym for GNSS, so the wording stays consistent with the Satellites, Device and Configuration screens. This spec and the code keep the internal term **source** (Source sheet, `GnssSource`).

- **Bottom tabs** (in order): `Status`, `Satellites`, `Sky`, `Map`, `Device`, `More`. Six tabs fit a 360 dp wide phone (60 dp each); if labels get truncated at large font scales, the tab bar shows icons only.
- **More** contains: **Receiver configuration** (u-blox only, §11), Console, Signal chart (if not on the Satellites screen), Recording (Could), Settings, Help, About.
- **Source status chip** (header, top-right, every main screen): source icon (📱 phone / 🔌 USB / ▶ replay) + short state text, e.g. `USB · 3D Fix`, `Phone · No fix`, `USB · Disconnected`. Tapping it opens the **Source sheet** (§2).
- On launch:
  - First launch, or no remembered source → **Source sheet** opens automatically.
  - Remembered source → that source starts and the last active tab shows (default `Satellites`).
  - Launched by a USB attach intent → USB source starts on that device.
- The Android back button closes sheets and dialogs first, then follows normal tab history, then exits.

### 1.1 Global data states

Every data screen (Status, Satellites, Sky, Map, Device) handles these states the same way:

| State | Display |
|---|---|
| No source selected | Empty illustration + "Choose a GNSS receiver" + "Use your phone's built-in receiver or an external one connected over USB." + **[Choose receiver]** button. Header chip: `No receiver`. |
| Connecting / waiting for first data | Spinner + "Waiting for data from <source>…" + elapsed seconds. After 10 s (USB): hint "No data received. Check baud rate or cable." with **[Change baud]**. |
| Receiving, no satellites yet | Normal screen with zeroed counters, and "Searching for satellites…" in the list or sky area. |
| Receiving | Normal content. |
| Stale (source disconnected / stopped) | Last data stays visible at 50% opacity, with a banner: "Disconnected — showing last data from 12:03:15" + **[Reconnect]**. |
| Error | Banner with the error message and an action (Retry / Open settings / Grant permission). |

---

## 2. Source selection (Source sheet)

A bottom sheet (full screen on small phones) opened from the status chip or on first launch.

```
┌──────────────────────────────────────────┐
│ Choose a GNSS receiver               ✕   │
├──────────────────────────────────────────┤
│ ◉ 📱 Phone (built-in)                    │
│      Your phone's built-in receiver      │
│                                          │
│ ○ 🔌 USB receiver                        │
│   ┌────────────────────────────────────┐ │
│   │ u-blox GNSS receiver               │ │
│   │ 1546:01A9 · CDC-ACM · SN 0012345   │ │
│   ├────────────────────────────────────┤ │
│   │ CP2102 USB to UART Bridge          │ │
│   │ 10C4:EA60 · CP210x                 │ │
│   └────────────────────────────────────┘ │
│   Baud rate  [ Auto ▾ ]                  │
│   (No devices? Connect via USB OTG.)     │
│                                          │
│ ○ ▶ Replay log file            (Could)   │
│                                          │
│            [ Connect ]                   │
└──────────────────────────────────────────┘
```

Behaviour:

1. **Phone (built-in)**
   1. On **Connect**: if location permission is missing → rationale dialog ("UBX Mobile needs precise location to read satellite data from your phone's GNSS receiver. Location never leaves your device.") → system permission prompt.
   2. If the user grants only *approximate* location → explain that precise location is needed, and offer **[Open app settings]**.
   3. If system location is off → dialog **[Turn on location]** (opens system location settings).
   4. When the checks pass → source starts, sheet closes.
2. **USB receiver**
   1. The device list refreshes live on attach and detach. Each entry shows the product name (or "Unknown USB serial device"), `VID:PID`, driver type, and the USB serial number if present.
   2. The baud selector is shown but greyed for CDC-ACM devices, which ignore baud rate (hint: "Not needed for native USB").
   3. On **Connect** → Android USB permission prompt (if not yet granted) → open the port → *Detection* (see §2.1).
   4. If permission is denied → inline error "USB permission denied" + **[Try again]**.
   5. If the list is empty → "No USB serial devices found" + help text about OTG and power.
   6. **Help → "Connecting a TTL GNSS module"** (e.g. Beitian BE-122): a simple wiring diagram (USB-to-TTL adapter 5V→VCC, GND→GND, RX→TX, TX→RX) and a note that the device list shows the *adapter* (e.g. "CP2102" or "USB Serial") rather than the GNSS module.
3. **Replay** (Could): file picker for `.ubx`, `.nmea`, `.log`, `.txt`. Playback speed 1×/2×/5×/max, with loop on/off.

### 2.1 USB receiver detection sequence (user-visible)

When the port opens, the status chip shows `USB · Detecting…`, and the Device screen fills in step by step:

1. **Listening** (up to 2 s, or 10 s on the auto-baud path): the app watches the input for NMEA sentences and UBX frames.
2. **Probe** (if "Probe for UBX" is on, the default): sends UBX polls for MON-VER, SEC-UNIQID, MON-GNSS, MON-HW/MON-RF.
3. **Result**:
   - u-blox detected (a MON-VER response arrives) → Device screen shows u-blox identity. Status chip: `USB · u-blox · <fix>`.
   - Only NMEA → "Generic NMEA receiver". UBX-only fields show `—`.
   - Nothing valid after every baud rate → error "No GNSS data detected" + **[Change baud] [Retry]**.
4. **Periodic data**: in *Poll mode* (default) the app polls NAV-PVT, NAV-SAT (or NAV-SVINFO), NAV-SIG, NAV-DOP and NAV-STATUS every 1 s on u-blox receivers. If the receiver already outputs these messages periodically, polling for that message stops.

---

## 3. Status screen

Purpose: position, time and fix quality at a glance (REQ-POS).

```
┌──────────────────────────────────────────┐
│ Status                [● USB · 3D Fix ▾] │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │  3D FIX          ⏱ TTFF 28.4 s       │ │  ← fix banner, colour by fix type
│ │  Sats used 14 · signal 22 · view 31  │ │
│ └──────────────────────────────────────┘ │
│ ┌ Position ────────────────────── ⧉ ─┐ │
│ │ Latitude     1.352083° N             │ │
│ │ Longitude  103.819836° E             │ │
│ │ Altitude    32.4 m (MSL) · 39.9 m ell│ │
│ │ H. acc      1.8 m      V. acc  2.9 m │ │
│ └──────────────────────────────────────┘ │
│ ┌ Motion ─────────────────────────────┐ │
│ │ Speed  0.03 m/s ±0.1   Course 214.5° │ │
│ └──────────────────────────────────────┘ │
│ ┌ Quality ────────────────────────────┐ │
│ │ PDOP 1.42   HDOP 0.78   VDOP 1.18    │ │
│ │ GDOP 1.61   TDOP 0.77                │ │
│ │ Carrier sol.  RTK fixed (u-blox)     │ │
│ └──────────────────────────────────────┘ │
│ ┌ Time ───────────────────────────────┐ │
│ │ UTC 2026-10-18 11:39:02.000 ✓ valid  │ │
│ │ Local 19:39:02 (UTC+8) · Leap s 18   │ │
│ └──────────────────────────────────────┘ │
│ ┌ Per constellation ──────────────────┐ │
│ │ GPS 6/9/11  GLO 3/5/7  GAL 4/6/8 ... │ │  ← used/signal/view
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### 3.1 Fields and sources

`—` = not available from that source. `Std` = standard Android API.

| Field | Android Location source | USB (UBX) | USB (NMEA only) |
|---|---|---|---|
| Fix type | Derived: no fix / fix (2D/3D inferred from `hasAltitude`); NMEA GSA if present | NAV-PVT `fixType` (+ `gnssFixOK`, `diffSoln`) | GGA quality + GSA mode |
| Latitude / Longitude | `Location` | NAV-PVT | GGA / RMC / GNS |
| Altitude ellipsoid | `Location.altitude` | NAV-PVT `height` | GGA alt + geoid sep |
| Altitude MSL | `getMslAltitudeMeters()` (API 34+) or NMEA GGA | NAV-PVT `hMSL` | GGA |
| H. accuracy | `accuracy` | NAV-PVT `hAcc` | — (GST if present: Could) |
| V. accuracy | `verticalAccuracyMeters` (API 26+) | NAV-PVT `vAcc` | — |
| Speed / speed acc | `speed` / `speedAccuracyMetersPerSecond` | NAV-PVT `gSpeed` / `sAcc` | RMC / VTG |
| Course / course acc | `bearing` / `bearingAccuracyDegrees` | NAV-PVT `headMot` / `headAcc` | RMC / VTG |
| PDOP / HDOP / VDOP | NMEA GSA if device emits NMEA, else — | NAV-DOP (or NAV-PVT `pDOP`) | GSA |
| GDOP / TDOP | — | NAV-DOP | — |
| Carrier solution | — | NAV-PVT `carrSoln` | GGA quality 4/5 |
| UTC time + validity | `Location.time` | NAV-PVT time + `valid` flags | RMC / ZDA |
| Leap seconds | — | NAV-TIMELS (Could) | — |
| TTFF | `GnssStatus.Callback.onFirstFix` | NAV-STATUS `ttff` | Measured by the app from port open to first valid fix |
| Sats used / signal / view | From the satellite set (§4) | From the satellite set | From the satellite set |

### 3.2 Fix banner colours (with text label, never colour alone)

| Fix | Label | Colour token |
|---|---|---|
| No fix | `NO FIX` | `fix.none` (grey/red) |
| Time only | `TIME ONLY` | `fix.weak` (amber) |
| Dead reckoning | `DR` | `fix.weak` |
| 2D | `2D FIX` | `fix.weak` |
| 3D | `3D FIX` | `fix.good` (green) |
| GNSS + DR | `3D + DR` | `fix.good` |
| DGNSS | `3D DGNSS` | `fix.good` |
| RTK float | `RTK FLOAT` | `fix.rtk` (blue) |
| RTK fixed | `RTK FIXED` | `fix.rtk` (blue, bold) |

### 3.3 Actions

- **⧉ Copy** on the Position card: copies `lat, lon` in the chosen format.
- **Share** (header overflow): plain-text snapshot of the whole Status screen.

---

## 4. Satellites screen

Purpose: list every SV and its status (REQ-SAT).

### 4.1 Portrait layout (default)

```
┌──────────────────────────────────────────┐
│ Satellites            [● USB · 3D Fix ▾] │
├──────────────────────────────────────────┤
│ Used 14 · Signal 22 · View 31            │
│ [All] [GPS 6/11] [GLO 3/7] [GAL 4/8] ... │  ← constellation filter chips (scroll-x)
│ Sort: C/N0 ▾   ☐ Used only  ☐ Has signal │  ▤ Chart toggle
├──────────────────────────────────────────┤
│ SV    C/N0          El   Az    Flags     │  ← sticky column header (tap = sort)
├──────────────────────────────────────────┤
│ ● G14  ▇▇▇▇▇▇▁ 41   47°  312°  E A U     │
│ ■ R01  ▇▇▇▇▁▁▁ 36   11°  282°  E   U     │
│ ▲ E16  ▇▇▇▁▁▁▁ 26   12°  304°  E A       │
│ ⬟ B21  ▇▇▁▁▁▁▁ 24    5°  277°  E A U  ⚠  │  ← ⚠ = unhealthy
│ ● G30  ▁▁▁▁▁▁▁  —    —    —    A         │  ← no signal, no position
│   ⌄ (tap row to expand)                  │
└──────────────────────────────────────────┘
```

Row anatomy (≥ 56 dp tall):

| Element | Content |
|---|---|
| Constellation badge | Shape + colour per constellation (§6.2). Optional national flag icon (setting). |
| SV label | Prefix + SV number, e.g. `G14`, monospace. Label style per REQ-SET-02. |
| C/N0 | Horizontal bar (0–55 dB-Hz, colour per §6.1) + integer value. `—` if no signal. If the SV has several signals, the bar shows the **strongest** signal, and a small `2×` badge marks multi-signal. |
| El / Az | Integer degrees. `—` if unknown (§4.5). |
| Flags | Fixed-width letters, each either present or blank: **E** ephemeris, **A** almanac, **U** used in fix. Plus icons: **⚠** unhealthy, **D** differential corrections applied (UBX). |
| Used in fix | Also shown by a bold label and a stronger row background (not by colour alone). |

**Expanded row / detail sheet** (tap a row, or tap a marker in the Sky view):

```
┌──────────────────────────────────────────┐
│ ● G14  GPS PRN 14                    ✕   │
├──────────────────────────────────────────┤
│ C/N0           41 dB-Hz                  │
│ Elevation      47°        Azimuth  312°  │
│ Used in fix    Yes                       │
│ Health         Healthy                   │
│ Quality (Qi)   7 – Code & carrier locked │
│ PR residual    -0.4 m                    │
│ Orbit source   Ephemeris                 │
│ Ephemeris ✓  Almanac ✓  AOP ✗  ANO ✗     │
│ DGNSS          No                        │
│ Corrections    SBAS ✗ RTCM ✗ SLAS ✗ SPARTN ✗│
│ ── Signals ───────────────────────────── │
│ L1C/A   41 dB-Hz  Qi 7  used  res -0.4 m │
│ L2CL    35 dB-Hz  Qi 7  used  res  0.2 m │
│ ── Source fields ─────────────────────── │
│ Carrier freq   1575.42 MHz  (Android)    │
│ Baseband C/N0  38.2 dB-Hz   (Android)    │
└──────────────────────────────────────────┘
```

Only sections with at least one available field are shown. Fields with no data show `—` (REQ-SAT-05).

### 4.2 Landscape / tablet layout (REQ-SAT-09)

When the window is ≥ 600 dp wide, the list becomes a dense table with u-center columns. The first column (SV) is pinned and the rest scroll horizontally if they do not fit:

`SV | GNSS | Signal | C/N0 | Residual | Used | Qi | El | Az | Orbit | Health | DGNSS | Corr | EPH | ALM | AOP | ANO`

Boolean columns use dot + letter, as in u-center: ● green `Y` / ● red `N` / ○ grey `?`.

### 4.3 Signal strength chart (REQ-SAT-11)

Toggled by the ▤ icon. Replaces the list with a vertical bar chart:

- X axis: SV labels, grouped by constellation (same sort order and filter as the list).
- Y axis: C/N0 0–55 dB-Hz, gridlines every 10.
- Bar fill: C/N0 colour scale. Used SVs: solid bar with a darker outline. Unused SVs: hatched or 40% opacity.
- Multi-signal SVs: side-by-side thin bars, one per signal.
- Scrolls horizontally when there are more SVs than fit. Tapping a bar opens the detail sheet.

### 4.4 Sorting and filtering

| Control | Options | Default | Persisted |
|---|---|---|---|
| Sort | SV ID (constellation, then number), C/N0 ↓, Elevation ↓, Azimuth ↑, Used first | Constellation + SV | Yes |
| Constellation chips | All, GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC, SBAS (only constellations present in the data, plus `All`). Multi-select. Each chip shows `used/view`. | All | Yes |
| Used only | toggle | off | Yes |
| Has signal only | toggle (hide C/N0 = 0 / no signal) | off | Yes |

**The filter state is shared with the Sky view** (REQ-SAT-07).

### 4.5 Data rules

- An SV is **"in view"** if the source reports it at all, **"with signal"** if C/N0 > 0, and **"used"** if the source flags it as used in the navigation solution.
- Elevation/azimuth are **unknown** when:
  - UBX NAV-SAT: `orbitSource == 0 (none)` **or** `elev` outside [-90, 90] **or** `azim` outside [0, 360].
  - Android: `!hasAlmanac && !hasEphemeris && elevation == 0 && azimuth == 0`.
  - NMEA GSV: the field is empty.
- Negative elevations (SV just below the horizon, which UBX can report) are listed but **not plotted** in the Sky view.
- SVs not reported for longer than the *satellite timeout* (default 5 s) are removed (REQ-SAT-12).
- The list updates in place at the UI refresh rate (default 2 Hz). Rows do not jump while the user is scrolling or touching the list: re-sorting is suspended during a touch and for 1 s afterwards.

### 4.6 Field availability by source

| Field | Android | UBX NAV-SAT (+NAV-SIG) | UBX NAV-SVINFO (legacy) | NMEA GSV/GSA |
|---|---|---|---|---|
| Constellation, SV | ✓ | ✓ | ✓ | ✓ (talker + SV number range, §tech 6.3) |
| C/N0 | ✓ | ✓ | ✓ | ✓ (integer) |
| Elevation / Azimuth | ✓ | ✓ | ✓ | ✓ |
| Used in fix | ✓ | ✓ `svUsed` | ✓ | ✓ via GSA SV list |
| Ephemeris / Almanac | ✓ | ✓ `ephAvail` / `almAvail` | partly (`orbitAvail`, `orbitEph`) | — |
| Health | — | ✓ | ✓ `unhealthy` | — |
| Quality indicator | — | ✓ | ✓ | — |
| PR residual | — | ✓ | ✓ | — |
| Orbit source | — | ✓ | — | — |
| AOP / ANO | — | ✓ | ✓ `orbitAop` | — |
| DGNSS / corrections | — | ✓ | ✓ `diffCorr` | — |
| Signal / band | ✓ via carrier frequency (API 26+) | ✓ NAV-SIG `sigId` | — | ✓ NMEA 4.10+ GSV signal ID |
| Baseband C/N0 | ✓ (API 30+) | — | — | — |

---

## 5. Sky screen

Purpose: show where the satellites are in the sky (REQ-SKY).

### 5.1 Layout

```
┌──────────────────────────────────────────┐
│ Sky                   [● USB · 3D Fix ▾] │
│ [All] [GPS] [GLO] [GAL] ...   🧭 N-up ▾   │  ← shared filter + orientation toggle
├──────────────────────────────────────────┤
│                   N                      │
│              ╭────▲────╮                 │
│          ╭───╯  ●30    ╰───╮             │
│        ╭─╯  ●14  ╭────╮    ╰─╮           │
│       │  ▲16   ╭─╯    ╰─╮     │  ← rings: 0°, 30°, 60°, (opt. every 10/15°)
│     W ┼──■1────┼── + ───┼─────┼ E        │
│       │⬟21     ╰─╮    ╭─╯     │          │
│        ╰─╮  ●17  ╰────╯    ╭─╯           │
│          ╰───╮         ╭───╯             │
│              ╰─────────╯                 │
│                   S                      │
├──────────────────────────────────────────┤
│ Avg C/N0   ┌─────────────────────────┐   │
│ (dB-Hz)    │░░▒▒▓▓██ 25.4 ▼ ███████ │   │  ← markers: in view ▽ / used ▼
│            10   18   27   36   45     │   │
├──────────────────────────────────────────┤
│ Legend ⌄                                 │  ← collapsible
│ ● GPS  ■ GLONASS  ▲ Galileo  ⬟ BeiDou    │
│ ⬢ QZSS ◆ NavIC   ▼ SBAS                  │
│ ◉ used in fix   ○ not used               │
│ C/N0: [grey <10 | red | orange | yellow | green ≥40] │
└──────────────────────────────────────────┘
```

- **Portrait**: the plot is square, as wide as the screen minus 16 dp margins. The gauge and legend scroll below it.
- **Landscape / tablet**: the plot sits on the left (height-limited square), and the gauge and legend sit in a side panel on the right.

### 5.2 Plot geometry

- Centre = zenith (90° elevation). Outer circle = horizon (0°).
- Radius: `r = R × (90 − el) / 90` (equidistant azimuthal projection).
- Angle: azimuth measured clockwise from north (up). Screen position: `x = cx + r·sin(az − rot)`, `y = cy − r·cos(az − rot)`, where `rot` = 0 in north-up mode or the device heading in heading-up mode.
- Grid:
  - Elevation rings at 0°, 30° and 60° (bold outer ring at 0°). Setting *Dense grid*: every 10° elevation and 15° azimuth (u-center style), with degree labels.
  - Spokes at N/E/S/W (dense: every 15° or 30°), with cardinal labels outside the outer ring.
- In heading-up mode, a north marker (▲ "N") moves around the rim, and the heading in degrees is shown under the toggle. If the device has no magnetometer, the toggle is disabled with the explanation "Compass not available".

### 5.3 Markers

| Property | Encoding |
|---|---|
| Shape | Constellation (§6.2). |
| Fill colour | C/N0 colour scale (§6.1), using the SV's strongest signal. Grey if no signal. |
| Used in fix | Filled marker with a 2 dp dark outline (light outline in dark theme), full opacity. |
| Not used | Same shape, 1 dp outline, 60% opacity. |
| Unhealthy | Small ⚠ badge at the top-right of the marker. |
| Label | SV label below the marker (setting: on/off). The label shifts to avoid the rim and overlapping labels (simple greedy collision avoidance). |
| Size | 20 dp nominal, scaled for plot sizes under 300 dp. Hit area ≥ 44 dp (nearest marker within 24 dp of the touch wins). |

Interactions:

- **Tap a marker** → detail sheet (same as §4.1).
- **Long press on the plot** → tooltip with the az/el under the finger (Could).
- **Pinch** is not supported (the plot is always fitted).

### 5.4 Average C/N0 gauge (REQ-SKY-07)

- A horizontal colour bar from 10 to 45 dB-Hz using the C/N0 scale (as in GPSTest).
- Two pointers with values: **in view** (mean C/N0 of SVs with signal) and **used** (mean C/N0 of SVs used in the fix). Values below 10 or above 45 are clamped to the ends but labelled with the true value.
- Calculated over the **filtered** set of SVs, so the user can compare constellations.

### 5.5 Optional layers

| Layer | Pri | Description |
|---|---|---|
| Trails | S | Polyline per SV showing its past positions (sampled every 10 s, kept for the selected duration). Faded, thin, in constellation colour. |
| Signal heatmap | C | Az/el grid of 15° × 10° cells (24 × 9 cells). Each cell is coloured by the max (or mean, setting) C/N0 observed in it during the session. Replaces or underlays the markers. A reset button clears it. Mirrors `sky-ublox.jpg`. |
| Elevation mask | C | Shaded ring below the receiver's configured minimum elevation (u-blox, read-only). |

---

## 6. Visual encoding (shared across screens)

### 6.1 C/N0 colour scale

A continuous scale, interpolated between these stops (the same in light and dark themes; the bar backgrounds adapt):

| C/N0 (dB-Hz) | Colour | Meaning |
|---|---|---|
| no signal / 0 | Neutral grey `#9E9E9E` | Not tracked |
| 10 | Dark red `#B71C1C` | Very weak |
| 20 | Red `#E53935` | Weak |
| 27 | Orange `#FB8C00` | Fair |
| 35 | Yellow/amber `#FDD835` | Good |
| ≥ 45 | Green `#43A047` | Strong |

Wherever colour appears, the numeric C/N0 value appears next to it (list) or on tap (sky).

### 6.2 Constellations

| Constellation | Shape | Colour token | u-center prefix | RINEX prefix | Flag (optional) |
|---|---|---|---|---|---|
| GPS | ● circle | `gnss.gps` | G | G | 🇺🇸 |
| GLONASS | ■ square | `gnss.glo` | R | R | 🇷🇺 |
| Galileo | ▲ triangle | `gnss.gal` | E | E | 🇪🇺 |
| BeiDou | ⬟ pentagon | `gnss.bds` | B | C | 🇨🇳 |
| QZSS | ⬢ hexagon | `gnss.qzss` | Q | J | 🇯🇵 |
| NavIC (IRNSS) | ◆ diamond | `gnss.navic` | N | I | 🇮🇳 |
| SBAS | ▼ inverted triangle | `gnss.sbas` | S | S | — |
| IMES / unknown | ✕ cross | `gnss.other` | ? | ? | — |

Constellation colours (used for badges, chips and trails, **not** for marker fill, which shows C/N0) must stay distinguishable for common colour-vision deficiencies. The shape is always the primary cue.

### 6.3 Themes

- Light and Dark, following the system by default.
- The Sky view in dark theme uses a near-black background with light grid lines (reminiscent of u-center). In light theme it uses a white background with mid-grey grid lines (as in GPSTest).

---

## 7. Device screen

Purpose: identify the receiver and show its capabilities (REQ-DEV). The screen is a scrollable list of cards. Each card has a title, label/value rows, and a ⧉ copy action on long-press of a row. The header has **Share** to export everything as text. When a u-blox receiver is detected, a **[Configure receiver]** button at the top of the screen opens Receiver configuration (§11).

### 7.1 Phone GNSS source

| Card | Rows |
|---|---|
| Phone | Manufacturer, Model, Android version (API level), Device fingerprint (collapsed) |
| GNSS hardware | Hardware model name (API 28+), Year of hardware (API 28+) |
| Capabilities (API 30+) | Raw measurements, Navigation messages, Low-power mode, Satellite blocklist, Measurement corrections, Antenna info, Accumulated delta range, Satellite PVT (API 33+), Correlation vectors (API 33+). Each one is ✓ / ✗ / "Not reported". |
| Observed | Constellations seen this session, Signal bands seen (L1, L5, E1, E5a, B1I, B1C, B2a, G1, ...), **Dual-frequency: Yes/No**, Max SVs used, NMEA output: Yes/No |
| Antenna (API 30+, if supported) | Per carrier frequency: phase centre offset (mm) with uncertainty |
| Session | Started at, TTFF, Location updates received, GNSS status callbacks received |

### 7.2 USB receiver source

| Card | Rows | Source |
|---|---|---|
| USB device | Product name, Manufacturer, VID:PID (hex), Serial number, Driver (CDC-ACM/FTDI/CP210x/PL2303/CH34x), Port number, Baud rate (or "native USB") | Android `UsbDevice` + serial driver |
| Receiver | Vendor ("u-blox" / "Unknown"), Module (`MOD=`), Hardware version, Software version, Firmware (`FWVER=`), Protocol version (`PROTVER=`), Unique chip ID | MON-VER, SEC-UNIQID |
| GNSS support | Supported constellations, Default constellations, Enabled constellations, Max concurrent | MON-VER extensions (`GPS;GLO;GAL;BDS`), MON-GNSS |
| Antenna & RF | Antenna status (INIT/DONTKNOW/OK/SHORT/OPEN), Antenna power (OFF/ON/DONTKNOW), Jamming state (unknown/OK/warning/critical), Jamming indicator (0–255), Noise per MS, AGC % — per RF block where MON-RF is available | MON-RF (gen 9+) or MON-HW (gen 8) |
| Protocols | NMEA detected (version estimate: 2.x / 4.0 / 4.10 / 4.11), Talker IDs seen, UBX detected, Data mode (Poll / Periodic-RAM / Passive) | Parser stats |
| Messages | Live table: message name · count · rate (Hz) · last seen. E.g. `UBX-NAV-PVT 1.0 Hz`, `NMEA GSV 4.0 Hz` | Parser stats |
| Stream | Bytes received, Throughput (B/s), Checksum errors, Unknown/skipped bytes, Last data age | Parser stats |
| Info messages | Last 50 `$xxTXT` sentences and UBX-INF-* messages, timestamped | NMEA TXT, UBX-INF |

"Unknown" or not-yet-received values show `—` with a subtle "waiting…" hint during the first 5 s after connecting.

---

## 8. More → Console (REQ-LOG-01)

```
┌──────────────────────────────────────────┐
│ Console        ⏸ Pause  🗑 Clear  ⚲ Filter│
├──────────────────────────────────────────┤
│ 11:39:02.104 $GNRMC,113902.00,A,0121.12…│
│ 11:39:02.105 $GNGGA,113902.00,0121.12…  │
│ 11:39:02.130 UBX-NAV-PVT (92 B)          │  ← tap UBX row → decoded fields
│ 11:39:02.141 UBX-NAV-SAT (380 B)         │
│ 11:39:02.150 ✗ NMEA checksum error       │
└──────────────────────────────────────────┘
```

- Ring buffer of the most recent 2,000 entries. Auto-scrolls to the bottom unless the user has scrolled up (then shows a "↓ New messages" pill).
- Filter: by protocol (NMEA/UBX/Errors) and by message name (multi-select from the names seen).
- **Phone source**: shows the phone's NMEA sentences and a one-line summary per GnssStatus/Location callback.
- Monospace font. Long lines wrap (setting: wrap / truncate).

## 9. More → Settings (REQ-SET)

| Section | Setting | Values | Default |
|---|---|---|---|
| Appearance | Theme | System / Light / Dark | System |
| | SV label style | u-center / RINEX | u-center |
| | Show constellation flags | on/off | off |
| | Coordinate format | Decimal degrees / DMS / DDM | DD |
| | Units | Metric / Imperial | Metric |
| Display | UI refresh rate | 1 / 2 / 5 Hz | 2 Hz |
| | Satellite timeout | 3 / 5 / 10 / 30 s | 5 s |
| | Keep screen on | on/off | on |
| | Sky: dense grid | on/off | off |
| | Sky: labels | on/off | on |
| | Sky: trails | Off / 10 min / 1 h | Off |
| Map | Tile server (Could, REQ-MAP-10) | URL template `…/{z}/{x}/{y}.png` | OpenStreetMap |
| USB | Default baud | list | Auto |
| | Probe for UBX | on/off | on |
| | UBX data mode | Poll (safe) / Enable periodic output (RAM only) | Poll |
| | Set DTR/RTS on open | on/off | on |
| About | Version, licences (open-source notices), diagnostics log (share) | | |

Changing *UBX data mode* to "Enable periodic output" shows a confirmation: "This temporarily changes your receiver's message output settings (RAM only). The original settings come back when the receiver is power-cycled. Continue?"

## 10. Error and edge-case catalogue

Configuration-specific cases are in §11.7.

| Situation | Behaviour |
|---|---|
| Location permission permanently denied | Phone GNSS card shows "Permission denied" + **[Open app settings]**. |
| Location services off while running | Status chip → `Phone · Location off`. Banner with **[Turn on]**. Data goes stale. |
| Phone has no GNSS hardware | Phone GNSS option is disabled: "This device has no GNSS receiver". |
| Device does not support USB host | USB option is disabled: "USB host (OTG) not supported on this device". |
| USB device unplugged mid-session | Chip → `USB · Disconnected`. Stale overlay. Auto-reconnect on re-attach (REQ-SER-12). |
| USB I/O error | Retry opening the port once. If that fails, show the error state with **[Retry]**. |
| Wrong baud (garbage data) | After 5 s with no valid frame: hint banner "Data received but not recognised — wrong baud rate?" + **[Auto-detect]**. |
| Adapter connected but **no bytes at all** | After 5 s: "No data from the adapter. Check the module's power and that TX/RX are crossed (adapter RX → module TX)." + link to the TTL wiring help. |
| Receiver outputs only UBX, no NMEA | Supported. Everything comes from UBX. |
| Receiver outputs NMEA with UBX probing turned off | Generic NMEA mode. |
| u-blox rejects a poll (ACK-NAK) or never answers | That message is marked unsupported for this session and polling for it stops. Fall back to alternatives (NAV-SAT → NAV-SVINFO, MON-RF → MON-HW). |
| Very high data rate (≥ 10 Hz, ≥ 460800 baud) | Parsing keeps up. The UI is throttled to its refresh rate. The Console drops entries and shows a "N dropped" marker. |
| > 100 SVs (multi-band, all constellations) | The list is virtualised. Sky labels auto-hide when markers overlap heavily (setting can force them on). |
| App backgrounded | Sources stop (default). On resume, the source restarts automatically. The USB port is re-opened only if the device is still attached. |

---

## 11. Receiver configuration (REQ-CFG)

Available only when the active source is a **u-blox receiver on USB** (detected through MON-VER). Opened from **Device → [Configure receiver]** or **More → Receiver configuration**. With any other source, the More entry is disabled with the hint "Requires a connected u-blox receiver".

### 11.1 Concepts shown to the user

| Concept | How it is presented |
|---|---|
| **Current** (RAM) | The value the receiver is using now. This is what every form shows. |
| **Saved** (BBR + Flash) | The value the receiver starts with after a power cycle. |
| **Default** | The factory value. |
| **Unsaved** marker | A small ● "unsaved" badge on a setting whose Current value differs from its Saved value. A summary chip in the header shows "3 unsaved". |
| **Staged edit** | A change made in the app but not yet sent. Highlighted with a left accent bar and the old value struck through: ~~1 Hz~~ → **5 Hz**. |

Flow: **Edit** (staged) → **Apply** (RAM: takes effect now, lost on power cycle) → **Save** (permanent).

### 11.2 Overview screen

```
┌──────────────────────────────────────────┐
│ ← Receiver configuration   ● 2 unsaved   │
├──────────────────────────────────────────┤
│ u-blox M10 · SPG 5.10 · UART1 38400      │  ← receiver + link summary
│ ┌──────────────────────────────────────┐ │
│ │ Rate & timing          1 Hz        › │ │
│ │ Port & protocols       38400 · UBX+NMEA ›
│ │ Constellations         GPS GAL BDS QZSS ›
│ │ Message output         9 messages  › │ │
│ │ Navigation             Portable    › │ │
│ │ NMEA options           4.11        › │ │  (Should)
│ │ Power                  Full power  › │ │  (Could)
│ │ Advanced (all keys)                › │ │  (Should)
│ └──────────────────────────────────────┘ │
│ ┌ Actions ─────────────────────────────┐ │
│ │ Restart receiver (hot/warm/cold)   › │ │
│ │ Save to flash                        │ │  ← enabled when "unsaved" > 0
│ │ Revert to saved                      │ │
│ │ Backup / Restore                   › │ │  (Should)
│ │ ⚠ Factory reset                      │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Each row shows a one-line summary of the current value(s), plus the ● unsaved badge where it applies.
- Values load when the screen opens (a spinner per row). If the read fails, the row shows "Couldn't read — tap to retry".

### 11.3 Section screens (common pattern)

```
┌──────────────────────────────────────────┐
│ ← Rate & timing                          │
├──────────────────────────────────────────┤
│ Measurement rate                         │
│ [ 1 ] [ 2 ] [▌5▐] [ 10 ] [Custom…] Hz    │  ← staged: 1 → 5 Hz
│ ~~1 Hz~~ → 5 Hz                          │
│ ⚠ With 4 constellations, M10 supports up │
│   to about 5 Hz. Higher rates may be     │
│   rejected or drop constellations.       │
│                                          │
│ Navigation ratio         [ 1 ▾]          │
│ (navigation solution every N measurements)│
│ Time reference           [ UTC ▾]        │
├──────────────────────────────────────────┤
│ 1 change      [ Discard ]   [ Apply ]    │  ← sticky staged-changes bar
└──────────────────────────────────────────┘
```

- Controls: segmented buttons for small enumerations, switches for booleans, numeric steppers with a range hint for numbers, pickers for long enumerations. Ranges and allowed values come from the key definitions (tech spec §13).
- The **staged-changes bar** appears whenever there are staged edits (across all sections; the count is global). **Discard** clears them. **Apply** opens a summary sheet if there is more than one change, then sends them.
- **Leaving** Configuration with staged edits prompts "Discard N unapplied changes?".
- After **Apply**: progress → read-back verification → toast "Applied (not saved)" with a **[Save]** action. A mismatch shows an error per setting ("Receiver reports 2 Hz, expected 5 Hz").

### 11.4 Sections and their settings

| Section | Settings | Notes |
|---|---|---|
| **Rate & timing** | Measurement rate (Hz or ms); navigation ratio; time reference (UTC/GPS/GLO/BDS/GAL) | Warns when the rate exceeds the receiver's limit for the enabled constellations. |
| **Port & protocols** | For the **connected port** (UART1 or USB): baud rate (UART only); input protocols UBX / NMEA / RTCM3; output protocols UBX / NMEA (/ RTCM3 where supported). Other ports (UART2, I2C, SPI) are listed read-only here and editable in Advanced. | Baud change follows §11.5. Lock-out rule: the UBX-in and UBX-out switches for the connected port are disabled ("UBX Mobile needs UBX to talk to the receiver"). |
| **Constellations** | Per constellation an on/off switch, with signal sub-switches where the receiver has several (e.g. BeiDou B1I / B1C, QZSS L1C/A / L1S). Shows "Max N concurrent" and the current count. | The info line notes that applying restarts the GNSS subsystem (satellites drop out and come back). The app rejects, before sending, combinations the receiver documents as invalid, where known. |
| **Message output** | Two lists, **NMEA** and **UBX**. Each message has an output rate on the connected port: Off / every epoch / every Nth epoch (stepper 0–255). | A note under NAV-PVT/NAV-SAT/NAV-SIG: "Enabling these lets UBX Mobile stop polling (lower link load)". |
| **Navigation** | Dynamic model (portable, stationary, pedestrian, automotive, sea, airborne <1g/<2g/<4g, wrist, … whichever the receiver supports); fix mode (2D / 3D / auto); minimum elevation (°); minimum C/N0 (dB-Hz) and the minimum number of SVs above it; UTC standard | Each enumeration value has a one-line explanation. |
| **NMEA options** (Should) | NMEA version; SV numbering (strict / extended); high precision; main talker ID; GSV limits | These change what the app has to parse. The parser handles all variants (tech spec §6.2). |
| **Power** (Could) | Power mode (full / balanced / interval / aggressive), update period | Warns that power-save modes reduce the update rate. |
| **Advanced** (Should) | Every key the receiver reports, grouped (CFG-RATE, CFG-UART1, CFG-SIGNAL, …) and searchable. A row shows name, type, current value and an ● unsaved badge. Tapping a row shows details: description, value per layer (RAM / BBR / Flash / Default), unit/scale, and an editor suited to the type. | Keys unknown to the app's key database show only raw ID, type and value, and are edited as raw numbers (with a warning). |

### 11.5 Changing the baud rate of the connected port

```
User stages 38400 → 115200 and taps Apply
  ├─ App sends CFG-VALSET (RAM) for the UART1 baud rate
  ├─ (the ACK may be lost because the receiver switches immediately — not a failure)
  ├─ App sets its own serial port to 115200
  ├─ App polls MON-VER and waits up to 3 s for a valid reply
  │    ├─ reply    → "Baud rate changed to 115200" (unsaved) + [Save]
  │    └─ no reply → app returns to 38400 and polls again
  │          ├─ reply    → "Receiver did not accept 115200; still at 38400"
  │          └─ no reply → "Lost contact. Power-cycle the receiver to restore the saved
  │                         baud rate." + [Auto-detect baud]
  └─ The remembered baud for this device is updated only after a successful change
```

### 11.6 Actions

| Action | Confirmation | Behaviour |
|---|---|---|
| **Restart receiver** | Sheet with three choices, each explained: **Hot start** (keeps all data), **Warm start** (clears ephemeris), **Cold start** (clears ephemeris, almanac, position and time). One tap, no extra confirmation. | GNSS-only software reset, so the serial link stays up. Clears the satellite list and resets TTFF tracking. The Status screen shows "Restarted (cold) at 12:03:15 — waiting for fix". |
| **Save to flash** | Dialog "Make these changes permanent?" listing the unsaved settings (old saved → new). **Cancel** / **Save**. | Writes the changed keys' current values to BBR + Flash, then reads back to confirm. The "unsaved" count goes to 0. |
| **Revert to saved** | Dialog "Undo N unsaved changes?" | Writes the saved values back to RAM for the changed keys. A baud change follows §11.5. |
| **Backup** (Should) | — | Reads the full configuration (all layers) into a JSON file and opens the Android share sheet. The backup is also kept in the app's backup list (last 20, including the automatic pre-change backups, labelled e.g. "Auto · before first change · 12:03"). |
| **Restore** (Should) | Pick a backup from the list or a file → preview the differences from the current configuration → **Apply to RAM** (then optional Save). | Keys the receiver does not know are skipped and listed. A backup from a different receiver model shows a warning. |
| **Factory reset** | Dialog with explicit wording: "Erase all saved settings and restore u-blox factory defaults? The receiver will restart and its baud rate will return to the default (e.g. 38400)." Hold-to-confirm button. | Clears the BBR + Flash configuration and restarts the receiver. The app reconnects (with auto-baud if the baud rate changed). |

### 11.7 Configuration edge cases

| Situation | Behaviour |
|---|---|
| Receiver replies ACK-NAK to Apply | Nothing was changed (transaction). The app shows "Receiver rejected the change" and names the rejected group. If the transaction spanned several messages, it bisects the change set to find the offending key. |
| No ACK within 2 s (not a baud change) | Read the keys back. If the values match, report success. Otherwise report failure and keep the edits staged. |
| USB disconnected during Apply/Save | Report "Unknown result — reconnect and review". On reconnect, Configuration reloads and shows the actual values. |
| Monitoring polls during configuration | Polling pauses while a configuration transaction is in flight, so ACKs are not confused with other traffic, and resumes afterwards. |
| New output would exceed the link capacity | Before Apply, estimate output bytes/s from enabled messages × rate. If it is above ~80% of baud/10, warn: "Output may exceed 38400 baud. Increase the baud rate or disable messages." |
| Receiver generation ≤ 8 (no CFG-VAL interface) | Overview shows "This receiver uses the legacy configuration interface", with the legacy sections if REQ-CFG-19 is implemented. Otherwise Configuration is read-only with that message. |
| Generic NMEA or phone source | Configuration is not available (REQ-CFG-01). For the phone source, a "Clear aiding data" action may be offered (REQ-CFG-20, Could). |

---

## 12. Map screen (REQ-MAP)

```
┌──────────────────────────────────────────┐
│ Map                  [● USB · 3D Fix ▾]  │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ 1.3520833° N  103.8198361° E         │ │  ← position overlay (long-press: copy)
│ │ ±2.4 m · 3D fix                       │ │
│ └──────────────────────────────────────┘ │
│        ░░░ OpenStreetMap tiles ░░░   [+] │
│      ·····                           [−] │
│           ·····  ◯ ← accuracy circle     │
│                ··●➤  ← position + course │
│                                      [◎] │  ← My location (filled = following)
│ © OpenStreetMap contributors             │  ← attribution (tap: copyright page)
├──────────────────────────────────────────┤
│ Status │ Satellites │ Sky │ Map │ Device │ ⋯ │
└──────────────────────────────────────────┘
```

### 12.1 Behaviour

| Element | Behaviour |
|---|---|
| Map | OpenStreetMap standard raster tiles. Drag to pan, pinch to zoom, double-tap to zoom in one level around the tapped point. Zoom range 2–19. Starts at zoom 16 on the position; with no position yet, at zoom 2 on (0°, 0°). |
| Position marker | Filled dot in the primary colour with a white outline. Hollow when there is no current fix (last known position) and grey when the source is stale (§1.1). |
| Accuracy circle | Translucent circle with radius hAcc (metres converted at the marker's latitude). Hidden when hAcc is unknown or smaller than the dot. |
| Course arrow | Drawn on the marker when speed > 0.5 m/s and course is known (REQ-MAP-08). |
| Track | Line through the session's positions (REQ-MAP-07). Cleared when the source changes or the receiver restarts. At most 2000 points; the oldest are dropped. |
| Follow mode | On by default: the map re-centres on each new position. Dragging or pinching turns it off. **[◎] My location** turns it on again and centres the map. The button shows the state (filled / outline icon, and its label says "Following" or "Centre on position"). |
| Zoom buttons | **[+]** / **[−]**, one level per tap, around the map centre (around the position when following). |
| Position overlay | Latitude and longitude in the coordinate format from Settings, horizontal accuracy and fix type (same labels as the Status screen). Long-press copies `lat, lon` and shows a toast. Without a fix: "Waiting for a position fix…". |
| Attribution | "© OpenStreetMap contributors", always visible at the bottom left. Tap opens https://www.openstreetmap.org/copyright. |
| Dark theme | The tiles stay as published; they are dimmed slightly (80% opacity on the dark background) so the map is not glaring. |

### 12.2 States and errors

| Situation | Display |
|---|---|
| No source / connecting / error | Same as every data screen (§1.1). |
| Source running, no fix yet, no last position | World view, overlay "Waiting for a position fix…". |
| No fix, last position known | Map stays on the last position; hollow marker; overlay "No fix — last position from 12:03:15". |
| Tiles cannot be loaded (offline, blocked, HTTP error) | Grid background; banner "Map tiles unavailable — check the internet connection". The marker, track, accuracy circle and overlay still work. Tiles retry when the map is moved or zoomed. |
| Phone is offline when the screen opens | As above. No other screen is affected (REQ-NFR-06). |

### 12.3 Network and privacy

- Tiles are requested only while the Map screen is visible and only for the visible area (no prefetching or offline download, per the OSM tile usage policy).
- Requests contain the tile coordinates, so the tile server learns roughly which area is being viewed. They never contain the position, the receiver identity or any other data. About states this.
