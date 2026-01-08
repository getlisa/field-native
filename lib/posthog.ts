import PostHog from 'posthog-react-native';
import { config } from './config';

// Create PostHog instance - can be used with or without PostHogProvider
// If PostHog is not enabled, export null
export const posthog: PostHog | null = config.posthog.isEnabled && config.posthog.apiKey
  ? new PostHog(config.posthog.apiKey, {
      host: config.posthog.host,
    })
  : null;

/**
 * PostHog event names - centralized for consistency and easier tracking
 * Follows snake_case naming convention for analytics events
 */
export const PostHogEvents = {
  // Job lifecycle events
  JOB_CREATED: 'job_created',
  JOB_STARTED: 'job_started',
  
  // Job creation flow events
  JOB_CREATION_STARTED: 'job_creation_started',
  JOB_CREATION_CANCELLED: 'job_creation_cancelled',
  
  // Job filtering events
  JOB_FILTER_APPLIED: 'job_filter_applied',
  JOB_FILTER_CANCELLED: 'job_filter_cancelled',
  
  // Recording events
  RECORDING_STOPPED: 'recording_stopped',
  
  // Authentication events
  USER_LOGGED_IN: 'user_logged_in',
} as const;

/**
 * Helper function to get company_id from auth store for event tracking
 * Uses dynamic import to avoid circular dependencies
 */
export const getCompanyIdForTracking = (): number | undefined => {
  try {
    // Use getState directly to avoid circular dependency issues
    const useAuthStore = require('@/store/useAuthStore').default;
    const user = useAuthStore.getState().user;
    return user?.company_id ? Number(user.company_id) : undefined;
  } catch {
    return undefined;
  }
};

