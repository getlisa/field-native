import { create } from 'zustand';
import type { CompanyConfigs } from '@/services/companyConfigsService';

interface CompanyConfigsState {
  configs: CompanyConfigs | null;
  isLoading: boolean;
  error: string | null;
  setConfigs: (configs: CompanyConfigs | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearConfigs: () => void;
}

export const useCompanyConfigsStore = create<CompanyConfigsState>((set) => ({
  configs: null,
  isLoading: false,
  error: null,
  setConfigs: (configs) => set({ configs, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clearConfigs: () => set({ configs: null, error: null, isLoading: false }),
}));
