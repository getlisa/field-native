import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { FollowUpQuestion } from '@/components/chat/types';

interface QuestionsCardProps {
  questions: FollowUpQuestion[];
  /** Send the collected answers (combined text) back to the estimate endpoint, once. */
  onAnswer?: (value: string) => void;
  /** Disable interaction (e.g. when rehydrated from history and already answered). */
  disabled?: boolean;
}

type Selection = { value: string; label: string };

/**
 * Renders the copilot's follow-up questions (Estimate Cost mode) as tappable option
 * buttons plus an inline "Other" free-text entry. Selecting options does NOT send —
 * the user answers every question first, then a single Submit sends the collective
 * answers back to the same conversation via onAnswer.
 */
export const QuestionsCard: React.FC<QuestionsCardProps> = ({ questions, onAnswer, disabled = false }) => {
  const { colors } = useTheme();
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [otherOpenFor, setOtherOpenFor] = useState<string | null>(null);
  const [otherDraft, setOtherDraft] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const isLocked = disabled || submitted;

  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => selections[q.id]?.value.trim()),
    [questions, selections]
  );

  const selectOption = (qId: string, opt: Selection) => {
    if (isLocked) return;
    setSelections((prev) => ({ ...prev, [qId]: opt }));
    if (otherOpenFor === qId) setOtherOpenFor(null);
  };

  const toggleOther = (qId: string) => {
    if (isLocked) return;
    setOtherOpenFor((prev) => (prev === qId ? null : qId));
  };

  const onOtherChange = (qId: string, text: string) => {
    setOtherDraft((prev) => ({ ...prev, [qId]: text }));
    setSelections((prev) => {
      const next = { ...prev };
      const trimmed = text.trim();
      if (trimmed) next[qId] = { value: trimmed, label: trimmed };
      else delete next[qId];
      return next;
    });
  };

  const isOptionSelected = (qId: string, value: string) => selections[qId]?.value === value;
  const isOtherSelected = (qId: string) =>
    otherOpenFor === qId || (!!selections[qId] && !questions.find((q) => q.id === qId)?.options.some((o) => o.value === selections[qId].value));

  const submit = () => {
    if (!allAnswered || isLocked) return;
    const combined = questions
      .map((q) => `${q.question}\n${selections[q.id].value}`)
      .join('\n\n');
    setSubmitted(true);
    setOtherOpenFor(null);
    onAnswer?.(combined);
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
        isLocked && styles.locked,
      ]}
    >
      {questions.map((q, qIndex) => {
        const otherOpen = otherOpenFor === q.id;
        const otherSelected = isOtherSelected(q.id);
        return (
          <View key={q.id || qIndex} style={[styles.questionBlock, qIndex > 0 && styles.questionGap]}>
            <ThemedText style={[styles.question, { color: colors.text }]}>{q.question}</ThemedText>
            <View style={styles.optionsRow}>
              {q.options?.map((opt) => {
                const selected = isOptionSelected(q.id, opt.value);
                return (
                  <Pressable
                    key={opt.id}
                    style={[
                      styles.optionButton,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primaryLight : colors.background,
                      },
                    ]}
                    onPress={() => selectOption(q.id, { value: opt.value, label: opt.label })}
                    disabled={isLocked}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={opt.label}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={13} color={colors.primary} />
                    ) : null}
                    <ThemedText
                      style={[styles.optionLabel, { color: selected ? colors.primary : colors.text }]}
                    >
                      {opt.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
              {q.allowOther ? (
                <Pressable
                  style={[
                    styles.optionButton,
                    styles.otherButton,
                    {
                      borderColor: colors.primary,
                      backgroundColor: otherSelected ? colors.primaryLight : colors.background,
                    },
                  ]}
                  onPress={() => toggleOther(q.id)}
                  disabled={isLocked}
                  accessibilityRole="button"
                  accessibilityState={{ selected: otherSelected }}
                  accessibilityLabel="Other — type your answer"
                >
                  <Ionicons name="create-outline" size={13} color={colors.primary} />
                  <ThemedText style={[styles.optionLabel, { color: colors.primary }]}>Other</ThemedText>
                </Pressable>
              ) : null}
            </View>

            {otherOpen && !isLocked ? (
              <View style={[styles.otherInputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <TextInput
                  value={otherDraft[q.id] ?? ''}
                  onChangeText={(text) => onOtherChange(q.id, text)}
                  placeholder="Type your answer…"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.otherInput, { color: colors.text }]}
                  autoFocus
                  onSubmitEditing={() => setOtherOpenFor(null)}
                  returnKeyType="done"
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {submitted ? (
        <View style={styles.answeredRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <ThemedText style={[styles.answeredText, { color: colors.textSecondary }]}>Answer sent</ThemedText>
        </View>
      ) : (
        <Pressable
          style={[
            styles.submitButton,
            { backgroundColor: allAnswered ? colors.primary : colors.backgroundTertiary },
          ]}
          onPress={submit}
          disabled={!allAnswered || isLocked}
          accessibilityRole="button"
          accessibilityState={{ disabled: !allAnswered || isLocked }}
          accessibilityLabel="Submit answers and get estimate"
        >
          <Ionicons
            name="sparkles"
            size={15}
            color={allAnswered ? '#ffffff' : colors.textTertiary}
          />
          <ThemedText
            style={[styles.submitLabel, { color: allAnswered ? '#ffffff' : colors.textTertiary }]}
          >
            Get estimate
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  locked: {
    opacity: 0.6,
  },
  questionBlock: {
    gap: 8,
  },
  questionGap: {
    marginTop: 14,
  },
  question: {
    fontSize: 14,
    fontWeight: '600',
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  otherButton: {
    borderStyle: 'dashed',
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  otherInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 12,
    paddingVertical: 4,
  },
  otherInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  submitLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  answeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  answeredText: {
    fontSize: 12,
  },
});

export default QuestionsCard;
