import { useCallback, useState } from 'react';

import { jobService, type Job, type VisitSession } from '@/services/jobService';

interface UseJobDetailsReturn {
  job: Job | null;
  visitSession: VisitSession | null;
  loading: boolean;
  error: string | null;
  fetchJob: (jobId: string) => Promise<void>;
  startJob: (jobId: string) => Promise<VisitSession | null>;
  completeJob: (jobId: string) => Promise<void>;
  refreshJob: () => Promise<void>;
}

export function useJobDetails(): UseJobDetailsReturn {
  const [job, setJob] = useState<Job | null>(null);
  const [visitSession, setVisitSession] = useState<VisitSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const fetchJob = useCallback(async (jobId: string) => {
    setLoading(true);
    setError(null);
    setCurrentJobId(jobId);

    try {
      const fetchedJob = await jobService.getJob(jobId);
      setJob(fetchedJob);

      // Try to fetch visit session if job is ongoing or completed
      if (fetchedJob.status !== 'scheduled') {
        try {
          const session = await jobService.getVisitSessionByJobId(jobId);
          setVisitSession(session);
        } catch {
          // Visit session may not exist yet
          setVisitSession(null);
        }
      } else {
        setVisitSession(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch job details');
      setJob(null);
      setVisitSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const startJob = useCallback(async (jobId: string): Promise<VisitSession | null> => {
    setLoading(true);
    setError(null);

    try {
      const result = await jobService.startJob(jobId);
      setJob(result.job);
      setVisitSession(result.visit_session);
      return result.visit_session;
    } catch (err: any) {
      setError(err?.message || 'Failed to start job');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeJob = useCallback(async (jobId: string) => {
    setLoading(true);
    setError(null);

    try {
      const completedJob = await jobService.completeJob(jobId);
      setJob(completedJob);
    } catch (err: any) {
      setError(err?.message || 'Failed to complete job');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshJob = useCallback(async () => {
    if (currentJobId) {
      await fetchJob(currentJobId);
    }
  }, [currentJobId, fetchJob]);

  return {
    job,
    visitSession,
    loading,
    error,
    fetchJob,
    startJob,
    completeJob,
    refreshJob,
  };
}

export default useJobDetails;

