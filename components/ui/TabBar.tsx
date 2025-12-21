import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

export interface Tab {
  key: string;
  label: string;
  icon?: string;
  badge?: number | string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabKey: string) => void;
  iconOnly?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
  iconOnly = false,
}) => {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.tabBackground }]}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            style={[
              styles.tab,
              isActive && [
                styles.activeTab,
                shadows.sm,
                { backgroundColor: colors.tabActiveBackground },
              ],
            ]}
            onPress={() => onTabChange(tab.key)}
          >
            {tab.icon && (
              <Ionicons
                name={tab.icon as any}
                size={20}
                color={isActive ? colors.tabIconSelected : colors.tabIconDefault}
              />
            )}
            {!iconOnly && (
              <ThemedText
                style={[
                  styles.tabText,
                  { color: colors.tabIconDefault },
                  isActive && [styles.activeTabText, { color: colors.tabIconSelected }],
                ]}
              >
                {tab.label}
              </ThemedText>
            )}
            {tab.badge !== undefined && (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: isActive ? colors.primary : colors.backgroundTertiary,
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.badgeText,
                    {
                      color: isActive ? colors.textInverse : colors.textSecondary,
                    },
                  ]}
                >
                  {tab.badge}
                </ThemedText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xs,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  activeTab: {},
  tabText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  activeTabText: {
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.lg,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
});

export default TabBar;
