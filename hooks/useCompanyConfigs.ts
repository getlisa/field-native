import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { companyConfigsService } from '@/services/companyConfigsService';

export const COMPANY_CONFIGS_QUERY_KEY = 'companyConfigs';

/**
 * Hook to fetch and manage company configs using TanStack Query
 * Includes periodic refetch for automatic updates
 */
export const useCompanyConfigs = (companyId: number | undefined) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [COMPANY_CONFIGS_QUERY_KEY, companyId],
    queryFn: () => companyConfigsService.getCompanyConfigs(companyId!),
    enabled: !!companyId,
    staleTime: 1000 * 60 * 5, // 5 minutes
    // Periodic refetch every 10 minutes
    refetchInterval: 1000 * 60 * 10,
    // Refetch when window regains focus (optional, can be disabled if not needed)
    refetchOnWindowFocus: false,
  });

  const invalidateCompanyConfigs = useCallback(() => {
    if (companyId) {
      queryClient.invalidateQueries({ queryKey: [COMPANY_CONFIGS_QUERY_KEY, companyId] });
    }
  }, [companyId, queryClient]);

  return {
    configs: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    invalidate: invalidateCompanyConfigs,
  };
};

export default useCompanyConfigs;
