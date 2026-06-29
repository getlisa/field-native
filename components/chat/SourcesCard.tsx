import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { SourceItem } from '@/copilot-contract';

interface SourcesCardProps {
  items: SourceItem[];
}

const getDomain = (url?: string): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

export const SourcesCard: React.FC<SourcesCardProps> = ({ items }) => {
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
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} sources`}
      >
        <Ionicons name="documents-outline" size={14} color={colors.textSecondary} />
        <ThemedText style={[styles.toggleLabel, { color: colors.textSecondary }]}>
          Sources ({items.length})
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
          const isWeb = item.type === 'web';
          const domain = getDomain(item.url);
          const canOpen = !!item.url;

          return (
            <Pressable
              key={index}
              style={[styles.item, { borderTopColor: colors.border }]}
              onPress={() => handleOpen(item.url)}
              disabled={!canOpen}
              accessibilityRole={canOpen ? 'link' : 'text'}
            >
              <Ionicons
                name={isWeb ? 'globe-outline' : 'document-text-outline'}
                size={14}
                color={colors.primary}
                style={styles.typeIcon}
              />
              <View style={styles.itemContent}>
                <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </ThemedText>
                {domain ? (
                  <ThemedText style={[styles.domain, { color: colors.textSecondary }]} numberOfLines={1}>
                    {domain}
                  </ThemedText>
                ) : null}
              </View>
              {canOpen ? (
                <Ionicons name="open-outline" size={12} color={colors.textSecondary} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  typeIcon: {
    marginTop: 1,
  },
  itemContent: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 12,
    lineHeight: 17,
  },
  domain: {
    fontSize: 11,
  },
});

export default SourcesCard;
