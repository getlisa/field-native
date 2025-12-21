# Building Preview/Testing Builds with Environment Variables

## Prerequisites

**Important**: This project requires Node.js 22. Make sure you're using the correct version:

```bash
# Using nvm (recommended)
nvm use 22

# Verify Node.js version
node --version  # Should show v22.x.x
```

The project includes a `.nvmrc` file, so `nvm use` will automatically switch to Node.js 22.

## Quick Start Guide

### Step 1: Prepare Your Environment Variables

Ensure your `.env` or `.env.preview` file exists in the root directory:

```bash
EXPO_PUBLIC_API_BASE_URL=https://your-preview-api-url.com/api
```

### Step 2: Sync Environment Variables to EAS Secrets

**First time setup** - Upload your environment variables to EAS Secrets:

```bash
# For preview builds (reads from .env.preview or .env)
npm run sync-env:preview

# Or manually:
node scripts/sync-env-to-eas.js --profile preview
```

This reads your `.env` file and automatically sets all `EXPO_PUBLIC_*` variables as EAS Secrets.

### Step 3: Build Preview Build

```bash
# Android APK (for testing/QA)
npm run build:preview:android
# Or: eas build --profile preview --platform android

# iOS IPA (for TestFlight or internal testing)
npm run build:preview:ios
# Or: eas build --profile preview --platform ios

# Both platforms
npm run build:preview:all
# Or: eas build --profile preview --platform all
```

## Detailed Instructions

### How It Works

1. **Local Development**: Your `.env` file is automatically loaded via `dotenv/config` in `app.config.js`
2. **Preview/Production Builds**: EAS Secrets are used (set via the sync script or manually)
3. **Environment Variables**: All `EXPO_PUBLIC_*` variables are available in your app via `process.env.EXPO_PUBLIC_*`

### Setting Up EAS Secrets

#### Option A: Using the Sync Script (Recommended)

The sync script automatically reads your `.env` file and uploads all `EXPO_PUBLIC_*` variables:

```bash
# Sync for preview builds
npm run sync-env:preview

# Sync for production builds  
npm run sync-env:production
```

#### Option B: Manual Setup

If you prefer to set secrets manually:

```bash
# Set your API base URL secret
eas secret:create --scope project --name EXPO_PUBLIC_API_BASE_URL --value "https://your-api-url.com/api" --type string

# View existing secrets
eas secret:list

# Update a secret
eas secret:create --scope project --name EXPO_PUBLIC_API_BASE_URL --value "new-value" --type string --force
```

### Available NPM Scripts

```bash
# Sync environment variables
npm run sync-env:preview      # Sync .env to EAS Secrets for preview
npm run sync-env:production   # Sync .env to EAS Secrets for production

# Build preview builds
npm run build:preview:android # Build Android APK
npm run build:preview:ios     # Build iOS IPA
npm run build:preview:all     # Build both platforms
```

### All Build Commands

#### Preview Builds (for testing/QA)
```bash
eas build --profile preview --platform android  # Android APK
eas build --profile preview --platform ios      # iOS IPA
eas build --profile preview --platform all      # Both
```

#### Development Builds (with dev client)
```bash
eas build --profile development --platform android
eas build --profile development --platform ios
```

#### Production Builds (for stores)
```bash
eas build --profile production --platform android  # AAB for Play Store
eas build --profile production --platform ios      # IPA for App Store
```

## Verifying Environment Variables

After building, verify the environment variables are set correctly:

```typescript
// In your app code
console.log('API URL:', process.env.EXPO_PUBLIC_API_BASE_URL);

// Or check during build in the logs
```

## Important Notes

- ✅ **`.env` files are gitignored** - your secrets stay safe
- ✅ **EAS Secrets** are automatically injected during builds - no code changes needed
- ✅ **Local development** uses `.env` file automatically via `app.config.js`
- ✅ **EXPO_PUBLIC_*** prefix is required for variables to be available in the app
- ⚠️ **Update secrets** if you change `.env` values: run `npm run sync-env:preview` again

## Troubleshooting

### Variables not available in build?

1. Check that variables start with `EXPO_PUBLIC_`
2. Ensure secrets are set: `eas secret:list`
3. Re-sync if you updated `.env`: `npm run sync-env:preview`

### Build fails with missing variables?

Make sure you've run the sync script before building:
```bash
npm run sync-env:preview
eas build --profile preview --platform android
```
