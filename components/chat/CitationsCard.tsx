import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { CitationItem } from '@/copilot-contract';

interface CitationsCardProps {
  items: CitationItem[];
}

export const CitationsCard: React.FC<CitationsCardProps> = ({ items }) => {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const handleOpen = (url?: string) => {
    if (!url) return;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) Linking.openURL(url);
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <Pressable
        style={styles.toggle}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} standards references`}
      >
        <Ionicons name="book-outline" size={14} color={colors.textSecondary} />
        <ThemedText style={[styles.toggleLabel, { color: colors.textSecondary }]}>
          Standards ({items.length})
        </ThemedText>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textSecondary}
          style={styles.chevron}
        />
      </Pressable>

      {open &&
        items.map((item, index) => {
          const isNfpa = item.standard?.toUpperCase().includes('NFPA');
          const codeLabel = [item.standard, item.code, item.section ? `§${item.section}` : null]
            .filter(Boolean)
            .join(' ');

          return (
            <Pressable
              key={index}
              style={[styles.item, isNfpa && { borderLeftColor: '#e53e3e' }]}
              onPress={() => handleOpen(item.url)}
              disabled={!item.url}
              accessibilityRole={item.url ? 'link' : 'text'}
            >
              {codeLabel ? (
                <ThemedText style={[styles.code, { color: colors.primary }]}>{codeLabel}</ThemedText>
              ) : null}
              <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                {item.title}
              </ThemedText>
              {item.url ? (
                <Ionicons name="open-outline" size={12} color={colors.textSecondary} style={styles.linkIcon} />
              ) : null}
            </Pressable>
          );
        })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  chevron: {
    marginLeft: 'auto',
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    gap: 2,
  },
  code: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 12,
    lineHeight: 17,
  },
  linkIcon: {
    marginTop: 2,
  },
});

export default CitationsCard;
