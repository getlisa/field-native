import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import TranscriptionView from '@/components/transcription/TranscriptionView';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

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
    transcriptionScrollRef,
    isLoadingDbTurns,
    isReceivingAudio,
    isAudioEnabled,
    toggleAudio,
  } = useJobDetailContext();
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
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
        scrollRef={transcriptionScrollRef}
        isLoadingDbTurns={isLoadingDbTurns}
      />
      {/* Audio toggle for viewers when receiving audio - only show in transcription tab */}
      {isViewer && isReceivingAudio && toggleAudio && (
        <View style={styles.audioToggleContainer}>
          <Pressable
            onPress={toggleAudio}
            style={[
              styles.audioToggle,
              {
                backgroundColor: isAudioEnabled ? colors.primary : colors.backgroundSecondary,
              },
            ]}
          >
            <Ionicons
              name={isAudioEnabled ? 'volume-high' : 'volume-mute'}
              size={20}
              color={isAudioEnabled ? '#fff' : colors.iconSecondary}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  audioToggleContainer: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.lg,
    zIndex: 10,
  },
  audioToggle: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
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
