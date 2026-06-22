import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { EstimateLineItemKind, EstimateQuote } from '@/components/chat/types';

interface QuoteCardProps {
  quote: EstimateQuote;
  /** When provided, render a "Download PDF" footer button that invokes this on press. */
  onDownloadPdf?: () => void;
  /** Show a spinner on the download button while the PDF link resolves / opens. */
  downloadingPdf?: boolean;
}

const KIND_VARIANT: Record<EstimateLineItemKind, BadgeVariant> = {
  material: 'info',
  service: 'primary',
  labor: 'warning',
  rental: 'success',
  permit: 'default',
  other: 'default',
};

/** Coerce a value (number, numeric string like "$18.00", or junk) to a number; NaN if not parseable. */
const toNum = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value.replace(/[^0-9.eE+-]/g, ''));
  return NaN;
};

/** Resolved total for a line item: its `lineTotal`, else quantity * unitPrice. */
const lineItemTotal = (item: { lineTotal?: unknown; quantity?: unknown; unitPrice?: unknown }): number => {
  const lt = toNum(item.lineTotal);
  if (Number.isFinite(lt)) return lt;
  const computed = toNum(item.quantity) * toNum(item.unitPrice);
  return Number.isFinite(computed) ? computed : NaN;
};

const firstFinite = (...values: unknown[]): number | undefined => {
  for (const v of values) {
    const n = toNum(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

/**
 * Structured cost-estimate card for the Estimate Cost demo mode.
 * Renders identified equipment, repair-vs-replace decision, priced line items
 * (pricebook code + kind), the materials/labor/tax subtotals and total, plus
 * collapsible assumptions and customer (NFPA) notes.
 */
export const QuoteCard: React.FC<QuoteCardProps> = ({ quote, onDownloadPdf, downloadingPdf = false }) => {
  const { colors } = useTheme();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const formatCurrency = useMemo(() => {
    const currency = quote.currency || 'USD';
    return (value: unknown) => {
      const n = toNum(value);
      if (!Number.isFinite(n)) return '—';
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency,
          maximumFractionDigits: 2,
        }).format(n);
      } catch {
        return `$${n.toFixed(2)}`;
      }
    };
  }, [quote.currency]);

  const eq = quote.identifiedEquipment;
  const isReplace = eq?.decision === 'replace';
  const confidencePct = Math.round((toNum(eq?.confidence) || 0) * 100);
  const equipmentLine =
    [eq?.brand, eq?.model].filter(Boolean).join(' ') +
    (eq?.category ? ` · ${eq.category}` : '');
  const title = quote.title || equipmentLine || 'Cost estimate';

  // Tolerate best-effort / partial payloads.
  const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const lineItemsTotal = lineItems.reduce((sum, it) => {
    const lt = lineItemTotal(it);
    return sum + (Number.isFinite(lt) ? lt : 0);
  }, 0);
  const materials = firstFinite(quote.materialsServicesSubtotal);
  const labor = firstFinite(quote.laborSubtotal);
  const taxOther = firstFinite(quote.taxOther);
  // Prefer explicit total; else sum the three subtotals; else sum the line items.
  const subtotalsSum =
    materials !== undefined || labor !== undefined || taxOther !== undefined
      ? (materials ?? 0) + (labor ?? 0) + (taxOther ?? 0)
      : undefined;
  const resolvedTotal =
    firstFinite(quote.total, subtotalsSum) ?? (lineItems.length > 0 ? lineItemsTotal : NaN);

  const customerNotes = Array.isArray(quote.customerNotes) ? quote.customerNotes : [];
  const assumptions = Array.isArray(quote.assumptions) ? quote.assumptions : [];

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
          {eq?.decision ? (
            <Badge variant={isReplace ? 'warning' : 'success'} size="sm">
              {isReplace ? 'REPLACE' : 'REPAIR'}
            </Badge>
          ) : null}
        </View>
        <View style={styles.subHeaderRow}>
          {equipmentLine ? (
            <ThemedText style={[styles.equipment, { color: colors.textSecondary }]} numberOfLines={1}>
              {equipmentLine}
            </ThemedText>
          ) : null}
          {eq?.confidence != null ? (
            <View style={styles.confidenceRow}>
              <Ionicons name="checkmark-circle-outline" size={13} color={colors.textSecondary} />
              <ThemedText style={[styles.confidence, { color: colors.textSecondary }]}>
                {confidencePct}%
              </ThemedText>
            </View>
          ) : null}
        </View>
        {eq?.issue ? (
          <ThemedText style={[styles.issue, { color: colors.text }]}>{eq.issue}</ThemedText>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Line items */}
      {lineItems.length === 0 ? (
        <ThemedText style={[styles.emptyItems, { color: colors.textTertiary }]}>
          No line items provided.
        </ThemedText>
      ) : (
        lineItems.map((item, index) => {
          const qty = toNum(item.quantity);
          const qtyLabel = Number.isFinite(qty) ? `${qty}${item.unit ? ` ${item.unit}` : ''}` : '—';
          return (
            <View key={`${item.code || item.description}-${index}`} style={styles.itemRow}>
              <View style={styles.itemMain}>
                <ThemedText style={[styles.itemDescription, { color: colors.text }]} numberOfLines={2}>
                  {item.description}
                </ThemedText>
                <View style={styles.itemMetaRow}>
                  {item.kind ? (
                    <Badge variant={KIND_VARIANT[item.kind] ?? 'default'} size="sm" style={styles.kindChip}>
                      {item.kind}
                    </Badge>
                  ) : null}
                  <ThemedText style={[styles.itemMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[item.code, `${qtyLabel} × ${formatCurrency(item.unitPrice)}`]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={[styles.itemTotal, { color: colors.text }]}>
                {formatCurrency(lineItemTotal(item))}
              </ThemedText>
            </View>
          );
        })
      )}

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Subtotals + total */}
      {materials !== undefined ? (
        <View style={styles.subtotalRow}>
          <ThemedText style={[styles.subtotalLabel, { color: colors.textSecondary }]}>
            Materials + Services
          </ThemedText>
          <ThemedText style={[styles.subtotalValue, { color: colors.text }]}>
            {formatCurrency(materials)}
          </ThemedText>
        </View>
      ) : null}
      {labor !== undefined ? (
        <View style={styles.subtotalRow}>
          <ThemedText style={[styles.subtotalLabel, { color: colors.textSecondary }]}>Labor</ThemedText>
          <ThemedText style={[styles.subtotalValue, { color: colors.text }]}>
            {formatCurrency(labor)}
          </ThemedText>
        </View>
      ) : null}
      {taxOther !== undefined && taxOther > 0 ? (
        <View style={styles.subtotalRow}>
          <ThemedText style={[styles.subtotalLabel, { color: colors.textSecondary }]}>Tax / Other</ThemedText>
          <ThemedText style={[styles.subtotalValue, { color: colors.text }]}>
            {formatCurrency(taxOther)}
          </ThemedText>
        </View>
      ) : null}
      <View style={styles.totalRow}>
        <ThemedText style={[styles.totalLabel, { color: colors.text }]}>Total quote</ThemedText>
        <ThemedText style={[styles.totalValue, { color: colors.primary }]}>
          {formatCurrency(resolvedTotal)}
        </ThemedText>
      </View>

      {/* Customer notes (NFPA / compliance) */}
      {customerNotes.length > 0 ? (
        <View style={[styles.notesBox, { backgroundColor: colors.warningLight, borderColor: colors.warning }]}>
          <View style={styles.notesHeader}>
            <Ionicons name="warning-outline" size={14} color={colors.warning} />
            <ThemedText style={[styles.notesTitle, { color: colors.text }]}>Notes for customer</ThemedText>
          </View>
          {customerNotes.map((note, index) => (
            <View key={index} style={styles.bulletItem}>
              <ThemedText style={[styles.bullet, { color: colors.textSecondary }]}>•</ThemedText>
              <ThemedText style={[styles.bulletText, { color: colors.text }]}>{note}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      {/* Assumptions (collapsible) */}
      {assumptions.length > 0 ? (
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
              Assumptions ({assumptions.length})
            </ThemedText>
          </Pressable>
          {assumptionsOpen &&
            assumptions.map((assumption, index) => (
              <View key={index} style={styles.bulletItem}>
                <ThemedText style={[styles.bullet, { color: colors.textSecondary }]}>•</ThemedText>
                <ThemedText style={[styles.bulletText, { color: colors.textSecondary }]}>
                  {assumption}
                </ThemedText>
              </View>
            ))}
        </>
      ) : null}

      {/* Download PDF */}
      {onDownloadPdf ? (
        <Pressable
          style={[styles.downloadButton, { backgroundColor: colors.primary }]}
          onPress={onDownloadPdf}
          disabled={downloadingPdf}
          accessibilityRole="button"
          accessibilityLabel="Download quotation PDF"
          accessibilityState={{ disabled: downloadingPdf }}
        >
          {downloadingPdf ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="document-text-outline" size={16} color="#ffffff" />
          )}
          <ThemedText style={styles.downloadLabel}>
            {downloadingPdf ? 'Opening…' : 'Download PDF'}
          </ThemedText>
        </Pressable>
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
  equipment: {
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 6,
  },
  itemMain: {
    flex: 1,
    gap: 4,
  },
  itemDescription: {
    fontSize: 13,
    fontWeight: '500',
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  kindChip: {
    alignSelf: 'flex-start',
  },
  itemMeta: {
    fontSize: 12,
  },
  itemTotal: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 64,
    textAlign: 'right',
  },
  subtotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  subtotalLabel: {
    fontSize: 13,
  },
  subtotalValue: {
    fontSize: 13,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  notesBox: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  notesTitle: {
    fontSize: 13,
    fontWeight: '600',
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
  bulletItem: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    paddingLeft: 4,
  },
  bullet: {
    fontSize: 12,
    lineHeight: 18,
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyItems: {
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 12,
  },
  downloadLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default QuoteCard;
