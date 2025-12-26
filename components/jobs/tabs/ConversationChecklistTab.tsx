import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { companyConfigsService, type ChecklistItem } from '@/services/companyConfigsService';
import { jobService, type ChecklistItemData } from '@/services/jobService';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

interface ChecklistDisplayItem {
  id: string;
  label: string;
  description?: string;
  completed: boolean;
  count?: number;
}

export const ConversationChecklistTab: React.FC = () => {
  const { colors } = useTheme();
  const { job, jobId } = useJobDetailContext();

  const isScheduled = job?.status === 'scheduled';
  const isOngoing = job?.status === 'ongoing';
  const isCompleted = job?.status === 'completed';

  // Fetch job data periodically for ongoing jobs to get updated checklist data
  const { data: refreshedJob, isLoading: isLoadingJob } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobService.getJob(jobId!),
    enabled: isOngoing && !!jobId,
    refetchInterval: 10000, // Refetch every 10 seconds for ongoing jobs
  });

  // Use refreshed job data if available, otherwise use context job
  const currentJob = refreshedJob || job;

  // Fetch static checklists for scheduled jobs (and as fallback)
  const { data: companyConfigs, isLoading: isLoadingConfigs } = useQuery({
    queryKey: ['companyConfigs', currentJob?.company_id],
    queryFn: () => companyConfigsService.getCompanyConfigs(currentJob!.company_id),
    enabled: !!currentJob?.company_id,
  });

  // Transform data based on job status - always show checklist items
  const checklistItems: ChecklistDisplayItem[] = React.useMemo(() => {
    // For ongoing and completed jobs, use dynamic checklists from job visit session data
    if ((isOngoing || isCompleted) && currentJob?.visit_sessions?.checklists?.items) {
      return currentJob.visit_sessions.checklists.items.map((item: ChecklistItemData) => ({
        id: item.id,
        label: item.label,
        completed: item.completed,
        count: item.transcription_turn_id?.length || 0,
      }));
    }
    
    // Always fall back to company configs checklists (for scheduled jobs or when visit session data is not available)
    if (companyConfigs?.checklists && companyConfigs.checklists.length > 0) {
      return companyConfigs.checklists.map((item: ChecklistItem, index: number) => ({
        id: `checklist-${index}`,
        label: item.label,
        description: item.description,
        completed: false,
        count: 0,
      }));
    }
    
    // Final fallback: return empty array (should rarely happen if company configs are set up)
    return [];
  }, [isOngoing, isCompleted, currentJob?.visit_sessions?.checklists, companyConfigs]);

  // Calculate completion stats
  const completedCount = checklistItems.filter((item) => item.completed).length;
  const totalCount = checklistItems.length;

  // Get star rating from visit_session_metrics when job is completed
  const starRating = isCompleted && currentJob?.visit_session_metrics?.star_rating 
    ? currentJob.visit_session_metrics.star_rating 
    : null;

  // Render star rating (use metrics star_rating for completed jobs)
  const renderStars = () => {
    if (starRating === null) return null;
    
    const filledStars = Math.round(starRating);
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= filledStars ? 'star' : 'star-outline'}
            size={16}
            color={star <= filledStars ? '#fbbf24' : colors.iconSecondary}
          />
        ))}
        <ThemedText style={[styles.starRatingText, { color: colors.textSecondary }]}>
          ({starRating})
        </ThemedText>
      </View>
    );
  };

  if (isLoadingConfigs || (isOngoing && isLoadingJob)) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading checklist...
        </ThemedText>
      </View>
    );
  }

  // Never show empty state - always show checklist items (even if empty from company configs)
  // This ensures the checklist is always visible for all job statuses

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header with title and rating */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.text} />
          <ThemedText style={styles.headerTitle}>Conversation Checklist</ThemedText>
        </View>
        <View style={styles.headerRight}>
          {isCompleted && starRating !== null ? renderStars() : null}
        </View>
      </View>

      {/* Checklist Items */}
      <View style={styles.checklistContainer}>
        {checklistItems.map((item) => (
          <View
            key={item.id}
            style={[
              styles.checklistItem,
              {
                backgroundColor: colors.cardBackground,
                borderColor: item.completed ? colors.success : colors.border,
              },
            ]}
          >
            <View style={styles.checklistItemLeft}>
              {/* Checkbox/Check icon */}
              <View
                style={[
                  styles.checkbox,
                  item.completed && {
                    backgroundColor: colors.success,
                    borderColor: colors.success,
                  },
                  !item.completed && { borderColor: colors.border },
                ]}
              >
                {item.completed && <Ionicons name="checkmark" size={16} color="#ffffff" />}
              </View>

              {/* Label only - no description */}
              <View style={styles.checklistItemText}>
                <ThemedText
                  style={[
                    styles.checklistLabel,
                    item.completed && { color: colors.textSecondary },
                  ]}
                >
                  {item.label}
                </ThemedText>
              </View>
            </View>

            {/* Count badge (show for all completed items with count > 0) */}
            {item.completed && item.count && item.count > 0 && (
              <View style={[styles.countBadgeContainer, { backgroundColor: colors.backgroundTertiary }]}>
                <ThemedText style={[styles.countBadgeText, { color: colors.textSecondary }]}>
                  {item.count}x
                </ThemedText>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing['4xl'],
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSizes.md,
    marginTop: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSizes.md,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.md,
    marginBottom: Spacing.lg,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  starsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starRatingText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    marginLeft: 2,
  },
  countBadge: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  checklistContainer: {
    gap: Spacing.md,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  checklistItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistItemText: {
    flex: 1,
    gap: Spacing.xs,
  },
  checklistLabel: {
    fontSize: FontSizes.md,
    fontWeight: '500',
  },
  checklistDescription: {
    fontSize: FontSizes.sm,
  },
  countBadgeContainer: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  countBadgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
});

export default ConversationChecklistTab;
