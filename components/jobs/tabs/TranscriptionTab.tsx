import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import TranscriptionView from '@/components/transcription/TranscriptionView';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { FontSizes, Spacing } from '@/constants/theme';

export const TranscriptionTab: React.FC = () => {
  const { 
    job,
    turns, 
    isConnected, 
    isConnecting, 
    isRecording, 
    transcriptionError,
    isJobAssignedToCurrentUser,
    isViewer,
    visitSessionId,
  } = useJobDetailContext();
  const { colors } = useTheme();

  return (
    <TranscriptionView
      turns={turns}
      isConnected={isConnected}
      isConnecting={isConnecting}
      isRecording={isRecording}
      error={transcriptionError}
      visitSessionId={visitSessionId || job?.visit_sessions?.id}
      jobStatus={job?.status}
      isViewer={isViewer}
      isAssigned={isJobAssignedToCurrentUser}
    />
  );
};

const styles = StyleSheet.create({
  notAssignedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing['5xl'],
    gap: Spacing.md,
  },
  notAssignedTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  notAssignedSubtitle: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing['5xl'],
  },
});

export default TranscriptionTab;
