import { api } from '@/lib/apiClient';

/**
 * Checklist Item Interface
 */
export interface ChecklistItem {
  label: string;
  description: string;
}

/**
 * Company Configs Interface (matches backend response)
 */
export interface CompanyConfigs {
  id: number;
  company_id: number;
  checklists: ChecklistItem[];
  updated_at: string;
}

/**
 * Get Company Configs Response
 */
export interface GetCompanyConfigsResponse {
  configs: CompanyConfigs;
}

/**
 * Update Company Configs Request
 */
export interface UpdateCompanyConfigsRequest {
  checklists: ChecklistItem[];
}

/**
 * Company Configs Service
 * Handles all company configuration-related API calls
 */
export const companyConfigsService = {
  /**
   * Get company configs by company ID
   * GET /api/configs/:companyId
   * @param companyId - Company ID
   * @returns Company configs
   */
  getCompanyConfigs: async (companyId: number): Promise<CompanyConfigs> => {
    const response = await api.get<GetCompanyConfigsResponse>(`/configs/${companyId}`);
    console.log('[getCompanyConfigs] Response:', response);
    return response.configs;
  },

  /**
   * Update company configs by company ID
   * PUT /api/configs/:companyId
   * @param companyId - Company ID
   * @param data - Config data to update
   * @returns Updated company configs
   */
  updateCompanyConfigs: async (
    companyId: number,
    data: UpdateCompanyConfigsRequest
  ): Promise<CompanyConfigs> => {
    const response = await api.put<GetCompanyConfigsResponse>(`/configs/${companyId}`, data);
    return response.configs;
  },
};

export default companyConfigsService;
