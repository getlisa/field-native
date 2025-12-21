import { api } from '@/lib/apiClient';

/**
 * User Role Type (matches backend)
 */
export type UserRole = 'admin' | 'technician' | 'service_manager';

/**
 * Address Interface (matches backend addressSchema)
 */
export interface Address {
  formatted_address: string;
  country: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  lat?: number;
  lng?: number;
}

/**
 * User Interface (matches backend response)
 */
export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  role: UserRole;
  company_id: number;
  address?: Address | null;
  phone_number?: string;
  created_at: string;
  updated_at: string;
}

/**
 * List Users Query Parameters
 */
export interface ListUsersParams {
  skip?: number;
  limit?: number;
  role?: UserRole;
}

/**
 * List Users Response
 */
export interface ListUsersResponse {
  users: User[];
  pagination: {
    skip: number;
    limit: number;
    total: number;
  };
}

/**
 * Create User Request Interface
 * Matches backend createUserSchema validation
 */
export interface CreateUserRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  job_title?: string;
  role?: UserRole;
  address?: Address;
}

/**
 * Update User Request Interface
 * Matches backend updateUserSchema validation
 */
export interface UpdateUserRequest {
  email?: string;
  password?: string;
  oldPassword?: string; // Required when updating password
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  job_title?: string;
  role?: UserRole;
  address?: Address;
}

/**
 * Users Service
 * Handles all user-related API calls
 */
export const usersService = {
  /**
   * List users with pagination and filters
   * @param params - Query parameters (skip, limit, role)
   * @returns List of users with pagination info
   */
  listUsers: async (params?: ListUsersParams): Promise<ListUsersResponse> => {
    const queryParams: Record<string, string> = {};
    
    if (params?.skip !== undefined) {
      queryParams.skip = params.skip.toString();
    }
    if (params?.limit !== undefined) {
      queryParams.limit = params.limit.toString();
    }
    if (params?.role) {
      queryParams.role = params.role;
    }

    const response = await api.get<ListUsersResponse>('/users', {
      params: queryParams,
    });
    
    return response;
  },

  /**
   * Get single user by ID
   * @param id - User ID
   * @returns User details
   */
  getUser: async (id: string): Promise<User> => {
    const response = await api.get<{ user: User }>(`/users/${id}`);
    return response.user;
  },

  /**
   * Get self user details (Authenticated users)
   * GET /api/users/self
   * @returns Current authenticated user details
   */
  getSelfUser: async (): Promise<User> => {
    const response = await api.get<{ user: User }>('/users/self');
    return response.user;
  },

  /**
   * Get users by role
   * @param role - User role to filter by
   * @param skip - Number of records to skip (pagination)
   * @param limit - Maximum number of records to return
   * @returns List of users with pagination
   */
  getUsersByRole: async (
    role: UserRole,
    skip?: number,
    limit?: number
  ): Promise<ListUsersResponse> => {
    return usersService.listUsers({ role, skip, limit });
  },

  /**
   * Get all technicians
   * @param skip - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns List of technicians with pagination
   */
  getTechnicians: async (skip?: number, limit?: number): Promise<ListUsersResponse> => {
    return usersService.listUsers({ role: 'technician', skip, limit });
  },

  /**
   * Get all admins
   * @param skip - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns List of admins with pagination
   */
  getAdmins: async (skip?: number, limit?: number): Promise<ListUsersResponse> => {
    return usersService.listUsers({ role: 'admin', skip, limit });
  },

  /**
   * Create a new user (Admin only)
   * POST /api/users
   * @param data - User data
   * @returns Created user
   */
  createUser: async (data: CreateUserRequest): Promise<User> => {
    const response = await api.post<{ user: User }>('/users', data);
    return response.user;
  },

  /**
   * Update user by ID (Self user or Admin)
   * PUT /api/users/:id
   * @param id - User ID
   * @param data - User data to update
   * @returns Updated user
   */
  updateUser: async (id: string, data: UpdateUserRequest): Promise<User> => {
    const response = await api.put<{ user: User }>(`/users/${id}`, data);
    return response.user;
  },
};

export default usersService;
