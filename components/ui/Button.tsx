import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  /** Button text */
  children: React.ReactNode;
  /** Visual variant */
  variant?: ButtonVariant;
  /** Size preset */
  size?: ButtonSize;
  /** Loading state - shows spinner */
  loading?: boolean;
  /** Icon name from Ionicons */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Icon position */
  iconPosition?: 'left' | 'right';
  /** Full width button */
  fullWidth?: boolean;
  /** Custom style */
  style?: StyleProp<ViewStyle>;
  /** Custom text style */
  textStyle?: StyleProp<TextStyle>;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  style,
  textStyle,
  ...props
}) => {
  const { colors, shadows } = useTheme();

  const isDisabled = disabled || loading;

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: isDisabled ? colors.buttonDisabled : colors.buttonPrimary,
          },
          containerPressed: {
            backgroundColor: colors.buttonPrimaryPressed,
          },
          text: {
            color: colors.textInverse,
          },
          icon: colors.textInverse,
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: isDisabled ? colors.buttonDisabled : colors.buttonSecondary,
            borderWidth: 1,
            borderColor: colors.border,
          },
          containerPressed: {
            backgroundColor: colors.buttonSecondaryPressed,
          },
          text: {
            color: colors.text,
          },
          icon: colors.text,
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: 'transparent',
          },
          containerPressed: {
            backgroundColor: colors.backgroundTertiary,
          },
          text: {
            color: colors.primary,
          },
          icon: colors.primary,
        };
      case 'danger':
        return {
          container: {
            backgroundColor: isDisabled ? colors.buttonDisabled : colors.error,
          },
          containerPressed: {
            backgroundColor: colors.error,
            opacity: 0.9,
          },
          text: {
            color: colors.textInverse,
          },
          icon: colors.textInverse,
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          container: {
            paddingVertical: Spacing.sm,
            paddingHorizontal: Spacing.md,
            borderRadius: BorderRadius.md,
            gap: Spacing.xs,
          },
          text: {
            fontSize: FontSizes.sm,
          },
          iconSize: 14,
        };
      case 'md':
        return {
          container: {
            paddingVertical: Spacing.md,
            paddingHorizontal: Spacing.lg,
            borderRadius: BorderRadius.lg,
            gap: Spacing.sm,
          },
          text: {
            fontSize: FontSizes.base,
          },
          iconSize: 18,
        };
      case 'lg':
        return {
          container: {
            paddingVertical: Spacing.lg,
            paddingHorizontal: Spacing.xl,
            borderRadius: BorderRadius.lg,
            gap: Spacing.sm,
          },
          text: {
            fontSize: FontSizes.lg,
          },
          iconSize: 20,
        };
    }
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  const renderIcon = (position: 'left' | 'right') => {
    if (!icon || iconPosition !== position || loading) return null;
    return (
      <Ionicons
        name={icon}
        size={sizeStyles.iconSize}
        color={variantStyles.icon}
      />
    );
  };

  return (
    <Pressable
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.container,
        sizeStyles.container,
        variantStyles.container,
        pressed && variantStyles.containerPressed,
        variant === 'primary' && !isDisabled && shadows.sm,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyles.text.color} />
      ) : (
        <>
          {renderIcon('left')}
          <Text
            style={[
              styles.text,
              sizeStyles.text,
              variantStyles.text,
              textStyle,
            ]}
          >
            {children}
          </Text>
          {renderIcon('right')}
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.6,
  },
  text: {
    fontWeight: '600',
  },
});

export default Button;
