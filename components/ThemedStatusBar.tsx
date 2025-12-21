import { StatusBar } from 'expo-status-bar';
import React from 'react';

import { useTheme } from '@/contexts/ThemeContext';

/**
 * StatusBar component that responds to the app's theme preference
 * (not the system theme), ensuring status bar icons are always visible
 */
export const ThemedStatusBar: React.FC = () => {
  const { colorScheme } = useTheme();
  
  // In light theme: use dark icons (visible on light background)
  // In dark theme: use light icons (visible on dark background)
  const statusBarStyle = colorScheme === 'dark' ? 'light' : 'dark';
  
  return <StatusBar style={statusBarStyle} />;
};

export default ThemedStatusBar;
