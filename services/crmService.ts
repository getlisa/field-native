import { api } from '@/lib/apiClient';

/**
 * Sync Jobs Response Interface
 */
export interface SyncJobsResponse {
  synced: number;
  cursor: Date | null;
}

/**
 * CRM Provider Type (matches backend enum)
 */
export type CrmProvider = 'SERVICETITAN' | 'BUILDOPS' | 'HOUSECALL_PRO' | 'SERVICETRADE';

/**
 * CRM Connection Interface (matches backend response)
 */
export interface CrmConnection {
  id: number;
  companyId: number;
  provider: CrmProvider;
  authType: 'OAUTH2';
  providerConfig: any; // JsonValue - can be any JSON-serializable value
  expiresAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get Connection Response Interface
 */
export interface GetConnectionResponse {
  connection: CrmConnection;
}

/**
 * CRM Service
 * Handles CRM-related API calls
 */
export const crmService = {
  /**
   * Sync all jobs for a company (for admin/service_manager)
   * POST /api/crm/jobs/sync
   * @param companyId - Company ID
   * @returns Sync response with number of synced jobs and cursor
   */
  syncJobs: async (companyId: number): Promise<SyncJobsResponse> => {
    const response = await api.post<SyncJobsResponse>('/crm/jobs/sync', {
      companyId,
    });
    return response;
  },

  /**
   * Sync jobs for a specific technician
   * POST /api/crm/technicians/:technicianId/sync
   * @param technicianId - Technician ID
   * @returns Sync response with number of synced jobs and cursor
   */
  syncTechnicianJobs: async (technicianId: string): Promise<SyncJobsResponse> => {
    const response = await api.post<SyncJobsResponse>(
      `/crm/technicians/${technicianId}/sync`,
      {}
    );
    return response;
  },

  /**
   * Get CRM connection for the current company
   * GET /api/crm/connection
   * @returns Connection details or null if not found (404)
   */
  getConnection: async (): Promise<CrmConnection | null> => {
    try {
      const response = await api.get<GetConnectionResponse>('/crm/connection');
      return response.connection;
    } catch (error: any) {
      // If 404, return null (no connection found)
      if (error?.status === 404) {
        return null;
      }
      // Re-throw other errors
      throw error;
    }
  },
};
