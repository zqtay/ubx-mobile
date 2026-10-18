// Pins the CMake version used by every Android module's native (C++) build.
//
// Why: the Android Gradle plugin defaults to CMake 3.22.1, whose bundled ninja (1.10) is not
// long-path aware on Windows. Native modules such as react-native-nitro-modules generate object
// paths that repeat the project path, which exceeds 260 characters in deep project folders
// (technical spec §12). CMake 3.31.x bundles ninja 1.12, which supports long paths when Windows
// long paths are enabled. Gradle installs the pinned version automatically if it is missing.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated withCmakeVersion';
// The root plugins below evaluate subprojects early, so the hook must be registered before them.
const ANCHOR = 'apply plugin: "expo-root-project"';

function cmakeBlock(version) {
  return `${MARKER}
subprojects { project ->
  ['com.android.application', 'com.android.library'].each { pluginId ->
    project.plugins.withId(pluginId) {
      if (project.state.executed) {
        logger.warn("withCmakeVersion: \${project.path} already evaluated, CMake version not pinned")
      } else {
        project.android.externalNativeBuild.cmake.version = '${version}'
      }
    }
  }
}

`;
}

/** @type {import('expo/config-plugins').ConfigPlugin<{ version?: string } | void>} */
const withCmakeVersion = (config, props) => {
  const version = (props && props.version) || '3.31.6';
  return withProjectBuildGradle(config, (cfg) => {
    const { contents, language } = cfg.modResults;
    if (language !== 'groovy') {
      throw new Error('withCmakeVersion: expected a Groovy android/build.gradle');
    }
    if (contents.includes(MARKER)) return cfg;
    if (!contents.includes(ANCHOR)) {
      throw new Error(`withCmakeVersion: anchor '${ANCHOR}' not found in android/build.gradle`);
    }
    cfg.modResults.contents = contents.replace(ANCHOR, cmakeBlock(version) + ANCHOR);
    return cfg;
  });
};

module.exports = withCmakeVersion;
