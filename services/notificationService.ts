/**
 * notificationService.ts - Push notification service for iOS and Android
 * 
 * Provides a clean abstraction for sending local notifications with support for
 * both iOS and Android platforms.
 * 
 * Uses expo-notifications for cross-platform notification support.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { type ProactiveSuggestionsMessage, type MissedOpportunity } from '@/lib/RealtimeChat';

// Initialize notification handler flag
let notificationHandlerInitialized = false;

/**
 * Initialize notification handler (call this early in app lifecycle)
 * Safe to call multiple times - only initializes once
 */
export function initializeNotificationHandler(): void {
  if (notificationHandlerInitialized) return;
  
  try {
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
  }),
});
    notificationHandlerInitialized = true;
  } catch (error) {
    console.error('[NotificationService] Error initializing notification handler:', error);
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
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      this.permissionsGranted = finalStatus === 'granted';
      return this.permissionsGranted;
    } catch (error) {
      console.error('[NotificationService] Error requesting permissions:', error);
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
      const { status } = await Notifications.getPermissionsAsync();
      this.permissionsGranted = status === 'granted';
      return this.permissionsGranted;
    } catch (error) {
      console.error('[NotificationService] Error checking permissions:', error);
      return false;
    }
  }

  /**
   * Send a local notification
   */
  async sendNotification(config: NotificationConfig): Promise<string> {
    try {
      // Ensure permissions are granted
      const hasPermission = await this.areNotificationsEnabled();
      if (!hasPermission) {
        const granted = await this.requestPermissions();
        if (!granted) {
          throw new Error('Notification permissions not granted');
        }
      }

      // Configure notification content
      const content: Notifications.NotificationContentInput = {
        title: config.title,
        body: config.body,
        data: config.data || {},
        sound: config.sound !== false, // Default to true
        priority: config.priority || 'high',
      };

      // Configure trigger (immediate)
      const trigger: Notifications.NotificationTriggerInput = null; // null = immediate

      // Schedule notification
      const notificationId = await Notifications.scheduleNotificationAsync({
        content,
        trigger,
      });

      if (__DEV__) {
        console.log('[NotificationService] ✅ Notification sent:', notificationId);
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
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      if (__DEV__) {
        console.log('[NotificationService] ✅ Notification cancelled:', notificationId);
      }
    } catch (error) {
      console.error('[NotificationService] Error cancelling notification:', error);
    }
  }

  /**
   * Cancel all notifications
   */
  async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      if (__DEV__) {
        console.log('[NotificationService] ✅ All notifications cancelled');
      }
    } catch (error) {
      console.error('[NotificationService] Error cancelling all notifications:', error);
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
      // Get all scheduled notifications
      const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
      
      // Find and cancel scheduled recording notifications for this job
      for (const notification of scheduledNotifications) {
        const data = notification.content.data;
        if (data?.type === 'recording' && data?.jobId === jobId) {
          await Notifications.cancelScheduledNotificationAsync(notification.identifier);
        }
      }

      // Also cancel any delivered notifications (shown in notification drawer)
      // Note: expo-notifications doesn't provide a direct way to cancel delivered notifications,
      // but we can dismiss them by sending a silent update or by using the notification identifier
      // For now, we'll rely on the scheduled notifications cancellation above
      // The notification will be automatically removed when the app is opened
      
      if (__DEV__) {
        console.log('[NotificationService] ✅ Recording notification cancelled for job:', jobId);
      }
    } catch (error) {
      console.error('[NotificationService] Error cancelling recording notification:', error);
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
