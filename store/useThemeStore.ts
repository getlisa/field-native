import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeStore {
  /** User's theme preference */
  themePreference: ThemePreference;
  /** Whether store has hydrated from AsyncStorage */
  _hasHydrated: boolean;
  /** Set theme preference */
  setThemePreference: (preference: ThemePreference) => void;
  /** Set hydration status */
  setHasHydrated: (state: boolean) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      themePreference: 'system',
      _hasHydrated: false,
      setThemePreference: (preference) => set({ themePreference: preference }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ themePreference: state.themePreference }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export default useThemeStore;
