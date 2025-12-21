import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { jobService, type Job } from '@/services/jobService';

export const JOB_QUERY_KEY = 'job';

export const useJobQuery = (jobId: string | undefined) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [JOB_QUERY_KEY, jobId],
    queryFn: () => jobService.getJob(jobId!),
    enabled: !!jobId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const invalidateJob = useCallback(() => {
    if (jobId) {
      queryClient.invalidateQueries({ queryKey: [JOB_QUERY_KEY, jobId] });
    }
  }, [jobId, queryClient]);

  return {
    job: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    invalidate: invalidateJob,
  };
};

export default useJobQuery;
