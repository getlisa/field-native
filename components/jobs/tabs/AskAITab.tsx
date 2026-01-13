/**
 * AskAITab Component - React Native Implementation
 * 
 * A conversational AI interface for technicians to interact with Clara assistant.
 * Supports multiple input modalities: text, voice, images (camera/gallery).
 * 
 * Key Features:
 * - Real-time streaming AI responses (using XMLHttpRequest for RN compatibility)
 * - Voice input with transcription (expo-audio)
 * - Camera and gallery image support (expo-image-picker)
 * - Image preview with upload progress
 * - Multimodal interactions (text + images)
 * - Optimistic UI updates
 * - Android keyboard handling
 * 
 * Data Flow:
 * 1. Text/Voice: User input → Stream AI response in real-time
 * 2. Images: Upload images → Create user message → Stream AI response
 * 
 * Streaming:
 * Uses XMLHttpRequest (not fetch) for progressive SSE streaming in React Native.
 * Falls back to non-streaming sendMessage if stream fails.
 */

import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatMessage } from '@/components/chat/ChatMessage';
import { MultiModalInput, type VoiceRecordingResult } from '@/components/chat/MultiModalInput';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { copilotChatService, type CopilotMessage } from '@/services/copilotChatService';
import { useAuthStore } from '@/store/useAuthStore';
import { useStreamingTTS } from '@/hooks/useStreamingTTS';
import type { MediaAsset } from '@/lib/media';
import type { Message, PendingImage } from '@/components/chat/types';
import { api } from '@/lib/apiClient';

