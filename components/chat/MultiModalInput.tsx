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

// Custom recording options optimized for OpenAI Whisper API compatibility
// iOS: Uses Linear PCM (WAV) for maximum compatibility
// Android: Uses AAC (M4A) which works well
const SILENCE_TIMEOUT_MS = 200; // stop after this much silence if recording
const OPENAI_COMPATIBLE_RECORDING_OPTIONS: RecordingOptions = {
  extension: Platform.OS === 'ios' ? '.wav' : '.m4a',
  sampleRate: 16000, // 16kHz is optimal for speech recognition
  numberOfChannels: 1, // Mono for speech
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
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

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

  const startVoiceRecording = useCallback(async () => {
    try {
      // Notify parent that recording is starting (to pause live transcription if needed)
      if (onVoiceRecordingStart) {
        await onVoiceRecordingStart();
      }

      // Request microphone permissions
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Permission Denied',
          'Microphone access is required for voice input. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Set audio mode for recording - platform-aware configuration
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          // iOS-specific: route audio through speaker when not using headphones
          ...(Platform.OS === 'ios' && { staysActiveInBackground: false }),
        });
      } catch (audioModeError: any) {
        console.warn('[MultiModalInput] Could not set audio mode:', audioModeError);
        // Check if this is because another audio session is active
        const errorMsg = audioModeError?.message || '';
        if (errorMsg.includes('OSStatus') || errorMsg.includes('audio session')) {
          Alert.alert(
            'Audio In Use',
            'The microphone is currently being used by another feature. Please stop the active recording first.',
            [{ text: 'OK' }]
          );
          return;
        }
        // Otherwise, try to continue anyway
      }

      // Create recorder instance with OpenAI-compatible settings
      // iOS: Linear PCM (WAV) for maximum compatibility with OpenAI Whisper
      // Android: AAC (M4A) which works well
      const recorder = new AudioModule.AudioRecorder(OPENAI_COMPATIBLE_RECORDING_OPTIONS);

      // Prepare and start recording
      await recorder.prepareToRecordAsync();
      await recorder.record();

      recorderRef.current = recorder;
      recordingStartTimeRef.current = Date.now();
      setIsRecording(true);

      if (__DEV__) {
        console.log(`[MultiModalInput] Voice recording started on ${Platform.OS}`);
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to start recording:', error);

      const errorMessage = error?.message || 'Unknown error';
      // Platform-specific error handling
      const isSimulatorError =
        errorMessage.includes('simulator') ||
        errorMessage.includes('not available') ||
        errorMessage.includes('emulator');

      // Check for audio session conflicts
      const isAudioSessionError = 
        errorMessage.includes('OSStatus error 561017449') ||
        errorMessage.includes('561017449') ||
        errorMessage.includes('audio session');

      if (isSimulatorError) {
        Alert.alert(
          Platform.OS === 'ios' ? 'Simulator Limitation' : 'Emulator Limitation',
          `Voice recording may not work properly on ${Platform.OS === 'ios' ? 'simulators' : 'emulators'}. Please test on a real device for full functionality.`,
          [{ text: 'OK' }]
        );
      } else if (isAudioSessionError) {
        Alert.alert(
          'Audio Session Conflict',
          'The microphone is currently being used by another feature. Please stop the active recording first.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Recording Error', `Could not start voice recording: ${errorMessage}`);
      }
      setIsRecording(false);
    }
  }, [onVoiceRecordingStart]);

  const stopVoiceRecording = useCallback(async () => {
    if (!recorderRef.current) return;

    const startTime = recordingStartTimeRef.current;
    const recorder = recorderRef.current;
    let uri: string | null = null;
    let stopError: Error | null = null;

    try {
      setIsRecording(false);

      if (__DEV__) {
        console.log('[MultiModalInput] Stopping voice recording...');
      }

      // Try to stop the recorder and get the URI
      try {
        await recorder.stop();
        const status = recorder.getStatus();
        uri = status.url || recorder.uri;
      } catch (error: any) {
        // OSStatus error 561017449 = audio session conflict (e.g., another audio session is active)
        // Save the error but continue to try to get the recording URI
        stopError = error;
        console.warn('[MultiModalInput] Error stopping recorder:', error?.message);
        
        // Try to get URI even if stop failed
        try {
          const status = recorder.getStatus();
          uri = status.url || recorder.uri;
        } catch (statusError) {
          console.warn('[MultiModalInput] Could not get recorder status:', statusError);
        }
      }

      // Clean up recorder reference
      recorderRef.current = null;
      recordingStartTimeRef.current = null;

      // Always try to reset audio mode, even if stop() failed
      // Use a small delay to let the native audio session settle
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        await setAudioModeAsync({
          allowsRecording: false,
        });
      } catch (audioModeError) {
        console.warn('[MultiModalInput] Could not reset audio mode:', audioModeError);
      }

      // If we have a URI, process the recording
      if (uri) {
        const durationMs = startTime ? Date.now() - startTime : undefined;
        const mimeType = getAudioMimeTypeFromUri(uri);
        const fileExtension = uri.split('.').pop()?.toLowerCase();
        console.log('[MultiModalInput] Audio recorded:', {
          uri,
          mimeType,
          fileExtension,
          platform: Platform.OS,
          hadStopError: Boolean(stopError),
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
              estimatedSizeKB: Math.round((rawBase64.length * 0.75) / 1024), // base64 is ~33% larger than binary
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

        // Provide recording result to parent component for processing
        if (onVoiceRecorded) {
          // Only set local state if prop is not provided (backward compatibility)
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
            // Only clear local state if prop is not provided (backward compatibility)
            if (!isTranscribingProp) {
              setIsTranscribingLocal(false);
            }
          }
        } else {
          // Fallback: notify via onSendMessage with structured data
          onSendMessage(base64Data ?? uri, 'voice');
        }
      } else {
        // If we couldn't get a URI, show the original error or a generic message
        if (stopError) {
          const errorMsg = stopError.message || 'Unknown error';
          // Check if this is an audio session conflict
          if (errorMsg.includes('OSStatus error 561017449') || errorMsg.includes('561017449')) {
            Alert.alert(
              'Audio Session Conflict',
              'The microphone is currently being used by another feature. Please try again or stop the active recording first.'
            );
          } else {
            Alert.alert(
              'Recording Error',
              `Could not stop voice recording: ${errorMsg}`
            );
          }
        } else {
          Alert.alert('Recording Error', 'No audio file was created.');
        }
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to stop recording:', error);
      Alert.alert(
        'Recording Error',
        `Could not stop voice recording: ${error?.message || 'Unknown error'}`
      );
    } finally {
      // Always clean up state, even if everything failed
      setIsRecording(false);
      if (!isTranscribingProp) {
        setIsTranscribingLocal(false);
      }
      recorderRef.current = null;
      recordingStartTimeRef.current = null;

      // Notify parent that recording ended (to resume live transcription if needed)
      if (onVoiceRecordingEnd) {
        try {
          await onVoiceRecordingEnd();
        } catch (err) {
          console.warn('[MultiModalInput] Error in onVoiceRecordingEnd:', err);
        }
      }
    }
  }, [onVoiceRecorded, onSendMessage, isTranscribingProp, onVoiceRecordingEnd]);

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
});

export default MultiModalInput;
