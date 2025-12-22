/**
 * permissionService.ts - Centralized permission management for iOS and Android
 * 
 * Handles all app permissions as defined in app.json:
 * - Microphone (RECORD_AUDIO)
 * - Notifications (POST_NOTIFICATIONS)
 * - Background services (FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE)
 * 
 * Provides clean abstraction and interface implementation for permission requests.
 */

import { Platform, PermissionsAndroid, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { requestRecordingPermissionsAsync } from 'expo-audio';

/**
 * Permission status interface
 */
export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
  message?: string;
}

/**
 * Permission Service Interface
 */
export interface IPermissionService {
  /**
   * Request all required permissions at app start
   */
  requestAllPermissions(): Promise<{
    microphone: PermissionStatus;
    notifications: PermissionStatus;
    background: PermissionStatus;
  }>;

  /**
   * Request microphone permission
   */
  requestMicrophonePermission(): Promise<PermissionStatus>;

  /**
   * Request notification permission
   */
  requestNotificationPermission(): Promise<PermissionStatus>;

  /**
   * Check if background service permissions are available (Android)
   */
  checkBackgroundPermissions(): Promise<PermissionStatus>;

  /**
   * Check if all required permissions are granted
   */
  checkAllPermissions(): Promise<{
    microphone: boolean;
    notifications: boolean;
    background: boolean;
  }>;
}

/**
 * Permission Service Implementation
 */
class PermissionService implements IPermissionService {
  /**
   * Request all required permissions at app start
   * Requests microphone first, then notifications right after
   */
  async requestAllPermissions(): Promise<{
    microphone: PermissionStatus;
    notifications: PermissionStatus;
    background: PermissionStatus;
  }> {
    // Request microphone permission first
    const microphone = await this.requestMicrophonePermission();
    
    // Request notification permission right after microphone (sequential, not parallel)
    const notifications = await this.requestNotificationPermission();
    
    // Check background permissions (this is just a check, not a request)
    const background = await this.checkBackgroundPermissions();

    return { microphone, notifications, background };
  }

