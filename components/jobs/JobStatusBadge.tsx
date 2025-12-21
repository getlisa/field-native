import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';
import type { JobStatus } from '@/services/jobService';

interface JobStatusBadgeProps {
  status: JobStatus;
  onStart?: () => void;
  onComplete?: () => void;
  loading?: boolean;
}

type StatusConfig = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  getBgColor: (colors: any) => string;
  textColor: string;
};

const STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
  scheduled: {
    label: 'Start Job',
    icon: 'play-circle',
    getBgColor: (colors) => colors.primary,
    textColor: '#ffffff',
  },
  ongoing: {
    label: 'In Progress',
    icon: 'radio-button-on',
    getBgColor: (colors) => colors.warning,
    textColor: '#ffffff',
  },
  completed: {
    label: 'Completed',
    icon: 'checkmark-circle',
    getBgColor: (colors) => colors.success,
    textColor: '#ffffff',
  },
};

export const JobStatusBadge: React.FC<JobStatusBadgeProps> = ({
  status,
  onStart,
  onComplete,
  loading = false,
}) => {
  const { colors, shadows } = useTheme();
  const config = STATUS_CONFIG[status];
  const bgColor = config.getBgColor(colors);
  const isInteractive = status === 'scheduled' && onStart;

  const handlePress = () => {
    if (loading) return;
    if (status === 'scheduled' && onStart) {
      onStart();
    } else if (status === 'ongoing' && onComplete) {
      onComplete();
    }
  };

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={config.textColor} />
      ) : (
        <Ionicons name={config.icon} size={20} color={config.textColor} />
      )}
      <ThemedText style={[styles.label, { color: config.textColor }]}>
        {config.label}
      </ThemedText>
    </>
  );

  if (isInteractive || (status === 'ongoing' && onComplete)) {
    return (
      <Pressable
        style={[
          styles.container,
          styles.button,
          shadows.sm,
          { backgroundColor: bgColor },
        ]}
        onPress={handlePress}
        disabled={loading}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, styles.badge, { backgroundColor: bgColor }]}>
      {content}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  button: {},
  badge: {
    opacity: 0.9,
  },
  label: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
});

export default JobStatusBadge;
