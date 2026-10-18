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
```
