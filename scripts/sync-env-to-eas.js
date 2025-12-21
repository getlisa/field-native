#!/usr/bin/env node

/**
 * Script to sync environment variables from .env file to EAS Secrets
 * 
 * Usage:
 *   node scripts/sync-env-to-eas.js [--profile preview|production]
 * 
 * This script reads your .env file and prompts you to set EAS secrets
 * for variables that start with EXPO_PUBLIC_
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const profile = process.argv.includes('--profile') 
  ? process.argv[process.argv.indexOf('--profile') + 1] 
  : 'preview';

const envFile = profile === 'production' ? '.env.production' : '.env.preview';
const defaultEnvFile = '.env';

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ${filePath} not found, trying ${defaultEnvFile}...`);
    if (!fs.existsSync(defaultEnvFile)) {
      console.error(`❌ Neither ${filePath} nor ${defaultEnvFile} found!`);
      process.exit(1);
    }
    filePath = defaultEnvFile;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const envVars = {};
  
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) return;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
      
      // Only sync EXPO_PUBLIC_ variables
      if (key.startsWith('EXPO_PUBLIC_')) {
        envVars[key] = value;
      }
    }
  });

  return envVars;
}

function setEASSecret(name, value) {
  try {
    console.log(`\n📝 Setting secret: ${name}`);
    execSync(
      `eas secret:create --scope project --name ${name} --value "${value}" --type string --force`,
      { stdio: 'inherit' }
    );
    console.log(`✅ Successfully set ${name}`);
  } catch (error) {
    console.error(`❌ Failed to set ${name}:`, error.message);
  }
}

console.log(`🔧 Syncing environment variables to EAS Secrets for profile: ${profile}\n`);

const envVars = readEnvFile(path.join(process.cwd(), envFile));

if (Object.keys(envVars).length === 0) {
  console.log('ℹ️  No EXPO_PUBLIC_* variables found in .env file');
  process.exit(0);
}

console.log(`Found ${Object.keys(envVars).length} EXPO_PUBLIC_* variable(s):`);
Object.keys(envVars).forEach((key) => {
  console.log(`  - ${key}`);
});

console.log('\n📤 Syncing to EAS Secrets...');

Object.entries(envVars).forEach(([key, value]) => {
  setEASSecret(key, value);
});

console.log('\n✅ Done! You can now build with:');
console.log(`   eas build --profile ${profile} --platform android`);
console.log(`   eas build --profile ${profile} --platform ios`);

