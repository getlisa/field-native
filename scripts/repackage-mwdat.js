const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const CONFIG = {
  group: 'com.meta.wearable',
  artifact: 'mwdat-core',
  version: '0.3.0',
  patchedVersion: '0.3.0-patched',
  gradleUserHome:
    process.env.GRADLE_USER_HOME ||
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.gradle'),
};

// Classes to strip (provided by React Native / FBJNI already)
const STRIP_PREFIXES = [
  'com/facebook/proguard/',
  'com/facebook/common/logging/',
  'com/facebook/common/util/',
];

// Classes to keep (Meta-specific / required by mwdat-core)
const KEEP_EXACT = new Set([
  'com/facebook/jni/Countable.class',
  'com/facebook/jni/CpuCapabilitiesJni.class',
]);

const KEEP_PREFIXES = ['com/facebook/common/collectlite/'];

// Native libs are kept intact to match upstream behavior.
const STRIP_NATIVE_PREFIXES = [];
const STRIP_NATIVE_EXACT = new Set();

function log(...args) {
  console.log('[patch-mwdat]', ...args);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function findOriginalAar() {
  const base = path.join(
    CONFIG.gradleUserHome,
    'caches',
    'modules-2',
    'files-2.1',
    CONFIG.group,
    CONFIG.artifact,
    CONFIG.version
  );

  if (!fs.existsSync(base)) return null;

  const hashes = fs.readdirSync(base);
  for (const h of hashes) {
    const p = path.join(base, h);
    if (!fs.statSync(p).isDirectory()) continue;
    const candidate = path.join(p, `${CONFIG.artifact}-${CONFIG.version}.aar`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function shouldStrip(entryName) {
  if (KEEP_EXACT.has(entryName)) return false;
  if (KEEP_PREFIXES.some((p) => entryName.startsWith(p))) return false;
  return STRIP_PREFIXES.some((p) => entryName.startsWith(p));
}

function writePom(outDir) {
  const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${CONFIG.group}</groupId>
  <artifactId>${CONFIG.artifact}</artifactId>
  <version>${CONFIG.patchedVersion}</version>
  <packaging>aar</packaging>
</project>
`;
  fs.writeFileSync(
    path.join(outDir, `${CONFIG.artifact}-${CONFIG.patchedVersion}.pom`),
    pom
  );
}

function shouldStripNative(entryName) {
  if (STRIP_NATIVE_EXACT.has(entryName)) return true;
  return STRIP_NATIVE_PREFIXES.some((p) => entryName.startsWith(p));
}

function main() {
  const force = process.argv.includes('--force');

  // IMPORTANT: output must live under android/ so Gradle (rootDir=android) can find it
  const outDir = path.join(
    process.cwd(),
    'android',
    'patched-libs',
    'com',
    'meta',
    'wearable',
    CONFIG.artifact,
    CONFIG.patchedVersion
  );

  const outAarPath = path.join(outDir, `${CONFIG.artifact}-${CONFIG.patchedVersion}.aar`);
  if (!force && fs.existsSync(outAarPath)) {
    log('Patched AAR already exists, skipping. Use --force to regenerate.');
    return;
  }

  const originalAar = findOriginalAar();
  if (!originalAar) {
    throw new Error(
      `Original AAR not found in Gradle cache. Build once to download ${CONFIG.group}:${CONFIG.artifact}:${CONFIG.version}.`
    );
  }

  log('Using original AAR:', originalAar);

  const aarZip = new AdmZip(originalAar);
  const classesJar = aarZip.getEntry('classes.jar');
  if (!classesJar) throw new Error('classes.jar not found in AAR');

  const classesZip = new AdmZip(classesJar.getData());
  const entries = classesZip.getEntries();
  let removed = 0;

  for (const e of entries) {
    if (e.isDirectory) continue;
    if (shouldStrip(e.entryName)) {
      classesZip.deleteFile(e.entryName);
      removed += 1;
    }
  }

  log(`Stripped ${removed} class entries from classes.jar`);

  // Rebuild AAR (copy everything except classes.jar, replace with patched)
  const outZip = new AdmZip();
  for (const e of aarZip.getEntries()) {
    if (e.entryName === 'classes.jar') continue;
    if (shouldStripNative(e.entryName)) continue;
    outZip.addFile(e.entryName, e.getData());
  }
  outZip.addFile('classes.jar', classesZip.toBuffer());

  ensureDir(outDir);
  outZip.writeZip(outAarPath);
  writePom(outDir);

  log('Patched AAR written:', outAarPath);
}

try {
  main();
} catch (e) {
  console.error('[patch-mwdat] ❌', e?.message || e);
  process.exit(1);
}

