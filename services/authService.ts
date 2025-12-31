import { api, type ApiTokens } from '@/lib/apiClient';
import { useAuthStore } from '@/store/useAuthStore';

// Import PostHog - get the singleton instance initialized by PostHogProvider
// Only import in production to avoid issues in development
let posthog: any = null;
if (!__DEV__) {
  try {
    const PostHogModule = require('posthog-react-native');
    posthog = PostHogModule.default;
  } catch (error) {
    // PostHog not available, continue without it
  }
}

/**
 * Reset PostHog identity - called on logout or session expiration
 * This function is safe to call even if PostHog is not available
 */
export const resetPostHogIdentity = () => {
  if (posthog && typeof posthog.reset === 'function') {
    try {
      posthog.reset();
    } catch (error) {
      // Silently fail - don't break logout flow
    }
  }
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  access_token?: string;
  refresh_token?: string;
  accessToken?: string;
  refreshToken?: string;
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: string;
  };
  user?: {
    id?: string;
    email: string;
    company_id?: number;
    first_name?: string;
    last_name?: string;
    role?: string;
  };
};

const authService = {
  login: async (payload: LoginRequest): Promise<LoginResponse> => {
    const data = await api.post<LoginResponse>('/auth/login', payload, { skipAuth: true });

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[authService][login] response data:', JSON.stringify(data, null, 2));
    }

    const access =
      data.access_token ??
      data.accessToken ??
      data.tokens?.accessToken;
    const refresh =
      data.refresh_token ??
      data.refreshToken ??
      data.tokens?.refreshToken;

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[authService][login] extracted tokens:', { access: !!access, refresh: !!refresh });
    }

    if (access) {
      api.setTokens(access, refresh);
    }

    const user = data.user
      ? ({
          ...data.user,
          role: data.user.role as 'technician' | 'admin' | undefined,
        })
      : null;
    useAuthStore.getState().login(user, access ?? null, refresh ?? null);

    // Identify user in PostHog
    if (posthog && user && typeof posthog.identify === 'function') {
      try {
        // Generate distinct ID: user-{id}-{firstName}-{lastName}
        const firstName = user.first_name || '';
        const lastName = user.last_name || '';
        const distinctId = `user-${user.id}-${firstName}-${lastName}`.toLowerCase().replace(/\s+/g, '-');
        
        posthog.identify(distinctId, {
          $set: {
            email: user.email,
            name: [firstName, lastName].filter(Boolean).join(' ') || undefined,
            first_name: firstName || undefined,
            last_name: lastName || undefined,
            company_id: user.company_id,
            role: user.role,
          },
          $set_once: {
            date_of_first_log_in: new Date().toISOString(),
          },
        });
      } catch (error) {
        // Silently fail - don't break login flow
      }
    }

    return data;
  },

  refresh: async (): Promise<ApiTokens> => api.refreshAccessToken(),

  logout: () => {
    api.clearTokens();
    // PostHog reset is handled in useAuthStore.logout() to cover both explicit logout and session expiration
    resetPostHogIdentity();
  },

  getTokens: () => api.getTokens(),
};

export default authService;

