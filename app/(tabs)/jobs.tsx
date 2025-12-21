import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import JobsList from '@/components/jobs/JobsList';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { useJobs } from '@/hooks/useJobs';
import type { Job } from '@/services/jobService';
import { Spacing, FontSizes } from '@/constants/theme';

export default function JobsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isAuthenticated, companyId: authedCompanyId, user } = useAuth();
  const { jobs, error, loading, fetchJobs } = useJobs();

  useEffect(() => {
    if (authedCompanyId) {
      fetchJobs(authedCompanyId);
    }
  }, [authedCompanyId, fetchJobs]);

  const handleJobPress = useCallback(
    (job: Job) => {
      router.push(`/jobs/${job.id}`);
    },
    [router]
  );

  const handleRefresh = useCallback(() => {
    if (authedCompanyId) {
      fetchJobs(authedCompanyId);
    }
  }, [authedCompanyId, fetchJobs]);

  // Not authenticated state
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centeredContent}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.textTertiary} />
          <ThemedText type="subtitle" style={[styles.messageTitle, { color: colors.text }]}>
            Authentication Required
          </ThemedText>
          <ThemedText style={[styles.messageText, { color: colors.textSecondary }]}>
            Please sign in to view your jobs
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  // Loading state (initial load)
  if (loading && jobs.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <ThemedText type="title">Jobs</ThemedText>
        </View>
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading jobs...
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error && jobs.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <ThemedText type="title">Jobs</ThemedText>
        </View>
        <View style={styles.centeredContent}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <ThemedText type="subtitle" style={[styles.messageTitle, { color: colors.error }]}>
            Failed to load jobs
          </ThemedText>
          <ThemedText style={[styles.messageText, { color: colors.textSecondary }]}>
            {error}
          </ThemedText>
          <Button variant="secondary" onPress={handleRefresh} icon="refresh-outline">
            Try Again
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <JobsList
        onRefresh={handleRefresh}
        onJobPress={handleJobPress}
        jobs={jobs}
        loading={loading}
        error={error}
        currentUser={user}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  messageTitle: {
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  messageText: {
    textAlign: 'center',
    fontSize: FontSizes.md,
    marginBottom: Spacing.md,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: FontSizes.md,
  },
});
