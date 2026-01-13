import PostHog from 'posthog-react-native';
import { config } from './config';

// Lazy initialization with try-catch to handle SSR/web bundling
// PostHog uses AsyncStorage which requires window object (not available during SSR)
let posthogInstance: PostHog | null = null;

try {
  if (config.posthog.isEnabled && config.posthog.apiKey) {
    // Only initialize in native environments (not web/SSR)
    // Check for window to ensure we're not in Node.js/SSR environment
    if (typeof window !== 'undefined') {
      posthogInstance = new PostHog(config.posthog.apiKey, {
        host: config.posthog.host,
      });
    }
  }
} catch (error) {
  // Silently fail during SSR/bundling - PostHog is optional
  if (__DEV__) {
    console.warn('[PostHog] Initialization skipped:', error);
  }
}

export const posthog: PostHog | null = posthogInstance;

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
  
  // Transcription audio playback events
  TRANSCRIPTION_AUDIO_PLAY_PAUSE: 'transcription_audio_play_pause',
  TRANSCRIPTION_AUDIO_PLAYED: 'transcription_audio_played',
  TRANSCRIPTION_AUDIO_PAUSED: 'transcription_audio_paused',
  
  // Chat input events
  CHAT_VOICE_INPUT_PRESSED: 'chat_voice_input_pressed',
  CHAT_VOICE_RECORDING_STARTED: 'chat_voice_recording_started',
  CHAT_VOICE_RECORDING_STOPPED: 'chat_voice_recording_stopped',
  CHAT_AGENT_RESPONSE_STOPPED: 'chat_agent_response_stopped',
  CHAT_GALLERY_OPENED: 'chat_gallery_opened',
  CHAT_CAMERA_OPENED: 'chat_camera_opened',
  CHAT_MESSAGE_SENT: 'chat_message_sent',
  
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

