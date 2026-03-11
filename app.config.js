import 'dotenv/config';

export default {
  expo: {
    name: 'Clara Wearables',
    slug: 'clara-wearables',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'field',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    updates: {
      url: 'https://u.expo.dev/ac0aa9b7-6730-422c-9a98-522ce7151c0e',
    },
    ios: {
      supportsTablet: true,
      runtimeVersion: '1.0.0',
      infoPlist: {
        // Microphone permission (for live transcription)
        NSMicrophoneUsageDescription: 'This app needs access to your microphone for live transcription during job visits.',

        // Speech recognition permission (for voice input transcription)
        NSSpeechRecognitionUsageDescription: 'This app needs access to speech recognition for voice input.',
        
        // Camera permission (for taking photos)
        NSCameraUsageDescription: 'This app needs access to your camera to take photos during job visits.',
        
        // Photo library permissions (for selecting/saving images)
        NSPhotoLibraryUsageDescription: 'This app needs access to your photo library to select images for job documentation.',
        NSPhotoLibraryAddUsageDescription: 'This app needs permission to save photos to your photo library.',
        
        // Bluetooth permission (for Meta glasses communication)
        NSBluetoothAlwaysUsageDescription: 'This app needs Bluetooth access to connect and communicate with Meta smart glasses.',
        NSBluetoothPeripheralUsageDescription: 'This app needs Bluetooth access to connect and communicate with Meta smart glasses.',

        // Meta Wearables DAT SDK - Developer Mode (no MetaAppID/ClientToken/TeamID required)
        // See https://wearables.developer.meta.com/docs/build-integration-ios/
        // For production/release channels, add MetaAppID, ClientToken, TeamID from Wearables Developer Center
        MWDAT: {
          AppLinkURLScheme: 'field://',
          MetaAppID: '', // Empty = Developer Mode; enable Developer Mode in Meta AI app Settings
        },

        // Allow querying Meta AI app URL schemes (required for canOpenURL on iOS 9+)
        // Meta AI/View app uses fb-viewapp:// - see meta-wearables-dat-ios discussion #98
        LSApplicationQueriesSchemes: [
          'fb-viewapp',
          'metaai',
          'fb-orca',
          'orca',
          'fb',
          'fbapi',
          'fb-messenger',
          'fb-messenger-api',
          'fb-messenger-api20140430',
          'fb-messenger-share-api',
        ],

        // External Accessory protocol for Meta glasses
        UISupportedExternalAccessoryProtocols: ['com.meta.ar.wearable'],

        // Background modes (audio recording + Meta glasses Bluetooth/accessory)
        UIBackgroundModes: ['audio', 'bluetooth-peripheral', 'external-accessory'],
      },
      bundleIdentifier: 'com.claraglasses.field',
      usesNonExemptEncryption: false,
    },
    android: {
      // Meta Wearables Camera SDK requires minSdk >= 29
      minSdkVersion: 29,
      runtimeVersion: '1.0.0',
      adaptiveIcon: {
        backgroundColor: '#e0f2fe', // primaryLight from theme
        foregroundImage: './assets/images/android-icon-foreground.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: [
        // Audio permissions
        'android.permission.RECORD_AUDIO', // Microphone for live transcription
        
        // Meta Wearables SDK permissions
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.INTERNET',
        
        // Foreground service permissions (for background recording)
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MICROPHONE',
        
        // Notification permission (Android 13+)
        'android.permission.POST_NOTIFICATIONS',
        
        // System permissions
        'android.permission.WAKE_LOCK', // Keep device awake during recording
        'android.permission.VIBRATE', // Haptic feedback
        
        // Camera permission
        'android.permission.CAMERA',
        
        
        // Media library permissions
        'android.permission.READ_MEDIA_IMAGES', // Android 13+ (API 33+) for reading images
        'android.permission.READ_EXTERNAL_STORAGE', // Android 12 and below for reading files
        'android.permission.WRITE_EXTERNAL_STORAGE', // For saving images (deprecated in Android 10+ but needed for older versions)
      ],
      package: 'com.justclara.field',
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-asset',
      "@react-native-community/datetimepicker",
      [
        'expo-build-properties',
        {
          android: {
            // Meta Wearables camera SDK requires minSdk >= 29
            minSdkVersion: 29,
          },
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff', // background from theme (light)
          dark: {
            backgroundColor: '#000000', // background from theme (dark)
          },
        },
      ],
      './plugins/withForegroundServiceType',
      './plugins/withMetaWearablesRepo',
      // expo-image-picker plugin (handles camera/gallery permissions)
      [
        'expo-image-picker',
        {
          photosPermission: 'This app needs access to your photos to select images for job documentation.',
          cameraPermission: 'This app needs access to your camera to take photos during job visits.',
        },
      ],
      [
        'expo-speech-recognition',
        {
          microphonePermission: 'This app needs access to your microphone for voice input.',
          speechRecognitionPermission: 'This app needs access to speech recognition for voice input.',
          androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
        },
      ],
      'expo-localization',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: 'ac0aa9b7-6730-422c-9a98-522ce7151c0e',
      },
    },
  },
};
