import { Ionicons } from '@expo/vector-icons';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  AudioModule,
  type AudioRecorder,
  type RecordingOptions,
  IOSOutputFormat,
  AudioQuality,
} from 'expo-audio';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  Animated,
  Easing,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { getMediaPicker, type MediaAsset } from '@/lib/media';
import { useTheme } from '@/contexts/ThemeContext';
import { posthog, PostHogEvents, getCompanyIdForTracking } from '@/lib/posthog';
import ExpoWearablesCamera, { type WearablesStatusEvent } from 'expo-wearables-camera';

const SPEECH_RECOGNITION_LANG = 'en-US';
const SPEECH_AUDIO_FILENAME_PREFIX = 'askai-voice';
const OPENAI_COMPATIBLE_RECORDING_OPTIONS: RecordingOptions = {
  extension: Platform.OS === 'ios' ? '.wav' : '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 128000,
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

interface PendingImage {
  id: string;
  uri: string;
  name?: string;
  type?: string;
  isUploading?: boolean;
}

export interface VoiceRecordingResult {
  uri: string;
  durationMs?: number;
  mimeType: string;
  base64Data?: string;
}

interface MultiModalInputProps {
  onSendMessage: (content: string, type: 'text' | 'voice' | 'image') => void;
  onImageSelected?: (image: MediaAsset) => void;
  onVoiceRecorded?: (result: VoiceRecordingResult) => void;
  onVoiceRecordingStart?: () => Promise<void>;
  onVoiceRecordingEnd?: () => Promise<void>;
  isLoading: boolean;
  isSpeaking: boolean;
  isTranscribing?: boolean;
  placeholder?: string;
  pendingImages?: PendingImage[];
  onRemovePendingImage?: (id: string) => void;
  isUploadingImages?: boolean;
  onStopSpeaking?: () => void;
  disabled?: boolean;
}

export const MultiModalInput: React.FC<MultiModalInputProps> = ({
  onSendMessage,
  onImageSelected,
  onVoiceRecorded,
  onVoiceRecordingStart,
  onVoiceRecordingEnd,
  isLoading,
  isSpeaking,
  isTranscribing: isTranscribingProp = false,
  placeholder = 'Type a message...',
  pendingImages = [],
  onRemovePendingImage,
  isUploadingImages = false,
  onStopSpeaking,
  disabled = false,
}) => {
  const { colors } = useTheme();
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  // Use prop if provided, otherwise fall back to local state (for backward compatibility)
  const [isTranscribingLocal, setIsTranscribingLocal] = useState(false);
  const isTranscribing = isTranscribingProp || isTranscribingLocal;
  const [wearablesStatus, setWearablesStatus] = useState<WearablesStatusEvent | null>(null);
  const [isConnectingMeta, setIsConnectingMeta] = useState(false);
  const [isCapturingGlasses, setIsCapturingGlasses] = useState(false);
  const [shouldMonitorWearables, setShouldMonitorWearables] = useState(false);
  const onImageSelectedRef = useRef(onImageSelected);
  const wearablesInitAttemptedRef = useRef(false);
  const wearablesInitializedRef = useRef(false);
  const legacyRecorderRef = useRef<AudioRecorder | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const recordingModeRef = useRef<'speech' | 'legacy' | null>(null);
  const speechListenersRef = useRef<Array<{ remove: () => void }>>([]);
  const latestRecordingUriRef = useRef<string | null>(null);
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Keep ref in sync so the long-running capture async chain always calls
  // the latest callback, even after background→foreground transitions.
  useEffect(() => {
    onImageSelectedRef.current = onImageSelected;
  }, [onImageSelected]);

  const ensureWearablesPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return true;

    if (!ExpoWearablesCamera?.requestAndroidPermissions) {
      Alert.alert(
        'Permissions Unavailable',
        'Required permissions handler is missing in this build.',
        [{ text: 'OK' }]
      );
      return false;
    }

    const granted = await ExpoWearablesCamera.requestAndroidPermissions();
    if (!granted) {
      Alert.alert(
        'Permissions Required',
        'Bluetooth and internet permissions are required to connect Meta AI.',
        [{ text: 'OK' }]
      );
    }
    return granted;
  }, []);

  const getWearablesErrorAlert = (error: any) => {
    const code = error?.code as string | undefined;
    const message = (error?.message as string | undefined) ?? '';

    if (
      code === 'REGISTRATION_WAIT_ERROR' ||
      message.includes('Wearables registration not completed')
    ) {
      return {
        title: 'Registration Incomplete',
        message:
          'Complete registration in the Meta AI app, then try again.',
      };
    }

    if (message.includes('No active wearable device found')) {
      return {
        title: 'No Active Device',
        message:
          'No active glasses were found. Make sure your glasses are on and connected.',
      };
    }

    if (message.includes('Camera permission not granted')) {
      return {
        title: 'Permission Required',
        message: 'Please allow camera access for Meta AI glasses.',
      };
    }

    // PermissionError.metaAINotInstalled - SDK cannot open Meta AI (see Meta docs PermissionError)
    // Developer Mode: no MetaAppID needed; enable in Meta AI app Settings
    if (
      message.includes('Cannot reach Meta AI') ||
      message.includes('metaAINotInstalled') ||
      message.includes('not installed')
    ) {
      return {
        title: 'Meta AI App Required',
        message:
          'Install or update the Meta AI app from the App Store, enable Developer Mode in Meta AI Settings, and ensure your glasses are paired.',
      };
    }

    // PermissionError.noDevice / noDeviceWithConnection
    if (
      message.includes('No wearable device') ||
      message.includes('disconnected') ||
      message.includes('powered off')
    ) {
      return {
        title: 'Glasses Not Connected',
        message:
          'Your glasses may be off or out of range. Turn them on and bring them closer.',
      };
    }

    // PermissionError.connectionError
    if (message.includes('Connection error') || message.includes('connectionError')) {
      return {
        title: 'Connection Error',
        message:
          'Device connection error. Ensure glasses are on and connected, then try again.',
      };
    }

    // PermissionError.requestTimeout
    if (message.includes('timed out') || message.includes('requestTimeout')) {
      return {
        title: 'Connection Timeout',
        message:
          'The glasses took too long to respond. Ensure they are on, nearby, and camera permission is granted in Meta AI.',
      };
    }

    // PermissionError.requestInProgress
    if (message.includes('already in progress') || message.includes('requestInProgress')) {
      return {
        title: 'Request In Progress',
        message: 'A permission request is already in progress. Please wait.',
      };
    }

    return null;
  };

  // Animate glow effect when speaking
  useEffect(() => {
    if (isSpeaking) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      glowAnim.setValue(0);
    }
  }, [isSpeaking, glowAnim]);

  useEffect(() => {
    if (
      !shouldMonitorWearables ||
      !ExpoWearablesCamera?.addListener
    ) {
      return;
    }

    const subscription = ExpoWearablesCamera.addListener('onWearablesStatus', (event) => {
      console.log('[MultiModalInput] onWearablesStatus event:', JSON.stringify(event));
      setWearablesStatus(event);
    });

    return () => {
      subscription?.remove();
    };
  }, [shouldMonitorWearables]);

  useEffect(() => {
    if (
      wearablesInitAttemptedRef.current ||
      !ExpoWearablesCamera?.initialize ||
      !ExpoWearablesCamera?.startMonitoring ||
      !ExpoWearablesCamera?.getStatus
    ) {
      return;
    }

    wearablesInitAttemptedRef.current = true;

    (async () => {
      const hasPermissions = await ensureWearablesPermissions();
      if (!hasPermissions) {
        return;
      }

      try {
        setShouldMonitorWearables(true);
        await ExpoWearablesCamera.initialize();
        await ExpoWearablesCamera.startMonitoring();
        const status = await ExpoWearablesCamera.getStatus();
        console.log('[MultiModalInput] Initial wearables status:', JSON.stringify(status));
        setWearablesStatus(status);
        wearablesInitializedRef.current = true;
      } catch (error: any) {
        console.error('[MultiModalInput] Meta AI init error:', error);
        const alert = getWearablesErrorAlert(error);
        if (alert) {
          Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
          return;
        }
        Alert.alert(
          'Meta AI Error',
          'Failed to initialize Meta AI integration. Please try again.',
          [{ text: 'OK' }]
        );
      }
    })();
  }, [ensureWearablesPermissions, getWearablesErrorAlert]);

  const performMetaAiRegistration = useCallback(
    async (showSuccessMessage: boolean) => {
      const wearablesModule = ExpoWearablesCamera;
      if (
        !wearablesModule?.initialize ||
        !wearablesModule?.startMonitoring ||
        !wearablesModule?.startRegistration ||
        !wearablesModule?.getStatus
      ) {
        Alert.alert(
          'Meta AI Unavailable',
          'Meta wearables camera module is not available in this build.',
          [{ text: 'OK' }]
        );
        return;
      }

      try {
        setIsConnectingMeta(true);
        if (!wearablesInitializedRef.current) {
          const hasPermissions = await ensureWearablesPermissions();
          if (!hasPermissions) return;
          setShouldMonitorWearables(true);
          await wearablesModule.initialize();
          await wearablesModule.startMonitoring();
          wearablesInitializedRef.current = true;
        }
        await wearablesModule.startRegistration();
        const status = await wearablesModule.getStatus();
        console.log('[MultiModalInput] Post-registration status:', JSON.stringify(status));
        setWearablesStatus(status);
        if (showSuccessMessage) {
          Alert.alert(
            'Complete in Meta AI',
            'Finish registration in the Meta AI app, then return here to continue.',
            [{ text: 'OK' }]
          );
        }
      } catch (error: any) {
        console.error('[MultiModalInput] Meta AI registration error:', error);
        const alert = getWearablesErrorAlert(error);
        if (alert) {
          Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
          return;
        }
        Alert.alert('Connection Error', 'Failed to connect Meta AI. Please try again.', [
          { text: 'OK' },
        ]);
      } finally {
        setIsConnectingMeta(false);
      }
    },
    [ensureWearablesPermissions, getWearablesErrorAlert]
  );

  // Registration should only happen when user explicitly taps the Meta Glass button.

  const mediaPicker = getMediaPicker();

  const hasPendingImages = pendingImages.length > 0;
  const hasText = textInput.trim().length > 0;
  // Text is always required (either typed or via voice transcription) for the /stream call
  const canSend = hasText && !isLoading && !isUploadingImages && !disabled;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    
    // Track message sent event
    if (posthog) {
      const companyId = getCompanyIdForTracking();
      const messageType = hasPendingImages ? 'image' : 'text';
      posthog.capture(PostHogEvents.CHAT_MESSAGE_SENT, {
        message_type: messageType,
        has_images: hasPendingImages,
        ...(companyId !== undefined && { company_id: companyId }),
      });
    }
    
    onSendMessage(textInput.trim(), hasPendingImages ? 'image' : 'text');
    setTextInput('');
  }, [canSend, textInput, hasPendingImages, onSendMessage]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Voice Recording
  // Platform-specific audio formats:
  // - iOS: Uses .m4a (AAC) format via AVFoundation
  // - Android: Uses .m4a (AAC) format via MediaRecorder
  // ─────────────────────────────────────────────────────────────────────────────

  const getAudioMimeTypeFromUri = (uri: string): string => {
    const ext = uri.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'm4a':
        return 'audio/m4a';
      case 'mp4':
        return 'audio/mp4';
      case 'webm':
        return 'audio/webm';
      case 'aac':
        return 'audio/aac';
      case 'wav':
        return 'audio/wav';
      default:
        return Platform.OS === 'ios' ? 'audio/wav' : 'audio/webm';
    }
  };

  const processRecordedAudio = useCallback(
    async (uri: string) => {
      const durationMs = recordingStartTimeRef.current
        ? Date.now() - recordingStartTimeRef.current
        : undefined;
      const mimeType = getAudioMimeTypeFromUri(uri);
      const fileExtension = uri.split('.').pop()?.toLowerCase();
      console.log('[MultiModalInput] Audio recorded:', {
        uri,
        mimeType,
        fileExtension,
        platform: Platform.OS,
      });
      let base64Data: string | undefined;

      try {
        // NOTE: readAsStringAsync is from expo-file-system/legacy; suppress deprecation warning intentionally
        // eslint-disable-next-line deprecation/deprecation
        const rawBase64 = await readAsStringAsync(uri, {
          encoding: 'base64',
        });
        base64Data = `data:${mimeType};base64,${rawBase64}`;

        if (__DEV__) {
          console.log('[MultiModalInput] Audio file size:', {
            base64Length: rawBase64.length,
            estimatedSizeKB: Math.round((rawBase64.length * 0.75) / 1024),
          });
        }
      } catch (readError) {
        console.warn('[MultiModalInput] Failed to read audio file for base64:', readError);
      }

      if (__DEV__) {
        console.log('[MultiModalInput] Recording saved:', {
          uri,
          durationMs,
          platform: Platform.OS,
          hasBase64: Boolean(base64Data),
        });
      }

      if (onVoiceRecorded) {
        if (!isTranscribingProp) {
          setIsTranscribingLocal(true);
        }
        try {
          await onVoiceRecorded({
            uri,
            durationMs,
            mimeType,
            base64Data,
          });
        } catch (transcriptionError) {
          console.error('[MultiModalInput] Voice processing error:', transcriptionError);
          Alert.alert('Voice Error', 'Could not process voice recording. Please try again.');
        } finally {
          if (!isTranscribingProp) {
            setIsTranscribingLocal(false);
          }
        }
      } else {
        onSendMessage(base64Data ?? uri, 'voice');
      }
    },
    [onSendMessage, onVoiceRecorded, isTranscribingProp]
  );

  const startLegacyRecording = useCallback(async () => {
    try {
      if (isRecordingRef.current) return;

      if (onVoiceRecordingStart) {
        await onVoiceRecordingStart();
      }

      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Permission Denied',
          'Microphone access is required for voice input. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          ...(Platform.OS === 'ios' && { staysActiveInBackground: false }),
        });
      } catch (audioModeError: any) {
        console.warn('[MultiModalInput] Could not set audio mode:', audioModeError);
      }

      const recorder = new AudioModule.AudioRecorder(OPENAI_COMPATIBLE_RECORDING_OPTIONS);
      await recorder.prepareToRecordAsync();
      await recorder.record();

      legacyRecorderRef.current = recorder;
      recordingStartTimeRef.current = Date.now();
      recordingModeRef.current = 'legacy';
      isRecordingRef.current = true;
      setIsRecording(true);

      if (__DEV__) {
        console.log(`[MultiModalInput] Legacy recording started on ${Platform.OS}`);
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to start legacy recording:', error);
      Alert.alert('Recording Error', `Could not start voice recording: ${error?.message || 'Unknown error'}`);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [onVoiceRecordingStart]);

  const stopLegacyRecording = useCallback(async () => {
    if (!legacyRecorderRef.current) return;

    const startTime = recordingStartTimeRef.current;
    const recorder = legacyRecorderRef.current;
    let uri: string | null = null;
    let stopError: Error | null = null;

    try {
      isRecordingRef.current = false;
      setIsRecording(false);

      if (__DEV__) {
        console.log('[MultiModalInput] Stopping legacy recording...');
      }

      try {
        await recorder.stop();
        const status = recorder.getStatus();
        uri = status.url || recorder.uri;
      } catch (error: any) {
        stopError = error;
        console.warn('[MultiModalInput] Error stopping legacy recorder:', error?.message);
        try {
          const status = recorder.getStatus();
          uri = status.url || recorder.uri;
        } catch (statusError) {
          console.warn('[MultiModalInput] Could not get legacy recorder status:', statusError);
        }
      }

      legacyRecorderRef.current = null;
      recordingStartTimeRef.current = null;
      recordingModeRef.current = null;

      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch (audioModeError) {
        console.warn('[MultiModalInput] Could not reset audio mode:', audioModeError);
      }

      if (uri) {
        await processRecordedAudio(uri);
      } else {
        if (stopError) {
          Alert.alert(
            'Recording Error',
            `Could not stop voice recording: ${stopError.message || 'Unknown error'}`
          );
        } else {
          Alert.alert('Recording Error', 'No audio file was created.');
        }
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to stop legacy recording:', error);
      Alert.alert(
        'Recording Error',
        `Could not stop voice recording: ${error?.message || 'Unknown error'}`
      );
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
      if (!isTranscribingProp) {
        setIsTranscribingLocal(false);
      }
      legacyRecorderRef.current = null;
      recordingStartTimeRef.current = null;
      recordingModeRef.current = null;

      if (onVoiceRecordingEnd) {
        try {
          await onVoiceRecordingEnd();
        } catch (err) {
          console.warn('[MultiModalInput] Error in onVoiceRecordingEnd:', err);
        }
      }
    }
  }, [onVoiceRecordingEnd, processRecordedAudio, isTranscribingProp]);

  const clearSpeechListeners = useCallback(() => {
    speechListenersRef.current.forEach((listener) => listener.remove());
    speechListenersRef.current = [];
  }, []);

  const finalizeSpeechSession = useCallback(async () => {
    clearSpeechListeners();
    isStoppingRef.current = false;
    recordingModeRef.current = null;

    if (onVoiceRecordingEnd) {
      try {
        await onVoiceRecordingEnd();
      } catch (err) {
        console.warn('[MultiModalInput] Error in onVoiceRecordingEnd:', err);
      }
    }
  }, [clearSpeechListeners, onVoiceRecordingEnd]);

  const stopVoiceRecording = useCallback(async () => {
    if (!isRecordingRef.current || isStoppingRef.current) return;

    if (recordingModeRef.current === 'legacy') {
      await stopLegacyRecording();
      return;
    }

    isStoppingRef.current = true;
    isRecordingRef.current = false;
    setIsRecording(false);

    if (__DEV__) {
      console.log('[MultiModalInput] Stopping voice recording...');
    }

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to stop speech recognition:', error);
      Alert.alert(
        'Recording Error',
        `Could not stop voice recording: ${error?.message || 'Unknown error'}`
      );
      await finalizeSpeechSession();
    }
  }, [finalizeSpeechSession, stopLegacyRecording]);

  const startVoiceRecording = useCallback(async () => {
    try {
      if (isRecordingRef.current) return;

      // Notify parent that recording is starting (to pause live transcription if needed)
      if (onVoiceRecordingStart) {
        await onVoiceRecordingStart();
      }

      if (ExpoSpeechRecognitionModule.supportsRecording?.() === false) {
        if (__DEV__) {
          console.log('[MultiModalInput] Speech recording unsupported, falling back.');
        }
        await startLegacyRecording();
        return;
      }

      const permissionResult = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permissionResult?.granted) {
        Alert.alert(
          'Permission Denied',
          'Microphone and speech recognition access are required for voice input. Please enable them in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      clearSpeechListeners();
      latestRecordingUriRef.current = null;
      isStoppingRef.current = false;

      const listeners = [
        ExpoSpeechRecognitionModule.addListener('speechend', () => {
          stopVoiceRecording();
        }),
        ExpoSpeechRecognitionModule.addListener('audioend', async (event: any) => {
          const uri = event?.uri as string | undefined;
          isRecordingRef.current = false;
          setIsRecording(false);

          if (uri) {
            latestRecordingUriRef.current = uri;
            await processRecordedAudio(uri);
          } else {
            Alert.alert('Recording Error', 'No audio was captured.');
          }
          await finalizeSpeechSession();
        }),
        ExpoSpeechRecognitionModule.addListener('error', async (event: any) => {
          console.error('[MultiModalInput] Speech recognition error:', event);
          isRecordingRef.current = false;
          setIsRecording(false);
          const errorMessage = event?.message || 'Speech recognition failed.';
          Alert.alert('Recording Error', errorMessage);
          await finalizeSpeechSession();
          if (recordingModeRef.current === 'speech' && !latestRecordingUriRef.current) {
            recordingModeRef.current = null;
            await startLegacyRecording();
          }
        }),
        ExpoSpeechRecognitionModule.addListener('end', async () => {
          if (!latestRecordingUriRef.current) {
            isRecordingRef.current = false;
            setIsRecording(false);
            await finalizeSpeechSession();
          }
        }),
      ];

      speechListenersRef.current = listeners;

      const outputFileName = `${SPEECH_AUDIO_FILENAME_PREFIX}-${Date.now()}.wav`;
      recordingModeRef.current = 'speech';
      ExpoSpeechRecognitionModule.start({
        lang: SPEECH_RECOGNITION_LANG,
        interimResults: false,
        continuous: false,
        recordingOptions: {
          persist: true,
          outputFileName,
        },
      });

      recordingStartTimeRef.current = Date.now();
      isRecordingRef.current = true;
      recordingModeRef.current = 'speech';
      setIsRecording(true);

      if (__DEV__) {
        console.log(`[MultiModalInput] Speech recognition started on ${Platform.OS}`);
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to start speech recognition:', error);

      const errorMessage = error?.message || 'Unknown error';
      const isSimulatorError =
        errorMessage.includes('simulator') ||
        errorMessage.includes('not available') ||
        errorMessage.includes('emulator');

      if (isSimulatorError) {
        Alert.alert(
          Platform.OS === 'ios' ? 'Simulator Limitation' : 'Emulator Limitation',
          `Voice recording may not work properly on ${Platform.OS === 'ios' ? 'simulators' : 'emulators'}. Please test on a real device for full functionality.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Recording Error', `Could not start voice recording: ${errorMessage}`);
      }
      isRecordingRef.current = false;
      setIsRecording(false);
      await finalizeSpeechSession();
      await startLegacyRecording();
    }
  }, [
    clearSpeechListeners,
    finalizeSpeechSession,
    onVoiceRecordingStart,
    processRecordedAudio,
    startLegacyRecording,
    stopVoiceRecording,
  ]);

  useEffect(() => {
    return () => {
      clearSpeechListeners();
    };
  }, [clearSpeechListeners]);

  const handleVoicePress = useCallback(() => {
    // Track events - differentiate between voice input and stopping agent response
    if (posthog) {
      const companyId = getCompanyIdForTracking();
      
      if (isSpeaking) {
        // User is stopping the agent's audio response
        posthog.capture(PostHogEvents.CHAT_AGENT_RESPONSE_STOPPED, {
          ...(companyId !== undefined && { company_id: companyId }),
        });
      } else if (isRecording) {
        // User is stopping voice recording
        posthog.capture(PostHogEvents.CHAT_VOICE_RECORDING_STOPPED, {
          ...(companyId !== undefined && { company_id: companyId }),
        });
      } else {
        // User is starting voice recording
        posthog.capture(PostHogEvents.CHAT_VOICE_RECORDING_STARTED, {
          ...(companyId !== undefined && { company_id: companyId }),
        });
      }
    }

    if (isSpeaking && onStopSpeaking) {
      onStopSpeaking();
    } else if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  }, [isSpeaking, isRecording, onStopSpeaking, startVoiceRecording, stopVoiceRecording]);

  // Animate the mic/stop button while recording or playing back (speaking)
  const shouldPulse = isRecording || isSpeaking;

  useEffect(() => {
    if (shouldPulse) {
      pulseLoopRef.current?.stop();
      pulseAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 650,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 650,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoopRef.current = loop;
      loop.start();
    } else {
      pulseLoopRef.current?.stop();
      pulseLoopRef.current = null;
      pulseAnim.setValue(0);
    }

    return () => {
      pulseLoopRef.current?.stop();
      pulseLoopRef.current = null;
    };
  }, [shouldPulse, pulseAnim]);

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.35],
  });
  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Camera Capture
  // Uses expo-image-picker which provides unified API for iOS and Android:
  // - iOS: Uses UIImagePickerController
  // - Android: Uses Intent.ACTION_IMAGE_CAPTURE
  // ─────────────────────────────────────────────────────────────────────────────
  const handleCameraPress = useCallback(async () => {
    // Track camera opened event
    if (posthog) {
      const companyId = getCompanyIdForTracking();
      posthog.capture(PostHogEvents.CHAT_CAMERA_OPENED, {
        ...(companyId !== undefined && { company_id: companyId }),
      });
    }

    // Check if we already have 4 images
    if (pendingImages.length >= 4) {
      Alert.alert(
        'Image Limit Reached',
        'You can only attach up to 4 images at a time.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!mediaPicker.isAvailable()) {
      Alert.alert(
        'Camera Unavailable',
        'Camera functionality requires a development build. Please run with `npx expo run:ios` or `npx expo run:android`.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const result = await mediaPicker.launchCamera({
        quality: 0.8,
        allowsEditing: false,
      });

      if (!result.cancelled && result.assets.length > 0) {
        const asset = result.assets[0];
        if (__DEV__) {
          console.log('[MultiModalInput] Camera captured:', {
            uri: asset.uri,
            type: asset.type,
            size: asset.size,
            platform: Platform.OS,
          });
        }
        onImageSelected?.(asset);
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Camera error:', error);
      Alert.alert('Camera Error', 'Failed to capture image. Please try again.');
    }
  }, [mediaPicker, onImageSelected, pendingImages]);

  const handleConnectMetaAiPress = useCallback(async () => {
    if (!ExpoWearablesCamera?.initialize) {
      Alert.alert(
        'Meta AI Unavailable',
        'Meta wearables camera module is not available in this build.',
        [{ text: 'OK' }]
      );
      return;
    }

    await performMetaAiRegistration(true);
  }, [performMetaAiRegistration]);

  const handleGlassesCameraPress = useCallback(async () => {
    if (pendingImages.length >= 4) {
      Alert.alert(
        'Image Limit Reached',
        'You can only attach up to 4 images at a time.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const wearablesModule = ExpoWearablesCamera;
      if (
        !wearablesModule?.initialize ||
        !wearablesModule?.startMonitoring ||
        !wearablesModule?.getStatus ||
        !wearablesModule?.requestWearablesCameraPermission ||
        !wearablesModule?.capturePhotoToTempFile
      ) {
        Alert.alert(
          'Glasses Camera Unavailable',
          'Meta wearables camera module is not available in this build.',
          [{ text: 'OK' }]
        );
        return;
      }

      const hasPermissions = await ensureWearablesPermissions();
      if (!hasPermissions) return;

      setShouldMonitorWearables(true);
      if (!wearablesInitializedRef.current) {
        await wearablesModule.initialize();
        await wearablesModule.startMonitoring();
        wearablesInitializedRef.current = true;
      }
      const status = await wearablesModule.getStatus();
      if (status?.registrationState !== 'Registered') {
        Alert.alert(
          'Not Connected',
          'Please tap “Connect Meta AI” before using the glasses camera.',
          [{ text: 'OK' }]
        );
        return;
      }
      if (!status?.hasActiveDevice) {
        Alert.alert(
          'Glasses Not Ready',
          'Put on your glasses and ensure they are connected. If you just granted camera permission, wait a few seconds and try again.',
          [{ text: 'OK' }]
        );
        return;
      }
      const wearablesPermission = await wearablesModule.requestWearablesCameraPermission();
      if (wearablesPermission !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow camera access for Meta AI glasses.',
          [{ text: 'OK' }]
        );
        return;
      }

      setIsCapturingGlasses(true);
      const result = await wearablesModule.capturePhotoToTempFile();
      if (result?.localPath) {
        const fileName = result.localPath.split('/').pop() || `glasses-${Date.now()}.jpg`;
        const fileExt = fileName.split('.').pop()?.toLowerCase();
        const mimeType = fileExt === 'heic' ? 'image/heic' : 'image/jpeg';
        const uri = result.localPath.startsWith('file://')
          ? result.localPath
          : `file://${result.localPath}`;
        if (__DEV__) {
          console.log('[MultiModalInput] Glasses camera captured:', {
            localPath: result.localPath,
            width: result.width,
            height: result.height,
            sizeBytes: result.sizeBytes,
            timestamp: result.timestamp,
          });
        }

        // Use ref to always call the latest callback — the long-running capture
        // spans a background→foreground transition (Meta AI permission flow),
        // so the closure-captured callback may be stale after re-render.
        onImageSelectedRef.current?.({
          uri,
          type: mimeType,
          name: fileName,
        });
      } else {
        Alert.alert('Capture Error', 'No photo was returned from glasses camera.');
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Glasses camera error:', error);
      const alert = getWearablesErrorAlert(error);
      if (alert) {
        Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
      } else {
        Alert.alert(
          'Glasses Camera Error',
          'Failed to connect to Meta AI or capture from glasses. Please try again.'
        );
      }
    } finally {
      setIsCapturingGlasses(false);
    }
  }, [ensureWearablesPermissions, getWearablesErrorAlert, pendingImages]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Gallery Pick
  // Uses expo-image-picker which provides unified API for iOS and Android:
  // - iOS: Uses PHPickerViewController (iOS 14+) or UIImagePickerController
  // - Android: Uses Intent.ACTION_PICK or document picker
  // ─────────────────────────────────────────────────────────────────────────────
  const handleGalleryPress = useCallback(async () => {
    // Track gallery opened event
    if (posthog) {
      const companyId = getCompanyIdForTracking();
      posthog.capture(PostHogEvents.CHAT_GALLERY_OPENED, {
        ...(companyId !== undefined && { company_id: companyId }),
      });
    }

    // Check if we already have 4 images
    if (pendingImages.length >= 4) {
      Alert.alert(
        'Image Limit Reached',
        'You can only attach up to 4 images at a time.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!mediaPicker.isAvailable()) {
      Alert.alert(
        'Gallery Unavailable',
        'Gallery functionality requires a development build. Please run with `npx expo run:ios` or `npx expo run:android`.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const result = await mediaPicker.launchGallery({
        quality: 0.8,
        allowsEditing: true,
      });

      if (!result.cancelled && result.assets.length > 0) {
        const asset = result.assets[0];
        if (__DEV__) {
          console.log('[MultiModalInput] Gallery picked:', {
            uri: asset.uri,
            type: asset.type,
            size: asset.size,
            platform: Platform.OS,
          });
        }
        onImageSelected?.(asset);
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Gallery error:', error);
      Alert.alert('Gallery Error', 'Failed to select image. Please try again.');
    }
  }, [mediaPicker, onImageSelected, pendingImages]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {hasPendingImages && (
        <View
          style={[
            styles.imagesPreview,
            { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
          ]}
        >
          {pendingImages.map((img) => (
            <View key={img.id} style={styles.imageWrapper}>
              <Image
                source={{ uri: img.uri }}
                style={[styles.previewImage, img.isUploading && styles.uploadingImage]}
              />
              {img.isUploading && (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator size="small" color="#ffffff" />
                </View>
              )}
              {!img.isUploading && onRemovePendingImage && (
                <Pressable
                  style={styles.removeImageButton}
                  onPress={() => onRemovePendingImage(img.id)}>
                  <Ionicons name="close" size={12} color="#ffffff" />
                </Pressable>
              )}
            </View>
          ))}
          {isUploadingImages && (
            <View style={styles.uploadingLabel}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <ThemedText style={[styles.uploadingText, { color: colors.textSecondary }]}>Uploading...</ThemedText>
            </View>
          )}
        </View>
      )}

      <View
        style={[
          styles.inputRow,
          { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
        ]}
      >
        <TextInput
          value={textInput}
          onChangeText={setTextInput}
          placeholder={hasPendingImages ? 'Ask about this image... (or use mic button)' : placeholder}
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={!isLoading && !isUploadingImages && !disabled}
          style={[styles.textInput, { color: colors.text }]}
        />
      </View>

      <View style={styles.actionsRow}>
        <View style={styles.mediaButtons}>
          <Pressable
            style={[styles.connectButton, { backgroundColor: colors.backgroundSecondary }]}
            onPress={handleConnectMetaAiPress}
            disabled={
              isLoading || isRecording || isTranscribing || disabled || isConnectingMeta
            }>
            {isConnectingMeta ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons name="link-outline" size={16} color={colors.textSecondary} />
            )}
            <ThemedText style={[styles.connectButtonText, { color: colors.textSecondary }]}>
              {wearablesStatus?.registrationState === 'Registered' ? 'Connected' : 'Connect'}
            </ThemedText>
          </Pressable>

          {/* Voice Button */}
          <View style={styles.voiceButtonContainer}>
              {shouldPulse && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.voicePulse,
                  {
                      backgroundColor: isRecording ? '#ef4444' : colors.primary,
                    opacity: pulseOpacity,
                    transform: [{ scale: pulseScale }],
                  },
                ]}
              />
            )}
            <Pressable
              style={[
                styles.iconButton,
                { backgroundColor: colors.backgroundSecondary },
                isRecording && styles.recordingButton,
                isSpeaking && styles.speakingButton,
                isTranscribing && styles.transcribingButton,
              ]}
              onPress={handleVoicePress}
              disabled={isLoading || isTranscribing || disabled}>
              {isTranscribing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : isSpeaking ? (
                <Ionicons name="stop" size={18} color="#ffffff" />
              ) : (
                <Ionicons name="mic" size={18} color={isRecording ? '#ffffff' : '#6b7280'} />
              )}
            </Pressable>
          </View>

          {/* Gallery Button */}
          <Pressable
            style={[styles.iconButton, { backgroundColor: colors.backgroundSecondary }]}
            onPress={handleGalleryPress}
            disabled={isLoading || isRecording || isTranscribing || disabled}>
            <Ionicons name="images-outline" size={18} color={colors.textSecondary} />
          </Pressable>

          {/* Camera Button */}
          <Pressable
            style={[styles.iconButton, { backgroundColor: colors.backgroundSecondary }]}
            onPress={handleCameraPress}
            disabled={isLoading || isRecording || isTranscribing || disabled}>
            <Ionicons name="camera-outline" size={18} color={colors.textSecondary} />
          </Pressable>

          <Pressable
            style={[
              styles.iconButton,
              { backgroundColor: colors.backgroundSecondary },
              isCapturingGlasses && { backgroundColor: colors.primary },
            ]}
            onPress={handleGlassesCameraPress}
            disabled={isLoading || isRecording || isTranscribing || disabled || isCapturingGlasses}>
            {isCapturingGlasses ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons name="glasses-outline" size={18} color={colors.textSecondary} />
            )}
          </Pressable>
        </View>

        <Pressable
          style={[
            styles.sendButton,
            { backgroundColor: colors.primary },
            !canSend && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!canSend}>
          {isUploadingImages ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="send" size={16} color="#ffffff" />
          )}
          <ThemedText style={styles.sendButtonText}>
            {isUploadingImages ? 'Sending...' : 'Send'}
          </ThemedText>
        </Pressable>
      </View>

      {wearablesStatus?.lastError ? (
        <ThemedText style={[styles.wearablesErrorText, { color: colors.textSecondary }]}>
          Meta AI error: {wearablesStatus.lastError}
        </ThemedText>
      ) : null}

      {/* Transcription Status */}
      {/* {isTranscribing && (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <ThemedText style={[styles.statusText, { color: colors.textSecondary }]}>
            Processing your voice message...
          </ThemedText>
        </View>
      )} */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
    paddingHorizontal: 12,
  },
  imagesPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  imageWrapper: {
    position: 'relative',
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  uploadingImage: {
    opacity: 0.7,
    borderColor: '#0a7ea4',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeImageButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  uploadingText: {
    fontSize: 12,
    color: '#6b7280',
  },
  inputRow: {
    borderRadius: 12,
    borderWidth: 1,
  },
  textInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
    maxHeight: 100,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mediaButtons: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  voiceButtonContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  voicePulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
  },
  connectButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingButton: {
    backgroundColor: '#ef4444',
  },
  speakingButton: {
    backgroundColor: '#0a7ea4',
  },
  transcribingButton: {
    backgroundColor: '#8b5cf6',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  sendButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    color: '#6b7280',
  },
  stopIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
  },
  stopPulse: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
  },
  wearablesErrorText: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default MultiModalInput;
