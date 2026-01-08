import { create } from 'zustand';

import { AudioRecorder } from '@/lib/audio/AudioRecorder';
import type { AudioChunkData } from '@/lib/audio/types';
import {
  convertCacheTurnsToDialogueTurns,
  RealtimeChat,
  type CacheTurn,
  type DialogueTurn,
  type RealtimeChatOptions,
  type ProactiveSuggestionsMessage,
} from '@/lib/RealtimeChat';

// No reconciliation needed - just replace turns directly when cached_turns are received

interface TranscriptionState {
  // Recording confirmation flag
  shouldShowRecordingConfirmation: boolean;
  setShouldShowRecordingConfirmation: (value: boolean) => void;
  
  // Transcription session state
  activeTranscriptionSessionId: string | null;
  activeJobId: string | null;
  
  // Connection and recording state
  isRecording: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  
  // Turns stored by session ID
  turnsBySessionId: Record<string, DialogueTurn[]>;
  
  // Internal refs (not exposed, managed internally)
  _realtimeChat: RealtimeChat | null;
  _audioRecorder: AudioRecorder | null;
  _apiTurns: DialogueTurn[];
  _isStopping: boolean;
  _onProactiveSuggestions: ((data: ProactiveSuggestionsMessage) => void) | null;
  _jobId: string | undefined;
  
  // Actions
  setActiveSession: (sessionId: string | null, jobId: string | null) => void;
  setRecording: (recording: boolean) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  
  // Transcription methods
  startTranscription: (
    visitSessionId: string,
    companyId?: string | number,
    options?: {
      jobId?: string;
      onProactiveSuggestions?: (data: ProactiveSuggestionsMessage) => void;
    }
  ) => Promise<void>;
  stopTranscription: () => Promise<void>;
  pauseTranscription: () => Promise<void>;
  resumeTranscription: () => Promise<void>;
  setApiTurns: (turns: DialogueTurn[], visitSessionId?: string) => void;
  
  // Clear all state
  clearTranscriptionState: () => void;
}

