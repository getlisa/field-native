import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Input } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { Spacing, BorderRadius, FontSizes } from '@/constants/theme';

type Props = {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onLogout?: () => void;
  status?: string | null;
  error?: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  /** Remember me checkbox state */
  rememberMe?: boolean;
  /** Remember me change handler */
  onRememberMeChange?: (value: boolean) => void;
  /** Whether saved credentials are available */
  hasSavedCredentials?: boolean;
  /** Handler to use saved credentials */
  onUseSavedCredentials?: () => void;
};

export const LoginForm: React.FC<Props> = ({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onLogout,
  status,
  error,
  isAuthenticated,
  loading,
  rememberMe = false,
  onRememberMeChange,
  hasSavedCredentials,
  onUseSavedCredentials,
}) => {
  const { colors } = useTheme();

  // Format error message for better UX
  const getErrorMessage = (err: string | null) => {
    if (!err) return null;
    
    const lowerErr = err.toLowerCase();
    
    if (lowerErr.includes('invalid') || lowerErr.includes('wrong') || lowerErr.includes('incorrect')) {
      return 'Invalid email or password. Please try again.';
    }
    if (lowerErr.includes('not found') || lowerErr.includes('no user')) {
      return 'No account found with this email.';
    }
    if (lowerErr.includes('network') || lowerErr.includes('connection')) {
      return 'Connection error. Please check your internet.';
    }
    if (lowerErr.includes('unauthorized') || lowerErr.includes('401')) {
      return 'Invalid email or password. Please try again.';
    }
    
    return err;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Technician Copilot
        </ThemedText>
        <ThemedText
          type="subtitle"
          style={[styles.subtitle, { color: colors.textSecondary }]}
        >
          Sign in to continue
        </ThemedText>
      </View>

      <View style={styles.form}>
        {/* Saved Credentials Banner */}
        {hasSavedCredentials && onUseSavedCredentials && !email && (
          <Pressable
            style={[
              styles.savedCredentialsBanner,
              { backgroundColor: colors.primaryLight, borderColor: colors.tint },
            ]}
            onPress={onUseSavedCredentials}
          >
            <View style={styles.savedCredentialsContent}>
              <Ionicons name="key-outline" size={20} color={colors.tint} />
              <View style={styles.savedCredentialsText}>
                <ThemedText style={[styles.savedCredentialsTitle, { color: colors.tint }]}>
                  Saved Password Available
                </ThemedText>
                <ThemedText style={[styles.savedCredentialsHint, { color: colors.textSecondary }]}>
                  Tap to use your saved credentials
                </ThemedText>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.tint} />
          </Pressable>
        )}

        <Input
          label="Email"
          value={email}
          onChangeText={onEmailChange}
          placeholder="email@example.com"
          credentialType="email"
          leftIcon="mail-outline"
        />

        <Input
          label="Password"
          value={password}
          onChangeText={onPasswordChange}
          placeholder="Enter your password"
          credentialType="password"
          leftIcon="lock-closed-outline"
        />

        {/* Remember Me Checkbox */}
        {onRememberMeChange && (
          <Pressable
            style={styles.rememberMeRow}
            onPress={() => onRememberMeChange(!rememberMe)}
          >
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: rememberMe ? colors.tint : 'transparent',
                  borderColor: rememberMe ? colors.tint : colors.border,
                },
              ]}
            >
              {rememberMe && (
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              )}
            </View>
            <ThemedText style={[styles.rememberMeText, { color: colors.text }]}>
              Remember me
            </ThemedText>
          </Pressable>
        )}

        <View style={styles.buttonRow}>
          <Button
            onPress={onSubmit}
            loading={loading}
            disabled={loading}
            fullWidth={!isAuthenticated || !onLogout}
            icon="log-in-outline"
          >
            Sign In
          </Button>

          {isAuthenticated && onLogout && (
            <Button variant="secondary" onPress={onLogout} icon="log-out-outline">
              Logout
            </Button>
          )}
        </View>

        {status && (
          <ThemedText style={[styles.feedbackText, { color: colors.success }]}>
            {status}
          </ThemedText>
        )}

        {error && (
          <ThemedText style={[styles.feedbackText, { color: colors.error }]}>
            {getErrorMessage(error)}
          </ThemedText>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: Spacing['2xl'],
  },
  header: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  form: {
    gap: Spacing.lg,
  },
  savedCredentialsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  savedCredentialsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  savedCredentialsText: {
    flex: 1,
  },
  savedCredentialsTitle: {
    fontWeight: '600',
    fontSize: FontSizes.md,
  },
  savedCredentialsHint: {
    fontSize: FontSizes.sm,
  },
  rememberMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rememberMeText: {
    fontSize: FontSizes.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  feedbackText: {
    textAlign: 'center',
    fontSize: 14,
  },
});

export default LoginForm;
