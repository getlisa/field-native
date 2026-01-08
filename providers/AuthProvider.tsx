import React, { createContext, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import authService, { type LoginRequest } from '@/services/authService';
import { useAuthStore, type User } from '@/store/useAuthStore';
import { posthog, PostHogEvents } from '@/lib/posthog';

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error';

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  login: (payload: LoginRequest) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  accessToken?: string;
  refreshToken?: string;
  companyId?: string;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const store = useAuthStore();
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (payload: LoginRequest) => {
    setStatus('loading');
    setError(null);
    try {
      const response = await authService.login(payload);
      const access =
        response.access_token ??
        response.accessToken ??
        response.tokens?.accessToken ??
        store.access_token;
      const refreshToken =
        response.refresh_token ??
        response.refreshToken ??
        response.tokens?.refreshToken ??
        store.refresh_token;

      const userPayload = (response.user ?? store.user ?? null) as User | null;

      // Persist auth state (PostHog identify is handled in store.login)
      store.login(userPayload, access ?? null, refreshToken ?? null);

      if (access) {
        // Track user logged in event
        if (posthog && userPayload) {
          const companyId = userPayload.company_id ? Number(userPayload.company_id) : undefined;
          posthog.capture(PostHogEvents.USER_LOGGED_IN, {
            ...(companyId !== undefined && { company_id: companyId }),
            ...(userPayload.role && { role: userPayload.role }),
          });
        }
        
        setStatus('authenticated');
        setError(null);
      } else {
        setStatus('error');
        setError('Unable to login');
        store.logout();
      }
    } catch (err: any) {
      setStatus('error');
      // Parse error message for better UX
      const errorMsg = err?.message || 'Unable to login';
      const statusCode = err?.status || err?.statusCode;
      
      if (statusCode === 401 || statusCode === 403) {
        setError('Invalid email or password');
      } else if (statusCode === 404) {
        setError('Account not found');
      } else if (errorMsg.toLowerCase().includes('network') || errorMsg.toLowerCase().includes('fetch')) {
        setError('Connection error. Please check your internet.');
      } else {
        setError(errorMsg);
      }
      store.logout();
    }
  }, [store]);

  const logout = useCallback(() => {
    authService.logout();
    // PostHog reset is handled in store.logout
    store.logout();
    setStatus('idle');
    setError(null);
  }, [store]);

  // Initialize status from persisted auth
  useEffect(() => {
    if (store.access_token) {
      setStatus('authenticated');
    } else {
      setStatus('idle');
    }
  }, [store.access_token]);

  const value = useMemo<AuthContextValue>(() => {
    const user = store.user;
    return {
      user,
      status,
      error,
      login,
      logout,
      isAuthenticated: Boolean(store.access_token),
      accessToken: store.access_token ?? undefined,
      refreshToken: store.refresh_token ?? undefined,
      companyId: user?.company_id ? String(user.company_id) : undefined,
    };
  }, [store.user, store.access_token, store.refresh_token, status, error, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

