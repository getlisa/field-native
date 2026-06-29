import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import type { FollowUpChip } from '@/copilot-contract';

interface FollowUpChipsProps {
  chips: FollowUpChip[];
  onPress: (prompt: string) => void;
}

export const FollowUpChips: React.FC<FollowUpChipsProps> = ({ chips, onPress }) => {
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handlePress = (chip: FollowUpChip) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => onPress(chip.prompt));
  };

  if (chips.length === 0) return null;

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
      >
        {chips.map((chip) => (
          <Pressable
            key={chip.id}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => handlePress(chip)}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
          >
            <ThemedText style={[styles.chipText, { color: colors.primary }]} numberOfLines={2}>
              {chip.label}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  scroll: {
    marginTop: 8,
  },
  scrollContent: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 220,
  },
  chipText: {
    fontSize: 13,
  },
});

export default FollowUpChips;
