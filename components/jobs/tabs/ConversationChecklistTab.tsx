import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { companyConfigsService, type ChecklistItem } from '@/services/companyConfigsService';
import type { ChecklistItemData } from '@/services/jobService';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

interface ChecklistDisplayItem {
  id: string;
  label: string;
  description?: string;
  completed: boolean;
  count?: number;
}

export const ConversationChecklistTab: React.FC = () => {
  console.log('[ConversationChecklistTab] Rendering');
  const { colors } = useTheme();
  const { job } = useJobDetailContext();

  const isScheduled = job?.status === 'scheduled';
  const isOngoing = job?.status === 'ongoing';
  const isCompleted = job?.status === 'completed';
  console.log('isScheduled && !!job?.company_id', job?.company_id);

  // Fetch static checklists for scheduled jobs
  const { data: companyConfigs, isLoading: isLoadingConfigs } = useQuery({
    queryKey: ['companyConfigs', job?.company_id],
    queryFn: () => companyConfigsService.getCompanyConfigs(job!.company_id),
    enabled: isScheduled && !!job?.company_id,
  });

  // Transform data based on job status
  const checklistItems: ChecklistDisplayItem[] = React.useMemo(() => {
    // For ongoing and completed jobs, use dynamic checklists from job visit session data
    if ((isOngoing || isCompleted) && job?.visit_sessions?.checklists?.items) {
      return job.visit_sessions.checklists.items.map((item: ChecklistItemData) => ({
        id: item.id,
        label: item.label,
        completed: item.completed,
        count: item.transcription_turn_id?.length || 0,
      }));
    } else if (isScheduled && companyConfigs?.checklists) {
      // Use static checklists from company config for scheduled jobs
      return companyConfigs.checklists.map((item: ChecklistItem, index: number) => ({
        id: `checklist-${index}`,
        label: item.label,
        description: item.description,
        completed: false,
        count: 0,
      }));
    }
    return [];
  }, [isOngoing, isCompleted, isScheduled, job?.visit_sessions?.checklists, companyConfigs]);

  // Calculate completion stats
  const completedCount = checklistItems.filter((item) => item.completed).length;
  const totalCount = checklistItems.length;
  const completionPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Render star rating (0-5 stars based on completion)
  const stars = Math.round((completionPercentage / 100) * 5);
  const renderStars = () => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= stars ? 'star' : 'star-outline'}
            size={16}
            color={star <= stars ? '#fbbf24' : colors.iconSecondary}
          />
        ))}
      </View>
    );
  };

  if (isLoadingConfigs) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading checklist...
        </ThemedText>
      </View>
    );
  }

  if (checklistItems.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="checkmark-circle-outline" size={64} color={colors.iconSecondary} />
        <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
          No Checklist Available
        </ThemedText>
        <ThemedText style={[styles.emptyText, { color: colors.textSecondary }]}>
          {isScheduled
            ? 'No checklist configured for this company'
            : isOngoing || isCompleted
            ? 'No checklist data recorded for this visit'
            : 'Checklist will appear once the job is started'}
        </ThemedText>
      </View>
    );
  }

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
          {renderStars()}
          <ThemedText style={[styles.countBadge, { color: colors.textSecondary }]}>
            ({completedCount})
          </ThemedText>
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

            {/* Count badge (only for ongoing jobs with completed items) */}
            {isOngoing && item.completed && item.count && item.count > 0 && (
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
    gap: 2,
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
