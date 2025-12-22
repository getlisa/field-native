import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import LoginForm from '@/components/auth/LoginForm';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { credentialService } from '@/services/credentialService';
import { useAuthStore } from '@/store/useAuthStore';

export default function HomeScreen() {
  const { login, logout, status: authStatus, error: authError, isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const hasHydrated = useAuthStore((state) => state._hasHydrated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  const [checkingCredentials, setCheckingCredentials] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Track keyboard height on Android to position form above keyboard
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const keyboardShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });

    const keyboardHideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, []);

  // Check for saved credentials on mount
  useEffect(() => {
    const checkSavedCredentials = async () => {
      try {
        const hasCredentials = await credentialService.hasCredentials();
        setHasSavedCredentials(hasCredentials);
        if (hasCredentials) {
          setRememberMe(true);
        }
      } catch (error) {
        // Ignore errors, just don't show saved credentials option
      } finally {
        setCheckingCredentials(false);
      }
    };

    checkSavedCredentials();
  }, []);

  // Load saved credentials when user taps the banner
  const handleUseSavedCredentials = useCallback(async () => {
    try {
      setAuthLoading(true);
      const credentials = await credentialService.loadCredentials();
      
      if (credentials) {
        setEmail(credentials.email);
        setPassword(credentials.password);
        setRememberMe(true);
      }
    } catch (error) {
      // Failed to load, user can enter manually
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      await login({ email: email.trim(), password });
      
      // Save credentials if remember me is checked and login was successful
      if (rememberMe) {
        await credentialService.saveCredentials(email.trim(), password);
      } else {
        // Clear any previously saved credentials
        await credentialService.clearCredentials();
      }
      // Navigation happens via Redirect below when isAuthenticated becomes true
    } catch {
      // Login failed, don't save credentials
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRememberMeChange = useCallback((value: boolean) => {
    setRememberMe(value);
    if (!value) {
      // Clear credentials if user unchecks remember me
      credentialService.clearCredentials();
      setHasSavedCredentials(false);
    }
  }, []);

  // Show loading while store is hydrating from AsyncStorage
  if (!hasHydrated || checkingCredentials) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </ThemedView>
    );
  }

  // Redirect to jobs tab if already authenticated
  if (isAuthenticated) {
    return <Redirect href="/(tabs)/jobs" />;
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              styles.loginFormContainer,
              Platform.OS === 'android' && keyboardHeight > 0 && { marginBottom: keyboardHeight },
            ]}
        >
          <LoginForm
            email={email}
            password={password}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={handleLogin}
            onLogout={logout}
            status={authStatus === 'authenticated' ? 'Logged in successfully' : null}
            error={authError}
            isAuthenticated={isAuthenticated}
            loading={authLoading}
            rememberMe={rememberMe}
            onRememberMeChange={handleRememberMeChange}
            hasSavedCredentials={hasSavedCredentials}
            onUseSavedCredentials={handleUseSavedCredentials}
          />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loginFormContainer: {
    width: '100%',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
