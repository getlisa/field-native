/**
 * useStreamingTTS - Text-to-Speech hook for streaming AI responses
 * 
 * Converts streaming text tokens into audio playback using TTS API.
 * Queues audio chunks for gapless playback as text streams in.
 * 
 * Features:
 * - Buffers text until sentence boundaries or threshold
 * - Generates audio in parallel for low latency
 * - Queues audio chunks for sequential playback
 * - Handles React Native audio playback via expo-audio
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

interface AudioQueueItem {
  text: string;
  audioUri?: string;
}

const FLUSH_TIMEOUT_MS = 150; // Flush quickly after short pause

// Strip basic markdown artifacts so TTS receives clean text.
const normalizeChunk = (input: string) => {
  return input
    .replace(/\*\*/g, ' ') // bold markers
    .replace(/__|`/g, ' ') // underline/code markers
    .replace(/^\s*#+\s+/gm, ' ') // headings (keep line, drop markdown)
    .replace(/^\s*[-*]\s+/gm, ' ') // bullet prefixes (keep line, drop markdown)
    .trimStart();
};

const COPILOT_API_BASE = process.env.EXPO_PUBLIC_COPILOT_BASE_URL 
  ? `${process.env.EXPO_PUBLIC_COPILOT_BASE_URL}/api/v1`
  : 'https://kzrvokx9if.execute-api.ap-south-1.amazonaws.com/staging/api/v1';

export function useStreamingTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const queueRef = useRef<AudioQueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const textBufferRef = useRef('');
  const bufferTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingUriRef = useRef<string | null>(null);
  const playNextRef = useRef<(() => void) | undefined>(undefined);
  const isProcessingNextRef = useRef(false); // Lock to prevent concurrent playNext calls

  // Create ONE player instance that stays alive
  // Use empty source initially, we'll use replace() to change the source
  const player = useAudioPlayer('');
  const lastPositionRef = useRef<number>(0);
  const positionStuckCountRef = useRef<number>(0);

  // Monitor playback status with improved detection
  useEffect(() => {
    if (!player) return;

    const checkPlaybackStatus = () => {
      try {
        if (!player) return;
        
        const isPlaying = player.playing ?? false;
        const currentPosition = player.currentTime ?? 0;
        const duration = player.duration ?? 0;
        
        // Update playing state when playback starts
        if (isPlaying && !isPlayingRef.current) {
          console.log('[useStreamingTTS] Playback started');
          isPlayingRef.current = true;
          setIsSpeaking(true);
          lastPositionRef.current = currentPosition;
          positionStuckCountRef.current = 0;
        }
        
        // Detect when audio finishes - multiple conditions for reliability
        const playbackFinished = isPlayingRef.current && playingUriRef.current && (
          // Condition 1: Player stopped playing
          (!isPlaying && currentPosition > 0) ||
          // Condition 2: Reached the end (with small tolerance)
          (duration > 0 && currentPosition >= duration - 0.1) ||
          // Condition 3: Position stuck (not advancing for multiple checks)
          (isPlaying && currentPosition > 0 && currentPosition === lastPositionRef.current && ++positionStuckCountRef.current > 5)
        );
        
        if (playbackFinished) {
          console.log('[useStreamingTTS] Audio chunk finished, queue size:', queueRef.current.length, {
            isPlaying,
            currentPosition,
            duration,
            positionStuckCount: positionStuckCountRef.current
          });
          
          // Clean up current file
          if (playingUriRef.current) {
            FileSystem.deleteAsync(playingUriRef.current, { idempotent: true }).catch(console.error);
            playingUriRef.current = null;
          }
          
          isPlayingRef.current = false;
          isProcessingNextRef.current = false;
          lastPositionRef.current = 0;
          positionStuckCountRef.current = 0;
          
          // Check if there are more items in queue
          if (queueRef.current.length > 0) {
            console.log('[useStreamingTTS] More chunks in queue, playing next');
            setTimeout(() => playNextRef.current?.(), 50);
          } else {
            console.log('[useStreamingTTS] No more chunks, stopping');
            setIsSpeaking(false);
          }
        }
        
        // Update last position for stuck detection
        if (currentPosition !== lastPositionRef.current) {
          lastPositionRef.current = currentPosition;
          positionStuckCountRef.current = 0;
        }
        
      } catch (error) {
        console.warn('[useStreamingTTS] Error in status check:', error);
        if (isPlayingRef.current) {
          isPlayingRef.current = false;
          isProcessingNextRef.current = false;
          setIsSpeaking(false);
        }
      }
    };

    // Poll every 200ms for status updates
    const interval = setInterval(checkPlaybackStatus, 200);

    return () => clearInterval(interval);
  }, [player]);

  const generateAudio = useCallback(async (item: AudioQueueItem) => {
    if (item.audioUri) return; // Already generated

    try {
      setIsLoading(true);
      console.log('[useStreamingTTS] Generating audio for text chunk:', item.text.substring(0, 50) + '...');
      
      if (!COPILOT_API_BASE) {
        throw new Error("EXPO_PUBLIC_COPILOT_BASE_URL is not set");
      }

      const response = await fetch(`${COPILOT_API_BASE}/voice/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: item.text, voice: 'alloy' })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[useStreamingTTS] TTS error response:', errorText);
        throw new Error(`TTS API error: ${response.status}`);
      }

      // In React Native, use arrayBuffer() directly instead of blob().arrayBuffer()
      // as React Native's Blob doesn't support arrayBuffer() method
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      console.log('[useStreamingTTS] Audio data received, size:', arrayBuffer.byteLength, 'bytes');
      
      if (arrayBuffer.byteLength === 0) {
        throw new Error('Received empty audio data');
      }
      
      // Convert to base64 using Buffer (available in React Native via polyfill or native)
      // Fallback to manual conversion if Buffer is not available
      let base64Data: string;
      try {
        // Try using Buffer if available (React Native with polyfill)
        if (typeof Buffer !== 'undefined') {
          base64Data = Buffer.from(uint8Array).toString('base64');
        } else {
          // Fallback: manual base64 conversion
          let binary = '';
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          base64Data = btoa(binary);
        }
      } catch (error) {
        // Final fallback: use btoa directly
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        base64Data = btoa(binary);
      }
      
      // Save to file system
      // Use legacy API for async operations
      const cacheDir = FileSystem.cacheDirectory || '';
      const fileUri = `${cacheDir}tts-${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`;
      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: 'base64',
      });

      item.audioUri = fileUri;
      console.log('[useStreamingTTS] Audio generation complete and saved to:', fileUri);
      
      setIsLoading(false);
      
      // Trigger playback if not already playing or processing
      // Use setTimeout to debounce rapid completion events
      if (!isPlayingRef.current && !isProcessingNextRef.current) {
        setTimeout(() => {
          if (!isPlayingRef.current && !isProcessingNextRef.current) {
            playNextRef.current?.();
          }
        }, 50);
      }
    } catch (error) {
      console.error('[useStreamingTTS] Error generating audio:', error);
      setIsLoading(false);
    }
  }, []);

  const playNext = useCallback(() => {
    // Already playing - will be called when current finishes
    if (isPlayingRef.current) {
      console.log('[useStreamingTTS] Already playing, will be called when current finishes');
      return;
    }

    if (!player) {
      console.warn('[useStreamingTTS] No player available');
      return;
    }

    // Find the first item with ready audio (like web version)
    const readyIndex = queueRef.current.findIndex(item => item.audioUri);
    
    if (readyIndex === -1) {
      // No audio ready yet
      console.log('[useStreamingTTS] No audio ready yet, queue size:', queueRef.current.length);
      if (queueRef.current.length === 0) {
        setIsSpeaking(false);
        isPlayingRef.current = false;
        isProcessingNextRef.current = false;
      }
      return;
    }

    // If there are items before this one without audio, keep waiting (maintain order)
    if (readyIndex > 0) {
      console.log(`[useStreamingTTS] Waiting for ${readyIndex} chunk(s) to be ready before playing`);
      setTimeout(() => playNextRef.current?.(), 50);
      return;
    }

    // First item is ready - start playing
    isPlayingRef.current = true;
    isProcessingNextRef.current = true;
    setIsSpeaking(true);
    
    const item = queueRef.current.shift()!;
    const audioUri = item.audioUri!;
    playingUriRef.current = audioUri;

    console.log('[useStreamingTTS] Playing audio chunk, remaining in queue:', queueRef.current.length);
    
    try {
      // Check if player is still valid before using it
      if (!player) {
        console.warn('[useStreamingTTS] Player is null, skipping playback');
        isPlayingRef.current = false;
        isProcessingNextRef.current = false;
        if (playingUriRef.current) {
          FileSystem.deleteAsync(playingUriRef.current, { idempotent: true }).catch(console.error);
          playingUriRef.current = null;
        }
        return;
      }

      player.replace(audioUri);
      
      // Small delay before starting playback to allow source to load
      setTimeout(() => {
        try {
          if (player) {
            player.play();
            console.log('[useStreamingTTS] Audio playback started successfully');
          }
        } catch (error) {
          console.error('[useStreamingTTS] Error starting playback:', error);
          isPlayingRef.current = false;
          isProcessingNextRef.current = false;
          if (playingUriRef.current) {
            FileSystem.deleteAsync(playingUriRef.current, { idempotent: true }).catch(console.error);
            playingUriRef.current = null;
          }
          // Try next item
          setTimeout(() => playNextRef.current?.(), 100);
        }
      }, 100);
    } catch (error: any) {
      // Handle case where native player object was invalidated (e.g., audio session reconfigured)
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('NativeSharedObjectNotFoundException') || 
          errorMsg.includes('Unable to find the native shared object')) {
        console.warn('[useStreamingTTS] Player object invalidated (likely due to audio session change), skipping playback');
      } else {
        console.error('[useStreamingTTS] Error replacing audio source:', error);
      }
      isPlayingRef.current = false;
      isProcessingNextRef.current = false;
      setIsSpeaking(false);
      if (playingUriRef.current) {
        FileSystem.deleteAsync(playingUriRef.current, { idempotent: true }).catch(console.error);
        playingUriRef.current = null;
      }
      // Try next item
      setTimeout(() => playNextRef.current?.(), 100);
    }
  }, [player]);
  
  // Store playNext in ref to avoid circular dependencies
  playNextRef.current = playNext;

  const flushBufferedText = useCallback(() => {
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
      bufferTimeoutRef.current = null;
    }

    if (textBufferRef.current.trim()) {
      const textToSpeak = textBufferRef.current.trim();
      textBufferRef.current = '';
      
      const newItem = { text: textToSpeak };
      queueRef.current.push(newItem);
      console.log('[useStreamingTTS] Flushed buffered text to queue, size:', queueRef.current.length);
      setIsSpeaking(true); // reflect speaking/queued state immediately

      // Start generating audio immediately in parallel
      generateAudio(newItem);
    }
  }, [generateAudio]);

  const addToQueue = useCallback((text: string) => {
    // Immediately reflect that speech is pending so the stop button appears without delay
    setIsSpeaking(true);
    
    const normalizedText = normalizeChunk(text);
    if (!normalizedText) {
      return;
    }

    // Clear any pending timeout while we process the new chunk
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
      bufferTimeoutRef.current = null;
    }

    // Merge incoming text until we hit newline boundaries. Each newline means a line is complete,
    // so we flush the buffer to TTS right away.
    const newlineRegex = /\n+/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = newlineRegex.exec(normalizedText)) !== null) {
      const segment = normalizedText.slice(lastIndex, match.index);
      if (segment) {
        textBufferRef.current += segment;
      }
      flushBufferedText(); // flush completed line
      lastIndex = match.index + match[0].length;
    }

    const remaining = normalizedText.slice(lastIndex);
    if (remaining) {
      textBufferRef.current += remaining;
    }

    // If we have remaining text without a newline yet, set a short timer to avoid getting stuck
    // on partial lines when the stream pauses.
    if (textBufferRef.current.trim()) {
      bufferTimeoutRef.current = setTimeout(() => {
        flushBufferedText();
      }, FLUSH_TIMEOUT_MS);
    }
  }, [flushBufferedText]);

  const flush = useCallback(() => {
    // Flush any remaining text in buffer
    flushBufferedText();
  }, [flushBufferedText]);

  const stop = useCallback(() => {
    console.log('[useStreamingTTS] Stopping TTS');
    
    // Clear buffer timeout
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
      bufferTimeoutRef.current = null;
    }

    // Stop current audio
    try {
      if (player && player.playing) {
        player.pause();
      }
    } catch (error) {
      console.warn('[useStreamingTTS] Error pausing player:', error);
    }

    // Clean up current playing file
    if (playingUriRef.current) {
      FileSystem.deleteAsync(playingUriRef.current, { idempotent: true }).catch(console.error);
      playingUriRef.current = null;
    }

    // Clear queue and clean up files
    for (const item of queueRef.current) {
      if (item.audioUri) {
        FileSystem.deleteAsync(item.audioUri, { idempotent: true }).catch(console.error);
      }
    }
    
    // Reset all state
    queueRef.current = [];
    textBufferRef.current = '';
    isPlayingRef.current = false;
    isProcessingNextRef.current = false;
    setIsSpeaking(false);
    setIsLoading(false);
  }, [player]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (bufferTimeoutRef.current) {
        clearTimeout(bufferTimeoutRef.current);
      }
      stop();
    };
  }, [stop]);

  return {
    addToQueue,
    flush,
    stop,
    isSpeaking,
    isLoading
  };
}
