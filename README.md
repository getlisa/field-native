# Field - Clara AI Companion

A React Native/Expo app with Meta Wearables (Ray-Ban Meta glasses) integration.

## Prerequisites

- Node.js 18+
- GitHub Personal Access Token with `read:packages` scope (for Meta SDK)
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)

## Get Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up GitHub Token (Required for Meta SDK)

The Meta Wearables SDK is hosted on GitHub Packages. You need a token to download it.

**Create a token:** https://github.com/settings/tokens/new?scopes=read:packages

```bash
# Option A: Environment variable (recommended for development)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Option B: Add to ~/.gradle/gradle.properties (persists across sessions)
echo "github_token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >> ~/.gradle/gradle.properties
```

### 3. Build and Run

**Android:**
```bash
# Full prebuild with automatic SDK patching
npm run prebuild:android

# Then run the app
npx expo run:android
```

**iOS:**
```bash
npx expo run:ios
```

### 4. Start development server

```bash
npx expo start
```

## Meta Wearables SDK Integration

This app integrates with Meta's Wearables DAT SDK for Ray-Ban Meta glasses support.

### How It Works

The Meta SDK (`mwdat-core`) bundles Facebook libraries that conflict with React Native. We solve this by:

1. **Patched AAR**: A custom script strips conflicting classes from the SDK
2. **Local Maven Repository**: The patched AAR is stored in `android/patched-libs/`
3. **Automatic Substitution**: Gradle automatically uses the patched version

### NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run patch-mwdat` | Patch Meta SDK AAR (idempotent) |
| `npm run patch-mwdat:force` | Force regenerate patched AAR |
| `npm run prebuild:android` | Expo prebuild + auto-patch |

### For New Developers

The patched AAR is already committed to the repo. Just run:

```bash
npm install
npx expo run:android
```

### Regenerating the Patched AAR

If you need to update or regenerate:

```bash
# Force regeneration
npm run patch-mwdat:force
```

See [`android/scripts/README.md`](./android/scripts/README.md) for detailed documentation.

## Custom Expo Modules

Located in `modules/`:

| Module | Description |
|--------|-------------|
| `expo-meta-wearables` | Meta Wearables SDK bridge |
| `expo-meta-image-picker` | Image picker with Meta glasses support |
| `expo-live-audio` | Live audio streaming |
| `expo-pcm-audio-player` | PCM audio playback |

## EAS Build (Cloud)

For EAS builds, add your GitHub token as a secret:

```bash
eas secret:create --name GITHUB_TOKEN --value ghp_xxxxxxxxxxxx --scope project
```

## Learn More

- [Expo documentation](https://docs.expo.dev/)
- [Meta Wearables DAT SDK](https://github.com/facebook/meta-wearables-dat-android)
