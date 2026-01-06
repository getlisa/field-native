/**
 * notificationService.ts - Push notification service for iOS and Android
 *
 * Provides a clean abstraction for sending local notifications with support for
 * both iOS and Android platforms.
 *
 * Uses expo-notifications for cross-platform notification support.
 * Note: expo-notifications is imported dynamically to avoid crashes when native module isn't available.
 */

import { Platform } from 'react-native';
import { type ProactiveSuggestionsMessage, type MissedOpportunity } from '@/lib/RealtimeChat';

// Lazy-load expo-notifications to avoid crashes when native module isn't available
let Notifications: typeof import('expo-notifications') | null = null;
let notificationsLoadError: Error | null = null;

const getNotifications = async () => {
  if (Notifications) return Notifications;
  if (notificationsLoadError) throw notificationsLoadError;

  try {
    Notifications = await import('expo-notifications');
    return Notifications;
  } catch (error) {
    notificationsLoadError = error as Error;
    console.warn('[NotificationService] expo-notifications not available:', error);
    throw error;
  }
};

// Initialize notification handler flag
let notificationHandlerInitialized = false;

/**
 * Initialize notification handler (call this early in app lifecycle)
 * Safe to call multiple times - only initializes once
 */
export async function initializeNotificationHandler(): Promise<void> {
  if (notificationHandlerInitialized) return;

  try {
    const notifications = await getNotifications();
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,  // Show notification banner at top of screen
        shouldShowList: true,    // Show notification in notification list
        shouldPlaySound: true,   // Play notification sound
        shouldSetBadge: true,    // Update app badge count
      }),
    });
    notificationHandlerInitialized = true;
  } catch (error) {
    console.warn('[NotificationService] Notification handler not available:', error);
  }
}

/**
 * Notification configuration interface
 */
export interface NotificationConfig {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: boolean;
  priority?: 'min' | 'low' | 'default' | 'high' | 'max';
  categoryId?: string;
}

/**
 * Proactive suggestion notification data
 */
export interface ProactiveSuggestionNotificationData {
  jobId: string;
  jobName: string;
  itemId: string;
  suggestion: string;
  severity: string;
  timestamp: string;
}

/**
 * Notification Service Interface
 */
export interface INotificationService {
  /**
   * Request notification permissions
   */
  requestPermissions(): Promise<boolean>;

  /**
   * Check if notifications are enabled
   */
  areNotificationsEnabled(): Promise<boolean>;

  /**
   * Send a local notification
   */
  sendNotification(config: NotificationConfig): Promise<string>;

  /**
   * Send a proactive suggestion notification
   */
  sendProactiveSuggestionNotification(
    data: ProactiveSuggestionNotificationData
  ): Promise<string>;

  /**
   * Cancel a notification by ID
   */
  cancelNotification(notificationId: string): Promise<void>;

  /**
   * Cancel all notifications
   */
  cancelAllNotifications(): Promise<void>;

  /**
   * Send a recording status notification
   */
  sendRecordingNotification(jobId: string, jobName: string): Promise<string>;

  /**
   * Cancel recording notification by job ID
   */
  cancelRecordingNotification(jobId: string): Promise<void>;
}

/**
 * Notification Service Implementation
 */
class NotificationService implements INotificationService {
  private permissionsGranted: boolean | null = null;

  /**
   * Request notification permissions
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const notifications = await getNotifications();
      const { status: existingStatus } = await notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      this.permissionsGranted = finalStatus === 'granted';
      return this.permissionsGranted;
    } catch (error) {
      console.warn('[NotificationService] Notifications not available:', error);
      this.permissionsGranted = false;
      return false;
    }
  }

  /**
   * Check if notifications are enabled
   */
  async areNotificationsEnabled(): Promise<boolean> {
    if (this.permissionsGranted !== null) {
      return this.permissionsGranted;
    }

    try {
      const notifications = await getNotifications();
      const { status } = await notifications.getPermissionsAsync();
      this.permissionsGranted = status === 'granted';
      return this.permissionsGranted;
    } catch (error) {
      console.warn('[NotificationService] Notifications not available:', error);
      return false;
    }
  }

