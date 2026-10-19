# UBX Mobile — Implementation Plan

| | |
|---|---|
| Document | Implementation Plan |
| Status | Draft v0.1 |
| Date | 2026-10-18 |
| Based on | [requirements.md](requirements.md), [functional-specifications.md](functional-specifications.md), [technical-specifications.md](technical-specifications.md) |

---

## 1. Strategy

1. **Data before UI, but without waiting for hardware.** The protocol parsers and a **Replay source** come first. With recorded logs, the Satellites, Sky and Status screens can be built and tested on an emulator before either native module exists.
2. **One vertical slice per source.** The phone GNSS path (no extra hardware needed) is finished end to end before the USB path.
3. **Must before Should.** Each milestone lists its Must scope. Should/Could items are picked up in M6 or deferred.
4. **Every milestone ends with a runnable build** that has been demonstrated on a real phone.

Estimates assume one experienced React Native developer with some Android/Kotlin knowledge. **1 unit ≈ 1 developer-day.**

---

## 2. Milestones

### M0 — Project foundation (≈ 3 units)

| # | Task | Ref |
|---|---|---|
| 0.1 | Create Expo app (TypeScript, Expo Router, tabs template). Enable `strict`, ESLint, Prettier, path aliases. | TS §1, §3 |
| 0.2 | Add the dev client and do the first `expo prebuild`. Set `minSdkVersion 26`. Build and run on a device. | TS §12 |
| 0.3 | Navigation skeleton: tabs Status / Satellites / Sky / Device / More, header with a placeholder StatusChip. | FS §1 |
| 0.4 | Theme tokens (light/dark), base components (`Card`, `KeyValueRow`, `EmptyState`, `Banner`). | TS §8.3 |
| 0.5 | `settingsStore` with MMKV persistence and versioned schema. i18n setup with `en.json`. | TS §7.3 |
| 0.6 | CI: typecheck, lint and Jest on push. | TS §12 |
| 0.7 | Initialise the git repository (the folder is not under version control yet). | — |

**Exit:** the app installs on a phone, tabs navigate, the theme switches, CI is green.

**Status (2026-10-18): done.** Typecheck, lint and 45 tests pass. The debug build (arm64-v8a, with CMake 3.31.6 pinned to get around the Windows path-length limit, TS §12) runs on the test phone over USB: tabs and the dark theme render. Dev setup notes: Gradle needs JDK 17+ (`JAVA_HOME` → Android Studio JBR). If the phone can't reach the PC over Wi-Fi, load Metro over USB with `adb reverse tcp:8081 tcp:8081` and `http://127.0.0.1:8081`.

### M1 — Domain model & protocol layer (≈ 8 units)

| # | Task | Ref |
|---|---|---|
| 1.1 | `domain/`: types, constellation metadata, `satKey` normalisation (all numbering schemes), signal tables, C/N0 colour scale. | TS §4, §6.3, §6.4 |
| 1.2 | `StreamDecoder`: NMEA/UBX/RTCM3 framing, checksums, resync, stats. Fuzz tests. | TS §6.1 |
| 1.3 | NMEA sentence parsers (GGA, RMC, GSA, GSV, GLL, VTG, GNS, ZDA, TXT). GSV/GSA assembler, epoch logic, version detection. | TS §6.2 |
| 1.4 | UBX decoders: NAV-PVT, NAV-SAT, NAV-SIG, NAV-DOP, NAV-STATUS, NAV-SVINFO, MON-VER, MON-HW, MON-RF, MON-GNSS, SEC-UNIQID, ACK, INF. UBX builder. | TS §6.5 |
| 1.5 | NMEA and UBX interpreters → `GnssEvent`s. | TS §7.1 |
| 1.6 | `GnssAccumulator` (precedence, ageing, signal merge, dirty-commit) + `gnssStore` + selectors (filter/sort/counts/avg C/N0). | TS §7.2, §7.3 |
| 1.7 | Collect fixtures: record ≥ 5 min logs in u-center from the available receivers (see §4), plus synthetic edge-case frames. | TS §10 |

**Exit:** `src/protocols`, `src/domain` and `src/state` have ≥ 90% line coverage. Replaying each fixture log in Jest produces satellite sets that match u-center for sampled epochs.