  /**
   * Request microphone permission
   */
  async requestMicrophonePermission(): Promise<PermissionStatus> {
    try {
      if (Platform.OS === 'android') {
        // Android: Request RECORD_AUDIO permission
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'This app needs access to your microphone for live transcription during job visits.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );

        return {
          granted: granted === PermissionsAndroid.RESULTS.GRANTED,
          canAskAgain: granted === PermissionsAndroid.RESULTS.DENIED,
          message:
            granted === PermissionsAndroid.RESULTS.GRANTED
              ? 'Microphone permission granted'
              : 'Microphone permission denied',
        };
      } else {
        // iOS: Request via expo-audio
        const { granted, canAskAgain } = await requestRecordingPermissionsAsync();

        return {
          granted,
          canAskAgain: canAskAgain ?? false,
          message: granted ? 'Microphone permission granted' : 'Microphone permission denied',
        };
      }
    } catch (error) {
      console.error('[PermissionService] Error requesting microphone permission:', error);
      return {
        granted: false,
        canAskAgain: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Request notification permission
   */
  async requestNotificationPermission(): Promise<PermissionStatus> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      return {
        granted: finalStatus === 'granted',
        canAskAgain: finalStatus === 'undetermined',
        message:
          finalStatus === 'granted'
            ? 'Notification permission granted'
            : 'Notification permission denied',
      };
    } catch (error) {
      console.error('[PermissionService] Error requesting notification permission:', error);
      return {
        granted: false,
        canAskAgain: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check if background service permissions are available (Android)
   * Note: FOREGROUND_SERVICE permissions are declared in AndroidManifest.xml
   * Android 14+ (API 34+) requires runtime permission for specific foreground service types
   * FOREGROUND_SERVICE_MICROPHONE is declared in app.json and should be available
   */
  async checkBackgroundPermissions(): Promise<PermissionStatus> {
    try {
      if (Platform.OS === 'android') {
        // Android 14+ (API 34+) requires runtime permission for FOREGROUND_SERVICE_MICROPHONE
        if (Platform.Version >= 34) {
          try {
            // Check if FOREGROUND_SERVICE_MICROPHONE permission exists
            // Note: This permission might not be in PermissionsAndroid constants
            // It's declared in AndroidManifest and checked at runtime
            const hasPermission = await PermissionsAndroid.check(
              'android.permission.FOREGROUND_SERVICE_MICROPHONE' as any
            ).catch(() => {
              // If check fails, try requesting it
              return false;
            });

            if (!hasPermission) {
              // Request the permission
              const granted = await PermissionsAndroid.request(
                'android.permission.FOREGROUND_SERVICE_MICROPHONE' as any,
                {
                  title: 'Background Service Permission',
                  message: 'This app needs to run in the background to continue recording audio during job visits.',
                  buttonNeutral: 'Ask Me Later',
                  buttonNegative: 'Cancel',
                  buttonPositive: 'OK',
                }
              ).catch(() => PermissionsAndroid.RESULTS.DENIED);

              return {
                granted: granted === PermissionsAndroid.RESULTS.GRANTED,
                canAskAgain: granted === PermissionsAndroid.RESULTS.DENIED,
                message:
                  granted === PermissionsAndroid.RESULTS.GRANTED
                    ? 'Background service permission granted'
                    : 'Background service permission denied',
              };
            }

            return {
              granted: true,
              canAskAgain: false,
              message: 'Background service permission granted',
            };
          } catch (error) {
            // FOREGROUND_SERVICE_MICROPHONE might not be available in PermissionsAndroid
            // In that case, it's declared in manifest and should work
            if (__DEV__) {
              console.log('[PermissionService] FOREGROUND_SERVICE_MICROPHONE not in PermissionsAndroid, assuming granted (declared in manifest)');
            }
            return {
              granted: true,
              canAskAgain: false,
              message: 'Background service available (declared in manifest)',
            };
          }
        } else {
          // Android < 14: Background services are automatically available
          return {
            granted: true,
            canAskAgain: false,
            message: 'Background service available (auto-granted)',
          };
        }
      } else {
        // iOS: Background modes are configured in Info.plist (app.json)
        // UIBackgroundModes: audio is already configured
        return {
          granted: true,
          canAskAgain: false,
          message: 'Background audio mode configured',
        };
      }
    } catch (error) {
      console.error('[PermissionService] Error checking background permissions:', error);
      // Default to granted since background services are usually available
      return {
        granted: true,
        canAskAgain: false,
        message: `Background service available (error checking: ${error instanceof Error ? error.message : 'Unknown'})`,
      };
    }
  }

  /**
   * Check if all required permissions are granted
   */
  async checkAllPermissions(): Promise<{
    microphone: boolean;
    notifications: boolean;
    background: boolean;
  }> {
    const [microphone, notifications, background] = await Promise.all([
      this.checkMicrophonePermission(),
      this.checkNotificationPermission(),
      this.checkBackgroundPermissions(),
    ]);

    return {
      microphone: microphone.granted,
      notifications: notifications.granted,
      background: background.granted,
    };
  }

  /**
   * Check microphone permission status
   */
  private async checkMicrophonePermission(): Promise<PermissionStatus> {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        return {
          granted,
          canAskAgain: !granted,
          message: granted ? 'Microphone permission granted' : 'Microphone permission not granted',
        };
      } else {
        // iOS: Check via expo-audio
        const { granted } = await requestRecordingPermissionsAsync();
        return {
          granted,
          canAskAgain: false,
          message: granted ? 'Microphone permission granted' : 'Microphone permission not granted',
        };
      }
    } catch (error) {
      return {
        granted: false,
        canAskAgain: false,
        message: `Error checking microphone permission: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Check notification permission status
   */
  private async checkNotificationPermission(): Promise<PermissionStatus> {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      return {
        granted: status === 'granted',
        canAskAgain: status === 'undetermined',
        message: status === 'granted' ? 'Notification permission granted' : 'Notification permission not granted',
      };
    } catch (error) {
      return {
        granted: false,
        canAskAgain: false,
        message: `Error checking notification permission: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Show alert if permissions are missing (for critical operations)
   */
  showPermissionAlert(missingPermissions: string[]): void {
    const message = `This feature requires the following permissions:\n\n${missingPermissions.join('\n')}\n\nPlease enable them in Settings.`;

    Alert.alert('Permissions Required', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          // On iOS, this would open Settings app
          // On Android, this would open app settings
          // Implementation depends on your needs
        },
      },
    ]);
  }
}

// Singleton instance
let permissionServiceInstance: IPermissionService | null = null;

/**
 * Get the permission service instance
 */
export const getPermissionService = (): IPermissionService => {
  if (!permissionServiceInstance) {
    permissionServiceInstance = new PermissionService();
  }
  return permissionServiceInstance;
};

export default getPermissionService;
