import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThinkingStep } from '@/components/chat/types';

interface ThinkingTraceProps {
  steps: ThinkingStep[];
  /** True while the estimate is still running (shows a live spinner in the header). */
  active?: boolean;
  /** Seconds the estimate took (shown in the collapsed header once finished). */
  durationSeconds?: number;
}

/**
 * Collapsible "thinking" dropdown for the Estimate Cost flow. Collapsed by default —
 * the header summarizes ("Thinking…" / "Thought for Ns"); expanding reveals the
 * intermediate workflow steps (identify → build_quote / ask_questions) with status.
 */
export const ThinkingTrace: React.FC<ThinkingTraceProps> = ({ steps, active = false, durationSeconds }) => {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  if (!steps.length) return null;

  const headerLabel = active
    ? 'Thinking…'
    : durationSeconds != null
      ? `Thought for ${durationSeconds}s`
      : 'Thinking steps';

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.header}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide thinking steps' : 'Show thinking steps'}
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name="flash-outline" size={14} color={colors.textSecondary} />
        <ThemedText style={[styles.headerLabel, { color: colors.textSecondary }]}>{headerLabel}</ThemedText>
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={colors.textSecondary}
        />
      </Pressable>

      {open ? (
        <View style={[styles.steps, { borderColor: colors.border }]}>
          {steps.map((step) => (
            <View key={step.id} style={styles.stepRow}>
              <View style={styles.stepIcon}>
                {step.status === 'active' ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                )}
              </View>
              <View style={styles.stepText}>
                <ThemedText style={[styles.stepLabel, { color: colors.text }]}>{step.label}</ThemedText>
                {step.detail ? (
                  <ThemedText style={[styles.stepDetail, { color: colors.textSecondary }]}>
                    {step.detail}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 12,
    flex: 1,
  },
  steps: {
    marginTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
    gap: 10,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepIcon: {
    width: 16,
    alignItems: 'center',
    marginTop: 1,
  },
  stepText: {
    flex: 1,
    gap: 1,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  stepDetail: {
    fontSize: 12,
  },
});

export default ThinkingTrace;
