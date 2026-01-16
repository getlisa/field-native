import useAuthStore from '@/store/useAuthStore';
import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

// Read API base URL from public env with localhost fallback for dev
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';

export type ApiTokens = {
  accessToken?: string;
  refreshToken?: string;
};

export interface ApiError {
  status?: number;
  message: string;
  code?: string;
  details?: any;
}

export interface ApiResponse<T = any> {
  data?: T | null;
  error?: ApiError | null;
}

interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
  headers?: Record<string, any>;
  skipAuth?: boolean;
}

type FailedRequest = {
  resolve: (token: string) => void;
  reject: (error: any) => void;
};

let tokens: ApiTokens = {};
let isRefreshing = false;
let failedRequestsQueue: FailedRequest[] = [];

// Seed in-memory tokens from persisted store on module load
const initialStoreState = useAuthStore.getState();
tokens = {
  accessToken: initialStoreState.access_token ?? undefined,
  refreshToken: initialStoreState.refresh_token ?? undefined,
};

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Keep in-memory tokens synced with the store
useAuthStore.subscribe((state) => {
  tokens.accessToken = state.access_token ?? undefined;
  tokens.refreshToken = state.refresh_token ?? undefined;
});

// Disabled verbose API logging - enable for debugging API issues
const logRequest = (_config: InternalAxiosRequestConfig) => {
  // Uncomment to debug API requests:
  // if (__DEV__) console.log('[api][request]', { method: _config.method, url: _config.url });
};

const logResponseError = (_error: AxiosError) => {
  // Uncomment to debug API errors:
  // if (__DEV__) console.log('[api][error]', { url: _error.config?.url, status: _error.response?.status });
};

const extractTokens = (data: any) => {
  const access =
    data?.access_token ||
    data?.accessToken ||
    data?.data?.access_token ||
    data?.data?.accessToken;
  const refresh =
    data?.refresh_token ||
    data?.refreshToken ||
    data?.data?.refresh_token ||
    data?.data?.refreshToken;

  if (access) tokens.accessToken = access;
  if (refresh) tokens.refreshToken = refresh;

  const { setAccessToken, setRefreshToken } = useAuthStore.getState();
  if (access) setAccessToken(access);
  if (refresh) setRefreshToken(refresh);
};

const processQueue = (error: any = null, token: string | null = null) => {
  failedRequestsQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else if (token) {
      promise.resolve(token);
    }
  });
  failedRequestsQueue = [];
};

const formatError = (error: AxiosError): ApiError => {
  if (error.response) {
    const data = error.response.data as any;
    return {
      message: data?.message || error.message || 'An error occurred',
      status: error.response.status,
      code: data?.code,
      details: data?.details,
    };
  }
  if (error.request) {
    return { message: 'Network error. Please check your connection.' };
  }
  return { message: error.message || 'An unexpected error occurred' };
};

const refreshAccessToken = async () => {
  if (!tokens.refreshToken) {
    const { refresh_token } = useAuthStore.getState();
    if (refresh_token) {
      tokens.refreshToken = refresh_token;
    }
  }

  if (!tokens.refreshToken) {
    throw { message: 'No refresh token available' } as ApiError;
  }

  const response = await axios.post(
    `${API_BASE_URL}/auth/refresh`,
    { refresh_token: tokens.refreshToken },
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const apiResponse: ApiResponse<any> = response.data;
  if (apiResponse.error) {
    clearTokens();
    useAuthStore.getState().logout();
    throw apiResponse.error;
  }
  extractTokens(apiResponse.data ?? apiResponse);
  return tokens;
};

// Request interceptor: attach access token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig & CustomAxiosRequestConfig) => {
    // Normalize headers to AxiosHeaders shape
    if (!config.headers) {
      config.headers = {} as any;
    }
    if (!config.skipAuth) {
      const storeTokens = useAuthStore.getState();
      const tokenToUse = tokens.accessToken ?? storeTokens.access_token ?? undefined;
      if (tokenToUse && config.headers) {
        config.headers.Authorization = `Bearer ${tokenToUse}`;
      }
    }
    logRequest(config);
    return config;
  },
  (error: any) => Promise.reject(error)
);

// Response interceptor: handle refresh + queue
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    logResponseError(error);
    const originalRequest = error.config as CustomAxiosRequestConfig;

    if (originalRequest?.skipAuth) {
      return Promise.reject(formatError(error));
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      if (!tokens.refreshToken) {
        const { refresh_token } = useAuthStore.getState();
        if (refresh_token) {
          tokens.refreshToken = refresh_token;
        }
      }

      if (!tokens.refreshToken) {
        clearTokens();
        useAuthStore.getState().logout();
        return Promise.reject(formatError(error));
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedRequestsQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err: any) => Promise.reject(err));
      }

      isRefreshing = true;

      try {
        const refreshedTokens = await refreshAccessToken();
        processQueue(null, refreshedTokens.accessToken || '');

        if (originalRequest.headers && refreshedTokens.accessToken) {
          originalRequest.headers.Authorization = `Bearer ${refreshedTokens.accessToken}`;
        }

        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearTokens();
        useAuthStore.getState().logout();
        // Handle both ApiError and AxiosError
        const formattedError = (refreshError as any).status !== undefined 
          ? refreshError 
          : formatError(refreshError as AxiosError);
        return Promise.reject(formattedError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(formatError(error));
  }
);

const unwrapResponse = <T>(resp: AxiosResponse<any>): T => {
  const apiResponse: ApiResponse<T> = resp.data;
  if (apiResponse?.error) {
    throw apiResponse.error;
  }
  return (apiResponse?.data ?? resp.data ?? null) as T;
};

export const api = {
  get: <T = any>(url: string, config?: CustomAxiosRequestConfig): Promise<T> =>
    apiClient.get(url, config).then((resp) => unwrapResponse<T>(resp)),
  post: <T = any>(url: string, data?: any, config?: CustomAxiosRequestConfig): Promise<T> =>
    apiClient.post(url, data, config).then((resp) => unwrapResponse<T>(resp)),
  put: <T = any>(url: string, data?: any, config?: CustomAxiosRequestConfig): Promise<T> =>
    apiClient.put(url, data, config).then((resp) => unwrapResponse<T>(resp)),
  patch: <T = any>(url: string, data?: any, config?: CustomAxiosRequestConfig): Promise<T> =>
    apiClient.patch(url, data, config).then((resp) => unwrapResponse<T>(resp)),
  delete: <T = any>(url: string, config?: CustomAxiosRequestConfig): Promise<T> =>
    apiClient.delete(url, config).then((resp) => unwrapResponse<T>(resp)),
  setTokens: (accessToken: string, refreshToken?: string) => {
    tokens = { accessToken, refreshToken };
    useAuthStore.getState().setAccessToken(accessToken);
    if (refreshToken) {
      useAuthStore.getState().setRefreshToken(refreshToken);
    }
  },
  clearTokens: () => {
    clearTokens();
    useAuthStore.getState().logout();
  },
  getTokens: () => tokens,
  refreshAccessToken,
};

const clearTokens = () => {
  tokens = {};
};

