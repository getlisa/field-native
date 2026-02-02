const {
  withProjectBuildGradle,
  withGradleProperties,
} = require('@expo/config-plugins');

const MAVEN_BLOCK = `
    // Meta Wearables DAT SDK (GitHub Packages)
    maven {
      url 'https://maven.pkg.github.com/facebook/meta-wearables-dat-android'
      credentials {
        // Username not required for GitHub Packages with PAT
        username = ""
        password = (System.getenv("GITHUB_TOKEN") ?: (findProperty("github_token") ?: ""))
      }
    }`;

const PATCHED_BLOCK = `
    // Patched mwdat-core (strips conflicting Facebook classes)
    def patchedRepo = new File(rootDir, "patched-libs")
    if (patchedRepo.exists()) {
      maven { url patchedRepo }
    }`;

const SUBSTITUTION_BLOCK = `

  // If patched mwdat-core exists, prefer it to avoid duplicate classes with React Native (fbjni, proguard-annotations)
  def patchedAar = new File(rootDir, "patched-libs/com/meta/wearable/mwdat-core/0.3.0-patched/mwdat-core-0.3.0-patched.aar")
  if (patchedAar.exists()) {
    configurations.all {
      resolutionStrategy {
        dependencySubstitution {
          substitute module('com.meta.wearable:mwdat-core:0.3.0') using module('com.meta.wearable:mwdat-core:0.3.0-patched')
        }
      }
    }
  }`;

module.exports = function withMetaWearablesRepo(config) {
  // Ensure a github_token placeholder exists in android/gradle.properties
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;
    const hasToken = props.some((p) => p.key === 'github_token');
    if (!hasToken) {
      props.push({
        type: 'property',
        key: 'github_token',
        value: 'YOUR_GITHUB_TOKEN_HERE',
      });
    }
    return config;
  });

  // Add GitHub Packages maven repo to android/build.gradle (project-level)
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    const hasMetaRepo = contents.includes('maven.pkg.github.com/facebook/meta-wearables-dat-android');
    const hasPatchedRepo =
      contents.includes('patched-libs') || contents.includes('def patchedRepo');
    const hasSubstitution = contents.includes("substitute module('com.meta.wearable:mwdat-core:0.3.0')");

    // Try to inject into allprojects.repositories block
    const allProjectsRegex = /allprojects\s*\{[\s\S]*?\n\}/m;
    const allProjectsMatch = contents.match(allProjectsRegex);
    if (allProjectsMatch) {
      let block = allProjectsMatch[0];
      const repoRegex = /repositories\s*\{[\s\S]*?\n\s*\}/m;
      const repoMatch = block.match(repoRegex);
      if (repoMatch) {
        let repoBlock = repoMatch[0];
        if (!hasPatchedRepo) {
          repoBlock = repoBlock.replace(/\n\s*\}$/, `${PATCHED_BLOCK}\n  }`);
        }
        if (!hasMetaRepo) {
          repoBlock = repoBlock.replace(/\n\s*\}$/, `${MAVEN_BLOCK}\n  }`);
        }
        block = block.replace(repoMatch[0], repoBlock);
        if (!hasSubstitution) {
          block = block.replace(/\n\}$/, `${SUBSTITUTION_BLOCK}\n}`);
        }
        contents = contents.replace(allProjectsMatch[0], block);
        config.modResults.contents = contents;
        return config;
      }
    }

    // Fallback: append a new allprojects.repositories block (last resort)
    contents += `\n\nallprojects {\n  repositories {\n${PATCHED_BLOCK}\n${MAVEN_BLOCK}\n  }\n${SUBSTITUTION_BLOCK}\n}\n`;
    config.modResults.contents = contents;
    return config;
  });
};

