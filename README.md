# UBX Mobile

Android app (React Native / Expo) for monitoring GNSS reception from the phone's built-in receiver or an external u-blox / NMEA receiver over USB serial — a mobile take on u-blox u-center.

Specifications live in [docs/](docs/):

- [requirements.md](docs/requirements.md)
- [functional-specifications.md](docs/functional-specifications.md)
- [technical-specifications.md](docs/technical-specifications.md)
- [implementation-plan.md](docs/implementation-plan.md)

## Prerequisites

- Node.js 22+
- JDK 17–21 (Android Studio's bundled JBR works: set `JAVA_HOME` to `<Android Studio>/jbr`)
- Android SDK (`ANDROID_HOME`, typically `%LOCALAPPDATA%\Android\Sdk` on Windows)
- An Android device with USB debugging enabled (Android 8.0 / API 26 or newer)
- Windows only: long paths enabled (`LongPathsEnabled = 1`). The build pins CMake 3.31.6 (`plugins/withCmakeVersion.js`) because the default CMake 3.22.1 fails on long paths. Gradle installs it if missing; see the technical spec §12.

The app uses custom native code, so it runs in a **development build**, not Expo Go.

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run android` | Build and install the debug app on a connected device, then start Metro |
| `npm start` | Start Metro for an already-installed development build |
| `npm run prebuild` | Regenerate the `android/` project from `app.json` and config plugins |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint + Prettier |
| `npm test` | Jest unit and component tests |
| `npm run check` | All of the above checks (what CI runs) |

`android/` is generated (Continuous Native Generation) and not committed — configure native behaviour through `app.json` and config plugins.

### Troubleshooting

- **"Gradle requires JVM 17 or later"**: point `JAVA_HOME` at a JDK 17+, e.g. `set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`.
- **White screen / stuck on "Connecting to development server"**: the phone can't reach Metro over Wi-Fi (firewall, different network, or the PC has several network adapters). Over USB, run `adb reverse tcp:8081 tcp:8081`, then in the dev launcher choose *Enter URL manually* → `http://127.0.0.1:8081`. Don't start Metro with `--localhost`: on Windows it then listens on IPv6 only and the USB forward can't reach it. For Wi-Fi, allow Node.js through Windows Firewall on a Private network and set `REACT_NATIVE_PACKAGER_HOSTNAME` to the PC's Wi-Fi IP before `npm start`.

## Project layout

```
src/
  app/            Expo Router routes (every file is a screen)
    (tabs)/       Status, Satellites, Sky, Device, More
  i18n/           String catalogue (en.json) and i18next setup
  state/          Zustand stores (settings persisted in MMKV)
  ui/
    components/   Shared UI building blocks
    theme/        Design tokens, light/dark theme provider
  __tests__/      Screen-level tests (kept out of src/app so they are not routes)
plugins/          Expo config plugins (native project tweaks applied at prebuild)
```
