/**
 * useSubscriberTranscription.ts - WebSocket hook for viewing ongoing jobs
 * 
 * This hook allows non-assigned technicians to subscribe to ongoing job transcriptions
 * without starting their own recording session. It receives both audio and transcript updates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type DialogueTurn, type CacheTurn } from '@/lib/RealtimeChat';
import { API_BASE_URL } from '@/lib/apiClient';
import { useAudioStreamManager } from '@/hooks/useAudioStreamManager';

/**
 * Reconcile API-fetched turns with WebSocket cached_turns
 * 
 * Strategy: Simple append/replace by turn_id
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

interface UseSubscriberTranscriptionProps {
  transcriptionSessionId: string | null;
  isJobOngoing: boolean;
  enabled: boolean; // Only enabled for viewers of ongoing jobs
  lastHeartbeatAt?: string | null; // Last heartbeat timestamp to check if session is active
}

export const useSubscriberTranscription = ({
  transcriptionSessionId,
  isJobOngoing,
  enabled,
  lastHeartbeatAt,
}: UseSubscriberTranscriptionProps) => {
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [isReceivingTurns, setIsReceivingTurns] = useState(false); // Track if we're receiving cached_turns
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false); // Track if we're retrying connection
  
  const wsRef = useRef<WebSocket | null>(null);
  const isReceivingAudioRef = useRef(false);
  const isAudioEnabledRef = useRef(false);
  const lastMessageTimeRef = useRef<number>(Date.now());
  const lastAudioChunkTimeRef = useRef<number>(0); // Track when we last received an audio chunk
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Timeout for no audio chunks
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Timeout for retry
  const apiTurnsRef = useRef<DialogueTurn[]>([]); // Store API-fetched turns
  const [retryTrigger, setRetryTrigger] = useState(0); // State to trigger useEffect re-run for retries
  const isRetryingRef = useRef(false); // Track if this is a retry attempt (skip heartbeat check)
  
  // Use the audio stream manager hook with pre-buffering config
  const audioStreamManager = useAudioStreamManager({
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    bufferDurationMs: 500,
    minBufferChunks: 2,
  });
  const audioManagerRef = useRef(audioStreamManager);
  
  // Update ref when manager changes
  useEffect(() => {
    audioManagerRef.current = audioStreamManager;
  }, [audioStreamManager]);

  // Toggle audio playback
  const toggleAudio = async () => {
    if (!isReceivingAudio) return;
    
    const newState = !isAudioEnabled;
    setIsAudioEnabled(newState);
    isAudioEnabledRef.current = newState;

    if (newState) {
      // Initialize audio manager
      await audioManagerRef.current.initialize();
    } else {
      // Stop audio
      await audioManagerRef.current.stop();
    }
  };

  useEffect(() => {
    // Cleanup function
    const cleanup = async () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setIsConnected(false);
      }
      // Flush any remaining buffered audio, then stop
      await audioManagerRef.current.flush();
      await audioManagerRef.current.stop();
      setIsReceivingAudio(false);
      isReceivingAudioRef.current = false;
      setIsAudioEnabled(false);
      isAudioEnabledRef.current = false;
    };

    // Only connect if enabled, job is ongoing, and we have a session ID
    if (!enabled || !isJobOngoing || !transcriptionSessionId) {
      // Cleanup if conditions not met
      cleanup();
      return;
    }

    // Check if heartbeat is recent (less than 10 seconds old)
    // BUT: Skip this check if we're in a retry attempt - just try to connect
    // The WebSocket will disconnect if there's no data anyway
    if (lastHeartbeatAt && !isRetryingRef.current) {
      const heartbeatTime = new Date(lastHeartbeatAt).getTime();
      const now = Date.now();
      const timeSinceHeartbeat = now - heartbeatTime;
      
      if (timeSinceHeartbeat > 10000) {
        // Heartbeat is more than 10 seconds old, schedule a retry instead of giving up
        console.log('[SubscriberTranscription] Heartbeat too old, will retry in 5 seconds');
        setIsRetrying(true);
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        retryTimeoutRef.current = setTimeout(() => {
          console.log('[SubscriberTranscription] Retrying connection (heartbeat check retry)...');
          isRetryingRef.current = true; // Mark as retry to skip heartbeat check next time
          setRetryTrigger(prev => prev + 1);
        }, 5000);
        return;
      }
    }

    // Get WebSocket URL from centralized API base
    const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
    const wsHost = API_BASE_URL.replace(/^https?:\/\//, '').replace(/\/api.*$/, '');
    const wsUrl = `${wsProtocol}://${wsHost}/api/transcriptions/subscribe/${transcriptionSessionId}`;

    console.log('[SubscriberTranscription] Connecting to:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let audioChunkCount = 0;

    ws.onopen = () => {
      console.log('[SubscriberTranscription] Connected');
      setIsConnected(true);
      setError(null);
      setIsRetrying(false); // Clear retrying flag on successful connection
      isRetryingRef.current = false; // Clear retry flag
      lastMessageTimeRef.current = Date.now();
      lastAudioChunkTimeRef.current = 0; // Reset audio chunk tracking
      
      // Clear any pending retry
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      
      // Set timeout to disconnect if no audio chunks received within 5 seconds
      audioTimeoutRef.current = setTimeout(() => {
        if (lastAudioChunkTimeRef.current === 0) {
          // No audio chunks received yet, disconnect and let retry logic handle reconnection
          console.log('[SubscriberTranscription] No audio chunks received within 5 seconds, disconnecting');
          if (wsRef.current) {
            wsRef.current.close();
          }
        }
      }, 5000);
    };

    ws.onmessage = async (event) => {
      try {
        // Update last message time
        lastMessageTimeRef.current = Date.now();
        
        // Clear existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        
        // Set new timeout - disconnect if no data for 10 seconds
        timeoutRef.current = setTimeout(() => {
          console.log('[SubscriberTranscription] No data received for 10 seconds, disconnecting');
          if (wsRef.current) {
            wsRef.current.close();
          }
        }, 10000);
        
        // Check if message is JSON (cached_turns) or base64 audio
        let messageData: any;
        try {
          messageData = JSON.parse(event.data);
        } catch {
          // Not JSON, it's base64 audio buffer
          audioChunkCount++;
          
          // Track that we received an audio chunk
          lastAudioChunkTimeRef.current = Date.now();
          
          // Clear the audio timeout since we received audio
          if (audioTimeoutRef.current) {
            clearTimeout(audioTimeoutRef.current);
            audioTimeoutRef.current = null;
          }
          
          // Log audio chunks (first one and every 20th)
          if (audioChunkCount === 1 || audioChunkCount % 20 === 0) {
            console.log(`[SubscriberTranscription] 🎵 Audio chunk #${audioChunkCount} received (${event.data.length} bytes), playback: ${isAudioEnabledRef.current ? 'ON' : 'OFF'}`);
          }
          
          // Mark that we're receiving audio (using ref to avoid re-render loop)
          if (!isReceivingAudioRef.current) {
            console.log('[SubscriberTranscription] 🔊 Started receiving audio stream');
            isReceivingAudioRef.current = true;
            setIsReceivingAudio(true);
          }

          // Play audio only if audio is enabled and manager exists
          if (isAudioEnabledRef.current && audioManagerRef.current) {
            const base64AudioData = event.data as string;
            await audioManagerRef.current.playChunk(base64AudioData);
          }
          
          return;
        }

        // Handle JSON messages (cached_turns)
        if (messageData.type === 'cached_turns' && Array.isArray(messageData.turns)) {
          // Mark that we're receiving turns from WebSocket
          if (!isReceivingTurns) {
            console.log('[SubscriberTranscription] 📝 Started receiving cached_turns from WebSocket');
            setIsReceivingTurns(true);
          }
          
          // Convert CacheTurn[] to DialogueTurn[]
          const convertedTurns: DialogueTurn[] = messageData.turns
            .filter((turn: any) => turn && typeof turn.text === 'string')
            .sort((a: CacheTurn, b: CacheTurn) => a.turn_index - b.turn_index)
            .map((turn: CacheTurn) => ({
              id: turn.turn_id?.toString() || turn.provider_result_id,
              resultId: turn.provider_result_id,
              turn_id: turn.turn_id || undefined, // Primary key for reconciliation
              speaker: turn.speaker === 'technician' ? 'Technician' : 'Customer',
              text: turn.text,
              timestamp: new Date(turn.updated_at_ms),
              isPartial: !turn.is_final,
              turn_index: turn.turn_index,
              word_timestamps: turn.word_timestamps,
            }));

          // Reconcile API turns with WebSocket cached turns
          const reconciled = reconcileTurns(apiTurnsRef.current, convertedTurns);
          setTurns(reconciled);
          
          if (__DEV__) {
            console.log('[SubscriberTranscription] Reconciled turns:', {
              apiTurns: apiTurnsRef.current.length,
              cachedTurns: convertedTurns.length,
              reconciled: reconciled.length,
            });
          }
        }
      } catch (error) {
        console.error('[SubscriberTranscription] Error processing message:', error);
      }
    };

    ws.onerror = (err) => {
      console.error('[SubscriberTranscription] WebSocket error:', err);
      setError('Connection error');
    };

    ws.onclose = (event) => {
      console.log('[SubscriberTranscription] WebSocket closed:', event.code, event.reason);
      wsRef.current = null;
      setIsConnected(false);
      setIsReceivingAudio(false);
      setIsReceivingTurns(false);
      isReceivingAudioRef.current = false;
      
      // Clear timeouts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (audioTimeoutRef.current) {
        clearTimeout(audioTimeoutRef.current);
        audioTimeoutRef.current = null;
      }
      
      // Stop audio
      audioManagerRef.current.flush().catch(() => {});
      audioManagerRef.current.stop();
      
      // Schedule retry after 5 seconds if conditions are still met
      if (enabled && isJobOngoing && transcriptionSessionId) {
        setIsRetrying(true);
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        retryTimeoutRef.current = setTimeout(() => {
          console.log('[SubscriberTranscription] Retrying connection (attempt after disconnect)...');
          isRetryingRef.current = true; // Mark as retry to skip heartbeat check
          setRetryTrigger(prev => prev + 1); // Trigger useEffect re-run
        }, 5000);
      }
    };

    return () => {
      // Cleanup on unmount or dependency change
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (audioTimeoutRef.current) {
        clearTimeout(audioTimeoutRef.current);
        audioTimeoutRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      audioManagerRef.current.flush().catch(() => {});
      audioManagerRef.current.stop();
      setIsConnected(false);
      setIsReceivingAudio(false);
      setIsReceivingTurns(false);
      isReceivingAudioRef.current = false;
      setIsAudioEnabled(false);
      isAudioEnabledRef.current = false;
      lastAudioChunkTimeRef.current = 0; // Reset audio chunk tracking
    };
  // Note: do NOT depend on audioStreamManager to avoid re-renders causing reconnect loops
  // retryTrigger is included to allow retry logic to trigger reconnection
  }, [enabled, isJobOngoing, transcriptionSessionId, lastHeartbeatAt, retryTrigger]);
  
  /**
   * Set API-fetched turns (will be reconciled with cached_turns from WebSocket)
   * Uses useCallback to ensure stable reference
   */
  const setApiTurns = useCallback((newApiTurns: DialogueTurn[]) => {
    apiTurnsRef.current = newApiTurns;
    
    // If we have cached turns from WebSocket, reconcile them
    setTurns((currentTurns) => {
      if (currentTurns.length > 0 && isConnected) {
        return reconcileTurns(newApiTurns, currentTurns);
      }
      return newApiTurns;
    });
    
    if (__DEV__) {
      console.log('[SubscriberTranscription] API turns set:', newApiTurns.length);
    }
  }, [isConnected]);

  return {
    turns,
    isConnected,
    isReceivingAudio,
    isReceivingTurns, // Track if we're receiving cached_turns from WebSocket
    isRetrying, // Track if we're retrying connection
    isAudioEnabled,
    toggleAudio,
    error,
    setApiTurns,
  };
};

export default useSubscriberTranscription;
