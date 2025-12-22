import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, AudioSource } from 'expo-audio';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/contexts/ThemeContext';
import type { DialogueTurn } from '@/lib/RealtimeChat';
import { jobService, type TranscriptionTurn } from '@/services/jobService';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';

interface WordTimestamp {
  word: string;
  start_sec: number;
  end_sec: number;
  confidence?: number;
}

export interface TranscriptionViewProps {
  turns: DialogueTurn[];
  isConnected: boolean;
  isConnecting: boolean;
  isRecording?: boolean;
  error: string | null;
  // For completed jobs - enable audio playback
  visitSessionId?: string;
  jobStatus?: 'scheduled' | 'ongoing' | 'completed';
  isViewer?: boolean;
  isAssigned?: boolean;
  scrollRef?: React.RefObject<{ scrollToEnd: (options?: { animated?: boolean }) => void } | null>; // For auto-scroll
  isLoadingDbTurns?: boolean; // Loading state for DB turns
}

interface EnhancedTurn extends DialogueTurn {
  word_timestamps?: WordTimestamp[];
  start_timestamp_ms?: number;
  end_timestamp_ms?: number;
}

const TurnItem: React.FC<{ 
  turn: EnhancedTurn; 
  isHighlighted?: boolean;
  highlightedWordIndex?: number | null;
  onPress?: () => void;
}> = ({ turn, isHighlighted = false, highlightedWordIndex = null, onPress }) => {
  const { colors } = useTheme();
  const isTechnician = turn.speaker === 'Technician';

  // Render text with word-level highlighting if available
  const renderText = () => {
    // STEP 1: Early exit if no word-level data or nothing to highlight
    if (!turn.word_timestamps || turn.word_timestamps.length === 0 || highlightedWordIndex === null) {
      return (
        <ThemedText
          style={[
            styles.turnText,
            turn.isPartial && styles.partialTurnText,
            { color: isHighlighted ? colors.primary : colors.text },
            isHighlighted && { fontWeight: '600' },
          ]}
        >
          {turn.text}
        </ThemedText>
      );
    }

    // STEP 2: Initialize tracking variables
    const words = turn.word_timestamps;  // Array of WordTimestamp objects
    const textLower = turn.text.toLowerCase();
    let textPosition = 0;                // Current position in text string
    const elements: React.ReactNode[] = []; // Array of React elements to render

    // STEP 3: Iterate through each word
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordText = word.word;  // e.g., "Hello"
      const wordLower = wordText.toLowerCase();

      // STEP 4: Find the word in the text starting from textPosition
      const searchStart = textPosition;
      const wordPosition = textLower.indexOf(wordLower, searchStart);

      if (wordPosition !== -1) {
        // Word found in text!
        const actualStart = wordPosition;
        const actualEnd = actualStart + wordText.length;

        // STEP 5: Add text before the word (spacing, punctuation)
        if (actualStart > textPosition) {
          elements.push(
            <ThemedText key={`before-${i}`} style={[styles.turnText, { color: colors.text }]}>
              {turn.text.substring(textPosition, actualStart)}
            </ThemedText>
          );
        }

        // STEP 6: Add the word (highlighted if it's the current word)
        const isWordHighlighted = i === highlightedWordIndex;
        const actualWord = turn.text.substring(actualStart, actualEnd);

        elements.push(
          <ThemedText
            key={`word-${i}`}
            style={[
              styles.turnText,
              { color: colors.text },
              isWordHighlighted && {
                backgroundColor: colors.primary,
                color: '#ffffff',
                fontWeight: '700',
                paddingHorizontal: 3,
                paddingVertical: 1,
                borderRadius: 3,
              },
            ]}
          >
            {actualWord}
          </ThemedText>
        );

        // STEP 7: Update text position
        textPosition = actualEnd;
      } else {
        // STEP 8: Word not found (edge case - punctuation issues)
        // Add the next space-delimited chunk
        if (textPosition < turn.text.length) {
          const nextSpace = turn.text.indexOf(' ', textPosition);
          const endPos = nextSpace === -1 ? turn.text.length : nextSpace;
          elements.push(
            <ThemedText key={`text-${i}`} style={[styles.turnText, { color: colors.text }]}>
              {turn.text.substring(textPosition, endPos)}
            </ThemedText>
          );
          textPosition = endPos === turn.text.length ? endPos : endPos + 1;
        }
      }
    }

    // STEP 9: Add remaining text after last word
    if (textPosition < turn.text.length) {
      elements.push(
        <ThemedText key="remaining" style={[styles.turnText, { color: colors.text }]}>
          {turn.text.substring(textPosition)}
        </ThemedText>
      );
    }

    return <View style={styles.wordContainer}>{elements}</View>;
  };

  const content = (
    <View
      style={[
        styles.turnContainer,
        isTechnician ? styles.technicianTurn : styles.customerTurn,
        isTechnician
          ? { backgroundColor: colors.primary + '1A' }
          : { backgroundColor: colors.backgroundSecondary },
        isHighlighted && {
          borderWidth: 3,
          borderColor: colors.primary,
        },
      ]}
    >
      <View style={styles.turnHeader}>
        <View
          style={[
            styles.avatarCircle,
            { backgroundColor: isTechnician ? colors.primary : colors.textSecondary },
          ]}
        >
          <ThemedText style={styles.avatarText}>
            {isTechnician ? 'T' : 'C'}
          </ThemedText>
        </View>
        <ThemedText style={[styles.timestamp, { color: colors.text }]}>
          {turn.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </ThemedText>
        {turn.isPartial && (
          <View style={styles.partialBadge}>
            <ThemedText style={styles.partialText}>Live</ThemedText>
          </View>
        )}
      </View>
      {renderText()}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
};

export const TranscriptionView: React.FC<TranscriptionViewProps> = ({
  turns: initialTurns,
  isConnected,
  isConnecting,
  isRecording = false,
  error,
  visitSessionId,
  jobStatus,
  isViewer = false,
  isAssigned = false,
  scrollRef,
  isLoadingDbTurns = false,
}) => {
  const { colors } = useTheme();
  const flatListRef = useRef<FlatList>(null);
  
  // Expose scrollToEnd method via ref for auto-scroll
  React.useImperativeHandle(scrollRef, () => ({
    scrollToEnd: (options?: { animated?: boolean }) => {
      flatListRef.current?.scrollToEnd(options);
    },
  }), []);

  // Use turns directly from props (already reconciled by parent)
  const enhancedTurns: EnhancedTurn[] = initialTurns;
  
  // State for completed job audio features (ONLY fetch audio, not turns)
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioStartTimeMs, setAudioStartTimeMs] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [localPlayingState, setLocalPlayingState] = useState(false); // Track our intended playing state

  const isCompleted = jobStatus === 'completed';
  
  // Only create player when we have a valid audio URL and job is completed
  const shouldHavePlayer = Boolean(audioUrl && isCompleted);
  const player = useAudioPlayer(shouldHavePlayer ? audioUrl : '');
  
  // Use local state for UI, but sync with player
  const isPlaying = localPlayingState;
  const duration = player?.duration || 0;

  // Sync local playing state with actual player state
  useEffect(() => {
    if (!player || !shouldHavePlayer) {
      setLocalPlayingState(false);
      return;
    }

    // Check player state periodically
    const syncInterval = setInterval(() => {
      try {
        const actuallyPlaying = player.playing ?? false;
        if (actuallyPlaying !== localPlayingState) {
          setLocalPlayingState(actuallyPlaying);
        }
      } catch (err) {
        console.debug('[TranscriptionView] Error syncing player state:', err);
      }
    }, 100);

    return () => clearInterval(syncInterval);
  }, [player, shouldHavePlayer, localPlayingState]);

  // Cleanup audio when component unmounts or tab changes
  useEffect(() => {
    return () => {
      // Stop audio when component unmounts
      try {
        if (player?.playing) {
          player.pause();
        }
      } catch (err) {
        // Ignore errors during cleanup - player might already be released
        console.debug('[TranscriptionView] Cleanup: player already released');
      }
    };
  }, []);

  // Load audio data for completed jobs (turns come from props)
  useEffect(() => {
    if (!isCompleted || !visitSessionId) {
      // Clear audio state for non-completed jobs
      setAudioUrl(null);
      setAudioLoading(false);
      return;
    }

    const loadAudioData = async () => {
      try {
        setAudioLoading(true);

        // Only fetch audio data (turns already provided by parent)
        const audioData = await jobService.getVisitSessionAudio(visitSessionId).catch(() => null);

        if (audioData?.presigned_url) {
          setAudioUrl(audioData.presigned_url);
          setAudioStartTimeMs(Number(audioData.start_timestamp_ms));
          if (__DEV__) {
            console.log('[TranscriptionView] Audio loaded for completed job');
          }
        } else {
          if (__DEV__) {
            console.log('[TranscriptionView] No audio available for completed job');
          }
        }
      } catch (err) {
        console.error('[TranscriptionView] Error loading audio:', err);
      } finally {
        setAudioLoading(false);
      }
    };

    loadAudioData();
  }, [isCompleted, visitSessionId]);

  // No need to sync turns - we use initialTurns directly from props
  // Turns are already reconciled by parent (app/jobs/[id].tsx)

  // Update current time from player
  useEffect(() => {
    if (!player || !shouldHavePlayer || !localPlayingState || isSeeking) return;
    
    // Update time while playing and not seeking
    const interval = setInterval(() => {
      try {
        const newTime = player.currentTime;
        if (newTime !== undefined && !isNaN(newTime)) {
          setCurrentTime(newTime);
        }
      } catch (err) {
        console.debug('[TranscriptionView] Error reading currentTime:', err);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [player, shouldHavePlayer, localPlayingState, isSeeking]);

  // Set audio ready when player is loaded
  useEffect(() => {
    if (!player || !shouldHavePlayer || !audioUrl) {
      setAudioReady(false);
      if (!audioUrl) {
        setAudioLoading(false);
      }
      return;
    }
    
    // Player is created, check if it has valid duration
    if (player.duration && player.duration > 0) {
      setAudioReady(true);
      setAudioLoading(false);
    } else {
      // Player created but not yet loaded - keep loading state
      const checkInterval = setInterval(() => {
        try {
          if (player.duration && player.duration > 0) {
            setAudioReady(true);
            setAudioLoading(false);
            clearInterval(checkInterval);
          }
        } catch (err) {
          console.debug('[TranscriptionView] Error checking player duration:', err);
        }
      }, 100);

      // Timeout after 10 seconds
      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        setAudioLoading(false);
        console.warn('[TranscriptionView] Audio loading timeout');
      }, 10000);

      return () => {
        clearInterval(checkInterval);
        clearTimeout(timeout);
      };
    }
  }, [player, shouldHavePlayer, audioUrl, player?.duration]);

  // Auto-scroll to end for live transcription
  useEffect(() => {
    if (!isCompleted && enhancedTurns.length > 0 && flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [enhancedTurns, isCompleted]);

  // Calculate highlighted turn and word for completed jobs with audio
  const highlightedTurnAndWord = useMemo(() => {
    // Don't highlight if audio isn't playing or no turns or not completed
    if (!isPlaying || !isCompleted || !enhancedTurns.length || currentTime === 0) {
      return { turnIndex: null, wordIndex: null };
    }

    // Current audio time in seconds (relative to audio start)
    // word_timestamps use seconds relative to audio start

    // Iterate through all dialogue turns
    for (let turnIndex = 0; turnIndex < enhancedTurns.length; turnIndex++) {
      const turn = enhancedTurns[turnIndex];
      
      // Skip turns without word timestamps
      if (!turn.word_timestamps || turn.word_timestamps.length === 0) {
        continue;
      }

      // Get first and last word timestamps to determine turn range
      const firstWord = turn.word_timestamps[0];
      const lastWord = turn.word_timestamps[turn.word_timestamps.length - 1];
      
      // word_timestamps use seconds relative to audio start
      const turnStartSec = firstWord.start_sec;
      const turnEndSec = lastWord.end_sec;

      // Check if current time is within this turn's word timestamps range
      if (currentTime >= turnStartSec && currentTime <= turnEndSec) {
        // Find the specific word being spoken
        for (let wordIndex = 0; wordIndex < turn.word_timestamps.length; wordIndex++) {
          const word = turn.word_timestamps[wordIndex];
          
          // Check if current time falls within this word's time range
          if (currentTime >= word.start_sec && currentTime <= word.end_sec) {
            return { turnIndex, wordIndex };
          }
        }
        
        // Current time is in the turn but between words (pause)
        return { turnIndex, wordIndex: null };
      }
    }

    // No match found
    return { turnIndex: null, wordIndex: null };
  }, [isPlaying, currentTime, enhancedTurns, isCompleted]);

  // Auto-scroll to highlighted turn during playback
  useEffect(() => {
    if (highlightedTurnAndWord.turnIndex !== null && flatListRef.current) {
      flatListRef.current.scrollToIndex({
        index: highlightedTurnAndWord.turnIndex,
        animated: true,
        viewPosition: 0.5,
      });
    }
  }, [highlightedTurnAndWord.turnIndex]);

  // Audio controls
  const togglePlayPause = useCallback(() => {
    if (!audioReady || !player) return;

    try {
      if (localPlayingState) {
        player.pause();
        setLocalPlayingState(false);
      } else {
        player.play();
        setLocalPlayingState(true);
      }
    } catch (err) {
      console.error('[TranscriptionView] Error toggling play/pause:', err);
    }
  }, [audioReady, player, localPlayingState]);

  const skipBackward = useCallback(() => {
    if (!audioReady || !player) return;
    try {
      const newPosition = Math.max(0, currentTime - 10);
      player.seekTo(newPosition);
      setCurrentTime(newPosition);
    } catch (err) {
      console.error('[TranscriptionView] Error skipping backward:', err);
    }
  }, [audioReady, player, currentTime]);

  const skipForward = useCallback(() => {
    if (!audioReady || !player) return;
    try {
      const newPosition = Math.min(duration, currentTime + 10);
      player.seekTo(newPosition);
      setCurrentTime(newPosition);
    } catch (err) {
      console.error('[TranscriptionView] Error skipping forward:', err);
    }
  }, [audioReady, player, currentTime, duration]);

  const handleSliderStart = useCallback(() => {
    setIsSeeking(true);
  }, []);

  const handleSliderChange = useCallback((value: number) => {
    setCurrentTime(value);
  }, []);

  const handleSliderComplete = useCallback(async (value: number) => {
    if (!audioReady || !player) {
      setIsSeeking(false);
      return;
    }

    const wasPlaying = localPlayingState;

    try {
      // Always pause first for clean seeking
      if (wasPlaying) {
        player.pause();
        setLocalPlayingState(false);
      }

      // Seek to position
      player.seekTo(value);
      setCurrentTime(value);

      // Wait a bit for seek to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Resume if it was playing
      if (wasPlaying) {
        player.play();
        setLocalPlayingState(true);
      }
    } catch (err) {
      console.error('[TranscriptionView] Error seeking:', err);
    } finally {
      setIsSeeking(false);
    }
  }, [audioReady, player, localPlayingState]);

  const handleTurnPress = useCallback(async (turnIndex: number) => {
    if (!isCompleted || !audioReady || !player) return;

    const turn = enhancedTurns[turnIndex];
    if (!turn.word_timestamps || turn.word_timestamps.length === 0) return;

    const wasPlaying = localPlayingState;

    try {
      // Pause first
      if (wasPlaying) {
        player.pause();
        setLocalPlayingState(false);
      }

      // Get seek position
      const firstWord = turn.word_timestamps[0];
      const seekPosition = firstWord.start_sec;
      
      // Seek
      player.seekTo(seekPosition);
      setCurrentTime(seekPosition);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start playing (regardless of previous state, user clicked a turn)
      player.play();
      setLocalPlayingState(true);
    } catch (err) {
      console.error('[TranscriptionView] Error jumping to turn:', err);
    }
  }, [isCompleted, audioReady, player, enhancedTurns, localPlayingState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const [statusVisible, setStatusVisible] = useState(true);
  const statusOpacity = useRef(new Animated.Value(1)).current;

  const statusKey = useMemo(() => {
    if (error) return 'error';
    if (isConnecting) return 'connecting';
    if (isCompleted) return 'completed';
    if (isConnected) return isRecording ? 'recording' : 'live';
    return 'inactive';
  }, [error, isConnecting, isCompleted, isConnected, isRecording]);

  useEffect(() => {
    // Always show when error/connecting/inactive
    if (statusKey === 'error' || statusKey === 'connecting' || statusKey === 'inactive') {
      setStatusVisible(true);
      statusOpacity.setValue(1);
      return;
    }
    // For live/recording/completed: show briefly then fade out
    setStatusVisible(true);
    statusOpacity.setValue(1);
    const timer = setTimeout(() => {
      Animated.timing(statusOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setStatusVisible(false);
      });
    }, 1500); // Changed from 2500ms to 1500ms for brief display
    return () => clearTimeout(timer);
  }, [statusKey, statusOpacity]);

  const renderConnectionStatus = () => {
    // Hide for assigned tech while recording (badge handled elsewhere)
    // if (isAssigned && isRecording) return null;
    // if (!statusVisible && (statusKey === 'live' || statusKey === 'recording' || statusKey === 'completed')) {
    //   return null;
    // }

    const content = (() => {
      if (statusKey === 'completed') {
        return (
          <View style={[styles.statusContainer, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            <ThemedText style={[styles.connectedText, { color: colors.primary }]}>
              Completed Recording
            </ThemedText>
          </View>
        );
      }
      if (statusKey === 'connecting') {
        return (
          <View style={[styles.statusContainer, { backgroundColor: colors.backgroundSecondary }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <ThemedText style={[styles.statusText, { color: colors.textSecondary }]}>
              Connecting to transcription service...
            </ThemedText>
          </View>
        );
      }
      if (statusKey === 'error') {
        return (
          <View style={[styles.statusContainer, styles.errorContainer]}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <ThemedText style={[styles.errorText, { color: colors.error }]}>{error}</ThemedText>
          </View>
        );
      }
      if (statusKey === 'live' || statusKey === 'recording') {
        return (
          <View style={[styles.statusContainer, styles.connectedContainer]}>
            <View style={[styles.liveDot, statusKey === 'recording' && styles.recordingDot]} />
            <ThemedText style={styles.connectedText}>
              {statusKey === 'recording' ? '🎤 Recording & Transcribing' : 'Live Transcription Active'}
            </ThemedText>
          </View>
        );
      }
      return (
        <View style={[styles.statusContainer, { backgroundColor: colors.backgroundSecondary }]}>
          <Ionicons name="mic-off" size={20} color={colors.iconSecondary} />
          <ThemedText style={[styles.statusText, { color: colors.textSecondary }]}>
            Transcription not active
          </ThemedText>
        </View>
      );
    })();

    return (
      <Animated.View style={{ opacity: statusOpacity }}>
        {content}
      </Animated.View>
    );
  };

  const renderEmptyState = () => {
    const subtitle =
      isViewer && jobStatus === 'scheduled'
        ? null
        : isConnected
          ? 'Start speaking to see the transcription'
          : 'Start the job to begin transcription';

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="chatbubbles-outline" size={48} color={colors.iconSecondary} />
        <ThemedText style={[styles.emptyTitle, { color: colors.textSecondary }]}>
          No transcription yet
        </ThemedText>
        {subtitle && (
          <ThemedText style={[styles.emptySubtitle, { color: colors.textTertiary }]}>
            {subtitle}
          </ThemedText>
        )}
      </View>
    );
  };

  // Calculate speaker percentages
  const technicianTurns = enhancedTurns.filter((t) => t.speaker === 'Technician').length;
  const customerTurns = enhancedTurns.filter((t) => t.speaker === 'Customer').length;
  const totalTurns = enhancedTurns.length;
  const technicianPercent = totalTurns > 0 ? Math.round((technicianTurns / totalTurns) * 100) : 0;
  const customerPercent = totalTurns > 0 ? Math.round((customerTurns / totalTurns) * 100) : 0;

  const renderItem = useCallback(
    ({ item, index }: { item: EnhancedTurn; index: number }) => (
      <TurnItem
        turn={item}
        isHighlighted={highlightedTurnAndWord.turnIndex === index}
        highlightedWordIndex={
          highlightedTurnAndWord.turnIndex === index ? highlightedTurnAndWord.wordIndex : null
        }
        onPress={isCompleted && audioUrl ? () => handleTurnPress(index) : undefined}
      />
    ),
    [highlightedTurnAndWord, isCompleted, audioUrl, handleTurnPress]
  );

  if (audioLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText style={[styles.statusText, { color: colors.textSecondary }]}>
          Loading transcription...
        </ThemedText>
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {renderConnectionStatus()}

      <FlatList
        ref={flatListRef}
        data={enhancedTurns}
        keyExtractor={(item, index) => item.id || `turn-${index}`}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          enhancedTurns.length === 0 && styles.emptyListContent,
          audioUrl && { paddingBottom: 180 }, // Extra space for audio player
        ]}
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={(info) => {
          console.warn('[TranscriptionView] Scroll to index failed:', info);
        }}
      />

      {/* Speaker Stats (always show if there are turns) */}
      {enhancedTurns.length > 0 && !audioUrl && (
        <View
          style={[styles.statsBar, { backgroundColor: colors.cardBackground, borderTopColor: colors.border }]}
        >
          <View style={styles.statItem}>
            <View style={[styles.statDot, { backgroundColor: colors.primary }]} />
            <ThemedText style={[styles.statText, { color: colors.textSecondary }]}>
              {technicianPercent}% Technician
            </ThemedText>
          </View>
          <View style={styles.statItem}>
            <View style={[styles.statDot, { backgroundColor: colors.textSecondary }]} />
            <ThemedText style={[styles.statText, { color: colors.textSecondary }]}>
              {customerPercent}% Customer
            </ThemedText>
          </View>
        </View>
      )}

      {/* Audio Player (only for completed jobs with audio) */}
      {isCompleted && audioUrl && (
        <View
          style={[
            styles.audioPlayer,
            { backgroundColor: colors.background, borderTopColor: colors.border },
          ]}
        >
          {/* Loading indicator over controls */}
          {(audioLoading || !audioReady) && (
            <View style={styles.audioLoadingOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
              <ThemedText style={[styles.statusText, { color: colors.textSecondary, marginLeft: Spacing.sm }]}>
                Loading audio...
              </ThemedText>
            </View>
          )}

          {/* Progress Slider */}
          <View style={styles.progressContainer}>
            <ThemedText style={[styles.timeText, { color: colors.textSecondary }]}>
              {formatTime(currentTime)}
            </ThemedText>
            <Slider
              style={styles.slider}
              value={currentTime}
              minimumValue={0}
              maximumValue={duration || 1}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
              disabled={!audioReady}
              onSlidingStart={handleSliderStart}
              onValueChange={handleSliderChange}
              onSlidingComplete={handleSliderComplete}
            />
            <ThemedText style={[styles.timeText, { color: colors.textSecondary }]}>
              -{formatTime(duration - currentTime)}
            </ThemedText>
          </View>

          {/* Speaker Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <View style={[styles.statDot, { backgroundColor: colors.primary }]} />
              <ThemedText style={[styles.statText, { color: colors.textSecondary }]}>
                {technicianPercent}% Technician
              </ThemedText>
            </View>
            <View style={styles.statItem}>
              <View style={[styles.statDot, { backgroundColor: colors.textSecondary }]} />
              <ThemedText style={[styles.statText, { color: colors.textSecondary }]}>
                {customerPercent}% Customer
              </ThemedText>
            </View>
          </View>

          {/* Control Buttons */}
          <View style={styles.controls}>
            <Pressable onPress={skipBackward} style={styles.controlButton} disabled={!audioReady}>
              <Ionicons name="play-back" size={28} color={audioReady ? colors.text : colors.textTertiary} />
            </Pressable>

            <Pressable
              onPress={togglePlayPause}
              style={[styles.playButton, { backgroundColor: audioReady ? colors.primary : colors.border }]}
              disabled={!audioReady}
            >
              {audioLoading || !audioReady ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#ffffff" />
              )}
            </Pressable>

            <Pressable onPress={skipForward} style={styles.controlButton} disabled={!audioReady}>
              <Ionicons name="play-forward" size={28} color={audioReady ? colors.text : colors.textTertiary} />
            </Pressable>
          </View>
        </View>
      )}
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  connectedContainer: {
    backgroundColor: '#dcfce7',
  },
  errorContainer: {
    backgroundColor: '#fee2e2',
  },
  statusText: {
    fontSize: FontSizes.sm,
  },
  connectedText: {
    fontSize: FontSizes.sm,
    color: '#15803d',
    fontWeight: '500',
  },
  errorText: {
    fontSize: FontSizes.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  recordingDot: {
    backgroundColor: '#ef4444',
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing['5xl'],
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  turnContainer: {
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.md,
    maxWidth: '90%',
  },
  technicianTurn: {
    alignSelf: 'flex-start',
  },
  customerTurn: {
    alignSelf: 'flex-start',
  },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  timestamp: {
    fontSize: FontSizes.sm,
    fontWeight: '400',
  },
  partialBadge: {
    backgroundColor: 'rgba(255, 204, 128, 0.15)',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginLeft: 'auto',
  },
  partialText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#d97706',
  },
  wordContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  turnText: {
    fontSize: FontSizes.md,
    lineHeight: 22,
  },
  partialTurnText: {
    fontStyle: 'italic',
    opacity: 0.8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing['5xl'],
    gap: Spacing.md,
  },
  emptyTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing['3xl'],
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderTopWidth: 1,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statText: {
    fontSize: FontSizes.xs,
  },
  audioPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    borderTopWidth: 1,
    // backgroundColor will be added dynamically with colors.background
  },
  audioLoadingOverlay: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  timeText: {
    fontSize: FontSizes.xs,
    minWidth: 40,
    fontWeight: '500',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing['2xl'],
  },
  controlButton: {
    padding: Spacing.sm,
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default TranscriptionView;

