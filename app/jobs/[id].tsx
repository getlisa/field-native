import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  GestureResponderEvent,
  KeyboardAvoidingView,
  PanResponder,
  PanResponderGestureState,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AskAITab } from '@/components/jobs/tabs/AskAITab';
import { ConversationChecklistTab } from '@/components/jobs/tabs/ConversationChecklistTab';
import { InsightsTab } from '@/components/jobs/tabs/InsightsTab';
import { TranscriptionTab } from '@/components/jobs/tabs/TranscriptionTab';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { JobDetailProvider } from '@/contexts/JobDetailContext';
import { useJobDetails } from '@/hooks/useJobDetails';
import { useJobQuery } from '@/hooks/useJobQuery';
import { useSubscriberTranscription } from '@/hooks/useSubscriberTranscription';
import { useTurnManagement } from '@/hooks/useTurnManagement';
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useRecordingStore } from '@/store/useRecordingStore';
import type { DialogueTurn } from '@/lib/RealtimeChat';
import { BorderRadius, FontSizes, Spacing } from '@/constants/theme';
import {
  getNotificationService,
  formatProactiveSuggestionsForNotification,
} from '@/services/notificationService';
import { getPermissionService } from '@/services/permissionService';
import { jobService } from '@/services/jobService';
import type { ProactiveSuggestionsMessage } from '@/lib/RealtimeChat';

type TabKey = 'transcription' | 'askAI' | 'checklist' | 'insights';

interface Tab {
  key: TabKey;
  icon: keyof typeof Ionicons.glyphMap;
}

const TABS: Tab[] = [
  { key: 'transcription', icon: 'document-text-outline' },
  { key: 'askAI', icon: 'sparkles-outline' },
  { key: 'checklist', icon: 'checkmark-circle-outline' },
  { key: 'insights', icon: 'bulb-outline' },
];

