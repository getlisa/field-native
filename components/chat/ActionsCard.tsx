import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { ActionItem, CopilotActionType } from '@/copilot-contract';

type ActionState = 'idle' | 'loading' | 'success' | 'error';

interface ActionsCardProps {
  items: ActionItem[];
  /** Address the PDF was already emailed to (shows confirmation instead of email button). */
  emailedTo?: string;
  onSignEstimate?: () => void;
  onEmailEstimate?: () => void;
  onDownloadPdf?: () => Promise<void>;
}

const ICONS: Record<CopilotActionType, keyof typeof import('@expo/vector-icons').Ionicons.glyphMap> = {
  sign_estimate: 'create-outline',
  email_estimate: 'mail-outline',
  download_pdf: 'document-text-outline',
};

export const ActionsCard: React.FC<ActionsCardProps> = ({
  items,
  emailedTo,
  onSignEstimate,
  onEmailEstimate,
  onDownloadPdf,
}) => {
  const { colors } = useTheme();
  const [states, setStates] = useState<Record<string, ActionState>>({});

  if (items.length === 0) return null;

  const setItemState = (id: string, state: ActionState) =>
    setStates((prev) => ({ ...prev, [id]: state }));

  const handlePress = async (item: ActionItem) => {
    const current = states[item.id] ?? 'idle';
    if (current === 'loading') return;

    setItemState(item.id, 'loading');
    try {
      if (item.actionType === 'sign_estimate' && onSignEstimate) {
        onSignEstimate();
        setItemState(item.id, 'idle');
      } else if (item.actionType === 'email_estimate' && onEmailEstimate) {
        onEmailEstimate();
        setItemState(item.id, 'idle');
      } else if (item.actionType === 'download_pdf' && onDownloadPdf) {
        await onDownloadPdf();
        setItemState(item.id, 'idle');
      } else {
        setItemState(item.id, 'idle');
      }
    } catch {
      setItemState(item.id, 'error');
      setTimeout(() => setItemState(item.id, 'idle'), 3000);
    }
  };

  const primaryItems = items.filter((i) => i.style !== 'secondary');
  const secondaryItems = items.filter((i) => i.style === 'secondary');

  const renderButton = (item: ActionItem) => {
    const state = states[item.id] ?? 'idle';
    const isPrimary = item.style !== 'secondary';
    const isError = state === 'error';
    const isLoading = state === 'loading';

    const bg = isPrimary
      ? isError ? colors.error : colors.primary
      : 'transparent';
    const fg = isPrimary ? '#ffffff' : isError ? colors.error : colors.primary;
    const iconName =
      isError
        ? 'alert-circle-outline'
        : state === 'success'
        ? 'checkmark-circle-outline'
        : ICONS[item.actionType] ?? 'ellipse-outline';

    return (
      <Pressable
        key={item.id}
        style={[
          styles.button,
          isPrimary ? { backgroundColor: bg } : [styles.outlineButton, { borderColor: isError ? colors.error : colors.primary }],
        ]}
        onPress={() => handlePress(item)}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        accessibilityState={{ disabled: isLoading }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <Ionicons name={iconName as any} size={16} color={fg} />
        )}
        <ThemedText style={[styles.buttonLabel, { color: fg }]}>
          {isError ? 'Try again' : isLoading ? 'Working…' : item.label}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {primaryItems.length > 0 && (
        <View style={styles.row}>{primaryItems.map(renderButton)}</View>
      )}
      {secondaryItems.length > 0 && (
        <View style={styles.row}>{secondaryItems.map(renderButton)}</View>
      )}
      {emailedTo ? (
        <View style={styles.emailedRow}>
          <Ionicons name="checkmark-circle" size={13} color={colors.success} />
          <ThemedText style={[styles.emailedText, { color: colors.textSecondary }]} numberOfLines={1}>
            Emailed to {emailedTo}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  outlineButton: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  emailedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  emailedText: {
    flex: 1,
    fontSize: 12,
  },
});

export default ActionsCard;
