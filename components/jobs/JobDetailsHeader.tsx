import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';
import type { Job } from '@/services/jobService';

import JobStatusBadge from './JobStatusBadge';

interface JobDetailsHeaderProps {
  job: Job;
  onStart?: () => void;
  onComplete?: () => void;
  loading?: boolean;
}

export const JobDetailsHeader: React.FC<JobDetailsHeaderProps> = ({
  job,
  onStart,
  onComplete,
  loading,
}) => {
  const { colors } = useTheme();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card variant="elevated" style={styles.container}>
      <View style={styles.topRow}>
        <ThemedText type="title" style={styles.title} numberOfLines={2}>
          {job.job_target_name || 'Untitled Job'}
        </ThemedText>
        <JobStatusBadge
          status={job.status}
          onStart={onStart}
          onComplete={onComplete}
          loading={loading}
        />
      </View>

      <View style={styles.infoSection}>
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color={colors.icon} />
          <ThemedText
            style={[styles.infoText, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {job.address}
          </ThemedText>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={16} color={colors.icon} />
          <ThemedText style={[styles.infoText, { color: colors.textSecondary }]}>
            {formatDate(job.start_timestamp)}
          </ThemedText>
        </View>

        {job.description && (
          <View style={[styles.descriptionContainer, { borderTopColor: colors.border }]}>
            <ThemedText style={[styles.descriptionLabel, { color: colors.textTertiary }]}>
              Description
            </ThemedText>
            <ThemedText style={[styles.descriptionText, { color: colors.textSecondary }]}>
              {job.description}
            </ThemedText>
          </View>
        )}
      </View>

      {job.visit_session_metrics && (
        <View style={[styles.metricsContainer, { borderTopColor: colors.border }]}>
          <ThemedText style={[styles.metricsTitle, { color: colors.textTertiary }]}>
            Session Metrics
          </ThemedText>
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <ThemedText style={[styles.metricValue, { color: colors.primary }]}>
                {job.visit_session_metrics.star_rating.toFixed(1)}
              </ThemedText>
              <ThemedText style={[styles.metricLabel, { color: colors.textSecondary }]}>
                Rating
              </ThemedText>
            </View>
            <View style={styles.metricItem}>
              <ThemedText style={[styles.metricValue, { color: colors.primary }]}>
                {job.visit_session_metrics.checklist_score_pct.toFixed(0)}%
              </ThemedText>
              <ThemedText style={[styles.metricLabel, { color: colors.textSecondary }]}>
                Checklist
              </ThemedText>
            </View>
            <View style={styles.metricItem}>
              <ThemedText style={[styles.metricValue, { color: colors.primary }]}>
                {job.visit_session_metrics.total_exchanges}
              </ThemedText>
              <ThemedText style={[styles.metricLabel, { color: colors.textSecondary }]}>
                Exchanges
              </ThemedText>
            </View>
          </View>
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.xl,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
  },
  infoSection: {
    gap: Spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: FontSizes.md,
    lineHeight: 20,
  },
  descriptionContainer: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  descriptionLabel: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  descriptionText: {
    fontSize: FontSizes.md,
    lineHeight: 20,
  },
  metricsContainer: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
  },
  metricsTitle: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  metricItem: {
    alignItems: 'center',
  },
  metricValue: {
    fontSize: FontSizes['3xl'],
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
});

export default JobDetailsHeader;
