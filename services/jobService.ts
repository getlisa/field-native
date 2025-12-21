import { api } from '@/lib/apiClient';

/**
 * Job Status Enum (matches backend)
 */
export type JobStatus = 'scheduled' | 'ongoing' | 'completed';

/**
 * Job Interface (matches backend response)
 */
export interface Job {
  id: string;
  company_id: number;
  technician_id: string | null;
  start_timestamp: string;
  address: string;
  geocoded_lat: number | null;
  geocoded_lng: number | null;
  description: string | null;
  job_target_name: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  visit_sessions?: VisitSession;
  visit_session_metrics?: VisitSessionMetrics | null;
}

/**
 * Jobs List Response Interface (matches backend safeJsonResponse structure)
 */
export interface JobsListResponse {
  jobs: Job[];
  pagination: {
    skip: number;
    limit: number;
    total?: number;
  };
}

/**
 * Create Job Request Interface
 * Matches backend createJobSchema validation
 */
export interface CreateJobRequest {
  job_target_name: string; // Required, max 200 chars
  address: string; // Required, max 500 chars
  start_timestamp: string; // Required, ISO 8601 datetime with timezone (e.g., 2025-11-25T14:54:00Z)
  technician_id?: string; // Optional, assigned technician
  description?: string; // Optional, max 2000 chars
  geocoded_lat?: number; // Optional, -90 to 90
  geocoded_lng?: number; // Optional, -180 to 180
}

/**
 * Checklist Item Interface (matches backend structure)
 */
export interface ChecklistItemData {
  id: string;
  label: string;
  completed: boolean;
  transcription_turn_id?: string[]; // Array of turn IDs, length indicates frequency
}

/**
 * Checklists Interface (matches backend structure)
 */
export interface ChecklistsData {
  status: 'in_progress' | 'completed';
  items: ChecklistItemData[];
}

/**
 * Job Summary Interface (matches backend structure)
 */
export interface JobSummaryData {
  summary: string;
  positivePoints: string[];
  improvementPoints: string[];
  upsellingOpportunities: string[];
  followUpActions?: string[];
  overallAssessment: string;
}

/**
 * Transcription Session Interface (matches backend response)
 */
export interface TranscriptionSession {
  id: string;
  visit_session_id: string;
  starts_at: string;
  ends_at: string | null;
  last_heartbeat_at: string | null;
  meta_data: any;
  created_at: string;
  updated_at: string;
}

/**
 * Visit Session Metrics Interface (matches backend response)
 */
export interface VisitSessionMetrics {
  id: string;
  job_id: string;
  technician_id: string;
  technician_talk_time_sec: number;
  customer_talk_time_sec: number;
  technician_talk_ratio_pct: number;
  total_exchanges: number;
  talk_speed_wpm: number;
  checklist_score_pct: number;
  star_rating: number;
  calculated_at: string;
  meta_data: any;
}

/**
 * Per Technician Metrics Interface (matches backend response)
 */
export interface PerTechnicianMetric {
  technician_full_name: string;
  technician_id: string;
  avg_star_rating: number;
  avg_talk_ratio_pct: number;
  avg_talk_speed_wpm: number;
  total_jobs: number;
}

/**
 * Dashboard Summary Interface (matches backend response)
 */
export interface DashboardSummary {
  job_completion: {
    percentage: number;
    total: number;
    completed: number;
  };
  average_rating: number;
  next_up_jobs: Array<{
    id: string;
    technician_id: string | null;
    start_timestamp: string;
    address: any;
    description: string | null;
    job_target_name: string | null;
    status: string;
  }>;
}

/**
 * Checklist Item Frequency Interface (matches backend response)
 */
export interface ChecklistItemFrequency {
  checklist_item: string;
  trigger_count: number;
}

/**
 * Visit Session Interface (matches backend response)
 */
export interface VisitSession {
  id: string;
  job_id: string;
  technician_id: string;
  start_time: string;
  status: string;
  checklists?: ChecklistsData; // JSON field from database
  job_summary?: string; // JSON string from database
  meta_data?: any; // JSON field containing post-processed transcription data
  transcription_sessions?: TranscriptionSession[];
}

