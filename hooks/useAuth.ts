import { useContext } from 'react';

import { AuthContext } from '@/providers/AuthProvider';

// Default auth value for when context is not yet available (during initial render)
const defaultAuthValue = {
  user: null,
  status: 'idle' as const,
  error: null,
  login: async () => {},
  logout: () => {},
  isAuthenticated: false,
  accessToken: undefined,
  refreshToken: undefined,
  companyId: undefined,
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  // Return default values if context not yet available (expo-router initial render)
  if (!context) {
    return defaultAuthValue;
  }
  return context;
};

export default useAuth;

