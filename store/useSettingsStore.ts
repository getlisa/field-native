import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SettingsStore {
  /** Whether Text-to-Speech is enabled */
  isTTSEnabled: boolean;
  /** Toggle TTS status */
  setTTSEnabled: (enabled: boolean) => void;
  /** Whether store has hydrated from AsyncStorage */
  _hasHydrated: boolean;
  /** Set hydration status */
  setHasHydrated: (state: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      isTTSEnabled: true,
      _hasHydrated: false,
      setTTSEnabled: (enabled) => set({ isTTSEnabled: enabled }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ isTTSEnabled: state.isTTSEnabled }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export default useSettingsStore;