export const AskAITab: React.FC = () => {
  const { job, jobId, canUseAskAI, isRecording: isLiveTranscribing, isConnected: isTranscriptionConnected, pauseTranscription, resumeTranscription } = useJobDetailContext();
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Refs
  const messagesContainerRef = useRef<FlatList<Message>>(null);
  const messagesEndRef = useRef<View>(null);

  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // TTS hook for voice agent
  const { addToQueue, flush, stop: stopTTS, isSpeaking } = useStreamingTTS();

  const isAllowed = canUseAskAI;

  // Refresh access token on mount and every 10 minutes while on this page
  useEffect(() => {
    const refreshToken = async () => {
      try {
        await api.refreshAccessToken();
        if (__DEV__) {
          console.log('[AskAI] Access token refreshed');
        }
      } catch (error) {
        console.warn('[AskAI] Failed to refresh access token:', error);
      }
    };

    // Refresh immediately on mount
    refreshToken();

    // Set up interval to refresh every 10 minutes (600000 ms)
    const interval = setInterval(refreshToken, 10 * 60 * 1000);

    // Cleanup interval on unmount
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Track keyboard height on Android to position input above keyboard
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const keyboardShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });

    const keyboardHideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, []);

  // Pause/resume live transcription when TTS is speaking
  // This is critical for iOS where audio session might not automatically trigger interruption events
  useEffect(() => {
    // Only manage if live transcription is active
    if (!isLiveTranscribing && !isTranscriptionConnected) return;

    if (isSpeaking) {
      // TTS started speaking - pause live transcription
      if (__DEV__) {
        console.log('[AskAI] TTS started - pausing live transcription');
      }
      pauseTranscription();
    } else {
      // TTS stopped speaking - resume live transcription
      // Small delay to ensure TTS audio session is fully released
      const timer = setTimeout(() => {
        if (__DEV__) {
          console.log('[AskAI] TTS stopped - resuming live transcription');
        }
        resumeTranscription();
      }, 200);
      
      return () => clearTimeout(timer);
    }
  }, [isSpeaking, isLiveTranscribing, isTranscriptionConnected, pauseTranscription, resumeTranscription]);

  // Ensure conversation exists
  const ensureConversation = useCallback(async () => {
    if (conversationId) return conversationId;
    if (!jobId || !user?.id) return null;
    try {
      const res = await copilotChatService.createConversation({ userId: String(user.id), jobId });
      setConversationId(res.data.id);
      return res.data.id;
    } catch (e) {
      console.warn('[AskAI] Failed to create conversation', e);
      return null;
    }
  }, [conversationId, jobId, user?.id]);

  // Map API messages to UI messages
  const mapCopilotMessageToUi = useCallback((msg: CopilotMessage): Message => {
    return {
      id: msg.id,
      role: msg.senderType === 'AI' ? 'assistant' : 'user',
      content: msg.content ?? '',
      timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
      contentType: msg.contentType,
      attachments: (msg.attachments || []).map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
        url: a.url,
        presignedUrl: a.presignedUrl,
      })),
      metadata: msg.metadata,
    };
  }, []);

  // Load conversation history
  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      if (!jobId || !user?.id || !isAllowed) return;
      setIsFetchingHistory(true);
      try {
        // Ensure conversation exists before loading history
        await ensureConversation();

        // Fetch conversation history using jobId
        const res = await copilotChatService.getConversationFull(jobId);
        const history = (res.data?.messages || [])
          .map(mapCopilotMessageToUi)
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (isMounted) {
          setMessages(history);
        }
      } catch (e) {
        console.warn('[AskAI] Failed to load chat history', e);
      } finally {
        if (isMounted) {
          setIsFetchingHistory(false);
        }
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [ensureConversation, isAllowed, jobId, mapCopilotMessageToUi, user?.id]);

  /**
   * Main message handler - supports text, voice, and images
   * 
   * Flow:
   * 1. Images: Upload → Create user message → Stream AI response
   * 2. Text/Voice: Create optimistic message → Stream AI response
   * 
   * Streaming uses XMLHttpRequest for React Native compatibility
   */
  const handleSendMessage = useCallback(
    async (content: string, _type: 'text' | 'voice' | 'image') => {
      const hasContent = content.trim().length > 0;
      const hasImages = pendingImages.length > 0;
      if (!isAllowed || (!hasContent && !hasImages)) return;

      // Optimistic UI: add user message immediately
      const tempUserMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
        contentType: hasImages ? 'IMAGE' : 'TEXT',
        attachments: pendingImages.map((img) => ({
          id: img.id,
          fileName: '',
          fileType: 'image/jpeg',
          fileSize: 0,
          url: img.uri,
        })),
      };
      setMessages((prev) => [...prev, tempUserMessage]);
      setIsLoading(true);

      try {
        const convId = await ensureConversation();
        if (!convId) {
          console.warn('[AskAI] No conversation ID, aborting send');
          return;
        }

        // If there are pending images, upload them first
        if (pendingImages.length > 0) {
          if (!hasContent) {
            console.warn('[AskAI] No question text provided with images');
            return;
          }

          setIsUploadingImages(true);
          setPendingImages((prev) => prev.map((img) => ({ ...img, isUploading: true })));

          try {
            const imagesToUpload = pendingImages.map((img) => ({
              uri: img.uri,
              type: 'image/jpeg',
              name: `image-${img.id}.jpg`,
            }));

            console.log('[AskAI] Uploading images:', imagesToUpload.length);

            // Upload images (this creates the user message with images)
            const uploadResult = await copilotChatService.uploadImages(
              convId,
              imagesToUpload,
              content
            );
            console.log('[AskAI] Images uploaded successfully');

            setPendingImages([]);
            setIsUploadingImages(false);

            // Add the image message to chat
            if (uploadResult.message) {
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== tempUserMessage.id), // Remove optimistic message
                {
                  id: uploadResult.message.id,
                  role: 'user',
                  content: uploadResult.message.content ?? '',
                  timestamp: uploadResult.message.createdAt
                    ? new Date(uploadResult.message.createdAt)
                    : new Date(),
                  attachments: (uploadResult.attachments || []).map((a) => ({
                    id: a.id,
                    fileName: a.fileName,
                    fileType: a.fileType,
                    fileSize: a.fileSize,
                    url: a.url,
                    presignedUrl: a.presignedUrl,
                  })),
                },
              ]);
            }

            /**
             * Stream AI response after image upload
             * 
             * SSE Event Flow:
             * 1. 'chunk': Content tokens arrive → Update message in real-time
             * 2. 'done': Stream complete → Finalize with server data
             * 3. 'error': Handle errors gracefully
             * 
             * Uses XMLHttpRequest for React Native streaming support
             */
            const aiMessageId = `ai-${Date.now()}`;
            let streamedContent = '';
            let messageCreated = false;

            try {
              await copilotChatService.streamMessage({
                conversationId: convId,
                content,
                senderId: user?.id ? String(user.id) : undefined,
                onEvent: (event) => {
                  if (event.type === 'chunk' && event.content) {
                    // Create message only when first chunk arrives
                    if (!messageCreated) {
                      messageCreated = true;
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: aiMessageId,
                          role: 'assistant',
                          content: '',
                          timestamp: new Date(),
                          attachments: [],
                        },
                      ]);
                    }
                    // Accumulate streamed content token by token
                    streamedContent += event.content;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === aiMessageId ? { ...msg, content: streamedContent } : msg
                      )
                    );
                    // Add token to TTS queue for voice playback
                    addToQueue(event.content);
                  } else if (event.type === 'done' && event.data) {
                    // Flush any remaining TTS buffer
                    flush();
                    // Create message if it wasn't created during streaming (no chunks received)
                    if (!messageCreated) {
                      messageCreated = true;
                      const finalAi = mapCopilotMessageToUi(event.data);
                      setMessages((prev) => [
                        ...prev,
                        { ...finalAi, id: finalAi.id || aiMessageId },
                      ]);
                    } else {
                    // Finalize with complete server message
                    const finalAi = mapCopilotMessageToUi(event.data);
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === aiMessageId
                          ? { ...finalAi, id: finalAi.id || aiMessageId }
                          : msg
                      )
                    );
                    }
                  } else if (event.type === 'error') {
                    console.warn('[AskAI] Stream error:', event.error);
                    stopTTS(); // Stop TTS on error
                  }
                },
              });
            } catch (streamErr) {
              console.warn('[AskAI] Streaming failed, falling back to sendMessage', streamErr);
              stopTTS(); // Stop TTS on stream error
              
              // Fallback: Use non-streaming API if XMLHttpRequest fails
              const { aiMessage } = await copilotChatService.sendMessage({
                conversationId: convId,
                content,
                senderId: user?.id ? String(user.id) : undefined,
              });

              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === aiMessageId
                    ? {
                        id: aiMessage.id,
                        role: 'assistant',
                        content: aiMessage.content ?? streamedContent,
                        timestamp: aiMessage.createdAt ? new Date(aiMessage.createdAt) : new Date(),
                        attachments: (aiMessage.attachments || []).map((a) => ({
                          id: a.id,
                          fileName: a.fileName,
                          fileType: a.fileType,
                          fileSize: a.fileSize,
                          url: a.url,
                          presignedUrl: a.presignedUrl,
                        })),
                      }
                    : msg
                )
              );
            }
          } catch (uploadErr) {
            console.warn('[AskAI] Image upload failed', uploadErr);
            setIsUploadingImages(false);
            setPendingImages((prev) => prev.map((img) => ({ ...img, isUploading: false })));
          }
        } else {
          /**
           * Stream text/voice message response
           * 
           * Creates empty AI message and fills it with streamed tokens.
           * Provides real-time typing effect like ChatGPT.
           */
          const aiMessageId = `ai-${Date.now()}`;
          let streamedContent = '';

          // Create temporary AI message for streaming
          setMessages((prev) => [
            ...prev,
            {
              id: aiMessageId,
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              attachments: [],
            },
          ]);

          try {
            await copilotChatService.streamMessage({
              conversationId: convId,
              content,
              senderId: user?.id ? String(user.id) : undefined,
              onEvent: (event) => {
                if (event.type === 'user_message' && event.data) {
                  // Update user message with confirmed server data
                  const confirmedUserMsg = mapCopilotMessageToUi(event.data);
                  setMessages((prev) =>
                    prev.map((msg) => (msg.id === tempUserMessage.id ? confirmedUserMsg : msg))
                  );
                } else if (event.type === 'chunk' && event.content) {
                  // Accumulate streamed content
                  streamedContent += event.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId ? { ...msg, content: streamedContent } : msg
                    )
                  );
                  // Add token to TTS queue for voice playback
                  addToQueue(event.content);
                } else if (event.type === 'done' && event.data) {
                  // Flush any remaining TTS buffer
                  flush();
                  // Finalize with server message
                  const finalAi = mapCopilotMessageToUi(event.data);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? { ...finalAi, id: finalAi.id || aiMessageId }
                        : msg
                    )
                  );
                } else if (event.type === 'error') {
                  console.warn('[AskAI] Stream error:', event.error);
                  stopTTS(); // Stop TTS on error
                }
              },
            });
          } catch (streamErr) {
            console.warn('[AskAI] Streaming failed, falling back to sendMessage', streamErr);
            stopTTS(); // Stop TTS on stream error
            // Fallback to non-streaming if stream fails
            const { userMessage, aiMessage } = await copilotChatService.sendMessage({
              conversationId: convId,
              content,
              senderId: user?.id ? String(user.id) : undefined,
            });

            // Update user message
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempUserMessage.id ? mapCopilotMessageToUi(userMessage) : msg
              )
            );

            // Update AI message
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMessageId
                  ? {
                      id: aiMessage.id,
                      role: 'assistant',
                      content: aiMessage.content ?? streamedContent,
                      timestamp: aiMessage.createdAt ? new Date(aiMessage.createdAt) : new Date(),
                      attachments: (aiMessage.attachments || []).map((a) => ({
                        id: a.id,
                        fileName: a.fileName,
                        fileType: a.fileType,
                        fileSize: a.fileSize,
                        url: a.url,
                        presignedUrl: a.presignedUrl,
                      })),
                    }
                  : msg
              )
            );
          }
        }
      } catch (err) {
        console.warn('[AskAI] Send failed', err);
        stopTTS(); // Stop TTS on error
      } finally {
        setIsLoading(false);
      }
    },
    [ensureConversation, isAllowed, mapCopilotMessageToUi, user?.id, pendingImages, addToQueue, flush, stopTTS]
  );

  // Handle image selection (from camera or gallery)
  const handleImageSelected = useCallback((asset: MediaAsset) => {
    console.log('[AskAI] Image selected:', asset.uri);
    const newImage: PendingImage = {
      id: `img-${Date.now()}`,
      uri: asset.uri,
      isUploading: false,
    };
    setPendingImages((prev) => [...prev, newImage]);
  }, []);

  // Remove pending image
  const handleRemovePendingImage = useCallback((imageId: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  // Stop AI speaking
  const handleStopSpeaking = useCallback(() => {
    stopTTS();
  }, [stopTTS]);

  // Handle when Ask AI recording starts - pause live transcription
  const handleVoiceRecordingStart = useCallback(async () => {
    if (isLiveTranscribing || isTranscriptionConnected) {
      if (__DEV__) {
        console.log('[AskAI] Pausing live transcription for Ask AI recording...');
      }
      // Stop TTS first to avoid audio session conflicts
      stopTTS();
      // Small delay to let TTS cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
      await pauseTranscription();
    }
  }, [isLiveTranscribing, isTranscriptionConnected, pauseTranscription, stopTTS]);

  // Handle when Ask AI recording ends - resume live transcription
  const handleVoiceRecordingEnd = useCallback(async () => {
    if (isLiveTranscribing || isTranscriptionConnected) {
      if (__DEV__) {
        console.log('[AskAI] Resuming live transcription after Ask AI recording...');
      }
      await resumeTranscription();
      // Small delay after resume to let audio session stabilize before TTS can play again
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }, [isLiveTranscribing, isTranscriptionConnected, resumeTranscription]);

  // Handle voice recordings - transcribe and send
  // If there are pending images, automatically upload them with the transcribed text
  const handleVoiceRecorded = useCallback(
    async (result: VoiceRecordingResult) => {
      if (!isAllowed) return;

      console.log('[AskAI] Voice recorded:', {
        uri: result.uri,
        durationMs: result.durationMs,
        mimeType: result.mimeType,
        hasBase64: Boolean(result.base64Data),
        hasPendingImages: pendingImages.length > 0,
      });

      const stripDataPrefix = (dataUri?: string) => {
        if (!dataUri) return null;
        const parts = dataUri.split(',');
        return parts.length > 1 ? parts[1] : parts[0];
      };

      const getBase64Audio = async () => {
        const inlineBase64 = stripDataPrefix(result.base64Data);
        if (inlineBase64) return inlineBase64;

        if (!result.uri) {
          throw new Error('No audio data to transcribe');
        }

        try {
          const rawBase64 = await FileSystem.readAsStringAsync(result.uri, {
            encoding: 'base64',
          });
          return rawBase64;
        } catch (err) {
          console.warn('[AskAI] Failed to read audio file:', err);
          throw new Error('No audio data to transcribe');
        }
      };

      setIsTranscribing(true);
      try {
        const base64Audio = await getBase64Audio();

        const resp = await copilotChatService.transcribeVoice({
          audioBase64: base64Audio,
          mimeType: result.mimeType,
        });

        console.log('[AskAI] Transcription successful:', resp?.text?.substring(0, 50));

        // Set isTranscribing to false immediately after transcription completes
        // (before calling handleSendMessage which might take a while with image uploads)
        setIsTranscribing(false);

        if (resp?.text) {
          // If there are pending images, send them with the transcribed text
          // Otherwise, send as regular voice message
          await handleSendMessage(resp.text, pendingImages.length > 0 ? 'image' : 'voice');
          return;
        }

        throw new Error('No transcription returned from voice service');
      } catch (error) {
        console.error('[AskAI] Voice transcription failed:', error);
        setIsTranscribing(false); // Ensure state is cleared on error
        throw error; // Re-throw so MultiModalInput can surface the error
      }
    },
    [handleSendMessage, isAllowed, pendingImages.length]
  );

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.iconContainer}>
        <View style={styles.iconPulse} />
        <View style={styles.iconRing} />
        <View style={styles.iconInner}>
          <Ionicons name="mic" size={32} color={colors.primary} />
        </View>
      </View>
      <View style={styles.emptyTextContainer}>
        <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
          Hi, I'm Clara!
        </ThemedText>
        <ThemedText style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Ask me any technical queries below, I can assist you!
        </ThemedText>
      </View>
    </View>
  );

  // Render processing indicators
  const renderProcessingIndicator = () => {
    if (!isLoading && !isSpeaking && !isTranscribing) return null;

    return (
      <View style={styles.processingContainer}>
        <View style={[styles.processingIcon, { backgroundColor: `${colors.primary}15` }]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
        <ThemedText style={[styles.processingText, { color: colors.textSecondary }]}>
          {isTranscribing && '🎤 Converting voice...'}
          {!isTranscribing && isLoading && '🤔 Clara is thinking...'}
          {!isTranscribing && !isLoading && isSpeaking && '🔊 Clara is speaking...'}
        </ThemedText>
      </View>
    );
  };

  // Not assigned view
  if (!isAllowed) {
    return (
      <View style={styles.notAssignedContainer}>
        <Ionicons name="lock-closed-outline" size={48} color={colors.iconSecondary} />
        <ThemedText style={[styles.notAssignedTitle, { color: colors.textSecondary }]}>
          Ask AI Unavailable
        </ThemedText>
        <ThemedText style={[styles.notAssignedSubtitle, { color: colors.textTertiary }]}>
          Ask AI is available only to the assigned technician while the job is active
        </ThemedText>
      </View>
    );
  }

  // Calculate input area position (Android keyboard handling)
  const inputBottomPosition = Platform.OS === 'android' ? keyboardHeight : 0;
  const bottomPadding = Math.max(8, insets.bottom);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => <ChatMessage message={item} />,
    []
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const listExtraData = useMemo(
    () => ({
      isLoading,
      isTranscribing,
      isSpeaking,
      isUploadingImages,
    }),
    [isLoading, isTranscribing, isSpeaking, isUploadingImages]
  );

  const HORIZONTAL_PADDING = 12;

  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Messages Area */}
      <FlatList
        ref={messagesContainerRef}
        data={invertedMessages}
        inverted
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={listExtraData}
        windowSize={8}
        maxToRenderPerBatch={8}
        initialNumToRender={12}
        removeClippedSubviews
        ListEmptyComponent={isFetchingHistory ? <ActivityIndicator /> : renderEmptyState}
        ListHeaderComponent={renderProcessingIndicator}
        contentContainerStyle={[styles.messagesList, { paddingHorizontal: HORIZONTAL_PADDING }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />

      {/* Voice Input Controls */}
      <View
        style={[
          styles.inputArea,
          {
            paddingBottom: bottomPadding,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingHorizontal: HORIZONTAL_PADDING,
          },
          Platform.OS === 'android' && keyboardHeight > 0 && {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: inputBottomPosition,
          },
        ]}
      >
        <MultiModalInput
          onSendMessage={handleSendMessage}
          onImageSelected={handleImageSelected}
          onVoiceRecorded={handleVoiceRecorded}
          onVoiceRecordingStart={handleVoiceRecordingStart}
          onVoiceRecordingEnd={handleVoiceRecordingEnd}
          isLoading={isLoading}
          isSpeaking={isSpeaking}
          isTranscribing={isTranscribing}
          placeholder="Ask anything..."
          pendingImages={pendingImages}
          onRemovePendingImage={handleRemovePendingImage}
          isUploadingImages={isUploadingImages}
          onStopSpeaking={handleStopSpeaking}
          disabled={!canUseAskAI}
        />
      </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  messagesList: {
    flexGrow: 1,
    paddingVertical: 16,
    paddingBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingTop: 60,
    gap: 16,
  },
  iconContainer: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconPulse: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(10, 126, 164, 0.1)',
  },
  iconRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(10, 126, 164, 0.2)',
  },
  iconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTextContainer: {
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 40,
    marginTop: 4,
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  processingIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingText: {
    fontSize: 12,
    flex: 1,
  },
  inputArea: {
    borderTopWidth: 1,
    paddingTop: 16,
    paddingBottom: 8,
  },
  notAssignedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  notAssignedTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  notAssignedSubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
});

export default AskAITab;
