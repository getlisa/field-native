/**
 * useSubscriberTranscription.ts - WebSocket hook for viewing ongoing jobs
 * 
 * This hook allows non-assigned technicians to subscribe to ongoing job transcriptions
 * without starting their own recording session. It receives both audio and transcript updates.
 * 
 * Binary Protocol:
 * - All messages use a single-byte header (first byte) to indicate message type
 * - 0x00: Audio message (raw PCM16 audio follows)
 *   - Format: mono, 16kHz, 16-bit signed little-endian PCM
 *   - Typical size: 1600-3200 bytes per chunk
 *   - Frequency: ~10-20 chunks/second during active recording
 * - 0x01: JSON control message (UTF-8 JSON string follows)
 *   - Used for: cached_turns updates, session control, etc.
 *   - Sent on: final transcription results, session events
 * 
 * Performance Benefits:
 * - ~33% size reduction (no base64 overhead for audio)
 * - ~70-80% CPU reduction (no encoding/decoding, no JSON parsing for audio)
 * - ~40-50% latency improvement
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import { type DialogueTurn, type CacheTurn, convertCacheTurnsToDialogueTurns } from '@/lib/RealtimeChat';
import { API_BASE_URL } from '@/lib/apiClient';
import { useAudioStreamManager } from '@/hooks/useAudioStreamManager';

// No reconciliation needed - just replace turns directly when cached_turns are received

interface UseSubscriberTranscriptionProps {
  transcriptionSessionId: string | null;
  isJobOngoing: boolean;
  enabled: boolean; // Only enabled for viewers of ongoing jobs
  lastHeartbeatAt?: string | null; // Last heartbeat timestamp to check if session is active
  onJobCompleted?: () => void; // Callback when job appears to be completed (no data for a period)
}

export const useSubscriberTranscription = ({
  transcriptionSessionId,
  isJobOngoing,
  enabled,
  lastHeartbeatAt,
  onJobCompleted,
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
  const previousSessionIdRef = useRef<string | null>(null); // Track previous session ID to avoid cleanup on remount
  
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

    // Check if we're already connected
    const wasConnected = wsRef.current !== null && wsRef.current.readyState === WebSocket.OPEN;
    const previousSessionId = previousSessionIdRef.current;
    const sessionIdChanged = previousSessionId !== null && previousSessionId !== transcriptionSessionId;

    // Only connect if enabled, job is ongoing, and we have a session ID
    if (!enabled || !isJobOngoing || !transcriptionSessionId) {
      // Only cleanup if we were connected to a different session (session ID changed)
      // Don't cleanup if session ID is just temporarily null (likely remount with job data loading)
      if (sessionIdChanged && wasConnected) {
        if (__DEV__) {
          console.log('[SubscriberTranscription] Session ID changed from', previousSessionId, 'to', transcriptionSessionId, '- cleaning up');
        }
        cleanup();
        previousSessionIdRef.current = transcriptionSessionId; // Update ref
      } else if (__DEV__ && !transcriptionSessionId && wasConnected) {
        // Session ID is null but we're still connected - likely remount, preserve connection
        console.log('[SubscriberTranscription] Session ID temporarily null (remount?), preserving connection');
      }
      return;
    }

    // If we're already connected to the same session, don't reconnect
    if (previousSessionId === transcriptionSessionId && wasConnected) {
      if (__DEV__) {
        console.log('[SubscriberTranscription] Already connected to same session', transcriptionSessionId, '- skipping reconnect');
      }
      return;
    }

    // Update ref with new session ID
    previousSessionIdRef.current = transcriptionSessionId;

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
    console.log('[SubscriberTranscription] Using binary protocol (0x00=audio, 0x01=JSON)');

    // Create WebSocket connection
    // Note: React Native WebSocket automatically handles binary data as base64 strings
    // Browser WebSocket delivers binary data as ArrayBuffer (when binaryType='arraybuffer')
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
          // Job might have completed - trigger callback to refresh job details
          if (onJobCompleted) {
            console.log('[SubscriberTranscription] No data for 10s - triggering callback to refresh job details');
            onJobCompleted();
          }
        }, 10000);
        
        // Convert message to Uint8Array for binary protocol handling
        // Binary Protocol Format:
        // - First byte (0x00): Audio message (raw PCM16 follows)
        // - First byte (0x01): JSON control message (UTF-8 JSON string follows)
        let messageBytes: Uint8Array;
        
        if (event.data instanceof ArrayBuffer) {
          // Browser WebSocket binary mode (most common)
          messageBytes = new Uint8Array(event.data);
        } else if (event.data instanceof Blob) {
          // Browser WebSocket blob mode
          const arrayBuffer = await event.data.arrayBuffer();
          messageBytes = new Uint8Array(arrayBuffer);
        } else if (typeof event.data === 'string') {
          // React Native WebSocket sends binary data as base64 string
          // Try to decode as base64 first (binary protocol)
          try {
            const binaryBuffer = Buffer.from(event.data, 'base64');
            messageBytes = new Uint8Array(binaryBuffer);
          } catch (base64Error) {
            // Not base64 - might be legacy JSON format
            console.warn('[SubscriberTranscription] Received text message, trying legacy JSON format');
            try {
              const messageData = JSON.parse(event.data);
              if (messageData.type === 'cached_turns' && Array.isArray(messageData.turns)) {
                // Handle legacy JSON format - use same filtering and conversion as binary protocol
                const validTurns: CacheTurn[] = messageData.turns
                  .filter(
                    (turn: any) =>
                      turn &&
                      typeof turn.provider_result_id === 'string' &&
                      typeof turn.turn_index === 'number' &&
                      typeof turn.text === 'string'
                  )
                  .sort((a: CacheTurn, b: CacheTurn) => a.turn_index - b.turn_index);
                
                // Convert using standard converter
                const convertedTurns = convertCacheTurnsToDialogueTurns(validTurns);
                
                // Directly replace turns with cached_turns - no reconciliation
                setTurns(convertedTurns);
              }
            } catch {
              // Ignore parse errors for legacy format
            }
            return;
          }
        } else {
          console.error('[SubscriberTranscription] Unknown message type:', typeof event.data);
          return;
        }

        // Check message type from first byte
        if (messageBytes.length === 0) {
          console.warn('[SubscriberTranscription] Empty message received');
          return;
        }

        const messageType = messageBytes[0];

        // Handle audio messages (0x00)
        // Format: [0x00][raw PCM16 audio data]
        // Audio format: mono, 16kHz, 16-bit signed little-endian PCM
        if (messageType === 0x00) {
          audioChunkCount++;
          
          // Track that we received an audio chunk
          lastAudioChunkTimeRef.current = Date.now();
          
          // Clear the audio timeout since we received audio
          if (audioTimeoutRef.current) {
            clearTimeout(audioTimeoutRef.current);
            audioTimeoutRef.current = null;
          }
          
          // Extract raw PCM16 buffer (skip first byte which is the message type 0x00)
          // This is raw audio data: mono, 16kHz, 16-bit signed integers, little-endian
          const audioBuffer = messageBytes.slice(1);
          
          // Log audio chunks (first one and every 20th)
          if (audioChunkCount === 1 || audioChunkCount % 20 === 0) {
            console.log(`[SubscriberTranscription] 🎵 Audio chunk #${audioChunkCount} received (${audioBuffer.length} bytes raw PCM16), playback: ${isAudioEnabledRef.current ? 'ON' : 'OFF'}`);
          }
          
          // Mark that we're receiving audio (using ref to avoid re-render loop)
          if (!isReceivingAudioRef.current) {
            console.log('[SubscriberTranscription] 🔊 Started receiving audio stream (binary protocol)');
            isReceivingAudioRef.current = true;
            setIsReceivingAudio(true);
          }

          // Play audio only if audio is enabled and manager exists
          if (isAudioEnabledRef.current && audioManagerRef.current) {
            // Convert raw PCM16 buffer to base64 for audio manager
            // (Native module expects base64 string, will decode and stream to native audio APIs)
            const base64AudioData = Buffer.from(audioBuffer).toString('base64');
            await audioManagerRef.current.playChunk(base64AudioData);
          }
        }
        // Handle JSON control messages (0x01)
        // Format: [0x01][UTF-8 encoded JSON string]
        // Example: {"type":"cached_turns","turns":[...],"timestamp":"2025-12-26T..."}
        else if (messageType === 0x01) {
          // Extract JSON string (skip first byte which is the message type 0x01)
          const jsonBytes = messageBytes.slice(1);
          const jsonString = new TextDecoder('utf-8').decode(jsonBytes);
          
          try {
            const messageData = JSON.parse(jsonString);
            
            // Handle cached_turns messages
            if (messageData.type === 'cached_turns' && Array.isArray(messageData.turns)) {
              // Mark that we're receiving turns from WebSocket
              if (!isReceivingTurns) {
                console.log('[SubscriberTranscription] 📝 Started receiving cached_turns from WebSocket (binary protocol)');
                setIsReceivingTurns(true);
              }
              
              // Filter and sort cached_turns (same validation as RealtimeChat.ts)
              const validTurns: CacheTurn[] = messageData.turns
                .filter(
                  (turn: any) =>
                    turn &&
                    typeof turn.provider_result_id === 'string' &&
                    typeof turn.turn_index === 'number' &&
                    typeof turn.text === 'string'
                )
                .sort((a: CacheTurn, b: CacheTurn) => a.turn_index - b.turn_index);

              // Convert CacheTurn[] to DialogueTurn[] using standard converter
              const convertedTurns = convertCacheTurnsToDialogueTurns(validTurns);

              // Directly replace turns with cached_turns - no reconciliation
              setTurns(convertedTurns);
              
              if (__DEV__) {
                console.log('[SubscriberTranscription] Replaced turns with cached_turns:', {
                  cachedTurns: convertedTurns.length,
                  rawTurns: messageData.turns.length,
                });
              }
            }
            // Add more control message types here as needed
            // e.g., transcription_result, session_ended, etc.
          } catch (error) {
            console.error('[SubscriberTranscription] Error parsing JSON control message:', error);
          }
        } else {
          console.warn(`[SubscriberTranscription] Unknown message type: 0x${messageType.toString(16).padStart(2, '0')}`);
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
      } else {
        // Job might have completed - trigger callback to invalidate job details
        if (onJobCompleted) {
          console.log('[SubscriberTranscription] Job appears completed - triggering callback to refresh job details');
          onJobCompleted();
        }
      }
    };

    return () => {
      // Cleanup on unmount or dependency change
      // Only cleanup if session ID actually changed (not just remounting with same session)
      const sessionIdChanged = previousSessionIdRef.current !== transcriptionSessionId;
      
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
      
      // Only cleanup WebSocket and audio if session actually changed
      // This prevents stopping transcription during component remounts with same session
      if (sessionIdChanged) {
        if (__DEV__) {
          console.log('[SubscriberTranscription] Session ID changed, cleaning up WebSocket and audio');
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
      } else if (__DEV__) {
        console.log('[SubscriberTranscription] Component remounting with same session, preserving connection');
      }
    };
  // Note: do NOT depend on audioStreamManager to avoid re-renders causing reconnect loops
  // retryTrigger is included to allow retry logic to trigger reconnection
  // onJobCompleted is included to allow job invalidation when no data received
  }, [enabled, isJobOngoing, transcriptionSessionId, lastHeartbeatAt, retryTrigger, onJobCompleted]);
  
  /**
   * Set API-fetched turns - directly replace turns (no reconciliation)
   * Uses useCallback to ensure stable reference
   */
  const setApiTurns = useCallback((newApiTurns: DialogueTurn[]) => {
    apiTurnsRef.current = newApiTurns;
    
    // Directly replace turns with API turns
    setTurns(newApiTurns);
    
    if (__DEV__) {
      console.log('[SubscriberTranscription] API turns set (replaced):', newApiTurns.length);
    }
  }, []);

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
