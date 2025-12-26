/**
 * RealtimeChat.ts - WebSocket implementation for Transcription API
 *
 * Architecture:
 * - visitSessionId is provided from the caller
 * - companyId is fetched from auth store if not provided
 * - This file handles: WebSocket connection and transcription event handling
 * - Uses AWS Transcribe Streaming via backend WebSocket service
 * - Maintains WebSocket connection in background/locked states for iOS
 *
 * Note: Audio capture is handled separately by the caller (React Native audio APIs)
 */

import useAuthStore from '@/store/useAuthStore';
import { API_BASE_URL } from './apiClient';

export interface WordTimestamp {
  word: string;
  start_sec: number;
  end_sec: number;
  confidence?: number;
}

export interface DialogueTurn {
  id?: string;
  resultId?: string;
  turn_id?: number; // Primary key for reconciliation (from DB and WebSocket)
  speaker: 'Technician' | 'Customer';
  text: string;
  timestamp: Date;
  triggeredChecklistItem?: string;
  isPartial?: boolean;
  turn_index?: number;
  word_timestamps?: WordTimestamp[];
}

export interface CacheTurn {
  turn_id: number | null;
  provider_result_id: string;
  turn_index: number;
  is_final: boolean;
  processed: boolean;
  text: string;
  speaker: 'technician' | 'customer' | null;
  start_sec: number;
  end_sec: number;
  word_timestamps?: Array<{ word: string; start_sec: number; end_sec: number }>;
  meta?: {
    merged_provider_result_ids?: string[];
    provisional?: boolean;
  };
  updated_at_ms: number;
}

export interface CachedTurnsMessage {
  type: 'cached_turns';
  turns: CacheTurn[];
  timestamp: string;
}

export interface ChecklistUpdate {
  itemCheck: string;
  evidence: string;
}

export interface AlertMessage {
  itemCheck: string;
  suggestion: string;
}

export interface MissedOpportunity {
  itemId: string;
  suggestion: string;
  severity: string;
  confidence: number;
}

export interface ProactiveSuggestionsMessage {
  type: 'proactive_suggestions';
  missedOpportunities: MissedOpportunity[];
  checklistDetected: boolean;
  updatedChecklistItemIds: string[];
  timestamp: string;
}

export interface RealtimeChatOptions {
  visitSessionId: string;
  companyId?: string | number;
  onTranscript?: (turn: DialogueTurn) => void;
  onCachedTurnsUpdate?: (turns: CacheTurn[]) => void;
  onAlert?: (alert: AlertMessage) => void;
  onProactiveSuggestions?: (suggestions: ProactiveSuggestionsMessage) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onSessionEnded?: (audioUrl?: string) => void;
  onConnectionStateChange?: (connected: boolean) => void;
}

// Derive WebSocket base URL from public env (Expo: EXPO_PUBLIC_*) with localhost default.
// const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws').replace(/^https/, 'wss');

export class RealtimeChat {
  private ws: WebSocket | null = null;
  private options: RealtimeChatOptions;
  private sequenceNumber = 0;
  private isReady = false;
  private manuallyStopped = false;

  constructor(options: RealtimeChatOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    try {
      this.manuallyStopped = false;

      const { visitSessionId } = this.options;

      if (!visitSessionId) {
        const error = new Error('visitSessionId is required');
        this.options.onError?.(error);
        throw error;
      }

      let companyId = this.options.companyId;
      if (!companyId) {
        const user = useAuthStore.getState().user;
        companyId = user?.company_id;
      }

      if (!companyId) {
        const error = new Error('companyId is required');
        this.options.onError?.(error);
        throw error;
      }

      // Get auth token for WebSocket connection
      const accessToken = useAuthStore.getState().access_token;

      if (__DEV__) {
        console.log('[Transcription] 🎙️ Starting transcription session');
        console.log('[Transcription] → companyId:', companyId);
        console.log('[Transcription] → visitSessionId:', visitSessionId);
        console.log('[Transcription] → hasToken:', !!accessToken);
      }

      // Include auth token as query param since WebSocket doesn't support headers
      const wsUrl = accessToken
        ? `${WS_BASE_URL}/transcriptions/start/${companyId}/${visitSessionId}?token=${accessToken}`
        : `${WS_BASE_URL}/transcriptions/start/${companyId}/${visitSessionId}`;

      await this.connectWebSocket(wsUrl);
    } catch (err) {
      console.error('[Transcription] ❌ ERROR:', err);
      this.cleanup();
      throw err;
    }
  }

