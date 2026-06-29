import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { Identification } from '@/copilot-contract';

interface IdentifiedCardProps {
  data: Identification;
}

export const IdentifiedCard: React.FC<IdentifiedCardProps> = ({ data }) => {
  const { colors } = useTheme();

  const confidencePct = Math.round((data.confidence ?? 0) * 100);
  const confidenceColor =
    confidencePct >= 80 ? colors.success : confidencePct >= 50 ? colors.warning : colors.error;
  const isReplace = data.decision === 'replace';
  const decisionColor = isReplace ? colors.warning : colors.success;
  const equipmentName = [data.brand, data.model].filter(Boolean).join(' ');

  return (
    <View style={[styles.card, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name="hardware-chip-outline" size={14} color={colors.primary} />
          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Identified Equipment</ThemedText>
        </View>
        {data.decision ? (
          <View style={[styles.decisionBadge, { borderColor: decisionColor }]}>
            <ThemedText style={[styles.decisionText, { color: decisionColor }]}>
              {isReplace ? 'REPLACE' : 'REPAIR'}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {equipmentName ? (
        <ThemedText style={[styles.equipmentName, { color: colors.text }]} numberOfLines={2}>
          {equipmentName}
        </ThemedText>
      ) : null}

      <View style={styles.detailRow}>
        {data.category ? (
          <ThemedText style={[styles.detail, { color: colors.textSecondary }]}>{data.category}</ThemedText>
        ) : null}
        {data.issue ? (
          <ThemedText style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>
            {data.issue}
          </ThemedText>
        ) : null}
      </View>

      {data.confidence != null ? (
        <View style={styles.confidenceRow}>
          <View style={[styles.confidenceBar, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.confidenceFill,
                { width: `${confidencePct}%` as any, backgroundColor: confidenceColor },
              ]}
            />
          </View>
          <View style={styles.confidenceLabelRow}>
            <Ionicons name="checkmark-circle-outline" size={12} color={confidenceColor} />
            <ThemedText style={[styles.confidencePct, { color: confidenceColor }]}>
              {confidencePct}% confident
            </ThemedText>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  decisionBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  decisionText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  equipmentName: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  detailRow: {
    gap: 2,
  },
  detail: {
    fontSize: 12,
    lineHeight: 17,
  },
  confidenceRow: {
    gap: 4,
    marginTop: 4,
  },
  confidenceBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: 4,
    borderRadius: 2,
  },
  confidenceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confidencePct: {
    fontSize: 11,
  },
});

export default IdentifiedCard;
