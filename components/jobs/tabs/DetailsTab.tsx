import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

export const DetailsTab: React.FC = () => {
  const { job, isJobAssignedToCurrentUser } = useJobDetailContext();
  const { colors } = useTheme();

  if (!job) return null;

  return (
    <View style={styles.container}>
      {!isJobAssignedToCurrentUser && (
        <View
          style={[
            styles.assignmentBanner,
            {
              backgroundColor: colors.warningLight,
              borderLeftColor: colors.warning,
            },
          ]}
        >
          <Ionicons name="information-circle" size={20} color={colors.warning} />
          <ThemedText style={[styles.assignmentText, { color: colors.warning }]}>
            You are not assigned to this job. Only view mode is available.
          </ThemedText>
        </View>
      )}

      {job.visit_sessions && (
        <Card>
          <ThemedText style={styles.sectionTitle}>Visit Session</ThemedText>
          <View style={styles.sessionCard}>
            <View style={styles.sessionRow}>
              <ThemedText style={[styles.sessionLabel, { color: colors.textSecondary }]}>
                Session ID
              </ThemedText>
              <ThemedText style={styles.sessionValue}>{job.visit_sessions.id}</ThemedText>
            </View>
            <View style={styles.sessionRow}>
              <ThemedText style={[styles.sessionLabel, { color: colors.textSecondary }]}>
                Status
              </ThemedText>
              <ThemedText style={styles.sessionValue}>{job.visit_sessions.status}</ThemedText>
            </View>
            <View style={styles.sessionRow}>
              <ThemedText style={[styles.sessionLabel, { color: colors.textSecondary }]}>
                Started
              </ThemedText>
              <ThemedText style={styles.sessionValue}>
                {new Date(job.visit_sessions.start_time).toLocaleString()}
              </ThemedText>
            </View>
          </View>
        </Card>
      )}

      {!job.visit_sessions && job.status === 'scheduled' && (
        <View style={styles.emptyDetails}>
          <Ionicons name="calendar-outline" size={48} color={colors.iconSecondary} />
          <ThemedText style={[styles.emptyTitle, { color: colors.textSecondary }]}>
            Job Scheduled
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.textTertiary }]}>
            {isJobAssignedToCurrentUser
              ? 'Start the job to begin tracking and transcription'
              : 'This job is assigned to another technician'}
          </ThemedText>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: Spacing.lg,
  },
  assignmentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 3,
  },
  assignmentText: {
    flex: 1,
    fontSize: FontSizes.sm,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  sessionCard: {
    gap: Spacing.md,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionLabel: {
    fontSize: FontSizes.sm,
  },
  sessionValue: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  emptyDetails: {
    alignItems: 'center',
    paddingVertical: Spacing['5xl'],
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
});

export default DetailsTab;
