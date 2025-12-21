import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { Spacing } from '@/constants/theme';

export default function TabLayout() {
  const { colors, shadows } = useTheme();
  const { isAuthenticated } = useAuth();

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
