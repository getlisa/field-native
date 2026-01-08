import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { posthog } from '@/lib/posthog';

/**
 * Helper function to identify user in PostHog
 */
const identifyUserInPostHog = (user: User | null) => {
  if (!posthog || !user) return;
  
  try {
    const distinctId = user.id || user.email;
    if (!distinctId) return;

    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    
    // Build properties object, only including defined values
    const properties: Record<string, any> = {
      email: user.email,
    };
    
    if (fullName) properties.name = fullName;
    if (firstName) properties.first_name = firstName;
    if (lastName) properties.last_name = lastName;
    if (user.company_id) properties.company_id = user.company_id;
    if (user.role) properties.role = user.role;

    console.log('PostHog identifying user:', distinctId, properties);
    posthog.identify(distinctId, properties);
  } catch (error) {
    // Silently fail - don't break auth flow
  }
};

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
      login: (user, accessToken, refreshToken) => {
        set({
          user,
          access_token: accessToken,
          refresh_token: refreshToken,
          error: null,
        });

        // Identify user in PostHog
        identifyUserInPostHog(user);
      },
      logout: () => {
        // Reset PostHog identity on logout
        if (posthog) {
          try {
            posthog.reset();
          } catch (error) {
            // Silently fail - don't break logout flow
          }
        }

        set({
          user: null,
          access_token: null,
          refresh_token: null,
          error: null,
          isLoading: false,
        });
      },
      setAccessToken: (token) => {
        set({ access_token: token });
        
        // Check if PostHog identity needs to be updated when token changes
        if (posthog && token) {
          const state = useAuthStore.getState();
          if (!state.user || (!state.user.id && !state.user.email)) {
            // User exists but no distinct ID available, skip identify
            return;
          }
          
          try {
            const currentDistinctId = posthog.getDistinctId();
            const expectedDistinctId = state.user.id || state.user.email;
            
            // If identity has changed or user is not identified, update identity
            if (!currentDistinctId || currentDistinctId !== expectedDistinctId) {
              // Reset if there's a mismatch (user changed)
              if (currentDistinctId && currentDistinctId !== expectedDistinctId) {
                posthog.reset();
              }
              
              // Identify with current user info
              identifyUserInPostHog(state.user);
            }
          } catch (error) {
            // Silently fail - don't break token update flow
          }
        }
      },
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
