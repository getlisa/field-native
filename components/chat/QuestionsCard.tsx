import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

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
 * buttons plus an "Other" button that opens a write-or-speak modal. Each question is
 * single-select (an option OR a free-text "Other" answer, never both). The user answers
 * every question, then a single Submit sends the collective answers via onAnswer.
 */
export const QuestionsCard: React.FC<QuestionsCardProps> = ({ questions, onAnswer, disabled = false }) => {
  const { colors } = useTheme();
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [submitted, setSubmitted] = useState(false);

  // "Other" write/speak modal state.
  const [otherModalFor, setOtherModalFor] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const speechSubsRef = useRef<{ remove: () => void }[]>([]);

  const isLocked = disabled || submitted;

  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => selections[q.id]?.value.trim()),
    [questions, selections]
  );

  // A question is answered via "Other" when its selection isn't one of the listed options.
  const isOtherSelected = useCallback(
    (q: FollowUpQuestion) => {
      const sel = selections[q.id];
      return !!sel && !q.options?.some((o) => o.value === sel.value);
    },
    [selections]
  );

  // Single selection per question → picking an option and "Other" are mutually exclusive.
  const selectOption = (qId: string, opt: Selection) => {
    if (isLocked) return;
    setSelections((prev) => ({ ...prev, [qId]: opt }));
  };

  const clearSpeechSubs = useCallback(() => {
    speechSubsRef.current.forEach((s) => {
      try {
        s.remove();
      } catch {
        // ignore
      }
    });
    speechSubsRef.current = [];
  }, []);

  const stopListening = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }
    setIsListening(false);
  }, []);

  // Clean up any speech session on unmount.
  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort?.();
      } catch {
        // ignore
      }
      clearSpeechSubs();
    };
  }, [clearSpeechSubs]);

  const openOther = (q: FollowUpQuestion) => {
    if (isLocked) return;
    setOtherText(isOtherSelected(q) ? selections[q.id].value : '');
    setOtherModalFor(q.id);
  };

  const closeOther = () => {
    stopListening();
    clearSpeechSubs();
    setOtherModalFor(null);
    setOtherText('');
  };

  const startListening = async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert('Permission needed', 'Microphone & speech recognition access are required to speak your answer.');
        return;
      }
      clearSpeechSubs();
      speechSubsRef.current = [
        ExpoSpeechRecognitionModule.addListener('result', (e: any) => {
          const transcript = e?.results?.[0]?.transcript;
          if (typeof transcript === 'string') setOtherText(transcript);
        }),
        ExpoSpeechRecognitionModule.addListener('end', () => setIsListening(false)),
        ExpoSpeechRecognitionModule.addListener('error', () => setIsListening(false)),
      ];
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: false });
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const confirmOther = () => {
    const trimmed = otherText.trim();
    if (otherModalFor && trimmed) {
      setSelections((prev) => ({ ...prev, [otherModalFor]: { value: trimmed, label: trimmed } }));
    }
    closeOther();
  };

  const submit = () => {
    if (!allAnswered || isLocked) return;
    const combined = questions.map((q) => `${q.question}\n${selections[q.id].value}`).join('\n\n');
    setSubmitted(true);
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
        const otherSelected = isOtherSelected(q);
        return (
          <View key={q.id || qIndex} style={[styles.questionBlock, qIndex > 0 && styles.questionGap]}>
            <ThemedText style={[styles.question, { color: colors.text }]}>{q.question}</ThemedText>
            <View style={styles.optionsRow}>
              {q.options?.map((opt) => {
                const selected = selections[q.id]?.value === opt.value;
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
                    {selected ? <Ionicons name="checkmark" size={13} color={colors.primary} /> : null}
                    <ThemedText style={[styles.optionLabel, { color: selected ? colors.primary : colors.text }]}>
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
                  onPress={() => openOther(q)}
                  disabled={isLocked}
                  accessibilityRole="button"
                  accessibilityState={{ selected: otherSelected }}
                  accessibilityLabel="Other — type or speak your answer"
                >
                  {otherSelected ? (
                    <Ionicons name="checkmark" size={13} color={colors.primary} />
                  ) : (
                    <Ionicons name="create-outline" size={13} color={colors.primary} />
                  )}
                  <ThemedText style={[styles.optionLabel, { color: colors.primary }]} numberOfLines={1}>
                    {otherSelected ? selections[q.id].value : 'Other'}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
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
          style={[styles.submitButton, { backgroundColor: allAnswered ? colors.primary : colors.backgroundTertiary }]}
          onPress={submit}
          disabled={!allAnswered || isLocked}
          accessibilityRole="button"
          accessibilityState={{ disabled: !allAnswered || isLocked }}
          accessibilityLabel="Submit answers and get estimate"
        >
          <Ionicons name="sparkles" size={15} color={allAnswered ? '#ffffff' : colors.textTertiary} />
          <ThemedText style={[styles.submitLabel, { color: allAnswered ? '#ffffff' : colors.textTertiary }]}>
            Get estimate
          </ThemedText>
        </Pressable>
      )}

      {/* "Other" write-or-speak modal */}
      <Modal visible={!!otherModalFor} transparent animationType="slide" onRequestClose={closeOther}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>Your answer</ThemedText>
              <Pressable onPress={closeOther} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={[styles.modalInputRow, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
              <TextInput
                value={otherText}
                onChangeText={setOtherText}
                placeholder="Type your answer…"
                placeholderTextColor={colors.textTertiary}
                style={[styles.modalInput, { color: colors.text }]}
                autoFocus
                multiline
              />
              <Pressable
                onPress={isListening ? stopListening : startListening}
                style={[
                  styles.micButton,
                  { backgroundColor: isListening ? colors.primary : colors.backgroundTertiary },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isListening ? 'Stop listening' : 'Speak your answer'}
              >
                <Ionicons name={isListening ? 'stop' : 'mic'} size={18} color={isListening ? '#ffffff' : colors.primary} />
              </Pressable>
            </View>
            {isListening ? (
              <ThemedText style={[styles.listeningHint, { color: colors.primary }]}>Listening… tap stop when done</ThemedText>
            ) : null}

            <View style={styles.modalFooter}>
              <Pressable
                style={[styles.modalCancel, { borderColor: colors.border }]}
                onPress={closeOther}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <ThemedText style={[styles.modalCancelLabel, { color: colors.textSecondary }]}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.modalDone, { backgroundColor: otherText.trim() ? colors.primary : colors.backgroundTertiary }]}
                onPress={confirmOther}
                disabled={!otherText.trim()}
                accessibilityRole="button"
                accessibilityLabel="Use this answer"
                accessibilityState={{ disabled: !otherText.trim() }}
              >
                <ThemedText style={[styles.modalDoneLabel, { color: otherText.trim() ? '#ffffff' : colors.textTertiary }]}>
                  Done
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    maxWidth: '100%',
  },
  otherButton: {
    borderStyle: 'dashed',
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 4,
  },
  modalInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
    maxHeight: 120,
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listeningHint: {
    fontSize: 12,
    marginTop: -4,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalCancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalDone: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  modalDoneLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default QuestionsCard;
