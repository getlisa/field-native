const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin to add foregroundServiceType="microphone" to RNBackgroundActionsTask service
 * Required for Android 15 (API 36) compliance
 */
module.exports = function withForegroundServiceType(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const { manifest } = androidManifest;

    if (!manifest.application) {
      return config;
    }

    const application = manifest.application[0];
    if (!Array.isArray(application.service)) {
      application.service = [];
    }

    // Check if the service already exists
    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let serviceExists = false;

    for (const service of application.service) {
      const existingServiceName = service.$?.['android:name'];
      if (
        existingServiceName === serviceName ||
        existingServiceName === '.RNBackgroundActionsTask' ||
        existingServiceName?.includes('RNBackgroundActionsTask')
      ) {
        // Update existing service with foregroundServiceType
        if (!service.$) {
          service.$ = {};
        }
        service.$['android:foregroundServiceType'] = 'microphone';
        serviceExists = true;
        break;
      }
    }

    // If service doesn't exist, add it with the foregroundServiceType
    if (!serviceExists) {
      application.service.push({
        $: {
          'android:name': serviceName,
          'android:foregroundServiceType': 'microphone',
        },
      });
    }

    return config;
  });
};

