import { useCallback, useState } from 'react';

import { jobService, type Job } from '@/services/jobService';
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

  const fetchJobs = useCallback(async (companyId?: string, skip = 0, limit = 50) => {
    const resolvedCompanyId = companyId ?? useAuthStore.getState().user?.company_id?.toString();
    if (!resolvedCompanyId) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: 'Missing company id',
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await jobService.getJobsByCompany(resolvedCompanyId, skip, limit);
      setState({
        jobs: response.jobs,
        error: null,
        loading: false,
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || 'Unable to fetch jobs',
      }));
    }
  }, []);

  return {
    jobs: state.jobs,
    error: state.error,
    loading: state.loading,
    fetchJobs,
  };
};

export default useJobs;

