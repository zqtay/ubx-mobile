// Signs release builds with the project's release key (M7.5, technical spec §12).
//
// The key never lives in the repository: its location and passwords come from Gradle properties,
// normally in ~/.gradle/gradle.properties (or ORG_GRADLE_PROJECT_* environment variables):
//
//   UBX_RELEASE_STORE_FILE=C:/keys/ubx-mobile-release.p12
//   UBX_RELEASE_STORE_PASSWORD=…
//   UBX_RELEASE_KEY_ALIAS=ubx-mobile
//   UBX_RELEASE_KEY_PASSWORD=…
//
// The Expo template signs release builds with the debug key. That APK could not be upgraded by
// a properly signed one later, so without the properties a release build fails instead.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated withReleaseSigning';
const PROP = 'UBX_RELEASE_STORE_FILE';

const SIGNING_CONFIG = `signingConfigs {
        ${MARKER}
        if (project.hasProperty('${PROP}')) {
            release {
                storeFile file(project.property('${PROP}'))
                storePassword project.property('UBX_RELEASE_STORE_PASSWORD')
                keyAlias project.property('UBX_RELEASE_KEY_ALIAS')
                keyPassword project.property('UBX_RELEASE_KEY_PASSWORD')
            }
        }`;

/** The `signingConfig signingConfigs.debug` line of the release build type. */
const RELEASE_SIGNING = /(release \{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/;

const RELEASE_LINE = [
  `${MARKER}: release key only; null when missing (the guard below stops the build)`,
  `            signingConfig project.hasProperty('${PROP}') ? signingConfigs.release : null`,
].join('\n');

const GUARD = `
${MARKER}
gradle.taskGraph.whenReady { graph ->
    def releasing = graph.allTasks.any { it.project == project && it.name ==~ /(assemble|bundle|package)Release/ }
    if (releasing && !project.hasProperty('${PROP}')) {
        throw new GradleException(
            "Release signing is not configured. Set ${PROP}, UBX_RELEASE_STORE_PASSWORD, " +
            "UBX_RELEASE_KEY_ALIAS and UBX_RELEASE_KEY_PASSWORD in ~/.gradle/gradle.properties " +
            "(see docs/release.md).")
    }
}
`;

/** Applies the release signing setup to the contents of android/app/build.gradle (idempotent). */
function applyReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!contents.includes('signingConfigs {') || !RELEASE_SIGNING.test(contents)) {
    throw new Error('withReleaseSigning: signing blocks not found in android/app/build.gradle');
  }
  return (
    contents
      .replace('signingConfigs {', SIGNING_CONFIG)
      .replace(RELEASE_SIGNING, (_match, head) => head + RELEASE_LINE) + GUARD
  );
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected a Groovy android/app/build.gradle');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
