import { useCallback, useEffect, useState } from 'react';

import { usersService, type User } from '@/services/usersService';
import { useAuth } from '@/hooks/useAuth';

interface UseProfileReturn {
  /** Current user profile data */
  user: User | null;
  /** Loading state */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refetch user profile */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage the current user's profile
 * Automatically fetches on mount when authenticated
 */
export const useProfile = (): UseProfileReturn => {
  const { isAuthenticated } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!isAuthenticated) {
      setUser(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const userData = await usersService.getSelfUser();
      setUser(userData);
    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to load profile';
      setError(errorMsg);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Fetch profile on mount and when auth state changes
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    user,
    loading,
    error,
    refetch: fetchProfile,
  };
};

export default useProfile;