export const useRecordingStore = create<TranscriptionState>((set, get) => {
  // Helper to get current turns for active session
  const getCurrentTurns = (): DialogueTurn[] => {
    const state = get();
    if (state.activeTranscriptionSessionId) {
      return state.turnsBySessionId[state.activeTranscriptionSessionId] || [];
    }
    return [];
  };

  // Handle cached turns update from WebSocket
  // Simply replace turns with new cached_turns - no reconciliation needed
  const handleCachedTurnsUpdate = (cacheTurns: CacheTurn[]) => {
    const state = get();
    
    if (!state.activeTranscriptionSessionId) {
      if (__DEV__) {
        console.warn('[RecordingStore] ⚠️ Received cached turns but no active session ID');
      }
      return;
    }
    
    const newDialogueTurns = convertCacheTurnsToDialogueTurns(cacheTurns);
    
    // Directly replace turns with new cached_turns
    set((currentState) => ({
      turnsBySessionId: {
        ...currentState.turnsBySessionId,
        [currentState.activeTranscriptionSessionId!]: newDialogueTurns,
      },
    }));
    
    if (__DEV__) {
      console.log('[RecordingStore] Replaced turns with cached_turns:', {
        cachedTurns: newDialogueTurns.length,
        sessionId: state.activeTranscriptionSessionId,
      });
    }
  };

  // Start audio recording
  const startAudioRecording = () => {
    const state = get();
    
    // Stop existing recorder if any
    if (state._audioRecorder) {
      state._audioRecorder.stop().catch(console.error);
    }

    // Create new audio recorder
    const audioRecorder = new AudioRecorder({
      jobId: state._jobId,
      onAudioChunk: (chunk: AudioChunkData) => {
        const currentState = get();
        
        // Don't send if stopping
        if (currentState._isStopping) {
          if (__DEV__) {
            console.log('[RecordingStore] ⏹️ Ignoring audio chunk - stopping in progress');
          }
          return;
        }
        
        // Send to WebSocket if connected
        if (chunk.byteSize > 0 && currentState._realtimeChat?.isConnected()) {
          currentState._realtimeChat.sendAudioChunk(chunk.buffer);
        }
      },
      onError: (err: Error) => {
        console.error('[RecordingStore] Audio recording error:', err);
        set({ error: `Audio error: ${err.message}` });
      },
      onStatusChange: (recording: boolean) => {
        set({ isRecording: recording });
        if (__DEV__) {
          console.log('[RecordingStore] Recording status:', recording);
        }
      },
      onAppBackground: () => {
        // Suppress recording confirmation dialog when app is opened from notification
        set({ shouldShowRecordingConfirmation: false });
      },
    });

    set({ _audioRecorder: audioRecorder });
    audioRecorder.start();
  };

  // Stop audio recording
  const stopAudioRecording = async () => {
    const state = get();
    if (state._audioRecorder) {
      try {
        await state._audioRecorder.stop();
        if (__DEV__) {
          console.log('[RecordingStore] ✅ Audio recording stopped');
        }
      } catch (error) {
        console.error('[RecordingStore] ❌ Error stopping audio recording:', error);
      }
      set({ _audioRecorder: null });
    }
    set({ isRecording: false });
  };

  return {
    // Initial state
    shouldShowRecordingConfirmation: true,
    activeTranscriptionSessionId: null,
    activeJobId: null,
    isRecording: false,
    isConnected: false,
    isConnecting: false,
    error: null,
    turnsBySessionId: {},
    
    // Internal refs
    _realtimeChat: null,
    _audioRecorder: null,
    _apiTurns: [],
    _isStopping: false,
    _onProactiveSuggestions: null,
    _jobId: undefined,
    
    // Simple setters
    setShouldShowRecordingConfirmation: (value) =>
      set({ shouldShowRecordingConfirmation: value }),
    setActiveSession: (sessionId, jobId) =>
      set({ activeTranscriptionSessionId: sessionId, activeJobId: jobId }),
    setRecording: (recording) => set({ isRecording: recording }),
    setConnected: (connected) => set({ isConnected: connected }),
    setConnecting: (connecting) => set({ isConnecting: connecting }),
    setError: (error) => set({ error }),
    
    // Start transcription
    startTranscription: async (visitSessionId, companyId, options) => {
      const state = get();
      const isSameSession = state.activeTranscriptionSessionId === visitSessionId;
      
      if (__DEV__) {
        console.log('[RecordingStore] Starting transcription:', {
          visitSessionId,
          currentSessionId: state.activeTranscriptionSessionId,
          isSameSession,
          jobId: options?.jobId,
        });
      }
      
      // Reset stopping flag
      set({ _isStopping: false });
      
      // Cleanup if different session
      if (!isSameSession) {
        if (state._realtimeChat) {
          state._realtimeChat.disconnect();
        }
        await stopAudioRecording();
      }
      
      // Set active session and options
      set({
        activeTranscriptionSessionId: visitSessionId,
        activeJobId: options?.jobId || null,
        _jobId: options?.jobId,
        _onProactiveSuggestions: options?.onProactiveSuggestions || null,
        isConnecting: true,
        error: null,
      });
      
      // Clear turns for new session
      if (!isSameSession) {
        set({
          turnsBySessionId: {
            ...state.turnsBySessionId,
            [visitSessionId]: [],
          },
        });
      }
      
      // Create WebSocket connection
      const realtimeChatOptions: RealtimeChatOptions = {
        visitSessionId,
        companyId,
        onCachedTurnsUpdate: handleCachedTurnsUpdate,
        onReady: () => {
          if (__DEV__) {
            console.log('[RecordingStore] WebSocket ready, starting audio recording...');
          }
          set({ isConnected: true, isConnecting: false });
          startAudioRecording();
        },
        onError: (err) => {
          console.error('[RecordingStore] WebSocket error:', err.message);
          set({ error: err.message, isConnecting: false });
        },
        onSessionEnded: () => {
          if (__DEV__) {
            console.log('[RecordingStore] Session ended signal received from server');
          }
          set({ isConnected: false });
        },
        onConnectionStateChange: (connected) => {
          set({ isConnected: connected });
          if (!connected) {
            set({ isConnecting: false });
          }
        },
        onProactiveSuggestions: (data) => {
          const currentState = get();
          if (currentState._onProactiveSuggestions) {
            currentState._onProactiveSuggestions(data);
          }
        },
      };
      
      const realtimeChat = new RealtimeChat(realtimeChatOptions);
      set({ _realtimeChat: realtimeChat });
      
      try {
        await realtimeChat.init();
      } catch (err: any) {
        set({
          error: err?.message || 'Failed to start transcription',
          isConnecting: false,
          isConnected: false,
        });
        await stopAudioRecording();
        set({ activeTranscriptionSessionId: null, activeJobId: null });
      }
    },
    
    // Stop transcription
    stopTranscription: async () => {
      const state = get();
      
      if (__DEV__) {
        console.log('[RecordingStore] 🛑 Stopping transcription - starting cleanup');
      }
      
      // Set stopping flag FIRST to prevent new audio chunks
      set({ _isStopping: true });
      
      // Stop audio recording
      await stopAudioRecording();
      
      // Disconnect WebSocket (disconnect() handles sending end signal internally)
      if (state._realtimeChat) {
        try {
          if (__DEV__) {
            console.log('[RecordingStore] 🔌 Disconnecting WebSocket...');
          }
          // disconnect() will handle sending end signal if needed
          state._realtimeChat.disconnect();
          if (__DEV__) {
            console.log('[RecordingStore] ✅ Disconnect initiated - waiting for session-ended');
          }
        } catch (error) {
          console.error('[RecordingStore] ❌ Error disconnecting WebSocket:', error);
        }
        
        set({ _realtimeChat: null });
      }
      
      // Clear all state
      set({
        activeTranscriptionSessionId: null,
        activeJobId: null,
        isRecording: false,
        isConnected: false,
        isConnecting: false,
        error: null,
        _isStopping: false,
        _apiTurns: [],
        _jobId: undefined,
        _onProactiveSuggestions: null,
      });
      
      if (__DEV__) {
        console.log('[RecordingStore] ✅ Transcription stopped and cleaned up');
      }
    },
    
    // Pause transcription (keeps WebSocket alive)
    pauseTranscription: async () => {
      const state = get();
      
      if (!state._audioRecorder || !state.isRecording) {
        if (__DEV__) {
          console.warn('[RecordingStore] Cannot pause - not recording');
        }
        return;
      }
      
      if (__DEV__) {
        console.log('[RecordingStore] ⏸️ Pausing transcription...');
      }
      
      try {
        await state._audioRecorder.pause();
        
        if (__DEV__) {
          console.log('[RecordingStore] ✅ Transcription paused (sending silence to keep connection alive)');
        }
      } catch (error) {
        console.error('[RecordingStore] Failed to pause transcription:', error);
      }
    },
    
    // Resume transcription
    resumeTranscription: async () => {
      const state = get();
      
      if (!state._audioRecorder || !state.isRecording) {
        if (__DEV__) {
          console.warn('[RecordingStore] Cannot resume - not recording');
        }
        return;
      }
      
      if (__DEV__) {
        console.log('[RecordingStore] ▶️ Resuming transcription...');
      }
      
      try {
        await state._audioRecorder.resume();
        
        if (__DEV__) {
          console.log('[RecordingStore] ✅ Transcription resumed');
        }
      } catch (error) {
        console.error('[RecordingStore] Failed to resume transcription:', error);
      }
    },
    
    // Set API turns - directly replace turns (no reconciliation)
    // For completed jobs, can be called without active session ID
    setApiTurns: (newApiTurns, visitSessionId?: string) => {
      const state = get();
      set({ _apiTurns: newApiTurns });
      
      // Store turns using active session ID if available, otherwise use visit session ID
      const sessionKey = state.activeTranscriptionSessionId || visitSessionId;
      
      if (sessionKey) {
        set({
          turnsBySessionId: {
            ...state.turnsBySessionId,
            [sessionKey]: newApiTurns,
          },
        });
      }
      
      if (__DEV__) {
        console.log('[RecordingStore] API turns set (replaced):', {
          count: newApiTurns.length,
          sessionId: sessionKey || 'none',
          usingVisitSessionId: !state.activeTranscriptionSessionId && !!visitSessionId,
        });
      }
    },
    
    // Clear all state
    clearTranscriptionState: () => {
      set({
        activeTranscriptionSessionId: null,
        activeJobId: null,
        isRecording: false,
        isConnected: false,
        isConnecting: false,
        error: null,
        // Don't clear turnsBySessionId - preserve them
      });
    },
  };
});

export default useRecordingStore;