  /**
   * Send a local notification
   */
  async sendNotification(config: NotificationConfig): Promise<string> {
    try {
      const notifications = await getNotifications();

      // Ensure permissions are granted
      const hasPermission = await this.areNotificationsEnabled();
      if (!hasPermission) {
        const granted = await this.requestPermissions();
        if (!granted) {
          throw new Error('Notification permissions not granted');
        }
      }

      // Configure notification content
      const content = {
        title: config.title,
        body: config.body,
        data: config.data || {},
        sound: config.sound !== false, // Default to true
        priority: config.priority || 'high',
      };

      // Schedule notification (null trigger = immediate)
      const notificationId = await notifications.scheduleNotificationAsync({
        content,
        trigger: null,
      });

      if (__DEV__) {
        console.log('[NotificationService] Notification sent:', notificationId);
      }

      return notificationId;
    } catch (error) {
      console.error('[NotificationService] Error sending notification:', error);
      throw error;
    }
  }

  /**
   * Send a proactive suggestion notification
   * Formats the notification similar to ChatMessage component
   */
  async sendProactiveSuggestionNotification(
    data: ProactiveSuggestionNotificationData
  ): Promise<string> {
    // Format notification similar to ChatMessage proactive suggestion
    const title = '💡 Proactive Suggestion';
    const body = `Regarding: ${data.itemId}\n\n${data.suggestion}`;

    // Determine priority based on severity
    let priority: 'min' | 'low' | 'default' | 'high' | 'max' = 'high';
    if (data.severity === 'high' || data.severity === 'critical') {
      priority = 'max';
    } else if (data.severity === 'low') {
      priority = 'default';
    }

    return this.sendNotification({
      title,
      body,
      data: {
        type: 'proactive_suggestion',
        jobId: data.jobId,
        jobName: data.jobName,
        itemId: data.itemId,
        suggestion: data.suggestion,
        severity: data.severity,
        timestamp: data.timestamp,
        tab: 'askAI', // Redirect to AskAI tab instead of Transcription tab
      },
      sound: true,
      priority,
      categoryId: 'proactive_suggestion',
    });
  }

  /**
   * Cancel a notification by ID
   */
  async cancelNotification(notificationId: string): Promise<void> {
    try {
      const notifications = await getNotifications();
      await notifications.cancelScheduledNotificationAsync(notificationId);
      if (__DEV__) {
        console.log('[NotificationService] Notification cancelled:', notificationId);
      }
    } catch (error) {
      console.warn('[NotificationService] Error cancelling notification:', error);
    }
  }

  /**
   * Cancel all notifications
   */
  async cancelAllNotifications(): Promise<void> {
    try {
      const notifications = await getNotifications();
      await notifications.cancelAllScheduledNotificationsAsync();
      if (__DEV__) {
        console.log('[NotificationService] All notifications cancelled');
      }
    } catch (error) {
      console.warn('[NotificationService] Error cancelling all notifications:', error);
    }
  }

  /**
   * Send a recording status notification
   * This is a persistent notification shown when recording is active
   */
  async sendRecordingNotification(jobId: string, jobName: string): Promise<string> {
    const title = '🎤 Live Recording';
    const body = `Recording in progress: ${jobName}`;

    return this.sendNotification({
      title,
      body,
      data: {
        type: 'recording',
        jobId,
        jobName,
      },
      sound: false, // Don't play sound for persistent notification
      priority: 'max',
      categoryId: 'recording',
    });
  }

  /**
   * Cancel recording notification by job ID
   */
  async cancelRecordingNotification(jobId: string): Promise<void> {
    try {
      const notifications = await getNotifications();
      // Get all scheduled notifications
      const scheduledNotifications = await notifications.getAllScheduledNotificationsAsync();

      // Find and cancel scheduled recording notifications for this job
      for (const notification of scheduledNotifications) {
        const data = notification.content.data;
        if (data?.type === 'recording' && data?.jobId === jobId) {
          await notifications.cancelScheduledNotificationAsync(notification.identifier);
        }
      }

      if (__DEV__) {
        console.log('[NotificationService] Recording notification cancelled for job:', jobId);
      }
    } catch (error) {
      console.warn('[NotificationService] Error cancelling recording notification:', error);
    }
  }
}

// Singleton instance
let notificationServiceInstance: INotificationService | null = null;

/**
 * Get the notification service instance
 */
export const getNotificationService = (): INotificationService => {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
};

/**
 * Helper function to format proactive suggestions for notifications
 */
export const formatProactiveSuggestionsForNotification = (
  suggestions: ProactiveSuggestionsMessage,
  jobId: string,
  jobName: string
): ProactiveSuggestionNotificationData[] => {
  return suggestions.missedOpportunities.map((opportunity: MissedOpportunity) => ({
    jobId,
    jobName,
    itemId: opportunity.itemId || 'General',
    suggestion: opportunity.suggestion,
    severity: opportunity.severity || 'medium',
    timestamp: suggestions.timestamp,
  }));
};

export default getNotificationService;