**Status (2026-10-18):** 1.1–1.6 done. 194 tests pass; coverage of the core layers is ~99% of lines and ~92% of branches, enforced in CI by per-directory thresholds (90%). Fixtures are synthetic so far (`test/helpers/fixtures.ts`: a u-blox M10-style NMEA 4.11 epoch plus every UBX message type), including fuzz tests of the decoder. **1.7 partly done:** the BE-122's configuration dump (`docs/examples/be-122-dump.txt`, u-center 2) provides a real MON-VER, now a fixture (`test/fixtures/be122.ts`) that the decoder and the demo receiver match byte for byte; it showed the module reports no `MOD=` line. Its CFG-VALGET pages are the factory reference for M5b. Still open: a recorded navigation log (NMEA + NAV-PVT/SAT/SIG) from the BE-122. Deviations from the spec: the event contract lives in `src/domain/events.ts`, the C/N0 colour scale in `src/ui/theme/cn0Scale.ts`.

### M2 — Replay source + core screens (≈ 9 units)

| # | Task | Ref |
|---|---|---|
| 2.1 | `GnssSource` interface, `SourceManager`, `ReplaySource` (bundled sample logs, speed control). Dev-only entry point in the Source sheet. | REQ-SRC-05, TS §7.1 |
| 2.2 | StatusChip + global data states (empty, waiting, stale, error). | FS §1.1 |
| 2.3 | **Satellites screen** (portrait): summary header, constellation chips, sort/filter controls, `SatelliteRow`, FlashList, sort freeze on touch. | REQ-SAT-01..08, 12; FS §4.1, §4.4, §4.5 |
| 2.4 | **Satellite detail sheet** with all NAV-SAT/NAV-SIG fields and the per-signal list. | REQ-SAT-04, 05, 10 |
| 2.5 | **Sky screen**: projection, grid, constellation-shaped markers, C/N0 fill, used/unused encoding, labels with collision avoidance, tap → detail, avg C/N0 gauge, collapsible legend, shared filter. | REQ-SKY-01..08; FS §5 |
| 2.6 | **Status screen**: fix banner, position/motion/quality/time cards, per-constellation counts, copy. | REQ-POS-01; FS §3 |
| 2.7 | Component tests + first Maestro flow (Replay → check every tab). | TS §10 |

**Exit:** on an emulator with the Replay source, all three screens show correct data and update smoothly. A design review of phone portrait layouts against the reference screenshots is done.

**Status (2026-10-18):** 2.1–2.7 implemented; 231 tests pass (unit, replay, and screen tests that render the real router with demo data). Beyond the plan: a basic Device screen (receiver identity, GNSS support, antenna/RF, protocols, stream stats, info messages) because the data already exists; settings schema v2 (satellite sort/filter, remembered source). **Not yet verified on a device:** the screens, sheets and Maestro flow (`e2e/demo-receiver.yaml`) still need a run on the phone/emulator, and the design review against the reference screenshots is pending. New native libraries (react-native-svg, FlashList, expo-clipboard) require rebuilding the development build (`npm run android`).

### M3 — Phone GNSS source (≈ 6 units)

| # | Task | Ref |
|---|---|---|
| 3.1 | `modules/android-gnss` (Kotlin): location updates, GnssStatus callback, first fix, NMEA listener with batching, provider-change receiver, device info and capabilities by API level. | TS §5.1 |
| 3.2 | `AndroidLocationSource`: permission flow (rationale, precise vs approximate, permanent denial), provider-off handling, mapping to `GnssEvent`s, carrier frequency → band, unknown-position rule, DOP and MSL from NMEA. | REQ-AND-01..08; FS §2 |
| 3.3 | Source sheet: Phone option, remembered source, AppState stop/restart. | REQ-SRC-01..04; TS §8.4 |
| 3.4 | Device screen, Android variant (Phone, GNSS hardware, Capabilities, Observed, Antenna, Session cards) + share as text. | REQ-DEV-01, 02, 07; FS §7.1 |
| 3.5 | Side-by-side check against **GPSTest** on 2 or more phones (one dual-frequency). | REQ-AND-03 |

**Exit:** UC-1 works on the test phones. SV count, C/N0 (±1 dB-Hz) and el/az (±1°) match GPSTest. Permission and location-off paths have been demonstrated.

