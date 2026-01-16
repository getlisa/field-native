import { api, type ApiTokens } from '@/lib/apiClient';
import { useAuthStore } from '@/store/useAuthStore';

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

export type SessionStatusResponse = {
  authenticated: boolean;
  access?: {
    expiresInSeconds: number;
  };
  refresh?: {
    expiresInSeconds: number;
    requiresReLoginSoon: boolean;
  };
  policy?: {
    longRunningOperationAllowed: boolean;
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

    return data;
  },

  refresh: async (): Promise<ApiTokens> => api.refreshAccessToken(),

  logout: () => {
    api.clearTokens();
  },

  getTokens: () => api.getTokens(),

  sessionStatus: async (refreshToken: string): Promise<SessionStatusResponse> => {
    const response = await api.get<SessionStatusResponse>('/auth/session-status', {
      params: { refresh_token: refreshToken },
      skipAuth: true,
    });
    return response;
  },
};

export default authService;