/**
 * Transcription Turn Interface (matches backend response)
 * Note: bigint values are serialized as strings in JSON responses
 */
export interface TranscriptionTurn {
  id: string | number; // bigint serialized as string or number
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  meta_data: any;
  visit_session_id: string | number; // bigint serialized as string or number
  turn_index: number;
  start_timestamp_ms: string | number; // bigint serialized as string or number
  end_timestamp_ms: string | number; // bigint serialized as string or number
  speaker: string | null;
  text: string;
  audio_s3_uri: string | null;
  provider: string;
  provider_result_id: string;
  transcription_session_id: string | number; // bigint serialized as string or number
}

/**
 * Job Service
 * Handles all job-related API calls
 * Only includes endpoints that are implemented on the backend
 */
export const jobService = {
  /**
   * Get jobs by company ID
   * @param companyId - Company ID
   * @param skip - Number of records to skip (pagination)
   * @param limit - Maximum number of records to return (pagination)
   * @returns List of jobs for the company with pagination
   */
  getJobsByCompany: async (companyId: string, skip: number = 0, limit: number = 50): Promise<JobsListResponse> => {
    const response = await api.get<JobsListResponse>(`/jobs/company/${companyId}`, {
      params: { skip, limit },
    });
    return response;
  },

  /**
   * Get single job by ID
   * @param id - Job ID
   * @returns Job details
   */
  getJob: async (id: string): Promise<Job> => {
    const response = await api.get<{ job: any }>(`/jobs/${id}`);
    const job = response.job;

    // Map visit_session_metrics if present (at job level)
    if (job.visit_session_metrics) {
      const metrics = job.visit_session_metrics;
      job.visit_session_metrics = {
        id: metrics.id.toString(),
        job_id: metrics.job_id.toString(),
        technician_id: metrics.technician_id.toString(),
        technician_talk_time_sec: metrics.technician_talk_time_sec,
        customer_talk_time_sec: metrics.customer_talk_time_sec,
        technician_talk_ratio_pct: Number(metrics.technician_talk_ratio_pct),
        total_exchanges: metrics.total_exchanges,
        talk_speed_wpm: metrics.talk_speed_wpm,
        checklist_score_pct: Number(metrics.checklist_score_pct),
        star_rating: Number(metrics.star_rating),
        calculated_at:
          metrics.calculated_at instanceof Date ? metrics.calculated_at.toISOString() : metrics.calculated_at,
        meta_data: metrics.meta_data,
      };
    } else {
      job.visit_session_metrics = null;
    }

    return job as Job;
  },

  /**
   * Create new job
   * @param data - Job data
   * @returns Created job
   */
  createJob: async (data: CreateJobRequest): Promise<Job> => {
    const response = await api.post<{ job: Job }>('/jobs', data);
    return response.job;
  },

  /**
   * Start a job
   * @param id - Job ID
   * @returns Updated job and visit session
   */
  startJob: async (id: string): Promise<{ job: Job; visit_session: VisitSession }> => {
    const response = await api.post<{ job: Job; visit_session: VisitSession }>(`/jobs/${id}/start`);
    return response;
  },

  /**
   * Get transcription turns by visit session ID
   * @param visitSessionId - Visit session ID
   * @returns Array of transcription turns
   */
  getTurnsByVisitSessionId: async (visitSessionId: string): Promise<TranscriptionTurn[]> => {
    const response = await api.get<TranscriptionTurn[]>(`/visit-sessions/${visitSessionId}/turns`);
    return response;
  },

  /**
   * Get visit session by ID (includes checklists and job_summary)
   * @param visitSessionId - Visit session ID
   * @returns Visit session with checklists and job_summary
   */
  getVisitSession: async (visitSessionId: string): Promise<VisitSession> => {
    const response = await api.get<VisitSession>(`/visit-sessions/${visitSessionId}`);
    return response;
  },

  /**
   * Get visit session by job ID
   * @param jobId - Job ID
   * @returns Visit session for the job (if exists)
   */
  getVisitSessionByJobId: async (jobId: string): Promise<VisitSession | null> => {
    try {
      const response = await api.get<VisitSession>(`/visit-sessions/job/${jobId}`);
      return response;
    } catch (error: any) {
      // If no visit session exists (404), return null
      if (error?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Get presigned audio URL for a visit session
   * @param visitSessionId - Visit session ID
   * @param expiresIn - Expiration time in seconds
   * @returns Presigned audio URL data
   */
  getVisitSessionAudio: async (
    visitSessionId: string,
    expiresIn: number = 3600
  ): Promise<{
    visit_session_id: string;
    audio_file_id: string;
    s3_uri: string;
    format: string;
    presigned_url: string;
    expires_in: number;
    start_timestamp_ms: string;
    end_timestamp_ms: string;
  }> => {
    const response = await api.get<{
      visit_session_id: string;
      audio_file_id: string;
      s3_uri: string;
      format: string;
      presigned_url: string;
      expires_in: number;
      start_timestamp_ms: string;
      end_timestamp_ms: string;
    }>(`/visit-sessions/${visitSessionId}/audio`, {
      params: { expiresIn },
    });
    return response;
  },

  /**
   * Complete a job
   * @param id - Job ID
   * @returns Updated job
   */
  completeJob: async (id: string): Promise<Job> => {
    const response = await api.post<{ job: Job }>(`/jobs/${id}/complete`);
    return response.job;
  },

  /**
   * Get transcription session by ID
   * @param transcriptionSessionId - Transcription session ID
   * @returns Transcription session with visit_sessions and heartbeat info
   */
  getTranscriptionSession: async (
    transcriptionSessionId: string
  ): Promise<{
    visit_sessions: {
      id: string | number;
      job_id: string | number;
    };
    id: string | number;
    visit_session_id: string | number;
    meta_data: any;
    created_at: string;
    updated_at: string;
    starts_at: string | null;
    ends_at: string | null;
    last_heartbeat_at: string | null;
  }> => {
    const response = await api.get<{
      visit_sessions: {
        id: string | number;
        job_id: string | number;
      };
      id: string | number;
      visit_session_id: string | number;
      meta_data: any;
      created_at: string;
      updated_at: string;
      starts_at: string | null;
      ends_at: string | null;
      last_heartbeat_at: string | null;
    }>(`/transcriptions/sessions/${transcriptionSessionId}`);
    return response;
  },

  /**
   * Get per-technician metrics grouped by technician_id
   * @param startDate - Start date in ISO string format
   * @param endDate - End date in ISO string format
   * @returns Per-technician metrics
   */
  getPerTechnicianMetrics: async (
    startDate: string,
    endDate: string
  ): Promise<{ metrics: PerTechnicianMetric[] }> => {
    const response = await api.get<{ metrics: PerTechnicianMetric[] }>('/dashboard/per-technician-metrics', {
      params: { startDate, endDate },
    });
    return response;
  },

  /**
   * Get dashboard summary (job completion, average rating, next up jobs)
   * @param startDate - Start date in ISO string format
   * @param endDate - End date in ISO string format
   * @returns Dashboard summary
   */
  getDashboardSummary: async (
    startDate: string,
    endDate: string
  ): Promise<{ summary: DashboardSummary }> => {
    const response = await api.get<{ summary: DashboardSummary }>('/dashboard/summary', {
      params: { startDate, endDate },
    });
    return response;
  },

  /**
   * Get most checked items frequency
   * @param startDate - Start date in ISO string format
   * @param endDate - End date in ISO string format
   * @returns Checklist item frequency data
   */
  getChecklistItemFrequency: async (
    startDate: string,
    endDate: string
  ): Promise<{ frequency: ChecklistItemFrequency[] }> => {
    const response = await api.get<{ frequency: ChecklistItemFrequency[] }>('/dashboard/checklist-item-frequency', {
      params: { startDate, endDate },
    });
    return response;
  },
};

