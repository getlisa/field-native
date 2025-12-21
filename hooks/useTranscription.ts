import { useCallback, useRef, useState } from 'react';

import { AudioRecorder } from '@/lib/audio/AudioRecorder';
import type { AudioChunkData } from '@/lib/audio/types';
import {
  convertCacheTurnsToDialogueTurns,
  RealtimeChat,
  type CacheTurn,
  type DialogueTurn,
  type RealtimeChatOptions,
} from '@/lib/RealtimeChat';

interface UseTranscriptionOptions {
  onProactiveSuggestions?: (data: any) => void;
  jobId?: string; // Job ID for deep linking from background service notification
}

interface UseTranscriptionReturn {
  turns: DialogueTurn[];
  isConnected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  error: string | null;
  startTranscription: (visitSessionId: string, companyId?: string | number) => Promise<void>;
  stopTranscription: () => void;
}

export function useTranscription(options?: UseTranscriptionOptions): UseTranscriptionReturn {
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const realtimeChatRef = useRef<RealtimeChat | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const optionsRef = useRef(options);

  // Update options ref when options change
  optionsRef.current = options;

  const handleCachedTurnsUpdate = useCallback((cacheTurns: CacheTurn[]) => {
    const dialogueTurns = convertCacheTurnsToDialogueTurns(cacheTurns);
    setTurns(dialogueTurns);
  }, []);

  /**
   * Start audio recording and send chunks to WebSocket
   */
  const startAudioRecording = useCallback(() => {
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
    }

    audioRecorderRef.current = new AudioRecorder({
      jobId: optionsRef.current?.jobId, // Pass job ID for deep linking
      onAudioChunk: (chunk: AudioChunkData) => {
        // Send audio chunk to WebSocket (only if valid data)
        if (chunk.byteSize > 0 && realtimeChatRef.current?.isConnected()) {
          realtimeChatRef.current.sendAudioChunk(chunk.base64);
        }
      },
      onError: (err: Error) => {
        console.error('[Transcription] Audio recording error:', err);
        setError(`Audio error: ${err.message}`);
      },
      onStatusChange: (recording: boolean) => {
        setIsRecording(recording);
        if (__DEV__) {
          console.log('[Transcription] Recording status:', recording);
        }
      },
    });

    audioRecorderRef.current.start();
  }, []);

  /**
   * Stop audio recording
   */
  const stopAudioRecording = useCallback(() => {
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const startTranscription = useCallback(
    async (visitSessionId: string, companyId?: string | number) => {
      // Clean up existing instances
      if (realtimeChatRef.current) {
        realtimeChatRef.current.disconnect();
      }
      stopAudioRecording();

      setIsConnecting(true);
      setError(null);
      setTurns([]);

      const options: RealtimeChatOptions = {
        visitSessionId,
        companyId,
        onCachedTurnsUpdate: handleCachedTurnsUpdate,
        onReady: () => {
          if (__DEV__) {
            console.log('[Transcription] WebSocket ready, starting audio recording...');
          }
          setIsConnected(true);
          setIsConnecting(false);

          // Start audio recording when WebSocket is ready
          startAudioRecording();
        },
        onError: (err) => {
          console.error('[Transcription] WebSocket error:', err.message);
          setError(err.message);
          setIsConnecting(false);
          // Don't auto-stop audio on error; let explicit stopTranscription handle it
        },
        onSessionEnded: () => {
          if (__DEV__) {
            console.log('[Transcription] Session ended signal received from server');
          }
          setIsConnected(false);
          // Only stop recording if the session truly ended from server
          // stopAudioRecording(); -- disabled: let explicit stopTranscription handle it
        },
        onConnectionStateChange: (connected) => {
          setIsConnected(connected);
          if (!connected) {
            setIsConnecting(false);
            // Don't stop audio here; let explicit stopTranscription handle it
            // This avoids stopping recording on transient WebSocket flaps
          }
        },
        onProactiveSuggestions: (data) => {
          if (__DEV__) {
            console.log('[Transcription] Proactive suggestions received, invalidating job data');
          }
          // Call the provided callback to invalidate job query
          optionsRef.current?.onProactiveSuggestions?.(data);
        },
      };

      realtimeChatRef.current = new RealtimeChat(options);

      try {
        await realtimeChatRef.current.init();
      } catch (err: any) {
        setError(err?.message || 'Failed to start transcription');
        setIsConnecting(false);
        setIsConnected(false);
        stopAudioRecording();
      }
    },
    [handleCachedTurnsUpdate, startAudioRecording, stopAudioRecording]
  );

  const stopTranscription = useCallback(() => {
    // Stop audio recording first
    stopAudioRecording();

    // Then disconnect WebSocket
    if (realtimeChatRef.current) {
      realtimeChatRef.current.disconnect();
      realtimeChatRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, [stopAudioRecording]);

  return {
    turns,
    isConnected,
    isConnecting,
    isRecording,
    error,
    startTranscription,
    stopTranscription,
  };
}

export default useTranscription;
