/**
 * useSubscriberTranscription.ts - WebSocket hook for viewing ongoing jobs
 * 
 * This hook allows non-assigned technicians to subscribe to ongoing job transcriptions
 * without starting their own recording session. It receives both audio and transcript updates.
 */

import { useEffect, useRef, useState } from 'react';
import { type DialogueTurn, type CacheTurn } from '@/lib/RealtimeChat';
import { API_BASE_URL } from '@/lib/apiClient';
import { useAudioStreamManager } from '@/hooks/useAudioStreamManager';

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
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const isReceivingAudioRef = useRef(false); // Use ref to track audio state without triggering re-renders
  const isAudioEnabledRef = useRef(false); // Track audio toggle synchronously
  const lastMessageTimeRef = useRef<number>(Date.now()); // Track last message time for timeout
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Timeout for disconnection
  
  // Use the audio stream manager hook with pre-buffering config
  const audioStreamManager = useAudioStreamManager({
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    bufferDurationMs: 500, // Adjust based on network/device
    minBufferChunks: 2,     // Pre-buffer 2 chunks before starting
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
    if (lastHeartbeatAt) {
      const heartbeatTime = new Date(lastHeartbeatAt).getTime();
      const now = Date.now();
      const timeSinceHeartbeat = now - heartbeatTime;
      
      if (timeSinceHeartbeat > 10000) {
        // Heartbeat is more than 10 seconds old, don't connect
        console.log('[SubscriberTranscription] Heartbeat too old, not connecting');
        cleanup();
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
          
          // Convert CacheTurn[] to DialogueTurn[]
          const convertedTurns: DialogueTurn[] = messageData.turns
            .filter((turn: any) => turn && typeof turn.text === 'string')
            .sort((a: CacheTurn, b: CacheTurn) => a.turn_index - b.turn_index)
            .map((turn: CacheTurn) => ({
              id: turn.turn_id?.toString() || turn.provider_result_id,
              resultId: turn.provider_result_id,
              speaker: turn.speaker === 'technician' ? 'Technician' : 'Customer',
              text: turn.text,
              timestamp: new Date(turn.updated_at_ms),
              isPartial: !turn.is_final,
              turn_index: turn.turn_index,
              word_timestamps: turn.word_timestamps,
            }));

          console.log(`[SubscriberTranscription] 📝 Received ${convertedTurns.length} turns`);
          setTurns(convertedTurns);
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
      isReceivingAudioRef.current = false;
      
      // Stop audio
      audioManagerRef.current.flush().catch(() => {});
      audioManagerRef.current.stop();
      
      // Reconnect after delay if still enabled
      if (enabled && isJobOngoing && transcriptionSessionId) {
        setTimeout(() => {
          console.log('[SubscriberTranscription] Reconnecting...');
          // Trigger re-mount by updating a dependency
        }, 3000);
      }
    };

    return () => {
      // Cleanup on unmount or dependency change
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      audioManagerRef.current.flush().catch(() => {});
      audioManagerRef.current.stop();
      setIsConnected(false);
      setIsReceivingAudio(false);
      isReceivingAudioRef.current = false;
      setIsAudioEnabled(false);
      isAudioEnabledRef.current = false;
    };
  // Note: do NOT depend on audioStreamManager to avoid re-renders causing reconnect loops
  }, [enabled, isJobOngoing, transcriptionSessionId, lastHeartbeatAt]);

  return {
    turns,
    isConnected,
    isReceivingAudio,
    isAudioEnabled,
    toggleAudio,
    error,
  };
};

export default useSubscriberTranscription;
