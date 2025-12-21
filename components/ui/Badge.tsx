import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';
export type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps {
  /** Badge text */
  children: React.ReactNode;
  /** Visual variant */
  variant?: BadgeVariant;
  /** Size preset */
  size?: BadgeSize;
  /** Icon name from Ionicons */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Custom style */
  style?: StyleProp<ViewStyle>;
  /** Dot indicator only (no text) */
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  icon,
  style,
  dot = false,
}) => {
  const { colors, isDark } = useTheme();

  const getVariantColors = () => {
    switch (variant) {
      case 'default':
        return {
          background: isDark ? colors.backgroundTertiary : colors.backgroundTertiary,
          text: colors.textSecondary,
          icon: colors.icon,
        };
      case 'success':
        return {
          background: colors.successLight,
          text: colors.success,
          icon: colors.success,
        };
      case 'warning':
        return {
          background: colors.warningLight,
          text: isDark ? colors.warning : '#92400e',
          icon: colors.warning,
        };
      case 'error':
        return {
          background: colors.errorLight,
          text: colors.error,
          icon: colors.error,
        };
      case 'info':
        return {
          background: colors.infoLight,
          text: colors.info,
          icon: colors.info,
        };
      case 'primary':
        return {
          background: colors.primaryLight,
          text: colors.primary,
          icon: colors.primary,
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingVertical: 2,
          paddingHorizontal: Spacing.sm,
          fontSize: FontSizes.xs,
          iconSize: 10,
          dotSize: 6,
        };
      case 'md':
        return {
          paddingVertical: Spacing.xs,
          paddingHorizontal: Spacing.sm,
          fontSize: FontSizes.sm,
          iconSize: 12,
          dotSize: 8,
        };
      case 'lg':
        return {
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          fontSize: FontSizes.md,
          iconSize: 14,
          dotSize: 10,
        };
    }
  };

  const variantColors = getVariantColors();
  const sizeStyles = getSizeStyles();

  if (dot) {
    return (
      <View
        style={[
          styles.dot,
          {
            width: sizeStyles.dotSize,
            height: sizeStyles.dotSize,
            borderRadius: sizeStyles.dotSize / 2,
            backgroundColor: variantColors.text,
          },
          style,
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: variantColors.background,
          paddingVertical: sizeStyles.paddingVertical,
          paddingHorizontal: sizeStyles.paddingHorizontal,
        },
        style,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={sizeStyles.iconSize}
          color={variantColors.icon}
        />
      )}
      <Text
        style={[
          styles.text,
          {
            fontSize: sizeStyles.fontSize,
            color: variantColors.text,
          },
        ]}
      >
        {children}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  text: {
    fontWeight: '600',
  },
  dot: {},
});

export default Badge;
