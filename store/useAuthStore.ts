import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { resetPostHogIdentity } from '@/services/authService';

export interface User {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  role?: 'technician' | 'admin';
  company_id?: number;
  created_at?: string;
  updated_at?: string;
}

interface AuthState {
  user: User | null;
  access_token: string | null;
  refresh_token: string | null;
  isLoading: boolean;
  error: string | null;
  _hasHydrated: boolean;
  login: (user: User | null, accessToken: string | null, refreshToken: string | null) => void;
  logout: () => void;
  setAccessToken: (token: string | null) => void;
  setRefreshToken: (token: string | null) => void;
  clearError: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      access_token: null,
      refresh_token: null,
      isLoading: false,
      error: null,
      _hasHydrated: false,
      login: (user, accessToken, refreshToken) =>
        set({
          user,
          access_token: accessToken,
          refresh_token: refreshToken,
          error: null,
        }),
      logout: () => {
        // Reset PostHog identity on logout (covers both explicit logout and session expiration)
        resetPostHogIdentity();
        
        set({
          user: null,
          access_token: null,
          refresh_token: null,
          error: null,
          isLoading: false,
        });
      },
      setAccessToken: (token) => set({ access_token: token }),
      setRefreshToken: (token) => set({ refresh_token: token }),
      clearError: () => set({ error: null }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        access_token: state.access_token,
        refresh_token: state.refresh_token,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export default useAuthStore;
