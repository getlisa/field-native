/**
 * Centralized environment configuration
 * All environment variables should be accessed through this file
 */

export const config = {
  // API Configuration
  api: {
    baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000/api',
  },

  // PostHog Configuration
  posthog: {
    apiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    isEnabled: !!process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
  },
} as const;

