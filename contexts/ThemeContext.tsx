import React, { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import {
  Colors,
  Spacing,
  BorderRadius,
  FontSizes,
  Shadows,
  type ThemeColors,
  type ColorKey,
  type ShadowPresets,
} from '@/constants/theme';
import { useThemeStore, type ThemePreference } from '@/store/useThemeStore';

export type ColorScheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Current color scheme (resolved) */
  colorScheme: ColorScheme;
  /** User's theme preference (light/dark/system) */
  themePreference: ThemePreference;
  /** Whether dark mode is active */
  isDark: boolean;
  /** All theme colors for current scheme */
  colors: ThemeColors;
  /** Get a specific color by key */
  getColor: (key: ColorKey) => string;
  /** Spacing scale */
  spacing: typeof Spacing;
  /** Border radius scale */
  borderRadius: typeof BorderRadius;
  /** Font sizes */
  fontSizes: typeof FontSizes;
  /** Shadows for current scheme */
  shadows: ShadowPresets;
  /** Set theme preference */
  setThemePreference: (preference: ThemePreference) => void;
  /** Toggle between light and dark (ignores system) */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  /** Force a specific color scheme (useful for testing) */
  forcedColorScheme?: ColorScheme;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  forcedColorScheme,
}) => {
  const systemColorScheme = useSystemColorScheme();
  const { themePreference, setThemePreference } = useThemeStore();
  
  // Resolve the actual color scheme based on preference
  const resolvedColorScheme: ColorScheme = useMemo(() => {
    if (forcedColorScheme) return forcedColorScheme;
    if (themePreference === 'system') {
      return systemColorScheme ?? 'light';
    }
    return themePreference;
  }, [forcedColorScheme, themePreference, systemColorScheme]);

  const isDark = resolvedColorScheme === 'dark';

  const toggleTheme = useCallback(() => {
    // Toggle between light and dark, ignoring system preference
    const newTheme = resolvedColorScheme === 'dark' ? 'light' : 'dark';
    setThemePreference(newTheme);
  }, [resolvedColorScheme, setThemePreference]);

  const value = useMemo<ThemeContextValue>(() => {
    const colors = Colors[resolvedColorScheme];
    const shadows = Shadows[resolvedColorScheme];

    return {
      colorScheme: resolvedColorScheme,
      themePreference,
      isDark,
      colors,
      getColor: (key: ColorKey) => colors[key],
      spacing: Spacing,
      borderRadius: BorderRadius,
      fontSizes: FontSizes,
      shadows,
      setThemePreference,
      toggleTheme,
    };
  }, [resolvedColorScheme, themePreference, isDark, setThemePreference, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook to access theme values
 * @example
 * const { colors, isDark, spacing, setThemePreference } = useTheme();
 * <View style={{ backgroundColor: colors.background, padding: spacing.md }} />
 */
export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/**
 * Hook to get a single color value
 * @example
 * const backgroundColor = useThemeColor('background');
 */
export const useThemeColor = (
  colorKey: ColorKey,
  overrides?: { light?: string; dark?: string }
): string => {
  const { colorScheme, colors } = useTheme();
  
  if (overrides) {
    const override = overrides[colorScheme];
    if (override) return override;
  }
  
  return colors[colorKey];
};

/**
 * Hook to create theme-aware styles
 * @example
 * const styles = useThemedStyles((colors, theme) => ({
 *   container: { backgroundColor: colors.background }
 * }));
 */
export function useThemedStyles<T>(
  styleFactory: (colors: ThemeColors, theme: ThemeContextValue) => T
): T {
  const theme = useTheme();
  return useMemo(() => styleFactory(theme.colors, theme), [styleFactory, theme]);
}

export { type ThemePreference };
export default ThemeContext;
