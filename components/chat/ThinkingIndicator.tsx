import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';

interface ThinkingIndicatorProps {
  isThinking: boolean;
  /** Optional live step label (e.g. "Identifying equipment"); falls back to "Thinking". */
  label?: string | null;
}

/**
 * Copilot-style row: sparkle avatar + animated "{label}..." (defaults to "Thinking").
 */
export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ isThinking, label }) => {
  const { colors } = useTheme();
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    if (!isThinking) {
      setDotCount(0);
      return;
    }
    const id = setInterval(() => {
      setDotCount((n) => (n + 1) % 4);
    }, 400);
    return () => clearInterval(id);
  }, [isThinking]);

  if (!isThinking) return null;

  const dots = '.'.repeat(dotCount);
  const text = label?.trim() || 'Thinking';

  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessibilityRole="text">
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Ionicons name="sparkles" size={16} color="#ffffff" />
      </View>
      <ThemedText style={[styles.label, { color: colors.textSecondary }]}>{text}{dots}</ThemedText>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 0,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
    flex: 1,
  },
});

export default ThinkingIndicator;
