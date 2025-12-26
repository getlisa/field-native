import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, View, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { Spacing, FontSizes } from '@/constants/theme';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import type { JobSummaryData, VisitSessionMetrics } from '@/services/jobService';

interface InsightCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  children: React.ReactNode;
  backgroundColor?: string;
}

const InsightCard: React.FC<InsightCardProps> = ({ 
  icon, 
  iconColor, 
  title, 
  children,
  backgroundColor 
}) => {
  const { colors } = useTheme();
  
  return (
    <View style={[styles.card, { backgroundColor: backgroundColor || colors.backgroundSecondary, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Ionicons name={icon} size={16} color={iconColor} />
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            {title}
          </ThemedText>
        </View>
      </View>
      <View style={styles.cardContent}>
        {children}
      </View>
    </View>
  );
};

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, sublabel }) => {
  const { colors } = useTheme();
  
  return (
    <View style={[styles.metricCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <ThemedText 
        style={[styles.metricValue, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </ThemedText>
      <ThemedText 
        style={[styles.metricLabel, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
      {sublabel && (
        <ThemedText 
          style={[styles.metricSublabel, { color: colors.textTertiary }]}
          numberOfLines={1}
        >
          {sublabel}
        </ThemedText>
      )}
    </View>
  );
};

interface KeyMomentProps {
  step: string;
  turnNumber: string;
  speaker: string;
  timestamp: string;
  mentionCount: string;
  excerpt: string;
  turnText?: string;
  onPress?: () => void;
}

const KeyMoment: React.FC<KeyMomentProps> = ({
  step,
  turnNumber,
  speaker,
  timestamp,
  mentionCount,
  excerpt,
  turnText,
  onPress,
}) => {
  const { colors } = useTheme();
  
  return (
    <Pressable 
      style={styles.keyMomentContainer}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.timelineConnector}>
        <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
        <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />
      </View>
      <View style={styles.keyMomentContent}>
        <View style={styles.keyMomentHeader}>
          <View style={styles.keyMomentTitleRow}>
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            <ThemedText style={[styles.keyMomentTitle, { color: colors.text }]}>
              {step}
            </ThemedText>
          </View>
          <View style={[styles.stepBadge, { backgroundColor: colors.backgroundTertiary }]}>
            <ThemedText style={[styles.stepBadgeText, { color: colors.textSecondary }]}>
              {turnNumber}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.keyMomentExcerpt, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.excerptHeader}>
            <ThemedText style={[styles.excerptSpeaker, { color: colors.textSecondary }]}>
              {speaker}
            </ThemedText>
            <ThemedText style={[styles.excerptTimestamp, { color: colors.textTertiary }]}>
              {timestamp}
            </ThemedText>
            <View style={[styles.mentionBadge, { backgroundColor: colors.primary + '15' }]}>
              <ThemedText style={[styles.mentionText, { color: colors.primary }]}>
                {mentionCount}
              </ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.excerptText, { color: colors.text }]}>
            {turnText || excerpt}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
};

export const InsightsTab: React.FC = () => {
  const { colors } = useTheme();
  const context = useJobDetailContext();
  const { job, jobStatus, turns, transcriptionScrollRef } = context;
  const setActiveTab = (context as any).setActiveTab as ((tab: 'transcription' | 'askAI' | 'checklist' | 'insights') => void) | undefined;

  const isCompleted = jobStatus === 'completed';
  const visitSession = job?.visit_sessions;
  const metrics = job?.visit_session_metrics;

  // Parse job_summary from JSON string
  const jobSummary = useMemo<JobSummaryData | null>(() => {
    if (!visitSession?.job_summary) return null;
    try {
      return JSON.parse(visitSession.job_summary);
    } catch (err) {
      console.error('[InsightsTab] Error parsing job_summary:', err);
      return null;
    }
  }, [visitSession?.job_summary]);

  // Parse meta_data for checklist information
  const checklistData = useMemo(() => {
    if (!visitSession?.checklists) return null;
    return visitSession.checklists;
  }, [visitSession?.checklists]);

  // Format talk ratio percentage
  const formatTalkRatio = (ratioPct: number | undefined, speaker: 'technician' | 'customer') => {
    if (ratioPct === undefined) return '0%';
    const percentage = speaker === 'technician' ? ratioPct : (100 - ratioPct);
    return `${Math.round(percentage)}%`;
  };

  // Format talk time in minutes and seconds
  const formatTalkTime = (seconds: number | undefined) => {
    if (!seconds) return '0m 0s';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  // Calculate word counts from dialogueTurns if not available in metrics
  const wordCounts = useMemo(() => {
    const technicianWords = turns
      .filter(turn => turn.speaker === 'Technician')
      .reduce((total, turn) => total + turn.text.split(/\s+/).filter(word => word.length > 0).length, 0);
    
    const customerWords = turns
      .filter(turn => turn.speaker === 'Customer')
      .reduce((total, turn) => total + turn.text.split(/\s+/).filter(word => word.length > 0).length, 0);
    
    return { technicianWords, customerWords };
  }, [turns]);

  if (!isCompleted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
        <View style={styles.placeholderContainer}>
          <Ionicons name="bulb-outline" size={64} color={colors.iconSecondary} />
          <ThemedText style={[styles.placeholderTitle, { color: colors.text }]}>
            Insights Pending
          </ThemedText>
          <ThemedText style={[styles.placeholderText, { color: colors.textSecondary }]}>
            AI-powered insights and recommendations will be available once the job is completed
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  if (!jobSummary && !metrics && !checklistData) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
        <View style={styles.placeholderContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <ThemedText style={[styles.placeholderText, { color: colors.textSecondary, marginTop: Spacing.md }]}>
            Loading insights...
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Metrics Overview */}
        {metrics && (
          <View style={styles.metricsSection}>
            <View style={styles.metricsGrid}>
              <MetricCard
                label="Talk Ratio"
                value={formatTalkRatio(metrics.technician_talk_ratio_pct, 'technician')}
                sublabel="Technician"
              />
              <MetricCard
                label="Rep Talk Time"
                value={formatTalkTime(metrics.technician_talk_time_sec)}
                sublabel="Actual"
              />
              <MetricCard
                label="Interactivity"
                value={metrics.total_exchanges?.toString() || '0'}
                sublabel="Total Exchanges"
              />
              <MetricCard
                label="Talk Speed"
                value={metrics.talk_speed_wpm?.toString() || '0'}
                sublabel="Words/min"
              />
            </View>
          </View>
        )}

        {/* Speaker Breakdown */}
        {metrics && (
          <InsightCard
            icon="people-outline"
            iconColor={colors.primary}
            title="Conversation Breakdown"
          >
            <View style={styles.speakerRow}>
              <View style={styles.speakerInfo}>
                <Ionicons name="person" size={16} color={colors.primary} />
                <ThemedText style={[styles.speakerName, { color: colors.text }]}>Technician</ThemedText>
              </View>
              <View style={styles.speakerStats}>
                <ThemedText style={[styles.speakerPercentage, { color: colors.text }]}>
                  {formatTalkRatio(metrics.technician_talk_ratio_pct, 'technician')}
                </ThemedText>
                <ThemedText style={[styles.speakerTime, { color: colors.textSecondary }]}>
                  ~{formatTalkTime(metrics.technician_talk_time_sec)}
                </ThemedText>
              </View>
            </View>
            <View style={[styles.progressBar, { backgroundColor: colors.backgroundTertiary }]}>
              <View 
                style={[
                  styles.progressFill, 
                  { 
                    backgroundColor: colors.primary + '40',
                    width: `${metrics.technician_talk_ratio_pct || 0}%` 
                  }
                ]} 
              />
            </View>
            <ThemedText style={[styles.speakerWords, { color: colors.textSecondary }]}>
              {metrics.meta_data?.technician_word_count || wordCounts.technicianWords} words
            </ThemedText>

            <View style={[styles.speakerRow, { marginTop: Spacing.md }]}>
              <View style={styles.speakerInfo}>
                <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                <ThemedText style={[styles.speakerName, { color: colors.text }]}>Customer</ThemedText>
              </View>
              <View style={styles.speakerStats}>
                <ThemedText style={[styles.speakerPercentage, { color: colors.text }]}>
                  {formatTalkRatio(metrics.technician_talk_ratio_pct, 'customer')}
                </ThemedText>
                <ThemedText style={[styles.speakerTime, { color: colors.textSecondary }]}>
                  ~{formatTalkTime(metrics.customer_talk_time_sec)}
                </ThemedText>
              </View>
            </View>
            <View style={[styles.progressBar, { backgroundColor: colors.backgroundTertiary }]}>
              <View 
                style={[
                  styles.progressFill, 
                  { 
                    backgroundColor: colors.textSecondary + '50',
                    width: `${100 - (metrics.technician_talk_ratio_pct || 0)}%` 
                  }
                ]} 
              />
            </View>
            <ThemedText style={[styles.speakerWords, { color: colors.textSecondary }]}>
              {metrics.meta_data?.customer_word_count || wordCounts.customerWords} words
            </ThemedText>

            {metrics.meta_data?.longest_technician_monologue_sec && (
              <View style={[styles.insightTip, { backgroundColor: colors.warning + '15', marginTop: Spacing.md }]}>
                <Ionicons name="information-circle" size={14} color={colors.warning} />
                <ThemedText style={[styles.insightTipText, { color: colors.text }]}>
                  Good listening! Make sure to explain findings clearly.
                </ThemedText>
              </View>
            )}
          </InsightCard>
        )}

        {/* Key Moments Timeline */}
        {checklistData && checklistData.items && checklistData.items.length > 0 && (() => {
          // Filter to only show items that were mentioned at least once
          const mentionedItems = checklistData.items.filter(item => {
            const turnIds = item.transcription_turn_id || [];
            return turnIds.length > 0;
          });

          if (mentionedItems.length === 0) return null;

          return (
            <InsightCard
              icon="list-outline"
              iconColor={colors.primary}
              title="Key Moments"
            >
              <View style={styles.keyMomentsTimeline}>
                {mentionedItems.map((item, index) => {
                  const turnIds = item.transcription_turn_id || [];
                  const firstTurnId = turnIds[0];
                  const mentionCount = turnIds.length;
                  
                  // Find the turn details from the turns array
                  // transcription_turn_id is a number, so convert if needed
                  const turnIdNum = typeof firstTurnId === 'string' ? parseInt(firstTurnId, 10) : firstTurnId;
                  const turn = firstTurnId ? turns.find(t => t.turn_id === turnIdNum || t.id === firstTurnId || String(t.id) === String(firstTurnId)) : null;
                  const turnText = turn?.text || item.label;
                  const turnSpeaker = turn?.speaker || 'Technician';
                  const turnTimestamp = turn?.timestamp 
                    ? turn.timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : 'N/A';
                  
                  const handlePress = () => {
                    if (firstTurnId && setActiveTab && transcriptionScrollRef?.current) {
                      // Navigate to transcription tab
                      setActiveTab('transcription');
                      // Scroll to the turn after a small delay to ensure tab is rendered
                      setTimeout(() => {
                        const scrollToTurnId = (transcriptionScrollRef.current as any)?.scrollToTurnId;
                        if (scrollToTurnId) {
                          scrollToTurnId(firstTurnId);
                        }
                      }, 300);
                    }
                  };
                  
                  return (
                    <KeyMoment
                      key={item.id}
                      step={item.label}
                      turnNumber={`Step ${index + 1}`}
                      speaker={turnSpeaker}
                      timestamp={turnTimestamp}
                      mentionCount={`Mentioned ${mentionCount}x`}
                      excerpt={item.label}
                      turnText={turnText}
                      onPress={firstTurnId ? handlePress : undefined}
                    />
                  );
                })}
              </View>
            </InsightCard>
          );
        })()}

        {/* Job Summary */}
        {jobSummary?.summary && (
          <InsightCard
            icon="document-text-outline"
            iconColor={colors.text}
            title="Job Summary"
          >
            <ThemedText style={[styles.summaryText, { color: colors.text }]}>
              {jobSummary.summary}
            </ThemedText>
          </InsightCard>
        )}

        {/* Positive Highlights */}
        {jobSummary?.positivePoints && jobSummary.positivePoints.length > 0 && (
          <InsightCard
            icon="checkmark-circle-outline"
            iconColor={colors.success}
            title="Positive Highlights"
          >
            {jobSummary.positivePoints.map((point, idx) => (
              <View key={idx} style={styles.listItem}>
                <ThemedText style={[styles.listItemBullet, { color: colors.success }]}>✓</ThemedText>
                <ThemedText style={[styles.listItemText, { color: colors.text }]}>
                  {point}
                </ThemedText>
              </View>
            ))}
          </InsightCard>
        )}

        {/* Areas for Improvement */}
        {jobSummary?.improvementPoints && jobSummary.improvementPoints.length > 0 && (
          <InsightCard
            icon="alert-circle-outline"
            iconColor={colors.warning}
            title="Areas for Improvement"
          >
            {jobSummary.improvementPoints.map((point, idx) => (
              <View key={idx} style={styles.listItem}>
                <ThemedText style={[styles.listItemBullet, { color: colors.warning }]}>→</ThemedText>
                <ThemedText style={[styles.listItemText, { color: colors.text }]}>
                  {point}
                </ThemedText>
              </View>
            ))}
          </InsightCard>
        )}

        {/* Opportunities & Options */}
        {jobSummary?.upsellingOpportunities && jobSummary.upsellingOpportunities.length > 0 && (
          <InsightCard
            icon="bulb-outline"
            iconColor={colors.info}
            title="Opportunities & Options"
          >
            {jobSummary.upsellingOpportunities.map((opportunity, idx) => (
              <View key={idx} style={styles.listItem}>
                <ThemedText style={[styles.listItemBullet, { color: colors.info }]}>💡</ThemedText>
                <ThemedText style={[styles.listItemText, { color: colors.text }]}>
                  {opportunity}
                </ThemedText>
              </View>
            ))}
          </InsightCard>
        )}

        {/* Follow-ups & Actions */}
        {jobSummary?.followUpActions && jobSummary.followUpActions.length > 0 && (
          <InsightCard
            icon="checkbox-outline"
            iconColor={colors.success}
            title="Follow-ups & Actions"
          >
            {jobSummary.followUpActions.map((action, idx) => (
              <View key={idx} style={styles.listItem}>
                <View style={[styles.checkbox, { borderColor: colors.border }]} />
                <ThemedText style={[styles.listItemText, { color: colors.text }]}>
                  {action}
                </ThemedText>
              </View>
            ))}
          </InsightCard>
        )}

        {/* Overall Assessment */}
        {jobSummary?.overallAssessment && (
          <InsightCard
            icon="star-outline"
            iconColor="#9333ea"
            title="Overall Assessment"
          >
            <ThemedText style={[styles.summaryText, { color: colors.text }]}>
              {jobSummary.overallAssessment}
            </ThemedText>
          </InsightCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing['2xl'],
    gap: Spacing.md,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  placeholderTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  placeholderText: {
    fontSize: FontSizes.md,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  metricsSection: {
    marginBottom: Spacing.lg,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  metricCard: {
    width: '48%',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
    textAlign: 'center',
  },
  metricSublabel: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.sm,
    marginTop: 0,
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  cardTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  cardContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  summaryText: {
    fontSize: FontSizes.sm,
    lineHeight: 20,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  listItemBullet: {
    fontSize: FontSizes.md,
    marginTop: 1,
  },
  listItemText: {
    flex: 1,
    fontSize: FontSizes.sm,
    lineHeight: 20,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 2,
    marginTop: 2,
  },
  speakerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  speakerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  speakerName: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  speakerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  speakerPercentage: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  speakerTime: {
    fontSize: FontSizes.xs,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: Spacing.xs,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  speakerWords: {
    fontSize: FontSizes.xs,
    marginBottom: Spacing.xs,
  },
  insightTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: 8,
  },
  insightTipText: {
    flex: 1,
    fontSize: FontSizes.xs,
    lineHeight: 16,
  },
  keyMomentsTimeline: {
    gap: 0,
  },
  keyMomentContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  timelineConnector: {
    alignItems: 'center',
    width: 20,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    marginTop: 4,
    marginBottom: 4,
  },
  keyMomentContent: {
    flex: 1,
    marginBottom: Spacing.md,
  },
  keyMomentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  keyMomentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
  },
  keyMomentTitle: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  stepBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
  },
  stepBadgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  keyMomentExcerpt: {
    padding: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
  },
  excerptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  excerptSpeaker: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  excerptTimestamp: {
    fontSize: FontSizes.xs,
  },
  mentionBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 'auto',
  },
  mentionText: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  excerptText: {
    fontSize: FontSizes.sm,
    lineHeight: 18,
  },
});

export default InsightsTab;
