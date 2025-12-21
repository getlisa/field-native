import { useRouter } from 'expo-router';
import React, { useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import JobsList from '@/components/jobs/JobsList';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/useAuth';
import { useJobs } from '@/hooks/useJobs';
import type { Job } from '@/services/jobService';

export default function JobsPage() {
  const router = useRouter();
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

  if (!isAuthenticated) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
          <ThemedText type="title">Jobs</ThemedText>
          <ThemedText>You must login first.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <JobsList
          onRefresh={() => authedCompanyId && fetchJobs(authedCompanyId)}
          onJobPress={handleJobPress}
          jobs={jobs}
          loading={loading}
          error={error}
          currentUser={user}
        />
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
    padding: 24,
    gap: 12,
  },
});