  private connectWebSocket(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (__DEV__) {
        // Log URL without token for security
        const sanitizedUrl = wsUrl.replace(/token=[^&]+/, 'token=***');
        console.log('[Transcription] 📡 Connecting to WebSocket:', sanitizedUrl);
      }

      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        if (__DEV__) {
          console.log('[Transcription] ⏱️ Timeout - no ready message received in 10s');
        }
        this.cleanup();
        const error = new Error('Unable to start recording. Please try again.');
        this.options.onError?.(error);
        reject(error);
      }, 10000);

      this.ws.onopen = () => {
        if (__DEV__) {
          console.log('[Transcription] 🟢 WebSocket connected, waiting for server ready...');
        }
        this.options.onConnectionStateChange?.(true);
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'ready' && !this.isReady) {
            clearTimeout(timeout);
            this.isReady = true;

            if (__DEV__) {
              console.log('[Transcription] ✅ Server ready - starting audio capture');
            }

            this.options.onReady?.();
            resolve();
          } else {
            this.handleMessage(data);
          }
        } catch (err) {
          // Non-JSON messages are not logged to reduce noise
        }
      };

      this.ws.onerror = (error: Event) => {
        if (__DEV__) {
          console.log('[Transcription] ❌ WebSocket error:', error);
        }
        this.options.onError?.(new Error('WebSocket connection error'));
      };

      this.ws.onclose = (event: WebSocketCloseEvent) => {
        if (__DEV__) {
          console.log('[Transcription] 🔴 WebSocket closed:', { 
            code: event.code, 
            reason: event.reason
          });
        }
        this.options.onConnectionStateChange?.(false);
        this.isReady = false;
      };
    });
  }

  private handleMessage(message: any): void {
    const messageType = message.type;

    if (__DEV__) {
      console.log('[Transcription] Message:', messageType);
    }

    switch (messageType) {
      case 'ready':
        break;

      case 'chunk-acknowledged':
        // Audio chunk was received - connection is healthy
        break;

      case 'cached_turns':
        if (this.options.onCachedTurnsUpdate && message.turns) {
          const validTurns: CacheTurn[] = message.turns
            .filter(
              (turn: any) =>
                turn &&
                typeof turn.provider_result_id === 'string' &&
                typeof turn.turn_index === 'number' &&
                typeof turn.text === 'string'
            )
            .sort((a: CacheTurn, b: CacheTurn) => a.turn_index - b.turn_index);

          this.options.onCachedTurnsUpdate(validTurns);
        }
        break;

      case 'proactive_suggestions':
        if (__DEV__) {
          console.log('[RealtimeChat] 📬 Received proactive_suggestions:', {
            missedOpportunities: message.missedOpportunities?.length || 0,
            checklistDetected: message.checklistDetected,
            updatedChecklistItemIds: message.updatedChecklistItemIds?.length || 0,
            hasCallback: !!this.options.onProactiveSuggestions,
          });
        }
        
        if (this.options.onProactiveSuggestions && message.missedOpportunities) {
          const suggestionsMessage: ProactiveSuggestionsMessage = {
            type: 'proactive_suggestions',
            missedOpportunities: message.missedOpportunities || [],
            checklistDetected: message.checklistDetected || false,
            updatedChecklistItemIds: message.updatedChecklistItemIds || [],
            timestamp: message.timestamp || new Date().toISOString(),
          };
          this.options.onProactiveSuggestions(suggestionsMessage);
        }
        break;

      case 'chunk-error':
        console.error('[Transcription] ❌ Chunk error:', message.error);
        break;

      case 'session-ended':
        if (__DEV__) {
          console.log('[Transcription] ✅ Session ended');
        }
        this.manuallyStopped = true;
        this.options.onSessionEnded?.(message.audioUrl);
        break;

      case 'session-cancelled':
        if (__DEV__) {
          console.log('[Transcription] ⚠️ Session cancelled');
        }
        break;

      case 'error':
        console.error('[Transcription] ❌ Error:', message.error);
        this.options.onError?.(new Error(message.error || 'Unknown error'));
        break;

      default:
        if (__DEV__) {
          console.log('[Transcription] ⚠️ Unknown message type:', messageType);
        }
    }
  }

  sendAudioChunk(audioBuffer: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) {
      if (__DEV__ && this.sequenceNumber === 0) {
        console.log('[Transcription] ⚠️ Cannot send audio - WebSocket not ready');
      }
      return;
    }

    // Log first chunk and then every 50th chunk to reduce spam
    if (__DEV__ && (this.sequenceNumber === 0 || this.sequenceNumber % 50 === 0)) {
      console.log(`[Transcription] 🎵 Sent audio chunk #${this.sequenceNumber} (${Math.round(audioBuffer.byteLength / 1024)}KB)`);
    }

    // Create buffer with 0x00 prefix + raw PCM16 data
    const audioData = new Uint8Array(audioBuffer);
    const combinedBuffer = new Uint8Array(1 + audioData.length);
    combinedBuffer[0] = 0x00; // Audio message type prefix
    combinedBuffer.set(audioData, 1);

    // Send as binary (slice to ensure we only send the exact bytes)
    this.ws.send(combinedBuffer.buffer.slice(0, combinedBuffer.byteLength));
    this.sequenceNumber++;
  }

  end(): void {
    this.manuallyStopped = true;
    if (!this.ws) {
      if (__DEV__) {
        console.warn('[RealtimeChat] ⚠️ Cannot send end event - WebSocket is null');
      }
      return;
    }
    
    const wsState = this.ws.readyState;
    if (wsState === WebSocket.OPEN) {
      if (__DEV__) {
        console.log('[RealtimeChat] 📤 Sending end signal');
      }
      try {
        // Prepend 0x01 byte and send JSON as binary
        const jsonData = JSON.stringify({ type: 'end' });
        const jsonBytes = new TextEncoder().encode(jsonData);
        const combinedBuffer = new Uint8Array(1 + jsonBytes.length);
        combinedBuffer[0] = 0x01; // Control message type prefix
        combinedBuffer.set(jsonBytes, 1);
        this.ws.send(combinedBuffer.buffer.slice(0, combinedBuffer.byteLength));
        if (__DEV__) {
          console.log('[RealtimeChat] ✅ End signal sent successfully');
        }
      } catch (error) {
        console.error('[RealtimeChat] ❌ Error sending end signal:', error);
      }
    } else {
      if (__DEV__) {
        console.warn('[RealtimeChat] ⚠️ Cannot send end event - WebSocket state is not OPEN', {
          readyState: wsState,
          stateName: wsState === WebSocket.CONNECTING ? 'CONNECTING' : 
                     wsState === WebSocket.CLOSING ? 'CLOSING' : 
                     wsState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
        });
      }
    }
  }

  cancel(): void {
    this.manuallyStopped = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (__DEV__) {
        console.log('[Transcription] 🚫 Sending cancel signal...');
      }
      // Prepend 0x01 byte and send JSON as binary
      const jsonData = JSON.stringify({ type: 'cancel' });
      const jsonBytes = new TextEncoder().encode(jsonData);
      const combinedBuffer = new Uint8Array(1 + jsonBytes.length);
      combinedBuffer[0] = 0x01; // Control message type prefix
      combinedBuffer.set(jsonBytes, 1);
      this.ws.send(combinedBuffer.buffer.slice(0, combinedBuffer.byteLength));
    }
  }

  disconnect(): void {
    if (__DEV__) {
      console.log('[Transcription] 🔌 Disconnecting...');
    }
    this.manuallyStopped = true;
    
    try {
      this.end();
    } catch (error) {
      console.warn('[Transcription] Error during end():', error);
    }
    
    this.cleanup();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isReady;
  }

  private cleanup(): void {
    if (__DEV__) {
      console.log('[Transcription] 🧹 Cleanup starting...');
    }

    // Clean up WebSocket with guards
    if (this.ws) {
      try {
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        console.warn('[Transcription] Error during WebSocket cleanup:', error);
      }
      this.ws = null;
    }

    this.isReady = false;
    
    if (__DEV__) {
      console.log('[Transcription] 🧹 Cleanup complete');
    }
  }

  /**
   * Destroy the RealtimeChat instance completely
   * Call this when you're done with the instance
   */
  destroy(): void {
    if (__DEV__) {
      console.log('[Transcription] 💥 Destroying RealtimeChat instance');
    }
    this.manuallyStopped = true;
    this.disconnect();
  }
}

/**
 * Convert CacheTurn array to DialogueTurn array for UI display
 */
export function convertCacheTurnsToDialogueTurns(cacheTurns: CacheTurn[]): DialogueTurn[] {
  return cacheTurns.map((turn) => ({
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
}

