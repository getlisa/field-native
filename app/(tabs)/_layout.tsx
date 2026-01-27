import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback } from 'react';
import { Platform, StyleSheet, BackHandler } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { Spacing } from '@/constants/theme';

export default function TabLayout() {
  const { colors, shadows } = useTheme();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigation();

  // Handle Android back button properly to prevent "addViewAt: failed to insert view" error
  // This error occurs when React Navigation tries to unmount views while React Native Fabric
  // is trying to mount new ones, typically when navigation state becomes inconsistent
  // Solution: Since we're in the tab layout and all tabs are root screens,
  // just exit the app when back is pressed to prevent view mounting conflicts
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        // iOS doesn't have hardware back button, no handler needed
        return;
      }

      if (__DEV__) {
        console.log('=== TabLayout focused ===');
        console.log('pathname:', pathname);
        console.log('canGoBack:', navigation.canGoBack());
        console.log('isAuthenticated:', isAuthenticated);
      }

      const backAction = () => {
        if (__DEV__) {
          console.log('=== BACK BUTTON PRESSED ===');
          console.log('canGoBack:', navigation.canGoBack());
          console.log('current pathname:', pathname);
        }

        // If we can go back (e.g., from a nested screen), let React Navigation handle it
        if (navigation.canGoBack()) {
          if (__DEV__) {
            console.log('Can go back - letting React Navigation handle it');
          }
          navigation.goBack();
          return true; // Prevent default behavior (we handled it)
        }

        // Check if we're on a root tab screen
        // Pathnames in Expo Router tabs appear as /jobs, /profile, etc. (without the (tabs) group)
        const isRootTab = pathname === '/jobs' || 
                          pathname === '/profile' || 
                          pathname === '/' ||
                          pathname === '/index' ||
                          pathname === '/(tabs)/jobs' || 
                          pathname === '/(tabs)/profile' || 
                          pathname === '/(tabs)' || 
                          pathname === '/(tabs)/' ||
                          pathname === '/(tabs)/index';
        
        if (__DEV__) {
          console.log('isRootTab:', isRootTab);
        }

        if (isRootTab) {
          // On root tab screen, exit app to prevent mounting error
          // This prevents the "addViewAt: failed to insert view" error
          if (__DEV__) {
            console.log('On root tab - exiting app to prevent mounting error');
          }
          BackHandler.exitApp();
          return true; // Prevent default (we handled it)
        }

        // Not on root tab and can't go back - let default behavior happen
        if (__DEV__) {
          console.log('Not on root tab and can\'t go back - allowing default behavior');
        }
        return false; // Allow default behavior
      };

      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        backAction
      );

      // Cleanup function
      return () => {
        if (__DEV__) {
          console.log('=== TabLayout cleanup ===');
        }
        backHandler.remove();
      };
    }, [navigation, pathname, isAuthenticated])
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarHideOnKeyboard: true,
        tabBarStyle: isAuthenticated
          ? [
              styles.tabBar,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.border,
                ...(Platform.OS === 'ios' ? shadows.md : { elevation: 8 }),
              },
            ]
          : { display: 'none', height: 0 },
        headerShown: false,
        tabBarButton: isAuthenticated ? HapticTab : () => null,
        tabBarShowLabel: isAuthenticated,
        tabBarLabelStyle: styles.tabBarLabel,
      }}>
      {/* Login screen - hidden from tab bar, only shown when not authenticated */}
      <Tabs.Screen
        name="index"
        options={{
          href: isAuthenticated ? null : '/', // Hide from tab bar when authenticated
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      
      {/* Jobs tab - main screen for authenticated users */}
      <Tabs.Screen
        name="jobs"
        options={{
          href: isAuthenticated ? '/(tabs)/jobs' : null, // Hide from tab bar when not authenticated
          title: 'Jobs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase" size={size} color={color} />
          ),
        }}
      />
      
      {/* Profile tab */}
      <Tabs.Screen
        name="profile"
        options={{
          href: isAuthenticated ? '/(tabs)/profile' : null, // Hide from tab bar when not authenticated
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.select({ ios: 96, android: 72 }),
    paddingBottom: Platform.select({ ios: Spacing['2xl'], android: Spacing.lg }),
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
