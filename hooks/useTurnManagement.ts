import { useCallback, useEffect, useRef, useState } from 'react';
import { jobService, type TranscriptionTurn } from '@/services/jobService';
import type { DialogueTurn } from '@/lib/RealtimeChat';

interface UseTurnManagementOptions {
  visitSessionId: string | undefined;
  jobStatus: 'scheduled' | 'ongoing' | 'completed' | undefined;
  isEnabled: boolean; // Only load when enabled
}

interface UseTurnManagementReturn {
  dbTurns: DialogueTurn[];
  isLoadingDbTurns: boolean;
  dbTurnsError: string | null;
  refetchDbTurns: () => Promise<void>;
  reconcileTurns: (cachedTurns: DialogueTurn[]) => DialogueTurn[];
}

/**
 * Manages transcription turns with proper DB and WebSocket reconciliation
 * 
 * Strategy:
 * 1. Load initial turns from DB (visit_sessions API)
 * 2. WebSocket cached_turns are reconciled by turn_id:
 *    - If turn_id exists in DB → already persisted, use cached version for updates
 *    - If turn_id doesn't exist → new live data not yet saved to DB
 * 3. Always show most recent data (WebSocket takes precedence)
 * 
 * @example
 * ```tsx
 * const { dbTurns, reconcileTurns } = useTurnManagement({
 *   visitSessionId: session?.id,
 *   jobStatus: job?.status,
 *   isEnabled: true,
 * });
 * 
 * // In WebSocket handler:
 * const allTurns = reconcileTurns(cachedTurns);
 * ```
 */
export const useTurnManagement = ({
  visitSessionId,
  jobStatus,
  isEnabled,
}: UseTurnManagementOptions): UseTurnManagementReturn => {
  const [dbTurns, setDbTurns] = useState<DialogueTurn[]>([]);
  const [isLoadingDbTurns, setIsLoadingDbTurns] = useState(false);
  const [dbTurnsError, setDbTurnsError] = useState<string | null>(null);
  
  // Keep a ref of DB turns for reconciliation (indexed by turn_id)
  const dbTurnsMapRef = useRef<Map<number, DialogueTurn>>(new Map());
  
  // Convert API TranscriptionTurn to DialogueTurn
  const convertApiTurnToDialogue = useCallback((turn: TranscriptionTurn): DialogueTurn => {
    return {
      id: turn.id?.toString() || turn.provider_result_id,
      resultId: turn.provider_result_id,
      turn_id: typeof turn.id === 'number' ? turn.id : parseInt(turn.id?.toString() || '0'), // Primary key for reconciliation
      speaker: turn.speaker === 'technician' ? 'Technician' : (turn.speaker === 'customer' ? 'Customer' : 'Technician'),
      text: turn.text,
      timestamp: new Date(turn.created_at),
      isPartial: false,
      turn_index: turn.turn_index,
      word_timestamps: turn.meta_data?.word_timestamps || [], // Include word timestamps for audio sync
    };
  }, []);
  
  // Fetch turns from DB
  const fetchDbTurns = useCallback(async () => {
    if (!visitSessionId || !isEnabled) {
      return;
    }
    
    setIsLoadingDbTurns(true);
    setDbTurnsError(null);
    
    try {
      const apiTurns = await jobService.getTurnsByVisitSessionId(visitSessionId);
      const convertedTurns = apiTurns.map(convertApiTurnToDialogue);
      
      // Update state
      setDbTurns(convertedTurns);
      
      // Update ref map for fast lookups during reconciliation (indexed by turn_id)
      const newMap = new Map<number, DialogueTurn>();
      convertedTurns.forEach(turn => {
        if (turn.turn_id !== undefined) {
          newMap.set(turn.turn_id, turn);
        }
      });
      dbTurnsMapRef.current = newMap;
      
      if (__DEV__) {
        console.log('[TurnManagement] Loaded DB turns:', convertedTurns.length);
      }
    } catch (error) {
      console.error('[TurnManagement] Failed to fetch DB turns:', error);
      setDbTurnsError(error instanceof Error ? error.message : 'Failed to load transcription');
    } finally {
      setIsLoadingDbTurns(false);
    }
  }, [visitSessionId, isEnabled, convertApiTurnToDialogue]);
  
  // Load DB turns on mount and when visitSessionId changes
  useEffect(() => {
    if (visitSessionId && isEnabled) {
      fetchDbTurns();
    }
  }, [visitSessionId, isEnabled, fetchDbTurns]);
  
  /**
   * Reconcile DB turns with WebSocket cached_turns
   * 
   * Strategy:
   * - PRIMARY KEY: turn_id (from DB and WS)
   * - DB turns = baseline (already in correct order from DB query)
   * - WS cached_turns = live plugin (fresher data)
   * 
   * Logic:
   * 1. For each cached turn:
   *    - If turn_id exists in DB → Replace with WS version (fresher)
   *    - If turn_id not in DB → Append to end (live, not persisted)
   * 2. DO NOT SORT by turn_index!
   *    - Each transcription_session has its own turn_index starting from 0
   *    - Sorting would mix different sessions incorrectly
   *    - DB order is already correct from query
   * 
   * @param cachedTurns - Live turns from WebSocket
   * @returns Reconciled array of DialogueTurn
   */
  const reconcileTurns = useCallback((cachedTurns: DialogueTurn[]): DialogueTurn[] => {
    if (cachedTurns.length === 0) {
      return dbTurns;
    }
    
    // Create a copy of DB turns for reconciliation (preserve DB order)
    const reconciledTurns = [...dbTurns];
    
    // Process each cached turn from WebSocket
    cachedTurns.forEach(cachedTurn => {
      // Find existing turn by turn_id (PRIMARY KEY)
      const existingIndex = reconciledTurns.findIndex(
        dbTurn => dbTurn.turn_id === cachedTurn.turn_id
      );
      
      if (existingIndex >= 0) {
        // Turn exists in DB → Replace with WS version (it's fresher)
        reconciledTurns[existingIndex] = cachedTurn;
        
        if (__DEV__) {
          console.log(`[TurnManagement] Updated turn_id ${cachedTurn.turn_id} with WS data`);
        }
      } else {
        // New turn not in DB yet → Append to end
        reconciledTurns.push(cachedTurn);
        
        if (__DEV__) {
          console.log(`[TurnManagement] Added new turn_id ${cachedTurn.turn_id} (live, not in DB)`);
        }
      }
    });
    
    // Return as-is (DO NOT SORT - DB order is correct)
    if (__DEV__) {
      console.log('[TurnManagement] Reconciled turns:', {
        dbTurns: dbTurns.length,
        cachedTurns: cachedTurns.length,
        reconciled: reconciledTurns.length,
        newLiveTurns: reconciledTurns.length - dbTurns.length,
      });
    }
    
    return reconciledTurns;
  }, [dbTurns]);
  
  return {
    dbTurns,
    isLoadingDbTurns,
    dbTurnsError,
    refetchDbTurns: fetchDbTurns,
    reconcileTurns,
  };
};