export default function JobDetailPage() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const currentUser = useAuthStore((state) => state.user);
  const { colors, shadows } = useTheme();

  // Initialize activeTab from URL parameter if provided, otherwise default to 'transcription'
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (tab && ['transcription', 'askAI', 'checklist', 'insights'].includes(tab)) {
      return tab as TabKey;
    }
    return 'transcription';
  });
  
  // Update activeTab when tab param changes (for navigation from notifications)
  useEffect(() => {
    if (tab && ['transcription', 'askAI', 'checklist', 'insights'].includes(tab)) {
      if (__DEV__) {
        console.log('[JobDetail] Tab param changed to:', tab);
      }
      setActiveTab(tab as TabKey);
    }
  }, [tab]);
  
  const [actionLoading, setActionLoading] = useState(false);
  const [suppressAutoTranscription, setSuppressAutoTranscription] = useState(false);
  const [isCompletingJob, setIsCompletingJob] = useState(false); // Track when job is being completed
  
  // Track if we're allowing navigation (e.g., from notification click)
  const allowNavigationRef = useRef(false);

  // Ordered tabs for swipe navigation
  const tabOrder: TabKey[] = ['transcription', 'askAI', 'checklist', 'insights'];

  // Use reusable swipe navigation hook
  const { panResponder, panX, slideAnim, fadeAnim } = useSwipeNavigation({
    tabs: tabOrder,
    activeTab,
    onTabChange: setActiveTab,
  });

  const { job, visitSession, loading, error, fetchJob, startJob, completeJob } = useJobDetails();

  // Use React Query for job data with automatic invalidation
  const { invalidate: invalidateJob } = useJobQuery(id);

  const isAssignedToJob = useMemo(() => {
    if (!job || !currentUser?.id) return false;
    return job.technician_id === currentUser.id;
  }, [job, currentUser?.id]);

  // Load turns from DB and handle reconciliation
  const { dbTurns, isLoadingDbTurns, reconcileTurns } = useTurnManagement({
    visitSessionId: visitSession?.id,
    jobStatus: job?.status,
    isEnabled: Boolean(job?.status === 'ongoing' || job?.status === 'completed'),
  });

  // Track app state to determine if we should send notifications
  const appState = useRef(AppState.currentState);
  const [isAppInForeground, setIsAppInForeground] = useState(true);
  const recordingNotificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      appState.current = nextAppState;
      setIsAppInForeground(nextAppState === 'active');
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Get transcription state and methods from store
  // Use stable empty array reference to avoid infinite loops
  const emptyTurnsRef = useRef<DialogueTurn[]>([]);
  const wsTurns = useRecordingStore((state) => {
    // Get turns for current session (reactive)
    if (state.activeTranscriptionSessionId) {
      const sessionTurns = state.turnsBySessionId[state.activeTranscriptionSessionId];
      // Return the actual array from store (or stable empty array reference)
      return sessionTurns || emptyTurnsRef.current;
    }
    return emptyTurnsRef.current;
  });
  const isRecording = useRecordingStore((state) => state.isRecording);
  const isConnected = useRecordingStore((state) => state.isConnected);
  const isConnecting = useRecordingStore((state) => state.isConnecting);
  const transcriptionError = useRecordingStore((state) => state.error);
  const activeTranscriptionSessionId = useRecordingStore((state) => state.activeTranscriptionSessionId);
  const activeJobId = useRecordingStore((state) => state.activeJobId);
  const startTranscription = useRecordingStore((state) => state.startTranscription);
  const stopTranscription = useRecordingStore((state) => state.stopTranscription);
  const setApiTurns = useRecordingStore((state) => state.setApiTurns);

  // Handle proactive suggestions callback
  const handleProactiveSuggestions = useCallback((suggestions: ProactiveSuggestionsMessage) => {
      if (__DEV__) {
        console.log('[JobDetail] 📬 Proactive suggestions received:', {
          missedOpportunities: suggestions.missedOpportunities?.length || 0,
          checklistDetected: suggestions.checklistDetected,
          appState: appState.current,
          isAssignedToJob,
          hasJob: !!job,
        });
      }

      // Invalidate job query when proactive suggestions are received
      invalidateJob();

      // Send notifications to the assigned technician
      // Only send if:
      // 1. User is assigned to the job
      // 2. There are missed opportunities (NOT for checklistDetected)
      // 3. App is in background (when in foreground, UI will show the suggestions)
      if (
        job &&
        isAssignedToJob &&
        suggestions.missedOpportunities?.length > 0 // Only for missedOpportunities
      ) {
        const notificationService = getNotificationService();
        
        // Format and send notifications for each missed opportunity only
        const notificationData = formatProactiveSuggestionsForNotification(
          suggestions,
          id,
          job.job_target_name || 'Job'
        );

        if (__DEV__) {
          console.log('[JobDetail] 📤 Sending proactive suggestion notifications:', {
            count: notificationData.length,
            appState: appState.current,
            isBackground: appState.current !== 'active',
          });
        }

        // Send notifications (will be shown or delivered based on app state)
        notificationData.forEach((data) => {
          notificationService
            .sendProactiveSuggestionNotification(data)
            .then(() => {
              if (__DEV__) {
                console.log('[JobDetail] ✅ Proactive suggestion notification sent:', data.suggestion);
              }
            })
            .catch((error) => {
              console.error('[JobDetail] ❌ Error sending proactive suggestion notification:', error);
            });
        });
      } else if (__DEV__) {
        console.log('[JobDetail] ⏭️ Skipping proactive suggestion notification:', {
          hasJob: !!job,
          isAssignedToJob,
          hasMissedOpportunities: (suggestions.missedOpportunities?.length || 0) > 0,
        });
      }
  }, [job, isAssignedToJob, id, invalidateJob]);

  // Manage recording notification when recording state changes
  useEffect(() => {
    const notificationService = getNotificationService();
    
    if (isRecording && isAssignedToJob && id && job?.job_target_name) {
      // Show notification when recording starts (always show, but especially important when app goes to background)
      notificationService
        .sendRecordingNotification(id, job.job_target_name)
        .then((notificationId: string) => {
          recordingNotificationIdRef.current = notificationId;
          if (__DEV__) {
            console.log('[JobDetail] Recording notification sent:', notificationId);
          }
        })
        .catch((error: any) => {
          console.error('[JobDetail] Error sending recording notification:', error);
        });
    } else {
      // Cancel notification when recording stops
      if (recordingNotificationIdRef.current && id) {
        notificationService
          .cancelRecordingNotification(id)
          .catch((error: any) => {
            console.error('[JobDetail] Error cancelling recording notification:', error);
          });
        recordingNotificationIdRef.current = null;
      }
    }

    // Cleanup: cancel notification when component unmounts or recording stops
    return () => {
      if (recordingNotificationIdRef.current && id) {
        notificationService
          .cancelRecordingNotification(id)
          .catch((error: any) => {
            console.error('[JobDetail] Error cancelling recording notification on cleanup:', error);
          });
      }
    };
  }, [isRecording, isAssignedToJob, id, job?.job_target_name]);

  // Get the first transcription session for heartbeat check
  const firstTranscriptionSession = job?.visit_sessions?.transcription_sessions?.[0];
  const lastHeartbeatAt = firstTranscriptionSession?.last_heartbeat_at || null;

  // Callback for when subscriber detects job might be completed (no data received)
  const handleSubscriberJobCompleted = useCallback(() => {
    if (__DEV__) {
      console.log('[JobDetail] Subscriber detected job might be completed - invalidating job query');
    }
    invalidateJob();
  }, [invalidateJob]);

  // Subscriber transcription for non-assigned viewers
  const {
    turns: subscriberWsTurns,
    isConnected: isSubscriberConnected,
    isReceivingAudio,
    isReceivingTurns,
    isRetrying: isSubscriberRetrying,
    isAudioEnabled,
    toggleAudio,
    error: subscriberError,
    setApiTurns: setViewerApiTurns,
  } = useSubscriberTranscription({
    transcriptionSessionId: firstTranscriptionSession?.id || null,
    isJobOngoing: job?.status === 'ongoing',
    enabled: !isAssignedToJob && job?.status === 'ongoing', // Only for viewers of ongoing jobs
    lastHeartbeatAt,
    onJobCompleted: handleSubscriberJobCompleted, // Invalidate job when no data received
  });

  // Poll job status for subscribers during ongoing jobs
  // This detects when job completes and triggers audio/turn updates
  useEffect(() => {
    // Only poll for viewers of ongoing jobs
    if (isAssignedToJob || !job || job.status !== 'ongoing' || !id) {
      return;
    }

    if (__DEV__) {
      console.log('[JobDetail] Starting job status polling for subscriber (ongoing job)');
    }

    // Poll every 5 seconds
    const pollInterval = setInterval(async () => {
      try {
        await fetchJob(id);
        
        // Check if job completed (will trigger via job state change)
        if (__DEV__ && job?.status === 'completed') {
          console.log('[JobDetail] Subscriber poll detected job completion');
        }
      } catch (error) {
        console.error('[JobDetail] Error polling job status:', error);
      }
    }, 5000);

    return () => {
      if (__DEV__) {
        console.log('[JobDetail] Stopping job status polling for subscriber');
      }
      clearInterval(pollInterval);
    };
  }, [isAssignedToJob, job?.status, id, fetchJob]);

  // When job becomes completed for subscribers, fetch final turns
  const hasFetchedSubscriberTurnsRef = useRef(false);
  const subscriberJobIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    const fetchSubscriberTurns = async () => {
      // Only for viewers (subscribers)
      if (isAssignedToJob || !visitSession?.id || !job?.status) {
        return;
      }
      
      // Reset flag if job ID changed
      if (subscriberJobIdRef.current !== id) {
        hasFetchedSubscriberTurnsRef.current = false;
        subscriberJobIdRef.current = id;
      }
      
      // Only fetch when job becomes completed
      if (job.status !== 'completed') {
        hasFetchedSubscriberTurnsRef.current = false;
        return;
      }
      
      // Only fetch once per job completion
      if (hasFetchedSubscriberTurnsRef.current) {
        return;
      }
      
      try {
        if (__DEV__) {
          console.log('[JobDetail] Subscriber: Job completed - fetching final turns from DB...');
        }
        
        hasFetchedSubscriberTurnsRef.current = true;
        
        const freshTurns = await jobService.getTurnsByVisitSessionId(visitSession.id);
        const convertedTurns: DialogueTurn[] = freshTurns.map((turn) => ({
          id: turn.id?.toString() || turn.provider_result_id,
          resultId: turn.provider_result_id,
          turn_id: typeof turn.id === 'number' ? turn.id : parseInt(turn.id?.toString() || '0'),
          speaker: (turn.speaker === 'technician' ? 'Technician' : (turn.speaker === 'customer' ? 'Customer' : 'Technician')) as 'Technician' | 'Customer',
          text: turn.text,
          timestamp: new Date(turn.created_at),
          isPartial: false,
          turn_index: turn.turn_index,
          word_timestamps: turn.meta_data?.word_timestamps || [],
        }));
        
        // Update subscriber turns with fresh API data
        setViewerApiTurns(convertedTurns);
        
        if (__DEV__) {
          console.log('[JobDetail] ✅ Subscriber: Updated with final turns from DB:', convertedTurns.length);
        }
      } catch (error) {
        console.error('[JobDetail] ❌ Subscriber: Error fetching final turns:', error);
        hasFetchedSubscriberTurnsRef.current = false; // Reset on error
      }
    };
    
    fetchSubscriberTurns();
  }, [job?.status, visitSession?.id, isAssignedToJob, setViewerApiTurns, id]);

  // When job becomes completed, fetch fresh turns from API and update store
  // This ensures we show the final DB state instead of cached turns
  const hasFetchedFreshTurnsRef = useRef(false);
  const jobIdForFreshTurnsRef = useRef<string | null>(null);
  
  useEffect(() => {
    const fetchAndSetFreshTurns = async () => {
      // Only for assigned users (they have the recording store)
      if (!isAssignedToJob || !visitSession?.id || !job?.status) {
        return;
      }
      
      // Reset flag if job ID changed (navigating to different job)
      if (jobIdForFreshTurnsRef.current !== id) {
        hasFetchedFreshTurnsRef.current = false;
        jobIdForFreshTurnsRef.current = id;
      }
      
      // Only fetch when job becomes completed
      if (job.status !== 'completed') {
        hasFetchedFreshTurnsRef.current = false;
        return;
      }
      
      // Only fetch if we're not currently recording (job is done)
      if (isRecording || isConnected) {
        return;
      }
      
      // Only fetch once per job completion
      if (hasFetchedFreshTurnsRef.current) {
        return;
      }
      
      try {
        if (__DEV__) {
          console.log('[JobDetail] Job completed - fetching fresh turns from API to replace cached turns...');
        }
        
        hasFetchedFreshTurnsRef.current = true;
        
        const freshTurns = await jobService.getTurnsByVisitSessionId(visitSession.id);
        const convertedTurns: DialogueTurn[] = freshTurns.map((turn) => ({
          id: turn.id?.toString() || turn.provider_result_id,
          resultId: turn.provider_result_id,
          turn_id: typeof turn.id === 'number' ? turn.id : parseInt(turn.id?.toString() || '0'),
          speaker: (turn.speaker === 'technician' ? 'Technician' : (turn.speaker === 'customer' ? 'Customer' : 'Technician')) as 'Technician' | 'Customer',
          text: turn.text,
          timestamp: new Date(turn.created_at),
          isPartial: false,
          turn_index: turn.turn_index,
          word_timestamps: turn.meta_data?.word_timestamps || [],
        }));
        
        // Update store with fresh API turns (this replaces cached turns)
        setApiTurns(convertedTurns);
        
        if (__DEV__) {
          console.log('[JobDetail] ✅ Updated store with fresh API turns after job completion:', convertedTurns.length);
        }
      } catch (error) {
        console.error('[JobDetail] ❌ Error fetching fresh turns after job completion:', error);
        hasFetchedFreshTurnsRef.current = false; // Reset on error so we can retry
      }
    };
    
    fetchAndSetFreshTurns();
  }, [job?.status, visitSession?.id, isAssignedToJob, isRecording, isConnected, setApiTurns, id]);

  // Use WebSocket turns directly (don't reconcile during live transcription)
  // cached_turns from WebSocket already contain ALL turns for the session
  // Reconciliation is not needed and causes issues with turn ordering
  const effectiveTurns = useMemo(() => {
    const wsSource = isAssignedToJob ? wsTurns : subscriberWsTurns;
    
    // During live transcription (ongoing job), use WebSocket data directly
    // cached_turns already contain all turns in correct order
    if (job?.status === 'ongoing' && wsSource.length > 0) {
      return wsSource;
    }
    
    // For completed jobs, prefer WebSocket data if available (fresher), otherwise use DB
    if (wsSource.length > 0) {
      return wsSource;
    }
    
    // Fallback to DB turns if no WebSocket data
    return dbTurns;
  }, [isAssignedToJob, wsTurns, subscriberWsTurns, dbTurns, job?.status]);
  
  // For viewers: show "live" when receiving cached_turns from WebSocket
  // For assigned users: show "live" when connected
  const effectiveIsConnected = isAssignedToJob 
    ? isConnected 
    : (isSubscriberConnected && isReceivingTurns);
  const effectiveIsConnecting = isAssignedToJob ? isConnecting : isSubscriberRetrying;
  const effectiveError = isAssignedToJob ? transcriptionError : subscriberError;

  // Track previous job ID to detect if we're navigating to a different job
  const previousJobIdRef = useRef<string | undefined>(undefined);
  
  // Ref for TranscriptionTab to enable auto-scroll
  const transcriptionScrollRef = useRef<{ scrollToEnd: (options?: { animated?: boolean }) => void; scrollToTurnId?: (turnId: string | number) => void } | null>(null);

  useEffect(() => {
    if (id) {
      // Reset navigation flag when arriving at this page
      allowNavigationRef.current = false;
      if (__DEV__) {
        console.log('[JobDetail] 📍 Navigated to job page, reset allowNavigation flag');
      }
      fetchJob(id);
    }
  }, [id, fetchJob]);

  // Update active tab when tab parameter changes (e.g., from notification)
  useEffect(() => {
    if (tab && ['transcription', 'askAI', 'checklist', 'insights'].includes(tab)) {
      setActiveTab(tab as TabKey);
      if (__DEV__) {
        console.log('[JobDetail] Tab changed from URL parameter:', tab);
      }
    }
  }, [tab]);
  
  // Auto-scroll to latest turn for ongoing jobs
  // Uses the last turn's ID and text to detect any changes (not just length)
  const lastTurnSignature = useMemo(() => {
    if (effectiveTurns.length === 0) return null;
    const lastTurn = effectiveTurns[effectiveTurns.length - 1];
    return `${lastTurn.id || lastTurn.resultId}-${lastTurn.text.substring(0, 50)}-${lastTurn.timestamp?.getTime()}`;
  }, [effectiveTurns]);
  
  useEffect(() => {
    if (
      job?.status === 'ongoing' &&
      effectiveTurns.length > 0 &&
      activeTab === 'transcription' &&
      transcriptionScrollRef.current &&
      lastTurnSignature
    ) {
      // Small delay to ensure content is rendered
      const timeout = setTimeout(() => {
        transcriptionScrollRef.current?.scrollToEnd?.({ animated: true });
      }, 100);
      
      return () => clearTimeout(timeout);
    }
  }, [lastTurnSignature, job?.status, activeTab, effectiveTurns.length]);

  // Remove auto-start transcription - only start when technician clicks start
  // (Removed useEffect that auto-started transcription)

  // Stop transcription only when navigating to a different job (not when remounting with same ID)
  // Use store state to check if same session is active
  useEffect(() => {
    const currentJobId = id;
    const currentSessionId = visitSession?.id;
    
    // If we had a previous job ID and it's different from current, stop transcription
    // (We're navigating away to a different job)
    if (previousJobIdRef.current && previousJobIdRef.current !== currentJobId) {
      if (__DEV__) {
        console.log('[JobDetail] Navigating to different job, stopping transcription');
      }
      stopTranscription();
    }
    
    // Check if we're remounting with the same active session (from store)
    // If so, don't stop transcription - it's already running
    if (
      currentJobId &&
      currentSessionId &&
      activeJobId === currentJobId &&
      activeTranscriptionSessionId === currentSessionId &&
      isRecording
    ) {
      if (__DEV__) {
        console.log('[JobDetail] Component remounting with same active session, preserving transcription:', {
          jobId: currentJobId,
          sessionId: currentSessionId,
          isRecording: isRecording,
        });
      }
      // Don't stop - transcription is already active for this session
    }
    
    // Update the previous job ID
    previousJobIdRef.current = currentJobId;
    
    // Cleanup: stop transcription when component unmounts (only if we're leaving completely)
    return () => {
      // Only stop if we're actually leaving (not just remounting with same ID)
      // Check if id still matches - if it does, we're probably just remounting, so don't stop
      if (previousJobIdRef.current !== currentJobId) {
        if (__DEV__) {
          console.log('[JobDetail] Component unmounting, stopping transcription');
        }
        stopTranscription();
      } else {
        if (__DEV__) {
          console.log('[JobDetail] Component remounting with same job ID, keeping transcription active');
        }
      }
    };
  }, [id, visitSession?.id, activeJobId, activeTranscriptionSessionId, isRecording, stopTranscription]);

  const handleStartJob = useCallback(async () => {
    if (!id || !isAssignedToJob) return;
    setSuppressAutoTranscription(false);
    setActionLoading(true);
    try {
      // Check permissions before starting job
      const permissionService = getPermissionService();
      const permissions = await permissionService.checkAllPermissions();

      // Request microphone permission (REQUIRED)
      if (!permissions.microphone) {
        const micPermission = await permissionService.requestMicrophonePermission();
        if (!micPermission.granted) {
          Alert.alert(
            'Microphone Permission Required',
            'This job requires microphone access for live transcription. Please enable it in Settings.',
            [{ text: 'OK' }]
          );
          setActionLoading(false);
          return;
        }
      }

      // Request notification permission (REQUIRED)
      if (!permissions.notifications) {
        const notifPermission = await permissionService.requestNotificationPermission();
        if (!notifPermission.granted) {
          Alert.alert(
            'Notification Permission Required',
            'This job requires notification access to alert you about important updates. Please enable it in Settings.',
            [{ text: 'OK' }]
          );
          setActionLoading(false);
          return;
        }
      }

      // Check background permissions (especially important for Android)
      if (!permissions.background) {
        const bgPermission = await permissionService.checkBackgroundPermissions();
        if (!bgPermission.granted) {
          Alert.alert(
            'Background Service Required',
            'This job requires background service to continue recording. Please enable it in Settings.',
            [{ text: 'OK' }]
          );
          // Continue anyway - background service might still work
        }
      }

      // Both microphone and notification permissions are granted - proceed with job start
      const session = await startJob(id);
      if (session?.id && job?.company_id) {
        // Start transcription immediately after starting job
        setActiveTab('transcription');
        await startTranscription(session.id, job.company_id, {
          jobId: id,
          onProactiveSuggestions: handleProactiveSuggestions,
        });
      }
    } finally {
      setActionLoading(false);
    }
  }, [id, startJob, startTranscription, isAssignedToJob, job?.company_id]);

  // Track if confirmCompleteJob was called from a user action (confirmation dialog)
  const completeJobUserActionRef = useRef(false);
  // Ref to track latest job status for polling
  const jobStatusRef = useRef(job?.status);

  // Update job status ref when job changes
  useEffect(() => {
    jobStatusRef.current = job?.status;
  }, [job?.status]);

  const confirmCompleteJob = useCallback(async () => {
    // Only allow completion if it was triggered by user action (confirmation dialog)
    if (!completeJobUserActionRef.current) {
      if (__DEV__) {
        console.warn('[JobDetail] ⚠️ Blocked automatic completeJob call - must be triggered from confirmation dialog');
        console.trace('[JobDetail] Call stack:');
      }
      return;
    }

    // Reset the flag after checking
    completeJobUserActionRef.current = false;

    if (!id) return;

    if (__DEV__) {
      console.log('[JobDetail] ✅ Stopping recording - sending WebSocket end event (server will complete job)');
    }

    setSuppressAutoTranscription(true);
    setActionLoading(true);
    setIsCompletingJob(true); // Mark as processing
    
    try {
      // Stop transcription and send WebSocket 'end' event
      // The server will handle completing the job when it receives the 'end' event
      await stopTranscription();
      
      // Immediately fetch fresh turns from DB and update store
      // This provides instant feedback without waiting for job status to update
      if (visitSession?.id) {
        try {
          if (__DEV__) {
            console.log('[JobDetail] 📥 Fetching fresh turns from DB after stop...');
          }
          
          const freshTurns = await jobService.getTurnsByVisitSessionId(visitSession.id);
          const convertedTurns: DialogueTurn[] = freshTurns.map((turn) => ({
            id: turn.id?.toString() || turn.provider_result_id,
            resultId: turn.provider_result_id,
            turn_id: typeof turn.id === 'number' ? turn.id : parseInt(turn.id?.toString() || '0'),
            speaker: (turn.speaker === 'technician' ? 'Technician' : (turn.speaker === 'customer' ? 'Customer' : 'Technician')) as 'Technician' | 'Customer',
            text: turn.text,
            timestamp: new Date(turn.created_at),
            isPartial: false,
            turn_index: turn.turn_index,
            word_timestamps: turn.meta_data?.word_timestamps || [],
          }));
          
          // Update store with fresh API turns immediately
          setApiTurns(convertedTurns);
          
          if (__DEV__) {
            console.log('[JobDetail] ✅ Updated store with fresh turns immediately:', convertedTurns.length);
          }
        } catch (turnError) {
          console.error('[JobDetail] ❌ Error fetching fresh turns:', turnError);
          // Continue anyway - job completion is more important
        }
      }
      
      // Poll for job completion (server processes the end event and completes the job)
      // This is needed to show audio player and final job state
      if (__DEV__) {
        console.log('[JobDetail] ⏳ Polling for job completion to show audio player...');
      }
      
      const maxAttempts = 15; // Poll for up to 15 seconds (15 * 1 second)
      let attempts = 0;
      let jobCompleted = false;
      
      while (attempts < maxAttempts && !jobCompleted) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await fetchJob(id);
        
        // Wait a bit for state to update
        await new Promise(resolve => setTimeout(resolve, 100));
        
        attempts++;
        
        // Check job status from ref (updated by useEffect)
        if (jobStatusRef.current === 'completed') {
          jobCompleted = true;
          if (__DEV__) {
            console.log('[JobDetail] ✅ Job marked as completed by server - audio player will load');
          }
          break;
        }
        
        if (__DEV__ && attempts % 3 === 0) {
          console.log(`[JobDetail] ⏳ Waiting for job completion... (${attempts}/${maxAttempts})`);
        }
      }
      
      if (!jobCompleted) {
        if (__DEV__) {
          console.warn('[JobDetail] ⚠️ Job completion timeout - refreshing anyway');
        }
      }
      
      // Invalidate job query to refresh all data (audio recordings, status, etc.)
      invalidateJob();
      
      // Final fetch to ensure we have the latest job data
      await fetchJob(id);
      
    } finally {
      setActionLoading(false);
      setIsCompletingJob(false);
    }
  }, [id, stopTranscription, fetchJob, invalidateJob]);

  const handleResumeJob = useCallback(async () => {
    if (!id || !isAssignedToJob || !visitSession?.id || !job?.company_id) {
      console.log('[JobDetail] Cannot resume - missing requirements:', {
        id,
        isAssignedToJob,
        visitSessionId: visitSession?.id,
        companyId: job?.company_id,
      });
      return;
    }
    setSuppressAutoTranscription(false);
    setActionLoading(true);
    try {
      // Check permissions before resuming
      const permissionService = getPermissionService();
      const permissions = await permissionService.checkAllPermissions();

      // Request missing permissions
      if (!permissions.microphone) {
        const micPermission = await permissionService.requestMicrophonePermission();
        if (!micPermission.granted) {
          Alert.alert(
            'Microphone Permission Required',
            'This job requires microphone access for live transcription. Please enable it in Settings.',
            [{ text: 'OK' }]
          );
          setActionLoading(false);
          return;
        }
      }

      // Start transcription (this will create a new transcription session)
      setActiveTab('transcription');
      await startTranscription(visitSession.id, job.company_id, {
        jobId: id,
        onProactiveSuggestions: handleProactiveSuggestions,
      });
    } finally {
      setActionLoading(false);
    }
  }, [id, visitSession?.id, job?.company_id, isAssignedToJob, startTranscription]);

  const handleCompleteJob = useCallback(() => {
    Alert.alert(
      'Complete Job?',
      'This will stop the recording and generate insights from the conversation. Are you sure you want to complete this job?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Complete Job',
          style: 'destructive',
          onPress: () => {
            // Set flag to indicate this is a user action from confirmation dialog
            completeJobUserActionRef.current = true;
            confirmCompleteJob();
          },
        },
      ],
      { cancelable: true }
    );
  }, [confirmCompleteJob]);

  const handleBack = useCallback(() => {
    // Check if we need to show confirmation dialog for recording
    // This handles both iOS back button and Android hardware back button
    const shouldShowConfirmation = useRecordingStore.getState().shouldShowRecordingConfirmation;
    
    if (__DEV__) {
      console.log('[JobDetail] 🔙 Back button pressed - checking conditions:', {
        isRecording,
        isAssignedToJob,
        allowNavigation: allowNavigationRef.current,
        shouldShowConfirmation,
        willShowDialog: isRecording && isAssignedToJob && !allowNavigationRef.current && shouldShowConfirmation,
      });
    }
    
    if (isRecording && isAssignedToJob && !allowNavigationRef.current && shouldShowConfirmation) {
      // Show confirmation dialog
      if (__DEV__) {
        console.log('[JobDetail] ✋ Back button pressed during recording - showing confirmation');
      }
      
      Alert.alert(
        'Recording in Progress',
        'You have an active recording. Do you want to complete the job before leaving?',
        [
          {
            text: 'Keep Recording',
            style: 'cancel',
            onPress: () => {
              if (__DEV__) {
                console.log('[JobDetail] User chose to keep recording');
              }
            },
          },
          {
            text: 'Complete Job',
            style: 'destructive',
            onPress: () => {
              if (__DEV__) {
                console.log('[JobDetail] User chose to complete job before leaving (from back button)');
              }
              // Set flag to indicate this is a user action from confirmation dialog
              completeJobUserActionRef.current = true;
              // Allow navigation after completion
              allowNavigationRef.current = true;
              confirmCompleteJob();
            },
          },
        ],
        { cancelable: true }
      );
      return true; // Prevent navigation
    }
    
    // Not recording or allowed to navigate - proceed with normal navigation
    if (__DEV__) {
      console.log('[JobDetail] ➡️ Proceeding with navigation');
    }
    
    try {
      if (router.canGoBack()) {
        router.back();
      } else {
        // If we can't go back, navigate to the jobs list or home
        router.replace('/(tabs)/jobs');
      }
    } catch (error) {
      // Fallback: navigate to jobs list if back navigation fails
      router.replace('/(tabs)/jobs');
    }
    return true; // Prevent default back action since we handled it
  }, [router, isRecording, isAssignedToJob, confirmCompleteJob]);

  // Prevent navigation when recording (using usePreventRemove for proper native-stack support)
  // But allow navigation if it's from a notification (flag is false) or user confirmed completion
  // 
  // MUST use the selector hook (not getState()) to ensure component re-renders when flag changes
  // This is critical: when flag changes from false → true, the condition must update
  const shouldShowConfirmation = useRecordingStore((state) => state.shouldShowRecordingConfirmation);
  const shouldPreventRemove = 
    isRecording && 
    isAssignedToJob && 
    !allowNavigationRef.current && 
    shouldShowConfirmation;
  
  // Memoized callback for usePreventRemove - recreated when dependencies change
  // This ensures the callback always has the latest values for tab, isRecording, and isAssignedToJob
  const handlePreventRemove = useCallback(
    ({ data }: { data: { action: any } }) => {
      // Double-check flag at navigation time using getState() - this is the latest value
      // If flag changed to false between render and navigation, we still can't undo
      // e.preventDefault(), but we won't show the alert
      const shouldShowConfirmation = useRecordingStore.getState().shouldShowRecordingConfirmation;
      console.log('shouldShowConfirmation', shouldShowConfirmation);
      if (!shouldShowConfirmation) {
        if (__DEV__) {
          console.log('[JobDetail] ✅ Flag is false - not showing confirmation (notification navigation)', {
            tab,
            isRecording,
            isAssignedToJob,
          });
        }
        // Note: e.preventDefault() was already called, but we don't show the alert
        return;
      }

      // Show confirmation dialog only if flag is true
      if (__DEV__) {
        console.log('[JobDetail] 🚫 Navigation prevented - recording in progress', {
          isRecording,
          isAssignedToJob,
          allowNavigation: allowNavigationRef.current,
          shouldShowConfirmation,
          tab,
        });
      }

      Alert.alert(
        'Recording in Progress',
        'You have an active recording. Do you want to complete the job before leaving?',
        [
          {
            text: 'Keep Recording',
            style: 'cancel',
            onPress: () => {
              if (__DEV__) {
                console.log('[JobDetail] User chose to keep recording');
              }
            },
          },
          {
            text: 'Complete Job',
            style: 'destructive',
            onPress: () => {
              if (__DEV__) {
                console.log('[JobDetail] User chose to complete job before leaving');
              }
              // Set flag to indicate this is a user action from confirmation dialog
              completeJobUserActionRef.current = true;
              // Allow navigation after completion
              allowNavigationRef.current = true;
              confirmCompleteJob();
            },
          },
        ],
        { cancelable: true }
      );
    },
    [tab, isRecording, isAssignedToJob, confirmCompleteJob]
  );
  
  usePreventRemove(shouldPreventRemove, handlePreventRemove);

  // Handle Android back button
  // This ensures confirmation dialog shows for Android hardware back button
  // iOS back button is handled by header back button (which calls handleBack)
  // iOS swipe gestures are handled by usePreventRemove
  useEffect(() => {
    if (Platform.OS === 'android') {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        return handleBack();
      });
      return () => backHandler.remove();
    }
  }, [handleBack]);

  // Context value for child components
  const contextValue = useMemo(
    () => ({
      job,
      jobId: id,
      jobStatus: job?.status,
      isJobAssignedToCurrentUser: isAssignedToJob,
      isViewer: !isAssignedToJob,
      // Ask AI available for all viewers regardless of assignment/status
      canUseAskAI: true,
      canViewTranscription: Boolean(isAssignedToJob || job?.status === 'completed'),
      turns: effectiveTurns,
      isConnected: effectiveIsConnected,
      isConnecting: effectiveIsConnecting,
      isRecording,
      transcriptionError: effectiveError,
      startTranscription,
      stopTranscription,
      visitSessionId: visitSession?.id || job?.visit_sessions?.id,
      transcriptionScrollRef, // Add scroll ref for auto-scroll
      isLoadingDbTurns, // Add loading state for DB turns
      setActiveTab, // Add setActiveTab for navigation
    }),
    [
      job,
      id,
      isAssignedToJob,
      effectiveTurns,
      effectiveIsConnected,
      effectiveIsConnecting,
      isRecording,
      effectiveError,
      startTranscription,
      stopTranscription,
      visitSession?.id,
      isLoadingDbTurns,
      setActiveTab,
    ]
  );

  if (loading && !job) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.loadingContainer} edges={['top', 'left', 'right']}>
          <ActivityIndicator size="large" color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading job details...
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (error && !job) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.errorContainer} edges={['top', 'left', 'right']}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <ThemedText style={styles.errorTitle}>Failed to load job</ThemedText>
          <ThemedText style={[styles.errorText, { color: colors.textSecondary }]}>
            {error}
          </ThemedText>
          <Button onPress={() => id && fetchJob(id)} icon="refresh-outline" size="sm">
            Retry
          </Button>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!job) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.errorContainer} edges={['top', 'left', 'right']}>
          <Ionicons name="document-outline" size={48} color={colors.iconSecondary} />
          <ThemedText style={styles.errorTitle}>Job not found</ThemedText>
          <Button onPress={handleBack} icon="arrow-back-outline" size="sm">
            Go Back
          </Button>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'transcription':
        return <TranscriptionTab />;
      case 'askAI':
        return <AskAITab />;
      case 'checklist':
        return <ConversationChecklistTab />;
      case 'insights':
        return <InsightsTab />;
      default:
        return <TranscriptionTab />;
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Use KeyboardAvoidingView for AskAI tab - iOS only
  const isAskAITab = activeTab === 'askAI';
  const useKeyboardAvoidingView = isAskAITab && Platform.OS === 'ios';

  console.log(isAssignedToJob, isConnected, isRecording, isConnecting, visitSession?.id, job?.visit_sessions?.id, "Debugging Job Detail Page");

  const content = (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header with Job Info and Action Button */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              backgroundColor: colors.background,
            },
            shadows.sm,
          ]}
        >
          <View style={styles.headerLeft}>
            <Pressable style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
            <View style={styles.jobInfo}>
              <ThemedText style={styles.jobName} numberOfLines={1}>
                {job.job_target_name || 'Untitled Job'}
              </ThemedText>
              <View style={styles.jobMetaRow}>
                <Ionicons name="location-outline" size={14} color={colors.iconSecondary} />
                <ThemedText style={[styles.jobMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {job.address}
                </ThemedText>
              </View>
              <View style={styles.jobMetaRow}>
                <Ionicons name="time-outline" size={14} color={colors.iconSecondary} />
                <ThemedText style={[styles.jobMeta, { color: colors.textSecondary }]}>
                  {formatDateTime(job.start_timestamp)}
                </ThemedText>
              </View>
            </View>
          </View>

          {/* Action Button or Status Badge */}
          {isAssignedToJob ? (
            <View style={styles.headerRight}>
              {job.status === 'scheduled' && (
                <Button
                  onPress={handleStartJob}
                  loading={actionLoading}
                  disabled={actionLoading}
                  size="sm"
                  variant="primary"
                >
                  Start
                </Button>
              )}
              {job.status === 'ongoing' && (
                <View style={styles.actionButtonRow}>
                  {/* Show LIVE indicator when recording */}
                  {isRecording && (
                    <View style={[styles.statusBadge, styles.liveBadge, { backgroundColor: '#ef444420', marginRight: 8 }]}>
                      <View style={styles.liveDot} />
                      <ThemedText style={[styles.statusBadgeText, { color: '#ef4444', fontWeight: '700' }]}>
                        LIVE
                      </ThemedText>
                    </View>
                  )}
                  {(() => {
                    const showResume = !isRecording && !isConnected && !isConnecting && (visitSession?.id || job?.visit_sessions?.id);
                    const showIconOnly = showResume; // Use icons when both buttons are shown
                    
                    if (showIconOnly) {
                      return (
                        <>
                          {/* <Pressable
                            onPress={handleResumeJob}
                            disabled={actionLoading}
                            style={({ pressed }) => [
                              styles.iconButton,
                              {
                                backgroundColor: colors.buttonPrimary,
                                opacity: actionLoading || pressed ? 0.7 : 1,
                              },
                            ]}
                          >
                            {actionLoading ? (
                              <ActivityIndicator size="small" color={colors.textInverse} />
                            ) : (
                              <Ionicons name="play" size={20} color={colors.textInverse} />
                            )}
                          </Pressable> */}
                          <Button
                            onPress={handleCompleteJob}
                            loading={actionLoading || isCompletingJob}
                            disabled={actionLoading || isCompletingJob}
                            size="sm"
                            variant="primary"
                            style={styles.actionButton}
                          >
                            Stop
                          </Button>
                        </>
                      );
                    }
                    
                    return (
                      <Button
                        onPress={handleCompleteJob}
                        loading={actionLoading || isCompletingJob}
                        disabled={actionLoading || isCompletingJob}
                        size="sm"
                        variant="primary"
                        style={styles.actionButton}
                      >
                        {isCompletingJob ? 'Processing...' : 'Stop'}
                      </Button>
                    );
                  })()}
                </View>
              )}
              {job.status === 'completed' && (
                <View style={[styles.statusBadge, { backgroundColor: colors.success + '20' }]}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <ThemedText style={[styles.statusBadgeText, { color: colors.success }]}>
                    Completed
                  </ThemedText>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.headerRight}>
              {job.status === 'scheduled' && (
                <View style={[styles.statusBadge, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                  <ThemedText style={[styles.statusBadgeText, { color: colors.primary }]}>
                    Scheduled
                  </ThemedText>
                </View>
              )}
              {job.status === 'ongoing' && (
                <View style={styles.liveStatusContainer}>
                  {/* For viewers: show LIVE when receiving cached_turns OR audio */}
                  {/* For assigned users: show LIVE when recording */}
                  {((!isAssignedToJob && (isReceivingTurns || isReceivingAudio)) || (isAssignedToJob && isRecording)) ? (
                    <>
                      <View style={[styles.statusBadge, styles.liveBadge, { backgroundColor: '#ef444420' }]}>
                        <View style={styles.liveDot} />
                        <ThemedText style={[styles.statusBadgeText, { color: '#ef4444', fontWeight: '700' }]}>
                          LIVE
                        </ThemedText>
                      </View>
                      {/* Audio toggle for viewers when receiving audio */}
                      {!isAssignedToJob && isReceivingAudio && (
                        <Pressable
                          onPress={toggleAudio}
                          style={[
                            styles.audioToggle,
                            {
                              backgroundColor: isAudioEnabled ? colors.primary : colors.backgroundSecondary,
                            },
                          ]}
                        >
                          <Ionicons
                            name={isAudioEnabled ? 'volume-high' : 'volume-mute'}
                            size={20}
                            color={isAudioEnabled ? '#fff' : colors.iconSecondary}
                          />
                        </Pressable>
                      )}
                    </>
                  ) : (
                    <View style={[styles.statusBadge, { backgroundColor: '#f59e0b20' }]}>
                      <Ionicons name="ellipse" size={10} color="#f59e0b" />
                      <ThemedText style={[styles.statusBadgeText, { color: '#f59e0b' }]}>
                        Ongoing
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}
              {job.status === 'completed' && (
                <View style={[styles.statusBadge, { backgroundColor: colors.success + '20' }]}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <ThemedText style={[styles.statusBadgeText, { color: colors.success }]}>
                    Completed
                  </ThemedText>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Icon-Only Tab Navigation */}
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.background,
              borderBottomColor: colors.border,
            },
          ]}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            
            return (
              <Pressable
                key={tab.key}
                style={[
                  styles.tabButton,
                  isActive && {
                    borderBottomColor: colors.primary,
                    borderBottomWidth: 3,
                  },
                ]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Ionicons
                  name={tab.icon}
                  size={24}
                  color={isActive ? colors.primary : colors.iconSecondary}
                />
              </Pressable>
            );
          })}
        </View>

        {/* Tab Content */}
        <Animated.View 
          style={[
            styles.tabContent,
            {
              opacity: fadeAnim,
              transform: [
                { 
                  translateX: Animated.add(slideAnim, panX)
                }
              ]
            }
          ]} 
          {...panResponder.panHandlers}
        >
          {renderActiveTab()}
        </Animated.View>
      </SafeAreaView>
    </ThemedView>
  );

  return (
    <JobDetailProvider value={contextValue}>
      {useKeyboardAvoidingView ? (
        <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={0}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </JobDetailProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  backButton: {
    padding: Spacing.xs,
    marginTop: Spacing.xs,
  },
  jobInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  jobName: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  jobMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  jobMeta: {
    fontSize: FontSizes.sm,
    flex: 1,
  },
  headerRight: {
    paddingTop: Spacing.xs,
  },
  actionButtonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  actionButton: {
    minWidth: 100,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  statusBadgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  liveStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  liveBadge: {
    paddingHorizontal: Spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 2,
  },
  audioToggle: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: '25%',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSizes.md,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing['2xl'],
    gap: Spacing.md,
  },
  errorTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '600',
  },
  errorText: {
    fontSize: FontSizes.md,
    textAlign: 'center',
  },
});
