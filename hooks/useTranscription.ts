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

/**
 * Reconcile API-fetched turns with WebSocket cached_turns
 * 
 * Strategy: Simple append/replace
 * - API turns = baseline (already in correct DB order)
 * - For each cached turn:
 *   - If turn_id exists in API → Replace that turn (fresher data)
 *   - If turn_id doesn't exist → Append to end (new live turn)
 * 
 * Note: DON'T sort by turn_index! Each transcription_session has its own
 * turn_index starting from 0, so sorting would mix different sessions.
 */
function reconcileTurns(apiTurns: DialogueTurn[], cachedTurns: DialogueTurn[]): DialogueTurn[] {
  if (apiTurns.length === 0) {
    return cachedTurns;
  }
  
  if (cachedTurns.length === 0) {
    return apiTurns;
  }
  
  // Start with API turns (preserve DB order)
  const reconciled = [...apiTurns];
  
  // Process each cached turn
  for (const cachedTurn of cachedTurns) {
    // Find matching turn by turn_id (primary key)
    const existingIndex = reconciled.findIndex(t => t.turn_id === cachedTurn.turn_id);
    
    if (existingIndex >= 0) {
      // Replace existing turn with fresher WS data
      reconciled[existingIndex] = cachedTurn;
    } else {
      // New turn not in DB yet - append to end
      reconciled.push(cachedTurn);
    }
  }
  
  // Return as-is (DO NOT SORT - DB order is correct)
  return reconciled;
}

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
  setApiTurns: (turns: DialogueTurn[]) => void; // For setting API-fetched turns
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
  
  // Store API-fetched turns separately to allow reconciliation with cached_turns
  const apiTurnsRef = useRef<DialogueTurn[]>([]);

  // Update options ref when options change
  optionsRef.current = options;

  const handleCachedTurnsUpdate = useCallback((cacheTurns: CacheTurn[]) => {
    const newDialogueTurns = convertCacheTurnsToDialogueTurns(cacheTurns);
    
    // Reconcile: merge API turns with cached turns from WebSocket
    // API turns are the baseline, cached turns are the live updates
    const reconciled = reconcileTurns(apiTurnsRef.current, newDialogueTurns);
    setTurns(reconciled);
    
    if (__DEV__) {
      console.log('[Transcription] Reconciled turns:', {
        apiTurns: apiTurnsRef.current.length,
        cachedTurns: newDialogueTurns.length,
        reconciled: reconciled.length,
      });
    }
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
  
  /**
   * Set API-fetched turns (will be reconciled with cached_turns from WebSocket)
   */
  const setApiTurns = useCallback((newApiTurns: DialogueTurn[]) => {
    apiTurnsRef.current = newApiTurns;
    
    // If we have cached turns from WebSocket, reconcile them
    // Otherwise, just show API turns
    setTurns((currentTurns) => {
      // If we already have turns from WebSocket, reconcile
      if (currentTurns.length > 0 && realtimeChatRef.current?.isConnected()) {
        return reconcileTurns(newApiTurns, currentTurns);
      }
      // Otherwise, just use API turns
      return newApiTurns;
    });
    
    if (__DEV__) {
      console.log('[Transcription] API turns set:', newApiTurns.length);
    }
  }, []);

  return {
    turns,
    isConnected,
    isConnecting,
    isRecording,
    error,
    startTranscription,
    stopTranscription,
    setApiTurns,
  };
}

export default useTranscription;