**Status (2026-10-18):** 3.1–3.4 implemented. The `android-gnss` Kotlin module compiles and the debug APK builds; `AndroidLocationSource`, permission flow (rationale, precise/approximate, denied/blocked → app settings), location-off handling and the Android Device screen (with Share) are covered by 253 passing tests using a fake native module. **Open:** 3.5 and the exit criteria need the phone — install the new build (`npm run android`), choose *Phone (built-in)*, and compare with GPSTest (satellite count, C/N0 ±1 dB-Hz, el/az ±1°). Also check the permission and location-off paths by hand.

### M4 — USB serial source (≈ 9 units)

| # | Task | Ref |
|---|---|---|
| 4.1 | `modules/usb-serial` (Kotlin): device listing with the u-blox probe table, permission request (Android 12/14 PendingIntent rules), open/close/setParameters/write, buffered reads → base64 events, attach/detach receivers, launch intent. | TS §5.2 |
| 4.2 | `plugins/withUsbHost.ts`: manifest features, intent filter, `device_filter.xml`. | TS §5.3 |
| 4.3 | `UsbSerialSource`: wiring to the StreamDecoder, stats, connection states, detach → stale, auto-reconnect on re-attach. | REQ-SER-01..04, 11, 12, 14 |
| 4.4 | `ReceiverDetector` + `AutoBaud`. | REQ-SER-05; TS §6.7 |
| 4.5 | `UbxClient`: monitoring channel (polls/VALGET only), request tracking, capability learning and fallbacks, 1 Hz poll scheduler. Unit tests proving the monitoring channel cannot write configuration. | REQ-SER-07, 08, 10; TS §6.6 |
| 4.6 | Source sheet: USB device list, baud selector, permission errors, empty state with OTG help. | FS §2, §2.1 |
| 4.7 | Launch-on-attach flow. | REQ-SER-13 |

**Exit:** UC-2 works with the **BE-122 through a USB-to-TTL adapter**: (a) at its configured 57600 baud with auto-baud (it outputs nothing until polled), (b) with UBX probing turned off, so it behaves like a generic NMEA receiver, and (c) after its baud rate was changed in u-center on a PC *without saving to flash*, to exercise auto-baud. Unplugging and replugging recovers. A code review confirms the allow-list. The CDC-ACM path (u-blox native USB) is checked only by unit tests and the probe table unless such a receiver becomes available.

**Status (2026-10-19):** 4.1–4.7 implemented. `modules/usb-serial` (Kotlin, usb-serial-for-android 3.10.0) compiles; `plugins/withUsbHost.js` adds the USB host feature, attach intent filter and `device_filter.xml`. `UsbSerialSource` (permission → open → detect → identity polls → 1 Hz polling; detach → stale → auto-reconnect; background close/reopen), `UbxClient` (monitoring-only allow-list, retries, NAK/timeout learning, fallbacks) and the receiver sheet's USB section are covered by tests against simulated receivers modelled on the BE-122 and BZ-251 dumps — including a test that every byte written is a read-only poll. **Open:** hardware runs with the BE-122 / BZ-251 via a USB-to-TTL adapter (exit criteria above).

### M5 — Device information for USB receivers (≈ 4 units)

| # | Task | Ref |
|---|---|---|
| 5.1 | Device screen, USB variant: USB device, Receiver (MON-VER, SEC-UNIQID), GNSS support (MON-VER ext, MON-GNSS), Antenna & RF (MON-RF/MON-HW), Protocols, Messages table, Stream stats, Info messages. | REQ-DEV-03..08; FS §7.2 |
| 5.2 | "waiting…" placeholders during detection, and share as text. | FS §7 |
| 5.3 | Verify the values match u-center for each test receiver (hardware/firmware/protocol versions, unique ID, antenna status with the antenna unplugged). | REQ-DEV-04, 05 |

**Exit:** UC-4 works for every receiver in the test matrix.

