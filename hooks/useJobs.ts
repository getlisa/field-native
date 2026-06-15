import { useCallback, useRef, useState } from 'react';

import { jobService, type Job, type JobFilterOptions } from '@/services/jobService';
import { useAuthStore } from '@/store/useAuthStore';

type JobsState = {
  jobs: Job[];
  error: string | null;
  loading: boolean;
};

export const useJobs = () => {
  const [state, setState] = useState<JobsState>({
    jobs: [],
    error: null,
    loading: false,
  });

  const loadingRef = useRef(false);
  const fetchTimeoutMsRef = useRef(35_000);

  const fetchJobs = useCallback(
    async (
      companyId?: string,
      options?: JobFilterOptions,
      opts?: { force?: boolean; timeoutMs?: number },
    ) => {
      const force = opts?.force ?? false;
      const timeoutMs = opts?.timeoutMs ?? fetchTimeoutMsRef.current;

    const resolvedCompanyId = companyId ?? useAuthStore.getState().user?.company_id?.toString();
    if (!resolvedCompanyId) {
      loadingRef.current = false;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: 'Missing company id',
      }));
      return;
    }

    // Prevent overlapping refreshes from leaving the UI in a perpetual loading state.
    // Manual refresh/search should pass `force: true`.
    if (loadingRef.current && !force) {
      return;
    }

    loadingRef.current = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out while loading jobs')), timeoutMs);
      });

      const response = await Promise.race([
        jobService.getJobsByCompany(resolvedCompanyId, options),
        timeoutPromise,
      ]);

      setState({ jobs: response.jobs, error: null, loading: false });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || 'Unable to fetch jobs',
      }));
    } finally {
      loadingRef.current = false;
    }
    },
    [],
  );

  return {
    jobs: state.jobs,
    error: state.error,
    loading: state.loading,
    fetchJobs,
  };
};

export default useJobs;

