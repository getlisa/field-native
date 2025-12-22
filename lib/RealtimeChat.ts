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

import { AppState, AppStateStatus } from 'react-native';
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
  // Disable auto-reconnect when user intentionally ends/cancels/disconnects
  private shouldAutoReconnect = true;
  private manuallyStopped = false;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  
  // Background state management
  private appStateSubscription: any = null;
  private currentAppState: AppStateStatus = AppState.currentState;
  private isInBackground = false;
  
  // Connection health monitoring (using audio stream as keepalive)
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckIntervalMs = 10000; // Check every 10 seconds
  private lastMessageReceived = Date.now();
  private lastChunkSent = Date.now();
  private connectionDeadTimeoutMs = 30000; // 30 seconds without any response = dead

  constructor(options: RealtimeChatOptions) {
    this.options = options;
    this.setupAppStateListener();
  }

  private setupAppStateListener(): void {
    // Listen to app state changes to handle background/foreground transitions
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    
    if (__DEV__) {
      console.log('[Transcription] 📱 App state listener setup');
    }
  }

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    const wasBackground = this.isInBackground;
    this.isInBackground = nextAppState === 'background' || nextAppState === 'inactive';
    
    if (__DEV__) {
      console.log(`[Transcription] 📱 App state changed: ${this.currentAppState} → ${nextAppState}`);
    }

    // Moving to background
    if (!wasBackground && this.isInBackground) {
      if (__DEV__) {
        console.log('[Transcription] 🌙 App entering background - maintaining WebSocket connection');
      }
      // Don't disconnect! Keep WebSocket alive for background audio
      // The keepalive will maintain the connection
    }
    
    // Returning to foreground
    if (wasBackground && !this.isInBackground && nextAppState === 'active') {
      if (__DEV__) {
        console.log('[Transcription] ☀️ App returning to foreground');
      }
      
      // Check if connection is still alive
      if (this.ws && this.ws.readyState !== WebSocket.OPEN && !this.manuallyStopped) {
        if (__DEV__) {
          console.log('[Transcription] 🔄 WebSocket disconnected while in background, reconnecting...');
        }
        this.attemptReconnect();
      }
    }

    this.currentAppState = nextAppState;
  };

  async init(): Promise<void> {
    try {
      this.manuallyStopped = false;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.shouldAutoReconnect = true;

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
          console.log('[Transcription] ⏱️ Timeout - no ready message received in 30s');
        }
        this.cleanup();
        reject(new Error('Timeout waiting for server ready message'));
      }, 30000);

      this.ws.onopen = () => {
        if (__DEV__) {
          console.log('[Transcription] 🟢 WebSocket connected, waiting for server ready...');
        }
        this.options.onConnectionStateChange?.(true);
        
        // Start connection health monitoring (audio stream acts as keepalive)
        this.startHealthCheck();
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        
        // Track message receipt for connection health monitoring
        this.lastMessageReceived = Date.now();

        if (data.type === 'ready' && !this.isReady) {
          clearTimeout(timeout);
          this.isReady = true;
          this.reconnectAttempts = 0;

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
            reason: event.reason,
            inBackground: this.isInBackground 
          });
        }
        this.options.onConnectionStateChange?.(false);
        this.isReady = false;
        
        // Stop health check when connection closes
        this.stopHealthCheck();

        // Only auto-reconnect if not manually stopped
        // Keep reconnecting even in background for continuous streaming
        if (this.shouldAutoReconnect && !this.manuallyStopped && !this.isReconnecting) {
          if (__DEV__) {
            console.log('[Transcription] 🔄 Connection lost, attempting reconnect...');
          }
          this.attemptReconnect();
        }
      };
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (__DEV__) {
        console.log('[Transcription] Max reconnect attempts reached');
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    if (__DEV__) {
      console.log(`[Transcription] 🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    }

    setTimeout(() => {
      if (!this.manuallyStopped) {
        this.init().catch((err) => {
          console.error('[Transcription] Reconnect failed:', err);
          this.isReconnecting = false;
        });
      }
    }, this.reconnectDelay * this.reconnectAttempts);
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
        // Server intentionally ended session - don't auto-reconnect
        this.manuallyStopped = true;
        this.shouldAutoReconnect = false;
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

  sendAudioChunk(base64Data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) {
      if (__DEV__ && this.sequenceNumber === 0) {
        console.log('[Transcription] ⚠️ Cannot send audio - WebSocket not ready');
      }
      return;
    }

    const chunkId = `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Track when we send chunks - this acts as our keepalive
    this.lastChunkSent = Date.now();

    // Log first chunk and then every 50th chunk to reduce spam
    if (__DEV__ && (this.sequenceNumber === 0 || this.sequenceNumber % 50 === 0)) {
      console.log(`[Transcription] 🎵 Sent audio chunk #${this.sequenceNumber} (${Math.round(base64Data.length / 1024)}KB)`);
    }

    this.ws.send(
      JSON.stringify({
        type: 'audio-chunk',
        chunkId,
        sequenceNumber: this.sequenceNumber++,
        data: base64Data,
      })
    );
  }

  end(): void {
    // User-initiated end; avoid auto-reconnect/recreate
    this.shouldAutoReconnect = false;
    this.manuallyStopped = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (__DEV__) {
        console.log('[Transcription] 📤 Sending end signal');
      }
      this.ws.send(JSON.stringify({ type: 'end' }));
    }
  }

  cancel(): void {
    this.shouldAutoReconnect = false;
    this.manuallyStopped = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (__DEV__) {
        console.log('[Transcription] 🚫 Sending cancel signal...');
      }
      this.ws.send(JSON.stringify({ type: 'cancel' }));
    }
  }

  disconnect(): void {
    if (__DEV__) {
      console.log('[Transcription] 🔌 Disconnecting...');
    }
    this.shouldAutoReconnect = false;
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

  private startHealthCheck(): void {
    // Clear any existing health check
    this.stopHealthCheck();
    
    if (__DEV__) {
      console.log(`[Transcription] 💓 Starting connection health monitoring (${this.healthCheckIntervalMs}ms intervals)`);
    }

    this.healthCheckInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (__DEV__) {
          console.log('[Transcription] ⚠️ Health check: WebSocket not open, stopping');
        }
        this.stopHealthCheck();
        return;
      }

      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageReceived;
      const timeSinceLastChunk = now - this.lastChunkSent;

      // If we're actively sending audio but not receiving any responses, connection is dead
      if (timeSinceLastChunk < this.healthCheckIntervalMs * 2 && timeSinceLastMessage > this.connectionDeadTimeoutMs) {
        if (__DEV__) {
          console.log('[Transcription] ❌ Connection appears dead:', {
            timeSinceLastMessage: `${Math.round(timeSinceLastMessage / 1000)}s`,
            timeSinceLastChunk: `${Math.round(timeSinceLastChunk / 1000)}s`,
            inBackground: this.isInBackground
          });
        }
        
        // Connection is dead, trigger reconnect
        this.stopHealthCheck();
        if (this.shouldAutoReconnect && !this.manuallyStopped) {
          this.ws.close();
          // onclose handler will trigger reconnect
        }
        return;
      }

      // Log health status in background mode
      if (__DEV__ && this.isInBackground && timeSinceLastChunk < this.healthCheckIntervalMs * 2) {
        console.log('[Transcription] 💓 Connection healthy (background mode):', {
          lastMessage: `${Math.round(timeSinceLastMessage / 1000)}s ago`,
          lastChunk: `${Math.round(timeSinceLastChunk / 1000)}s ago`
        });
      }
    }, this.healthCheckIntervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      if (__DEV__) {
        console.log('[Transcription] 💓 Health monitoring stopped');
      }
    }
  }

  private cleanup(): void {
    if (__DEV__) {
      console.log('[Transcription] 🧹 Cleanup starting...');
    }

    // Stop health monitoring
    this.stopHealthCheck();

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

    // Remove app state listener
    if (this.appStateSubscription) {
      try {
        this.appStateSubscription.remove();
        this.appStateSubscription = null;
        if (__DEV__) {
          console.log('[Transcription] 📱 App state listener removed');
        }
      } catch (error) {
        console.warn('[Transcription] Error removing app state listener:', error);
      }
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
    this.shouldAutoReconnect = false;
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

