import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { EstimateLineItemType, EstimateQuote } from '@/components/chat/types';

interface QuoteCardProps {
  quote: EstimateQuote;
}

const TYPE_VARIANT: Record<EstimateLineItemType, BadgeVariant> = {
  equipment: 'primary',
  part: 'info',
  labor: 'warning',
  access: 'success',
  other: 'default',
};

/**
 * Structured cost-estimate card for the Estimate Cost demo mode.
 * Renders identified equipment, repair-vs-replace decision, line items, total,
 * collapsible assumptions, and notes.
 */
export const QuoteCard: React.FC<QuoteCardProps> = ({ quote }) => {
  const { colors } = useTheme();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const formatCurrency = useMemo(() => {
    return (value: number) => {
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: quote.currency || 'USD',
          maximumFractionDigits: 2,
        }).format(value);
      } catch {
        return `${quote.currency || '$'}${value.toFixed(2)}`;
      }
    };
  }, [quote.currency]);

  const { identifiedEquipment: eq } = quote;
  const isReplace = eq.decision === 'replace';
  const confidencePct = Math.round((eq.confidence ?? 0) * 100);
  const title = [eq.brand, eq.model].filter(Boolean).join(' ') || eq.category || 'Identified equipment';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {title}
          </ThemedText>
          <Badge variant={isReplace ? 'warning' : 'success'} size="sm">
            {isReplace ? 'REPLACE' : 'REPAIR'}
          </Badge>
        </View>
        <View style={styles.subHeaderRow}>
          {eq.category ? (
            <ThemedText style={[styles.category, { color: colors.textSecondary }]} numberOfLines={1}>
              {eq.category}
            </ThemedText>
          ) : null}
          <View style={styles.confidenceRow}>
            <Ionicons name="checkmark-circle-outline" size={13} color={colors.textSecondary} />
            <ThemedText style={[styles.confidence, { color: colors.textSecondary }]}>
              {confidencePct}% confidence
            </ThemedText>
          </View>
        </View>
        {eq.issue ? (
          <ThemedText style={[styles.issue, { color: colors.text }]}>{eq.issue}</ThemedText>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Line items */}
      <View style={styles.itemsHeaderRow}>
        <ThemedText style={[styles.colItem, styles.colHeader, { color: colors.textSecondary }]}>
          Item
        </ThemedText>
        <ThemedText style={[styles.colQty, styles.colHeader, { color: colors.textSecondary }]}>
          Qty
        </ThemedText>
        <ThemedText style={[styles.colUnit, styles.colHeader, { color: colors.textSecondary }]}>
          Unit
        </ThemedText>
        <ThemedText style={[styles.colAmount, styles.colHeader, { color: colors.textSecondary }]}>
          Amount
        </ThemedText>
      </View>

      {quote.lineItems?.map((item, index) => {
        const isLabor = item.type === 'labor';
        return (
          <View key={`${item.label}-${index}`} style={styles.itemRow}>
            <View style={styles.colItem}>
              <ThemedText style={[styles.itemLabel, { color: colors.text }]} numberOfLines={2}>
                {item.label}
              </ThemedText>
              <Badge variant={TYPE_VARIANT[item.type] ?? 'default'} size="sm" style={styles.typeChip}>
                {item.type}
              </Badge>
            </View>
            <ThemedText style={[styles.colQty, styles.cellText, { color: colors.text }]}>
              {isLabor ? `${item.quantity}h` : item.quantity}
            </ThemedText>
            <ThemedText style={[styles.colUnit, styles.cellText, { color: colors.text }]}>
              {formatCurrency(item.unitCost)}
            </ThemedText>
            <ThemedText style={[styles.colAmount, styles.cellText, { color: colors.text }]}>
              {formatCurrency(item.amount)}
            </ThemedText>
          </View>
        );
      })}

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Total */}
      <View style={styles.totalRow}>
        <ThemedText style={[styles.totalLabel, { color: colors.text }]}>Estimated total</ThemedText>
        <ThemedText style={[styles.totalValue, { color: colors.primary }]}>
          {formatCurrency(quote.total)}
        </ThemedText>
      </View>

      {/* Assumptions (collapsible) */}
      {quote.assumptions?.length ? (
        <>
          <Pressable
            style={styles.assumptionsToggle}
            onPress={() => setAssumptionsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Toggle assumptions"
          >
            <Ionicons
              name={assumptionsOpen ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={colors.textSecondary}
            />
            <ThemedText style={[styles.assumptionsTitle, { color: colors.textSecondary }]}>
              Assumptions ({quote.assumptions.length})
            </ThemedText>
          </Pressable>
          {assumptionsOpen &&
            quote.assumptions.map((assumption, index) => (
              <View key={index} style={styles.assumptionItem}>
                <ThemedText style={[styles.assumptionBullet, { color: colors.textSecondary }]}>
                  •
                </ThemedText>
                <ThemedText style={[styles.assumptionText, { color: colors.textSecondary }]}>
                  {assumption}
                </ThemedText>
              </View>
            ))}
        </>
      ) : null}

      {/* Notes */}
      {quote.notes ? (
        <ThemedText style={[styles.notes, { color: colors.textTertiary }]}>{quote.notes}</ThemedText>
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
  header: {
    gap: 6,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  category: {
    flex: 1,
    fontSize: 12,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confidence: {
    fontSize: 12,
  },
  issue: {
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  itemsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  colHeader: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  colItem: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-start',
  },
  colQty: {
    width: 48,
    textAlign: 'right',
  },
  colUnit: {
    width: 64,
    textAlign: 'right',
  },
  colAmount: {
    width: 72,
    textAlign: 'right',
  },
  cellText: {
    fontSize: 13,
  },
  itemLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  typeChip: {
    alignSelf: 'flex-start',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  assumptionsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  assumptionsTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  assumptionItem: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    paddingLeft: 4,
  },
  assumptionBullet: {
    fontSize: 12,
    lineHeight: 18,
  },
  assumptionText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  notes: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 12,
  },
});

export default QuoteCard;
