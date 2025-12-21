import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, CardBody, Badge } from '@/components/ui';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { credentialService } from '@/services/credentialService';
import { Spacing, BorderRadius, FontSizes } from '@/constants/theme';

type ThemeOption = {
  value: ThemePreference;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { colors, themePreference, setThemePreference, shadows } = useTheme();
  const { logout } = useAuth();
  const { user, loading, error, refetch } = useProfile();

  const handleLogout = async () => {
    // Clear saved credentials on logout
    await credentialService.clearCredentials();
    logout();
    // Navigate to the login page (tabs index)
    router.replace('/(tabs)');
  };

  const getRoleBadgeVariant = (role?: string) => {
    switch (role) {
      case 'admin':
        return 'error';
      case 'service_manager':
        return 'warning';
      case 'technician':
      default:
        return 'primary';
    }
  };

  const formatRole = (role?: string) => {
    if (!role) return 'User';
    return role.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <ThemedText type="title">Profile</ThemedText>
        </View>

        {/* Loading State */}
        {loading && !user && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
            <ThemedText style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading profile...
            </ThemedText>
          </View>
        )}

        {/* Error State */}
        {error && !loading && (
          <Card variant="outlined" style={styles.card}>
            <CardBody>
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
                <ThemedText style={[styles.errorText, { color: colors.error }]}>
                  {error}
                </ThemedText>
                <Button variant="secondary" onPress={refetch} icon="refresh-outline">
                  Try Again
                </Button>
              </View>
            </CardBody>
          </Card>
        )}

        {/* User Profile Card */}
        {user && (
          <Card variant="elevated" style={[styles.card, shadows.md]}>
            <CardBody>
              {/* Avatar & Name Section */}
              <View style={styles.avatarSection}>
                <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                  <ThemedText style={styles.avatarText}>
                    {user.first_name?.[0]?.toUpperCase() || ''}
                    {user.last_name?.[0]?.toUpperCase() || ''}
                  </ThemedText>
                </View>
                <View style={styles.nameContainer}>
                  <ThemedText type="subtitle" style={styles.userName}>
                    {user.first_name} {user.last_name}
                  </ThemedText>
                  <Badge variant={getRoleBadgeVariant(user.role)} size="sm" style={styles.roleBadge}>
                    {formatRole(user.role)}
                  </Badge>
                </View>
              </View>

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              {/* User Details */}
              <View style={styles.detailsSection}>
                <ProfileDetailRow
                  icon="mail-outline"
                  label="Email"
                  value={user.email}
                  colors={colors}
                />
                {user.phone_number && (
                  <ProfileDetailRow
                    icon="call-outline"
                    label="Phone"
                    value={user.phone_number}
                    colors={colors}
                  />
                )}
                {user.job_title && (
                  <ProfileDetailRow
                    icon="briefcase-outline"
                    label="Job Title"
                    value={user.job_title}
                    colors={colors}
                  />
                )}
                {user.address?.formatted_address && (
                  <ProfileDetailRow
                    icon="location-outline"
                    label="Address"
                    value={user.address.formatted_address}
                    colors={colors}
                  />
                )}
              </View>
            </CardBody>
          </Card>
        )}

        {/* Theme Settings Card */}
        <Card variant="elevated" style={[styles.card, shadows.md]}>
          <CardBody>
            <View style={styles.sectionHeader}>
              <Ionicons name="color-palette-outline" size={22} color={colors.text} />
              <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
                Appearance
              </ThemedText>
            </View>

            <View style={styles.themeOptions}>
              {THEME_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor: themePreference === option.value
                        ? colors.primaryLight
                        : colors.backgroundSecondary,
                      borderColor: themePreference === option.value
                        ? colors.tint
                        : colors.border,
                    },
                  ]}
                  onPress={() => setThemePreference(option.value)}
                >
                  <Ionicons
                    name={option.icon}
                    size={24}
                    color={themePreference === option.value ? colors.tint : colors.textSecondary}
                  />
                  <ThemedText
                    style={[
                      styles.themeOptionText,
                      {
                        color: themePreference === option.value
                          ? colors.tint
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {option.label}
                  </ThemedText>
                  {themePreference === option.value && (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.tint}
                      style={styles.checkIcon}
                    />
                  )}
                </Pressable>
              ))}
            </View>
          </CardBody>
        </Card>

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <Button
            variant="danger"
            onPress={handleLogout}
            icon="log-out-outline"
            fullWidth
          >
            Sign Out
          </Button>
        </View>

        {/* App Version */}
        <ThemedText style={[styles.versionText, { color: colors.textTertiary }]}>
          Version 1.0.0
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

// Helper component for profile detail rows
interface ProfileDetailRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: any;
}

const ProfileDetailRow: React.FC<ProfileDetailRowProps> = ({
  icon,
  label,
  value,
  colors,
}) => (
  <View style={styles.detailRow}>
    <View style={[styles.detailIconContainer, { backgroundColor: colors.backgroundSecondary }]}>
      <Ionicons name={icon} size={18} color={colors.icon} />
    </View>
    <View style={styles.detailContent}>
      <ThemedText style={[styles.detailLabel, { color: colors.textTertiary }]}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.detailValue, { color: colors.text }]}>
        {value}
      </ThemedText>
    </View>
  </View>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: Spacing.lg,
    paddingBottom: Spacing['3xl'],
  },
  header: {
    marginBottom: Spacing.xl,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing['3xl'],
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSizes.md,
  },
  errorContainer: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  errorText: {
    fontSize: FontSizes.md,
    textAlign: 'center',
  },
  card: {
    marginBottom: Spacing.lg,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: FontSizes['2xl'],
    fontWeight: '600',
  },
  nameContainer: {
    flex: 1,
    gap: Spacing.xs,
  },
  roleBadge: {
    alignSelf: 'flex-start',
  },
  userName: {
    marginBottom: Spacing.xs,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.lg,
  },
  detailsSection: {
    gap: Spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  detailIconContainer: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: FontSizes.xs,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: FontSizes.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSizes.lg,
  },
  themeOptions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    gap: Spacing.sm,
    position: 'relative',
  },
  themeOptionText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  checkIcon: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
  },
  logoutSection: {
    marginTop: Spacing.lg,
  },
  versionText: {
    textAlign: 'center',
    fontSize: FontSizes.sm,
    marginTop: Spacing.xl,
  },
});
