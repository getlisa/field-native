import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import JobsList from '@/components/jobs/JobsList';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { useJobs } from '@/hooks/useJobs';
import type { Job, JobFilterOptions } from '@/services/jobService';
import { Spacing, FontSizes } from '@/constants/theme';

export default function JobsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isAuthenticated, companyId: authedCompanyId, user } = useAuth();
  const { jobs, error, loading, fetchJobs } = useJobs();
  
  // Store current filter state to persist across refreshes
  const [currentFilters, setCurrentFilters] = useState<JobFilterOptions | undefined>(undefined);

  // Initial load
  useEffect(() => {
    if (authedCompanyId) {
      fetchJobs(authedCompanyId, currentFilters);
    }
  }, [authedCompanyId, fetchJobs]);

  // Refetch jobs when navigating back to this tab (e.g., after completing a job)
  useFocusEffect(
    useCallback(() => {
      if (authedCompanyId) {
        fetchJobs(authedCompanyId, currentFilters);
      }
    }, [authedCompanyId, fetchJobs, currentFilters])
  );

  const handleJobPress = useCallback(
    (job: Job) => {
      router.push(`/jobs/${job.id}`);
    },
    [router]
  );

  const handleRefresh = useCallback((filters?: JobFilterOptions) => {
    // Update stored filters if new ones are provided
    if (filters !== undefined) {
      setCurrentFilters(filters);
    }
    
    // Always use current filters (either newly provided or stored)
    const filtersToUse = filters !== undefined ? filters : currentFilters;
    
    if (authedCompanyId) {
      fetchJobs(authedCompanyId, filtersToUse);
    }
  }, [authedCompanyId, fetchJobs, currentFilters]);

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
          <Button variant="secondary" onPress={() => handleRefresh()} icon="refresh-outline">
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
        currentFilters={currentFilters}
        onFiltersChange={setCurrentFilters}
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
