import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { FollowUpQuestion } from '@/components/chat/types';

interface QuestionsCardProps {
  questions: FollowUpQuestion[];
  /** Send the chosen option value (or typed "Other" text) back to the estimate endpoint. */
  onAnswer?: (value: string) => void;
  /** Disable interaction (e.g. when rehydrated from history and already answered). */
  disabled?: boolean;
}

/**
 * Renders the copilot's follow-up questions (Estimate Cost mode) as tappable option
 * buttons plus an inline "Other" free-text entry. Selecting an option or submitting
 * "Other" sends the value back to the same conversation via onAnswer.
 */
export const QuestionsCard: React.FC<QuestionsCardProps> = ({ questions, onAnswer, disabled = false }) => {
  const { colors } = useTheme();
  const [answered, setAnswered] = useState(false);
  const [otherOpenFor, setOtherOpenFor] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');

  const isLocked = disabled || answered;

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isLocked) return;
    setAnswered(true);
    setOtherOpenFor(null);
    onAnswer?.(trimmed);
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
        return (
          <View key={q.id || qIndex} style={[styles.questionBlock, qIndex > 0 && styles.questionGap]}>
            <ThemedText style={[styles.question, { color: colors.text }]}>{q.question}</ThemedText>
            <View style={styles.optionsRow}>
              {q.options?.map((opt) => (
                <Pressable
                  key={opt.id}
                  style={[styles.optionButton, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => submit(opt.value)}
                  disabled={isLocked}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                >
                  <ThemedText style={[styles.optionLabel, { color: colors.text }]}>{opt.label}</ThemedText>
                </Pressable>
              ))}
              {q.allowOther ? (
                <Pressable
                  style={[
                    styles.optionButton,
                    styles.otherButton,
                    { borderColor: colors.primary, backgroundColor: otherOpen ? colors.primaryLight : colors.background },
                  ]}
                  onPress={() => {
                    setOtherText('');
                    setOtherOpenFor(otherOpen ? null : q.id);
                  }}
                  disabled={isLocked}
                  accessibilityRole="button"
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
                  value={otherText}
                  onChangeText={setOtherText}
                  placeholder="Type your answer…"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.otherInput, { color: colors.text }]}
                  autoFocus
                  onSubmitEditing={() => submit(otherText)}
                  returnKeyType="send"
                />
                <Pressable
                  style={[
                    styles.otherSend,
                    { backgroundColor: otherText.trim() ? colors.primary : colors.backgroundTertiary },
                  ]}
                  onPress={() => submit(otherText)}
                  disabled={!otherText.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Send answer"
                >
                  <Ionicons name="send" size={15} color="#ffffff" />
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {answered ? (
        <View style={styles.answeredRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <ThemedText style={[styles.answeredText, { color: colors.textSecondary }]}>Answer sent</ThemedText>
        </View>
      ) : null}
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
    paddingRight: 6,
    paddingVertical: 4,
  },
  otherInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  otherSend: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
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
