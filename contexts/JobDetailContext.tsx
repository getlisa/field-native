import React, { createContext, useContext, ReactNode } from 'react';
import type { DialogueTurn } from '@/lib/RealtimeChat';
import type { Job } from '@/services/jobService';

interface JobDetailContextValue {
  job: Job | null;
  jobId: string | undefined;
  isJobAssignedToCurrentUser: boolean;
  isViewer: boolean;
  jobStatus?: Job['status'];
  canUseAskAI: boolean;
  canViewTranscription: boolean;
  turns: DialogueTurn[];
  isConnected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  transcriptionError: string | null;
  startTranscription: (visitSessionId: string, companyId: number) => void;
  stopTranscription: () => void;
  visitSessionId?: string;
}

const JobDetailContext = createContext<JobDetailContextValue | undefined>(undefined);

export const useJobDetailContext = () => {
  const context = useContext(JobDetailContext);
  if (!context) {
    throw new Error('useJobDetailContext must be used within JobDetailProvider');
  }
  return context;
};

interface JobDetailProviderProps {
  children: ReactNode;
  value: JobDetailContextValue;
}

export const JobDetailProvider: React.FC<JobDetailProviderProps> = ({ children, value }) => {
  return (
    <JobDetailContext.Provider value={value}>
      {children}
    </JobDetailContext.Provider>
  );
};

export default JobDetailContext;
