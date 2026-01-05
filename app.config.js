import 'dotenv/config';

export default {
  expo: {
    name: 'Clara Tech Copilot',
    slug: 'field',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'field',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    updates: {
      url: 'https://u.expo.dev/dbcac3d2-0bae-4ccf-ae06-71eddb096c0c',
    },
    ios: {
      supportsTablet: true,
      runtimeVersion: '1.0.0',
      infoPlist: {
        // Microphone permission (for live transcription)
        NSMicrophoneUsageDescription: 'This app needs access to your microphone for live transcription during job visits.',
        
        // Camera permission (for taking photos)
        NSCameraUsageDescription: 'This app needs access to your camera to take photos during job visits.',
        
        // Photo library permissions (for selecting/saving images)
        NSPhotoLibraryUsageDescription: 'This app needs access to your photo library to select images for job documentation.',
        NSPhotoLibraryAddUsageDescription: 'This app needs permission to save photos to your photo library.',
        
        // Background audio mode (for continuous recording)
        UIBackgroundModes: ['audio'],
      },
      bundleIdentifier: 'com.justclara.field',
      usesNonExemptEncryption: false,
    },
    android: {
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
      // expo-image-picker plugin (handles camera/gallery permissions)
      [
        'expo-image-picker',
        {
          photosPermission: 'This app needs access to your photos to select images for job documentation.',
          cameraPermission: 'This app needs access to your camera to take photos during job visits.',
        },
      ],
      'expo-localization',
      // Meta Wearables plugin - configure with your Meta Developer credentials
      [
        'expo-meta-wearables',
        {
          metaAppId: process.env.META_APP_ID || 'YOUR_META_APP_ID',
          clientToken: process.env.META_CLIENT_TOKEN || 'YOUR_META_CLIENT_TOKEN',
          appLinkScheme: 'field',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: 'dbcac3d2-0bae-4ccf-ae06-71eddb096c0c',
      },
    },
  },
};
