# UBX Mobile — Release guide

| | |
|---|---|
| Document | Release guide (M7.5) |
| Date | 2026-10-19 |
| Implements | REQ-NFR-14; [technical-specifications.md](technical-specifications.md) §12 |

UBX Mobile ships as a signed **APK** for sideloading. There is no Play Store listing.

## 1. One-time setup: the release key

Every update must be signed with the **same key** as the version already installed. A lost key means every user has to uninstall (and lose their settings and backups) before installing a new build. Create it once, keep it out of the repository, and back it up.

1. Create the key (the JDK that ships with Android Studio includes `keytool`):

   ```powershell
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
     -storetype PKCS12 -keystore C:\keys\ubx-mobile-release.p12 `
     -alias ubx-mobile -keyalg RSA -keysize 4096 -validity 10000
   ```

   Choose a strong password. `keytool` asks for a name and organisation; these appear in the certificate.

2. Tell Gradle where it is. Add to `%USERPROFILE%\.gradle\gradle.properties` (outside the project, never committed):

   ```properties
   UBX_RELEASE_STORE_FILE=C:/keys/ubx-mobile-release.p12
   UBX_RELEASE_STORE_PASSWORD=<password>
   UBX_RELEASE_KEY_ALIAS=ubx-mobile
   UBX_RELEASE_KEY_PASSWORD=<password>
   ```

   Write the path with **forward slashes** (`C:/keys/...`). This file is a Java properties file, where `\` starts an escape: a path such as `C:\Users\...\ubx-mobile-release.p12` stops the build with "Malformed \uxxxx encoding". `npm run release:apk` checks for this. A password containing `\` must be written as `\\`.

   `UBX_RELEASE_STORE_PASSWORD` opens the keystore file and `UBX_RELEASE_KEY_PASSWORD` unlocks the key inside it. A PKCS12 keystore (as created in step 1) has a single password, so both are the password you chose in step 1. They differ only for an older JKS keystore created with a separate `-keypass`.

   On a build server, use the environment variables `ORG_GRADLE_PROJECT_UBX_RELEASE_STORE_FILE` and so on instead.

3. **Back up** the `.p12` file and both passwords, in two places such as a password manager and an offline copy.

The config plugin `plugins/withReleaseSigning.js` reads these properties. Without them, a release build **fails** with "Release signing is not configured". It does not fall back to the debug key the Expo template would use, because an APK signed with that key could never be upgraded to a properly signed one.

## 2. Each release

1. Run `npm run check` and the hardware checks in the implementation plan (§5 acceptance checklist for 1.0).
2. Bump the version in `app.json`:
   - `expo.version`: semantic version shown in About (e.g. `1.0.0`).
   - `expo.android.versionCode`: an integer that **must increase** with every APK you distribute (Android refuses to install a lower one over a higher one).
3. If dependencies changed, regenerate the licence list: `npm run licenses`.
4. Build:

   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   npm run release:apk
   ```

   This regenerates `android/` (`expo prebuild --clean`) and builds for 32- and 64-bit ARM phones. The APK is written to `dist/ubx-mobile-<version>-<versionCode>.apk`, with its size and SHA-256 printed. `npm run release:apk -- --no-prebuild` reuses the current `android/` folder.

5. Verify the signature:

   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\apksigner.bat" verify --print-certs dist\ubx-mobile-1.0.0-1.apk
   ```

   Use the file name printed by the build: `ubx-mobile-<version>-<versionCode>.apk`, so the first release (`1.0.0`, versionCode `1`) is `ubx-mobile-1.0.0-1.apk`.

   The certificate must be your release certificate (the same SHA-256 digest as the previous release), not "Android Debug".

6. Publish the APK together with its SHA-256 and the release notes.

## 3. Installing (instructions for users)

1. Download the APK on the phone (or copy it over USB).
2. Open it. Android asks to allow installs from that app (browser, Files): **Settings → Install unknown apps → allow**. You can switch this off again afterwards.
3. Tap **Install**. Play Protect may warn about an app from an unknown developer; choose *Install anyway*.

**Updating**: install the new APK over the old one; settings, remembered receivers and backups are kept. If Android says the package "conflicts with an existing package", the APK was signed with a different key (for example, the installed app is a development build). Export configuration backups first (Receiver configuration → Backup & restore → Share), then uninstall and install the new APK.

**Development builds** (`npm run android`) are signed with the debug key, so they cannot be upgraded to a release APK or the other way round without uninstalling.

## 4. Optional: EAS Build

`npx eas-cli@latest build -p android` can build the APK in the cloud (with `"buildType": "apk"` in an `eas.json` profile). EAS then generates and stores **its own** keystore. Choose one way of signing for the lifetime of the app: an APK signed by EAS cannot update one signed with the local key, and the other way round. To use the local key with EAS, upload it with `npx eas-cli@latest credentials`.
