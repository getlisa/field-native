import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

export type InputSize = 'sm' | 'md' | 'lg';

// Credential type for autofill support
export type CredentialType = 'email' | 'username' | 'password' | 'newPassword' | 'none';

interface InputProps extends TextInputProps {
  /** Label text */
  label?: string;
  /** Helper/hint text */
  hint?: string;
  /** Error message */
  error?: string;
  /** Size preset */
  size?: InputSize;
  /** Left icon name */
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Right icon name */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  /** Right icon press handler */
  onRightIconPress?: () => void;
  /** Container style */
  containerStyle?: StyleProp<ViewStyle>;
  /** Input wrapper style */
  inputContainerStyle?: StyleProp<ViewStyle>;
  /** Credential type for autofill - sets appropriate autoComplete and textContentType */
  credentialType?: CredentialType;
}

/**
 * Get platform-specific autofill props based on credential type.
 * 
 * For iOS Password AutoFill to work properly:
 * - Use textContentType="username" for the login identifier (email/username)
 * - Use textContentType="password" for the password field
 * - These must be in the same view hierarchy
 * 
 * For Android Autofill:
 * - Use autoComplete="username" or "email" for the login identifier
 * - Use autoComplete="password" for the password field
 * - Set importantForAutofill="yes"
 */
const getAutofillProps = (credentialType?: CredentialType): Partial<TextInputProps> => {
  if (!credentialType || credentialType === 'none') {
    return {
      autoComplete: 'off' as const,
      textContentType: 'none' as const,
      importantForAutofill: 'no' as const,
    };
  }

  switch (credentialType) {
    case 'email':
      // For login forms, use 'username' textContentType for better iOS password autofill
      return {
        autoComplete: 'email' as const,
        textContentType: 'username' as const, // iOS recognizes this for password autofill
        keyboardType: 'email-address' as const,
        autoCapitalize: 'none' as const,
        autoCorrect: false,
        importantForAutofill: 'yes' as const,
      };
    case 'username':
      return {
        autoComplete: 'username' as const,
        textContentType: 'username' as const,
        autoCapitalize: 'none' as const,
        autoCorrect: false,
        importantForAutofill: 'yes' as const,
      };
    case 'password':
      return {
        autoComplete: 'current-password' as const, // More specific for login
        textContentType: 'password' as const,
        // secureTextEntry is handled separately for show/hide toggle
        autoCapitalize: 'none' as const,
        autoCorrect: false,
        importantForAutofill: 'yes' as const,
      };
    case 'newPassword':
      return {
        autoComplete: 'new-password' as const,
        textContentType: 'newPassword' as const,
        // secureTextEntry is handled separately for show/hide toggle
        autoCapitalize: 'none' as const,
        autoCorrect: false,
        importantForAutofill: 'yes' as const,
      };
    default:
      return {};
  }
};

export const Input = forwardRef<TextInput, InputProps>(
  (
    {
      label,
      hint,
      error,
      size = 'md',
      leftIcon,
      rightIcon,
      onRightIconPress,
      containerStyle,
      inputContainerStyle,
      editable = true,
      secureTextEntry,
      credentialType,
      style,
      ...props
    },
    ref
  ) => {
    const { colors } = useTheme();
    const [isFocused, setIsFocused] = useState(false);
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);

    // Determine if this is a password field
    const isPassword = secureTextEntry !== undefined || credentialType === 'password' || credentialType === 'newPassword';
    const showPassword = isPassword && isPasswordVisible;

    // Get autofill props if credential type is specified
    const autofillProps = getAutofillProps(credentialType);

    const getSizeStyles = () => {
      switch (size) {
        case 'sm':
          return {
            paddingVertical: Spacing.sm,
            paddingHorizontal: Spacing.md,
            fontSize: FontSizes.sm,
            iconSize: 16,
          };
        case 'md':
          return {
            paddingVertical: Spacing.md,
            paddingHorizontal: Spacing.lg,
            fontSize: FontSizes.base,
            iconSize: 18,
          };
        case 'lg':
          return {
            paddingVertical: Spacing.lg,
            paddingHorizontal: Spacing.lg,
            fontSize: FontSizes.lg,
            iconSize: 20,
          };
      }
    };

    const sizeStyles = getSizeStyles();
    const hasError = !!error;

    const getBorderColor = () => {
      if (hasError) return colors.error;
      if (isFocused) return colors.inputBorderFocus;
      return colors.inputBorder;
    };

    const handleFocus = (e: any) => {
      setIsFocused(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: any) => {
      setIsFocused(false);
      props.onBlur?.(e);
    };

    return (
      <View style={[styles.container, containerStyle]}>
        {label && (
          <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        )}

        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: editable ? colors.inputBackground : colors.backgroundTertiary,
              borderColor: getBorderColor(),
              borderRadius: BorderRadius.lg,
            },
            inputContainerStyle,
          ]}
        >
          {leftIcon && (
            <Ionicons
              name={leftIcon}
              size={sizeStyles.iconSize}
              color={colors.icon}
              style={styles.leftIcon}
            />
          )}

          <TextInput
            ref={ref}
            editable={editable}
            placeholderTextColor={colors.inputPlaceholder}
            onFocus={handleFocus}
            onBlur={handleBlur}
            // Override autofill background on Android
            {...(Platform.OS === 'android' && {
              underlineColorAndroid: 'transparent',
            })}
            style={[
              styles.input,
              {
                paddingVertical: sizeStyles.paddingVertical,
                paddingHorizontal: leftIcon ? 0 : sizeStyles.paddingHorizontal,
                paddingRight: rightIcon || isPassword ? 0 : sizeStyles.paddingHorizontal,
                fontSize: sizeStyles.fontSize,
                color: colors.inputText,
                backgroundColor: 'transparent', // Prevent autofill background color
              },
              style,
            ]}
            // Spread other props first
            {...props}
            // Then apply autofill props (these should not be overridden)
            {...autofillProps}
            // secureTextEntry must come after autofillProps to handle password visibility toggle
            secureTextEntry={isPassword && !showPassword}
          />

          {isPassword && (
            <Pressable
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={styles.rightIconButton}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={sizeStyles.iconSize}
                color={colors.icon}
              />
            </Pressable>
          )}

          {!isPassword && rightIcon && (
            <Pressable
              onPress={onRightIconPress}
              disabled={!onRightIconPress}
              style={styles.rightIconButton}
            >
              <Ionicons
                name={rightIcon}
                size={sizeStyles.iconSize}
                color={colors.icon}
              />
            </Pressable>
          )}
        </View>

        {(hint || error) && (
          <Text
            style={[
              styles.hint,
              { color: hasError ? colors.error : colors.textSecondary },
            ]}
          >
            {error || hint}
          </Text>
        )}
      </View>
    );
  }
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
  },
  label: {
    fontSize: FontSizes.md,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden', // Clip autofill highlight
  },
  input: {
    flex: 1,
  },
  leftIcon: {
    marginLeft: Spacing.md,
    marginRight: Spacing.sm,
  },
  rightIconButton: {
    padding: Spacing.md,
  },
  hint: {
    fontSize: FontSizes.sm,
  },
});

export default Input;
