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
  Animated,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { getMediaPicker, type MediaAsset } from '@/lib/media';
import { useTheme } from '@/contexts/ThemeContext';

// Custom recording options optimized for OpenAI Whisper API compatibility
// iOS: Uses Linear PCM (WAV) for maximum compatibility
// Android: Uses AAC (M4A) which works well
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
  isLoading: boolean;
  isSpeaking: boolean;
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
  isLoading,
  isSpeaking,
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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
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
  const canSend = hasText && !isLoading && !isUploadingImages && !disabled;

  const handleSend = useCallback(() => {
    if (!canSend) return;
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
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        // iOS-specific: route audio through speaker when not using headphones
        ...(Platform.OS === 'ios' && { staysActiveInBackground: false }),
      });

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

      if (isSimulatorError) {
        Alert.alert(
          Platform.OS === 'ios' ? 'Simulator Limitation' : 'Emulator Limitation',
          `Voice recording may not work properly on ${Platform.OS === 'ios' ? 'simulators' : 'emulators'}. Please test on a real device for full functionality.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Recording Error', `Could not start voice recording: ${errorMessage}`);
      }
      setIsRecording(false);
    }
  }, []);

  const stopVoiceRecording = useCallback(async () => {
    if (!recorderRef.current) return;

    const startTime = recordingStartTimeRef.current;
    const recorder = recorderRef.current;

    try {
      setIsRecording(false);

      if (__DEV__) {
        console.log('[MultiModalInput] Stopping voice recording...');
      }

      await recorder.stop();
      const status = recorder.getStatus();
      const uri = status.url || recorder.uri;
      recorderRef.current = null;
      recordingStartTimeRef.current = null;

      // Reset audio mode
      await setAudioModeAsync({
        allowsRecording: false,
      });

      if (uri) {
        const durationMs = startTime ? Date.now() - startTime : undefined;
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
          setIsTranscribing(true);
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
            setIsTranscribing(false);
          }
        } else {
          // Fallback: notify via onSendMessage with structured data
          onSendMessage(base64Data ?? uri, 'voice');
        }
      } else {
        Alert.alert('Recording Error', 'No audio file was created.');
      }
    } catch (error: any) {
      console.error('[MultiModalInput] Failed to stop recording:', error);
      Alert.alert(
        'Recording Error',
        `Could not stop voice recording: ${error?.message || 'Unknown error'}`
      );
      setIsRecording(false);
      setIsTranscribing(false);
      recorderRef.current = null;
      recordingStartTimeRef.current = null;
    }
  }, [onVoiceRecorded, onSendMessage]);

  const handleVoicePress = useCallback(() => {
    if (isSpeaking && onStopSpeaking) {
      onStopSpeaking();
    } else if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  }, [isSpeaking, isRecording, onStopSpeaking, startVoiceRecording, stopVoiceRecording]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Camera Capture
  // Uses expo-image-picker which provides unified API for iOS and Android:
  // - iOS: Uses UIImagePickerController
  // - Android: Uses Intent.ACTION_IMAGE_CAPTURE
  // ─────────────────────────────────────────────────────────────────────────────
  const handleCameraPress = useCallback(async () => {
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
        allowsEditing: true,
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
          placeholder={hasPendingImages ? 'Ask about this image...' : placeholder}
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={!isLoading && !isUploadingImages && !disabled}
          style={[styles.textInput, { color: colors.text }]}
        />
      </View>

      <View style={styles.actionsRow}>
        <View style={styles.mediaButtons}>
          {/* Voice Button */}
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
              <View style={styles.pauseIconContainer}>
                <Animated.View
                  style={[
                    styles.pauseGlow,
                    {
                      opacity: glowAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 0.6],
                      }),
                      transform: [
                        {
                          scale: glowAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.2],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <Ionicons name="pause" size={18} color="#ffffff" />
              </View>
            ) : (
              <Ionicons name="mic" size={18} color={isRecording ? '#ffffff' : '#6b7280'} />
            )}
          </Pressable>

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
      {isTranscribing && (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <ThemedText style={[styles.statusText, { color: colors.textSecondary }]}>
            Processing your voice message...
          </ThemedText>
        </View>
      )}
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
  pauseIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
  },
  pauseGlow: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    opacity: 0.3,
    // Animation for glowing effect
    shadowColor: '#0a7ea4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
});

export default MultiModalInput;
