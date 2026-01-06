# Meta Wearables SDK - Android Build Scripts

This directory contains scripts for building the Android app with Meta Wearables SDK (mwdat-core) integration.

## The Problem

The Meta Wearables DAT SDK (`mwdat-core`) bundles several Facebook libraries that conflict with React Native's own versions:

| Bundled in mwdat-core | Conflicts with |
|-----------------------|----------------|
| `com.facebook.jni.*` | React Native's `fbjni:0.7.0` |
| `com.facebook.proguard.*` | `proguard-annotations` |
| `com.facebook.common.logging.*` | Fresco's `fbcore` |
| `com.facebook.common.util.*` | Fresco's `fbcore` (TriState) |

These duplicate classes cause build failures with `DuplicateClassesException`.

## The Solution

The `repackage-mwdat.js` script creates a patched version of the AAR that:
1. Strips conflicting Facebook classes that React Native provides
2. Keeps Meta-specific classes (`Countable`, `CpuCapabilitiesJni`, `RingBuffer`) that only the Meta SDK has
3. Creates a local Maven repository with the patched AAR

## Quick Start

### For New Developers

```bash
# 1. Clone the repo and install dependencies
git clone <repo-url>
cd field-native
npm install

# 2. Set up GitHub token for Meta SDK access
# Create a GitHub Personal Access Token with `read:packages` scope
# See: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token

# Option A: Environment variable (recommended)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Option B: gradle.properties (per-project)
echo "github_token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >> android/gradle.properties

# Option C: Global gradle.properties
echo "github_token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >> ~/.gradle/gradle.properties

# 3. Build Android (this downloads SDK and creates patched AAR automatically)
npm run prebuild:android

# Or do it step by step:
npx expo prebuild --platform android
npm run patch-mwdat
npx expo run:android
```

### For Existing Developers

If you already have the android folder generated:

```bash
# Just run the patch script (idempotent - skips if already done)
npm run patch-mwdat

# Force regeneration if needed
npm run patch-mwdat:force
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run patch-mwdat` | Patch mwdat-core AAR (skips if already done) |
| `npm run patch-mwdat:force` | Force regenerate patched AAR |
| `npm run prebuild:android` | Run expo prebuild + patch in one command |

## How It Works

### 1. Gradle Downloads Original SDK

When you run `expo prebuild` or `expo run:android`, Gradle downloads `mwdat-core:0.3.0` from GitHub Packages to:
```
~/.gradle/caches/modules-2/files-2.1/com.meta.wearable/mwdat-core/0.3.0/
```

On Windows with custom Gradle home:
```
D:\packages\gradle\caches\modules-2\files-2.1\com.meta.wearable\mwdat-core\0.3.0\
```

### 2. Script Creates Patched AAR

The `repackage-mwdat.js` script:
1. Reads the original AAR from Gradle cache
2. Extracts `classes.jar`
3. Strips conflicting classes (see list below)
4. Creates `mwdat-core-0.3.0-patched.aar`
5. Writes to `android/patched-libs/` as a local Maven repository

### 3. Gradle Uses Patched Version

`android/build.gradle` is configured to:
1. Add `patched-libs` as a Maven repository (first priority)
2. Substitute all `mwdat-core:0.3.0` references with `mwdat-core:0.3.0-patched`

```gradle
allprojects {
  repositories {
    // Local patched mwdat-core (Facebook classes stripped)
    maven { url "${rootDir}/patched-libs" }
    // ... other repos
  }

  configurations.all {
    resolutionStrategy {
      dependencySubstitution {
        substitute module('com.meta.wearable:mwdat-core:0.3.0')
            using module('com.meta.wearable:mwdat-core:0.3.0-patched')
      }
    }
  }
}
```

## Classes Stripped vs Kept

### Stripped (Provided by React Native)

```
com/facebook/proguard/*          # proguard-annotations
com/facebook/common/logging/*    # Fresco fbcore
com/facebook/common/util/*       # Fresco fbcore (TriState)
com/facebook/jni/CppException.class
com/facebook/jni/CppSystemErrorException.class
com/facebook/jni/DestructorThread*.class
com/facebook/jni/ExceptionHelper.class
com/facebook/jni/HybridClassBase.class
com/facebook/jni/HybridData*.class
com/facebook/jni/IteratorHelper.class
com/facebook/jni/MapIteratorHelper.class
com/facebook/jni/NativeRunnable.class
com/facebook/jni/ThreadScopeSupport.class
com/facebook/jni/UnknownCppException.class
com/facebook/jni/annotations/*.class
```

### Kept (Meta SDK Specific)

```
com/facebook/jni/Countable.class           # Meta's reference counting
com/facebook/jni/CpuCapabilitiesJni.class  # Meta's CPU detection
com/facebook/common/collectlite/*          # RingBuffer, etc.
```

## Troubleshooting

### "mwdat-core not found in Gradle cache"

Gradle hasn't downloaded the SDK yet. Run:
```bash
cd android && ./gradlew :app:dependencies
```

Or just build the app:
```bash
npx expo run:android
```

### "DuplicateClassesException"

The patched AAR isn't being used. Check:
1. `android/patched-libs/` exists and contains the AAR
2. `android/build.gradle` has the `dependencySubstitution` block
3. Run `npm run patch-mwdat:force` to regenerate

### "ClassNotFoundException: com.facebook.jni.Countable"

The strip list removed too many classes. The current script keeps Countable - if you see this error, the patched AAR may be from an older version. Run:
```bash
npm run patch-mwdat:force
```

### GitHub Token Issues

If Gradle can't download from GitHub Packages:
1. Ensure your token has `read:packages` scope
2. Check token is exported: `echo $GITHUB_TOKEN`
3. Try adding to `~/.gradle/gradle.properties`

## EAS Build (Cloud)

For EAS builds, add the GitHub token as a secret:

```bash
eas secret:create --name GITHUB_TOKEN --value ghp_xxxxxxxxxxxx --scope project
```

The patched AAR is committed to git (`android/patched-libs/`), so EAS builds will use it automatically.

## File Structure

```
android/
├── build.gradle              # Configures patched-libs repo and substitution
├── patched-libs/             # Local Maven repository (committed to git)
│   └── com/meta/wearable/mwdat-core/0.3.0-patched/
│       ├── mwdat-core-0.3.0-patched.aar
│       └── mwdat-core-0.3.0-patched.pom
└── scripts/
    ├── README.md             # This file
    ├── repackage-mwdat.js    # Main patching script
    ├── package.json          # Script dependencies (adm-zip)
    └── package-lock.json
```

## Updating Meta SDK Version

When a new version of mwdat-core is released:

1. Update version in `modules/expo-meta-wearables/android/build.gradle`
2. Update `CONFIG.originalVersion` in `repackage-mwdat.js`
3. Delete `android/patched-libs/`
4. Run `npm run patch-mwdat:force`
5. Commit the new patched AAR

## Related Files

- `modules/expo-meta-wearables/android/build.gradle` - Expo module using the SDK
- `android/build.gradle` - Root Gradle config with repository setup
- `.gitignore` - Configured to track `android/scripts/` and `android/patched-libs/`
