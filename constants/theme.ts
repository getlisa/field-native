/**
 * Comprehensive theme system for light and dark modes.
 * All colors are semantic and organized by purpose.
 */

import { Platform } from 'react-native';

// Brand colors
const brand = {
  primary: '#0a7ea4',
  primaryLight: '#e0f2fe',
  primaryDark: '#075985',
  secondary: '#6366f1',
  secondaryLight: '#e0e7ff',
  secondaryDark: '#4338ca',
};

// Semantic status colors
const status = {
  success: '#10b981',
  successLight: '#d1fae5',
  successDark: '#059669',
  warning: '#f59e0b',
  warningLight: '#fef3c7',
  warningDark: '#d97706',
  error: '#ef4444',
  errorLight: '#fee2e2',
  errorDark: '#dc2626',
  info: '#3b82f6',
  infoLight: '#dbeafe',
  infoDark: '#2563eb',
};

export const Colors = {
  light: {
    // Base
    text: '#111827',
    textSecondary: '#6b7280',
    textTertiary: '#9ca3af',
    textInverse: '#ffffff',
    
    // Backgrounds
    background: '#ffffff',
    backgroundSecondary: '#f9fafb',
    backgroundTertiary: '#f3f4f6',
    backgroundElevated: '#ffffff',
    
    // Borders
    border: '#e5e7eb',
    borderLight: '#f3f4f6',
    borderFocus: brand.primary,
    
    // Brand
    tint: brand.primary,
    brand: brand.primary,
    brandLight: brand.primaryLight,
    primary: brand.primary,
    primaryLight: brand.primaryLight,
    primaryDark: brand.primaryDark,
    
    // Interactive
    buttonPrimary: brand.primary,
    buttonPrimaryPressed: brand.primaryDark,
    buttonSecondary: '#f3f4f6',
    buttonSecondaryPressed: '#e5e7eb',
    buttonDisabled: '#d1d5db',
    
    // Input
    inputBackground: '#ffffff',
    inputBorder: '#d0d5dd',
    inputBorderFocus: brand.primary,
    inputPlaceholder: '#9ca3af',
    inputText: '#111827',
    
    // Card
    cardBackground: '#ffffff',
    cardBorder: '#e5e7eb',
    cardPressed: '#f9fafb',
    cardShadow: 'rgba(0, 0, 0, 0.05)',
    
    // Status
    success: status.success,
    successLight: status.successLight,
    warning: status.warning,
    warningLight: status.warningLight,
    error: status.error,
    errorLight: status.errorLight,
    info: status.info,
    infoLight: status.infoLight,
    
    // Icons
    icon: '#6b7280',
    iconSecondary: '#9ca3af',
    iconActive: brand.primary,
    
    // Tab bar
    tabIconDefault: '#687076',
    tabIconSelected: brand.primary,
    tabBackground: '#f3f4f6',
    tabActiveBackground: '#ffffff',
    
    // Overlay
    overlay: 'rgba(0, 0, 0, 0.5)',
    overlayLight: 'rgba(0, 0, 0, 0.1)',
    
    // Skeleton/Loading
    skeleton: '#e5e7eb',
    skeletonHighlight: '#f3f4f6',
    
    // Chat
    chatBubbleUser: brand.primary,
    chatBubbleAssistant: '#f3f4f6',
    chatBubbleUserText: '#ffffff',
    chatBubbleAssistantText: '#374151',
  },
  dark: {
    // Base
    text: '#f9fafb',
    textSecondary: '#9ca3af',
    textTertiary: '#6b7280',
    textInverse: '#111827',
    
    // Backgrounds
    background: '#111827',
    backgroundSecondary: '#1f2937',
    backgroundTertiary: '#374151',
    backgroundElevated: '#1f2937',
    
    // Borders
    border: '#374151',
    borderLight: '#4b5563',
    borderFocus: '#38bdf8',
    
    // Brand
    tint: '#38bdf8',
    brand: '#38bdf8',
    brandLight: '#0c4a6e',
    primary: '#38bdf8',
    primaryLight: '#0c4a6e',
    primaryDark: '#7dd3fc',
    
    // Interactive
    buttonPrimary: '#0ea5e9',
    buttonPrimaryPressed: '#0284c7',
    buttonSecondary: '#374151',
    buttonSecondaryPressed: '#4b5563',
    buttonDisabled: '#4b5563',
    
    // Input
    inputBackground: '#1f2937',
    inputBorder: '#374151',
    inputBorderFocus: '#38bdf8',
    inputPlaceholder: '#6b7280',
    inputText: '#f9fafb',
    
    // Card
    cardBackground: '#1f2937',
    cardBorder: '#374151',
    cardPressed: '#374151',
    cardShadow: 'rgba(0, 0, 0, 0.3)',
    
    // Status
    success: '#34d399',
    successLight: '#064e3b',
    warning: '#fbbf24',
    warningLight: '#78350f',
    error: '#f87171',
    errorLight: '#7f1d1d',
    info: '#60a5fa',
    infoLight: '#1e3a8a',
    
    // Icons
    icon: '#9ca3af',
    iconSecondary: '#6b7280',
    iconActive: '#38bdf8',
    
    // Tab bar
    tabIconDefault: '#9ca3af',
    tabIconSelected: '#38bdf8',
    tabBackground: '#1f2937',
    tabActiveBackground: '#374151',
    
    // Overlay
    overlay: 'rgba(0, 0, 0, 0.7)',
    overlayLight: 'rgba(0, 0, 0, 0.3)',
    
    // Skeleton/Loading
    skeleton: '#374151',
    skeletonHighlight: '#4b5563',
    
    // Chat
    chatBubbleUser: '#0ea5e9',
    chatBubbleAssistant: '#374151',
    chatBubbleUserText: '#ffffff',
    chatBubbleAssistantText: '#f3f4f6',
  },
};

export type ThemeColors = typeof Colors.light;
export type ColorKey = keyof ThemeColors;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

// Spacing scale (4px base)
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
} as const;

// Border radius scale
export const BorderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  full: 9999,
} as const;

// Font sizes
export const FontSizes = {
  xs: 11,
  sm: 13,
  md: 14,
  base: 15,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 24,
  '4xl': 32,
} as const;

// Shadow style type
export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ShadowPresets {
  sm: ShadowStyle;
  md: ShadowStyle;
  lg: ShadowStyle;
}

// Shadows
export const Shadows: { light: ShadowPresets; dark: ShadowPresets } = {
  light: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
  },
  dark: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 2,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};