**Status (2026-10-19):** 5.1–5.2 implemented. The USB Device screen has the USB device/adapter card (with a note that a bridge's descriptor describes the adapter, not the GNSS module), Receiver (MON-VER, SEC-UNIQID), GNSS support (supported/default/enabled/max concurrent), one Antenna & RF card per RF block, Protocols (NMEA version, talkers, UBX, data mode: polling / receiver output / listening only), a live Messages table (rate over 5 s and count per message, from `src/protocols/messageStats.ts`), Stream (bytes, throughput, last-data age, frames, errors, junk) and Info messages. Missing identity values read "waiting…" while connecting/detecting and for 5 s after; rows copy on long-press; Share exports everything. **Open:** 5.3 needs the hardware — compare against u-center 2 for the BE-122 and BZ-251 (versions, unique ID, antenna status with the antenna unplugged).

### M5b — Receiver configuration (≈ 12 units)

| # | Task | Ref |
|---|---|---|
| 5b.1 | Capture a full VALGET dump (all layers) from the BE-122 as a fixture. Generate the CFG key database from the M10 interface description. `valCodec` (key-ID size rules, encode/decode, VALGET/VALSET/VALDEL builders, chunking, transactions). | TS §13.1, §13.2 |
| 5b.2 | UbxClient **configuration channel**: `ConfigWriteRequest`, CFG-VALSET/VALDEL/RST, poll pause during transactions, write log. | REQ-SER-08, REQ-CFG-22; TS §6.6 |
| 5b.3 | `ConfigService` + `configStore`: load (RAM/Flash/BBR), staged edits, Apply with read-back verification, Save, Revert to saved, automatic pre-change backup. | REQ-CFG-02..06; TS §13.3, §13.4 |
| 5b.4 | Baud-change state machine with rollback. | REQ-CFG-09; FS §11.5 |
| 5b.5 | `rules.ts`: lock-out protection, throughput estimate, M10 rate/constellation limits. | REQ-CFG-07, 10, 11; TS §13.4 |
| 5b.6 | UI framework: overview, declarative section renderer, staged-changes bar, Apply/Save/Revert/Factory-reset confirmations, unsaved badges. | REQ-CFG-01..06; FS §11.1–11.3, §11.6 |
| 5b.7 | Sections: Rate & timing, Port & protocols, Constellations, Message output, Navigation. Restart sheet (hot/warm/cold). | REQ-CFG-07..14; FS §11.4 |
| 5b.8 | Hardware verification on the BE-122. Each setting: apply → observe the effect in Status/Satellites/Console → save → power-cycle → still applied. Revert and factory reset restore the defaults. Baud 38400 ↔ 115200 round-trip. | UC-5 |

**Exit:** UC-5 works on the BE-122. Every Must REQ-CFG item has been demonstrated, and a factory reset returns the module to its out-of-box state (checked against a VALGET dump taken before any changes).

### M6 — Should-level features & polish (≈ 12 units)

| # | Task | Ref |
|---|---|---|
| 6.1 | Landscape/tablet layouts: wide satellite table, side-by-side sky view. | REQ-SAT-09; FS §4.2, §5.1 |
| 6.2 | Signal strength bar chart. | REQ-SAT-11; FS §4.3 |
| 6.3 | Heading-up sky mode (compass) and sky trails. | REQ-SKY-09, 10 |
| 6.4 | Console screen (ring buffer, pause/clear/filter, decoded UBX detail). | REQ-LOG-01; FS §8 |
| 6.5 | Full Settings screen (units, coordinate format, label style, flags, refresh rate, timeout, keep awake, USB options incl. opt-in periodic UBX output on RAM). | REQ-SET-*; REQ-SER-09; FS §9 |
| 6.6 | u-blox extras on the Status screen (carrier solution, time validity, leap seconds). | REQ-POS-02 |
| 6.7 | Accessibility pass: screen-reader labels, font scaling to 1.3, greyscale check of sky/list, contrast tests. | REQ-NFR-02, 07 |
| 6.8 | Configuration: NMEA options section. | REQ-CFG-15 |
| 6.9 | Configuration: backup / restore (JSON, share sheet, backup list, restore preview with diff). | REQ-CFG-16; TS §13.5 |
| 6.10 | Configuration: Advanced key editor (all keys, per-layer values, search). | REQ-CFG-17 |

**Exit:** all Should requirements are done or explicitly deferred with a reason.

### M7 — Hardening & release (≈ 5 units)

| # | Task | Ref |
|---|---|---|
| 7.1 | Performance profiling against the budgets (921600 baud, 10 Hz, 100+ signals). Apply the decoder fallback only if needed. | REQ-NFR-03, 04; TS §7.4 |
| 7.2 | Run the full hardware test matrix (§4) and fix device-specific issues. | — |
| 7.3 | Long-run soak test (2 h USB session, 2 h phone session): no memory growth, no ANR. | REQ-NFR-05 |
| 7.4 | Remove unneeded permissions (e.g. INTERNET), add open-source licence notices to About, write the in-app help text (OTG, power, baud). | TS §5.3, §11 |
| 7.5 | Release build pipeline: signed **APK** (create and back up the release keystore), version 1.0.0, install/upgrade instructions for sideloading ("Install unknown apps" permission). | REQ-NFR-14; TS §12 |

**Exit:** the release candidate passes the acceptance checklist (§5).

### Optional — Could items (backlog, after v1.0)

| Item | Ref | Est. |
|---|---|---|
| Raw stream recording + share (foreground service for background recording) | REQ-LOG-02, REQ-NFR-09 | 4 |
| Sky signal heatmap (u-center style) | REQ-SKY-11 | 3 |
| Elevation-mask ring via CFG-VALGET | REQ-SKY-12 | 1 |
| Replay source exposed to end users (file picker) | REQ-SRC-05 | 1 |
| Configuration: power settings | REQ-CFG-18 | 1 |
| Configuration: legacy (gen ≤ 8) receivers | REQ-CFG-19 | 4 |
| Phone GNSS: clear aiding data / inject time | REQ-CFG-20 | 1 |
| Import u-center configuration files | REQ-CFG-21 | 2 |

---

## 3. Schedule overview

```
Units:   0    5    10   15   20   25   30   35   40   45   50   55   60   65   70
M0  ███                                                                         (3)
M1     ████████                                                                 (8)
M2             █████████                                                        (9)
M3                      ██████                                                  (6)
M4                            █████████                                         (9)
M5                                     ████                                     (4)
M5b                                        ████████████                         (12)
M6                                                     ████████████             (12)
M7                                                                 █████        (5)
                                                         ≈ 68 units (+ ~20% contingency ≈ 82)
```

M3 (Kotlin GNSS module) can start in parallel with M2 if a second developer is available. M4.1/4.2 (USB native module) can also be prototyped early to reduce risk R1.

---

## 4. Test hardware matrix

### 4.1 Available

| Item | Purpose |
|---|---|
| Android phone (model to be noted) | Phone GNSS source, USB host for the external receiver |
| **Beitian BE-122** (u-blox M10, TTL UART, 38400 default) | Reference external receiver: UBX gen-9+ paths, NMEA, auto-baud, Device screen |

### 4.2 Needed before M1.7 / M4 (inexpensive)

| Item | Why |
|---|---|
| **USB-to-TTL adapter**, ideally **two**: one **CP2102** and one **CH340** | The BE-122 has only a TTL UART. Two common chipsets also test two driver paths. The adapter must provide a **5 V** pin to power the module (VCC 3.6–5.5 V) and use 3.3 V logic levels (most CP2102/CH340 boards do). |
| **USB OTG adapter/cable** matching the phone's port (usually USB-C → USB-A female) | Lets the phone act as USB host. |
| Jumper wires | Adapter 5V → VCC, GND → GND, adapter RX → module TX, adapter TX → module RX. |
| Windows PC with **u-center 2** (and/or u-center classic if it supports M10) | Record fixture logs from the BE-122, and compare the app with u-center. |

### 4.3 Coverage gaps and how they are handled

| Not covered by available hardware | Mitigation |
|---|---|
| u-blox native USB (CDC-ACM) | Unit tests plus the usb-serial-for-android CDC driver. Marked "supported, untested" in the release notes. |
| FTDI / PL2303 adapters | Same. Add one later if a cheap adapter is on hand. |
| u-blox M8 / legacy NAV-SVINFO / MON-HW | Synthetic UBX fixtures only. |
| Multi-band receiver (NAV-SIG with several signals per SV) | Synthetic fixtures. The phone may cover multi-band UI if it is dual-frequency. |
| Generic non-u-blox NMEA receiver | BE-122 with UBX probing turned off. |
| Several phone vendors / old Android versions | An Android 8–10 emulator for API-level paths (no real GNSS data there, so it is used for the Replay source only). |

---

## 5. Acceptance checklist (v1.0)

- [ ] All **Must** requirements in [requirements.md](requirements.md) are met and their ACs verified (traceability table kept in the PR or release notes).
- [ ] UC-1 to UC-5 demonstrated on the phones and receivers in §4.
- [ ] Satellite list and sky view on the phone source agree with GPSTest. On u-blox receivers they agree with u-center (same SVs, C/N0 ±1 dB-Hz, el/az ±1°, flags identical).
- [ ] Monitoring is side-effect free: after a session that does not use Configuration, a full configuration dump (all layers) of each receiver is identical to the one taken before.
- [ ] Configuration: Apply only changes RAM, Save persists across a power cycle, Revert and factory reset restore the previous/default state, and a baud change never leaves the app unable to reach the receiver without a clear recovery path.
- [ ] Performance budgets (TS §7.4) met on the mid-range reference phone.
- [ ] 2 h soak tests pass with no crash or ANR and memory stays flat.
- [ ] Portrait phone, landscape phone and tablet layouts reviewed. Light and dark themes reviewed.
- [ ] Unit coverage ≥ 90% on protocol/domain/state. The E2E Maestro suite passes in CI.

---

## 6. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | OEM differences in USB host behaviour (power limits, permission dialogs, CDC quirks) | Medium | High | Prototype the USB module early with the BE-122 and the adapter (spike in M0/M1). Document powered-hub use in help. |
| R9 | Only one phone and one receiver available, so vendor-specific bugs may surface only after release | Medium | Medium | Coverage-gap mitigations (§4.3). Diagnostics log the user can share (REQ-LOG-03) to debug field reports. |
| R10 | Wiring mistakes with the TTL module (TX/RX swapped, wrong voltage) mistaken for software bugs | Medium | Low | In-app help with a wiring diagram for TTL modules. The "No GNSS data detected" error suggests checking TX/RX. |
| R2 | JS thread cannot keep up with high-rate streams | Low–Med | Medium | Batched native reads, accumulator outside React, throttled commits. Decoder fallback to a worklet thread or Kotlin framing (TS §7.4). |
| R3 | Phone GNSS data varies by vendor (no NMEA, no carrier frequency, odd svids, C/N0 caps) | High | Low–Med | Every field optional in the model (`—` in UI). Test on several phones. Compare with GPSTest. |
| R4 | UBX message layouts differ between firmware generations | Medium | Medium | Version-aware decoders (`version` byte, payload-length checks), fallbacks (NAV-SVINFO, MON-HW), fixtures from several generations. |
| R5 | NMEA SV numbering ambiguity (extended vs strict 4.10/4.11, vendor ranges) | Medium | Medium | Talker plus range plus system-ID heuristics (TS §6.3), unit-tested with real logs from each receiver. |
| R6 | Accidental receiver misconfiguration (by monitoring code, or by a configuration bug) | Low | High | Two-channel UbxClient with unit tests (REQ-SER-08). Apply is RAM-only, Save is separately confirmed, automatic pre-change backup, lock-out rules, factory reset. Before/after config-dump checks in acceptance. |
| R11 | User locks themselves out (wrong baud, protocol disabled, rate too high for the link) and saves it to flash | Medium | Medium | Lock-out rules and throughput warning (TS §13.4), baud-change rollback, Save only after Apply has succeeded, factory reset reachable via auto-baud. As a last resort, u-center on a PC. |
| R12 | Key IDs or limits differ between M10 firmware versions | Medium | Medium | Key database generated from the interface description and checked against a real VALGET dump. Unknown keys handled generically by size bits. The receiver's NAK is the final word. |
| R7 | Expo SDK / RN upgrade breaking local native modules | Medium | Low | Pin versions. Small, isolated modules. Upgrade only between milestones. |
| R8 | Trademark issues with "u-blox"/"u-center" in branding | Low | Medium | Neutral app name (Q1). Use "u-blox" only to describe compatibility. |

---

## 7. Next steps

1. Connect the phone (USB debugging on) and run `npm run android` to finish M0.2.
2. Get a USB-to-TTL adapter (CP2102 and/or CH340) and an OTG cable (§4.2).
3. Before any configuration testing, record a full configuration dump of the BE-122 in u-center 2 as the "factory" reference (M5b.1).
