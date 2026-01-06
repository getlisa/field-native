#!/usr/bin/env node
/**
 * Repackages mwdat-core AAR to remove bundled Facebook classes
 * that conflict with standalone fbjni, fbcore, and proguard-annotations.
 *
 * Creates a local Maven repository with the patched AAR.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  groupId: 'com.meta.wearable',
  artifactId: 'mwdat-core',
  version: '0.3.0-patched', // Use different version to avoid cache conflicts
  originalVersion: '0.3.0',

  // Classes to strip - these conflict with React Native's standalone libs
  // We must be precise about which fbjni classes to strip vs keep:
  // - Strip: Standard fbjni classes that React Native's fbjni:0.7.0 provides
  // - Keep: Meta-specific extensions (Countable, CpuCapabilitiesJni) that only Meta SDK has
  stripPrefixes: [
    'com/facebook/proguard/',            // CONFLICT with proguard-annotations
    'com/facebook/common/logging/',      // CONFLICT with Fresco fbcore
    'com/facebook/common/util/',         // CONFLICT with Fresco fbcore (TriState)
    // NOTE: Keep com/facebook/common/collectlite/ - Meta SDK needs RingBuffer
  ],

  // Specific fbjni classes to strip (duplicates with React Native's fbjni:0.7.0)
  // Keep: Countable, CpuCapabilitiesJni (Meta-specific, not in React Native's fbjni)
  stripExact: [
    'com/facebook/jni/CppException.class',
    'com/facebook/jni/CppSystemErrorException.class',
    'com/facebook/jni/DestructorThread.class',
    'com/facebook/jni/DestructorThread$1.class',
    'com/facebook/jni/DestructorThread$Destructor.class',
    'com/facebook/jni/DestructorThread$DestructorList.class',
    'com/facebook/jni/DestructorThread$DestructorStack.class',
    'com/facebook/jni/DestructorThread$Terminus.class',
    'com/facebook/jni/ExceptionHelper.class',
    'com/facebook/jni/HybridClassBase.class',
    'com/facebook/jni/HybridData.class',
    'com/facebook/jni/HybridData$Destructor.class',
    'com/facebook/jni/IteratorHelper.class',
    'com/facebook/jni/MapIteratorHelper.class',
    'com/facebook/jni/NativeRunnable.class',
    'com/facebook/jni/ThreadScopeSupport.class',
    'com/facebook/jni/UnknownCppException.class',
    'com/facebook/jni/annotations/DoNotStrip.class',
    'com/facebook/jni/annotations/DoNotStripAny.class',
  ]
};

// Paths - Windows uses D:/packages/gradle, others use ~/.gradle
const GRADLE_CACHE = process.env.GRADLE_USER_HOME ||
  (process.platform === 'win32'
    ? 'D:\\packages\\gradle\\caches'
    : path.join(process.env.HOME, '.gradle', 'caches'));

const SCRIPT_DIR = __dirname;
const ANDROID_DIR = path.dirname(SCRIPT_DIR);
const OUTPUT_DIR = path.join(ANDROID_DIR, 'patched-libs');

async function findOriginalAar() {
  // Hardcoded path for Windows with custom Gradle home
  const basePath = 'D:\\packages\\gradle\\caches\\modules-2\\files-2.1\\com.meta.wearable\\mwdat-core\\' + CONFIG.originalVersion;

  console.log(`Looking for AAR in: ${basePath}`);

  if (!fs.existsSync(basePath)) {
    throw new Error(`mwdat-core not found at ${basePath}. Run a Gradle sync first.`);
  }

  // Find the AAR file in subdirectories
  const subdirs = fs.readdirSync(basePath);
  for (const subdir of subdirs) {
    const aarPath = path.join(basePath, subdir, `mwdat-core-${CONFIG.originalVersion}.aar`);
    if (fs.existsSync(aarPath)) {
      return aarPath;
    }
  }

  throw new Error(`AAR file not found in ${basePath}`);
}

async function main() {
  console.log('=== Repackaging mwdat-core AAR ===\n');

  // Ensure adm-zip is available
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch (e) {
    console.log('Installing adm-zip...');
    execSync('npm install adm-zip', { cwd: SCRIPT_DIR, stdio: 'inherit' });
    AdmZip = require('adm-zip');
  }

  // Find original AAR
  const originalAar = await findOriginalAar();
  console.log(`Found original AAR: ${originalAar}`);

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Read original AAR
  const aar = new AdmZip(originalAar);
  const newAar = new AdmZip();

  let strippedClasses = 0;
  let keptClasses = 0;

  // Process each entry
  for (const entry of aar.getEntries()) {
    if (entry.entryName === 'classes.jar') {
      console.log('\nProcessing classes.jar...');

      // Extract and process classes.jar
      const classesJar = new AdmZip(entry.getData());
      const newClassesJar = new AdmZip();

      for (const classEntry of classesJar.getEntries()) {
        const entryName = classEntry.entryName;

        // Strip signature files (they become invalid after modifying the JAR)
        const isSignatureFile = entryName.startsWith('META-INF/') && (
          entryName.endsWith('.SF') ||
          entryName.endsWith('.RSA') ||
          entryName.endsWith('.DSA') ||
          entryName.endsWith('.EC')
        );

        const shouldStrip = isSignatureFile ||
          CONFIG.stripPrefixes.some(prefix => entryName.startsWith(prefix)) ||
          (CONFIG.stripExact && CONFIG.stripExact.includes(entryName));

        if (shouldStrip) {
          strippedClasses++;
          if (strippedClasses <= 10) {
            console.log(`  Stripping: ${entryName}`);
          } else if (strippedClasses === 11) {
            console.log('  ... (more entries stripped)');
          }
        } else {
          keptClasses++;
          newClassesJar.addFile(
            entryName,
            classEntry.getData(),
            classEntry.comment
          );
        }
      }

      // Add processed classes.jar to new AAR
      newAar.addFile('classes.jar', newClassesJar.toBuffer());

    } else {
      // Copy other entries as-is
      newAar.addFile(entry.entryName, entry.getData(), entry.comment);
    }
  }

  console.log(`\nStripped ${strippedClasses} classes, kept ${keptClasses} classes`);

  // Create Maven repository structure
  const repoPath = path.join(
    OUTPUT_DIR,
    ...CONFIG.groupId.split('.'),
    CONFIG.artifactId,
    CONFIG.version
  );
  fs.mkdirSync(repoPath, { recursive: true });

  // Write patched AAR
  const aarPath = path.join(repoPath, `${CONFIG.artifactId}-${CONFIG.version}.aar`);
  newAar.writeZip(aarPath);
  console.log(`\nWrote patched AAR: ${aarPath}`);

  // Create POM file
  const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd"
    xmlns="http://maven.apache.org/POM/4.0.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${CONFIG.groupId}</groupId>
  <artifactId>${CONFIG.artifactId}</artifactId>
  <version>${CONFIG.version}</version>
  <packaging>aar</packaging>
  <description>Patched mwdat-core with bundled Facebook classes removed</description>
</project>`;

  const pomPath = path.join(repoPath, `${CONFIG.artifactId}-${CONFIG.version}.pom`);
  fs.writeFileSync(pomPath, pomContent);
  console.log(`Wrote POM: ${pomPath}`);

  console.log('\n=== Done! ===');
  console.log(`\nAdd this to your build.gradle repositories:`);
  console.log(`  maven { url "\${rootDir}/patched-libs" }`);
  console.log(`\nUpdate expo-meta-wearables to use version: ${CONFIG.version}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
