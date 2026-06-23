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
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatMessage } from '@/components/chat/ChatMessage';
import { SignaturePad } from '@/components/chat/SignaturePad';
import { MultiModalInput, type VoiceRecordingResult } from '@/components/chat/MultiModalInput';
import { ThinkingIndicator } from '@/components/chat/ThinkingIndicator';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
import { useJobDetailContext } from '@/contexts/JobDetailContext';
import { copilotChatService, type CopilotMessage } from '@/services/copilotChatService';
import { useAuthStore } from '@/store/useAuthStore';
import { useStreamingTTS } from '@/hooks/useStreamingTTS';
import { ExpoLiveAudio } from '@/native';
import type { MediaAsset } from '@/lib/media';
import type {
  EstimateQuote,
  FollowUpQuestion,
  IdentifiedEquipment,
  Message,
  PendingImage,
  ThinkingStep,
} from '@/components/chat/types';
import { api } from '@/lib/apiClient';

export const AskAITab: React.FC = () => {
  const { job, jobId, canUseAskAI, isRecording: isLiveTranscribing, isConnected: isTranscriptionConnected, pauseTranscription, resumeTranscription, setSwipeEnabled } = useJobDetailContext();
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Refs
  const messagesContainerRef = useRef<FlatList<Message>>(null);

  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  // Estimate Cost demo mode — sticky toggle in the chat bar. Routes the next send
  // to the estimate endpoint instead of the normal copilot stream.
  const [estimateMode, setEstimateMode] = useState(false);
  // Estimate Cost signing: the quote message whose signature pad is open, + in-flight flag.
  const [signingMessage, setSigningMessage] = useState<Message | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  // Suspend tab-swipe while the signature pad is open so drawing strokes don't switch tabs.
  useEffect(() => {
    setSwipeEnabled?.(!signingMessage);
    return () => setSwipeEnabled?.(true);
  }, [signingMessage, setSwipeEnabled]);

  const userScrolledUpRef = useRef(false);
  const thinkingStartedAtRef = useRef<number | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);

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

  // Note: We no longer pause/resume transcription when TTS is speaking
  // The audio session uses PlayAndRecord category which supports simultaneous
  // playback (TTS) and recording (microphone). Both can work together without conflicts.

  // Reset conversation and messages when jobId changes
  // This prevents showing messages from previous jobs
  useEffect(() => {
    setConversationId(null);
    setMessages([]);
    setPendingImages([]);
    setIsThinking(false);
    setStreamingMessageId(null);
    streamingMessageIdRef.current = null;
    thinkingStartedAtRef.current = null;
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    if (__DEV__) {
      console.log('[AskAI] Job changed - resetting conversation state for jobId:', jobId);
    }
  }, [jobId]);

  // Ensure conversation exists
  const ensureConversation = useCallback(async () => {
    // Don't use cached conversationId - always create/fetch for current jobId
    // This ensures we never use conversation from wrong job
    if (!jobId || !user?.id) return null;
    try {
      const res = await copilotChatService.createConversation({ userId: String(user.id), jobId });
      setConversationId(res.data.id);
      return res.data.id;
    } catch (e) {
      console.warn('[AskAI] Failed to create conversation', e);
      return null;
    }
  }, [jobId, user?.id]);

  // Scroll to the latest message
  const scrollToLatestMessage = useCallback((animated: boolean = true) => {
    requestAnimationFrame(() => {
      messagesContainerRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const forceScrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    scrollToLatestMessage(true);
  }, [scrollToLatestMessage]);

  const maybeScrollToEnd = useCallback((animated: boolean = true) => {
    if (userScrolledUpRef.current) return;
    requestAnimationFrame(() => {
      messagesContainerRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const SCROLL_BOTTOM_THRESHOLD = 100;
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const fromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const scrolledUp = fromBottom > SCROLL_BOTTOM_THRESHOLD;
    userScrolledUpRef.current = scrolledUp;
    setIsUserScrolledUp(scrolledUp);
  }, []);

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
          userScrolledUpRef.current = false;
          setIsUserScrolledUp(false);
          scrollToLatestMessage(false);
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
  }, [ensureConversation, isAllowed, jobId, mapCopilotMessageToUi, scrollToLatestMessage, user?.id]);

  // Pin to bottom when new content arrives unless the user scrolled up
  useEffect(() => {
    if (messages.length === 0) return;
    maybeScrollToEnd(true);
  }, [messages, streamingMessageId, maybeScrollToEnd]);

  // Ensure latest message is visible when the tab first mounts with data
  useEffect(() => {
    scrollToLatestMessage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  /**
   * Main message handler - supports text, voice, and images
   * 
   * Flow:
   * 1. Images: Upload → Create user message → Stream AI response
   * 2. Text/Voice: Create optimistic message → Stream AI response
   * 
   * Streaming uses XMLHttpRequest for React Native compatibility
   */
  /**
   * Estimate Cost (demo) handler.
   *
   * Routes to the self-contained estimate endpoint. Sends the (optional) note plus the
   * captured photo as inline base64, streams the markdown estimate, and attaches the
   * structured `quote` to the assistant message so ChatMessage can render the quote card.
   */
  const handleSendEstimate = useCallback(
    async (content: string) => {
      const hasContent = content.trim().length > 0;
      const imagesForEstimate = pendingImages;
      const hasImages = imagesForEstimate.length > 0;
      if (!isAllowed || (!hasContent && !hasImages)) return;

      // Optimistic user message (with the captured photo shown via its local uri)
      const tempUserMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
        contentType: hasImages ? 'IMAGE' : 'TEXT',
        attachments: imagesForEstimate.map((img) => ({
          id: img.id,
          fileName: img.name || '',
          fileType: img.type || 'image/jpeg',
          fileSize: 0,
          url: img.uri,
        })),
      };
      setMessages((prev) => [...prev, tempUserMessage]);
      setIsLoading(true);
      setPendingImages([]);

      try {
        const convId = await ensureConversation();
        if (!convId) {
          console.warn('[AskAI] No conversation ID, aborting estimate');
          return;
        }

        // Read the captured photo to base64 (no data: prefix, per the endpoint contract)
        let imageBase64: string | undefined;
        let imageMimeType: string | undefined;
        const firstImage = imagesForEstimate[0];
        if (firstImage) {
          try {
            imageBase64 = await FileSystem.readAsStringAsync(firstImage.uri, {
              encoding: 'base64',
            });
            imageMimeType = firstImage.type || 'image/jpeg';
          } catch (readErr) {
            console.warn('[AskAI] Failed to read estimate image for base64', readErr);
          }
        }

        const aiMessageId = `ai-${Date.now()}`;
        let assistantContent = '';
        let messageCreated = false;
        let quoteData: EstimateQuote | undefined;
        let questionsData: FollowUpQuestion[] | undefined;
        let responseKind: 'quote' | 'questions' | 'message' | undefined;
        // Intermediate workflow events (node/identified) shown in the thinking dropdown.
        const trace: ThinkingStep[] = [];

        thinkingStartedAtRef.current = Date.now();
        setIsThinking(true);

        // Add or update a trace step (keyed by id).
        const upsertStep = (id: string, label: string, patch: Partial<ThinkingStep> = {}) => {
          const existing = trace.find((s) => s.id === id);
          if (existing) {
            existing.label = label;
            if (patch.detail !== undefined) existing.detail = patch.detail;
            if (patch.status) existing.status = patch.status;
          } else {
            trace.push({ id, label, status: 'active', ...patch });
          }
        };

        // Build metadata with only the keys we actually have (avoid clobbering on updates).
        const buildMeta = (): NonNullable<Message['metadata']> => {
          const meta: NonNullable<Message['metadata']> = { mode: 'estimate' };
          if (responseKind) meta.responseKind = responseKind;
          if (quoteData) meta.quote = quoteData;
          if (questionsData) meta.questions = questionsData;
          if (trace.length) meta.thinkingTrace = trace.map((s) => ({ ...s }));
          return meta;
        };

        // Tolerant extraction of the follow-up questions array across payload shapes.
        const extractQuestions = (ev: any): FollowUpQuestion[] | undefined => {
          const d = ev?.data;
          if (Array.isArray(d)) return d;
          if (Array.isArray(d?.questions)) return d.questions;
          if (Array.isArray(ev?.questions)) return ev.questions;
          if (Array.isArray(d?.data?.questions)) return d.data.questions;
          return undefined;
        };

        // Create the assistant bubble on first content, or update it as quote/questions arrive.
        const upsertAssistant = () => {
          const creating = !messageCreated;
          if (creating) {
            messageCreated = true;
            const start = thinkingStartedAtRef.current ?? Date.now();
            const thoughtSecs = Math.max(1, Math.round((Date.now() - start) / 1000));
            setIsThinking(false);
            streamingMessageIdRef.current = aiMessageId;
            setStreamingMessageId(aiMessageId);
            setMessages((prev) => [
              ...prev,
              {
                id: aiMessageId,
                role: 'assistant',
                content: assistantContent,
                timestamp: new Date(),
                attachments: [],
                thoughtDurationSeconds: thoughtSecs,
                metadata: buildMeta(),
              },
            ]);
          } else {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMessageId
                  ? { ...msg, content: assistantContent, metadata: { ...msg.metadata, ...buildMeta() } }
                  : msg
              )
            );
          }
        };

        await copilotChatService.streamEstimate({
          conversationId: convId,
          content: hasContent ? content : undefined,
          imageBase64,
          imageMimeType,
          senderId: user?.id ? String(user.id) : undefined,
          onEvent: (event) => {
            if (__DEV__) {
              // Diagnostic: capture the real estimate event shapes (remove once confirmed).
              console.log('[Estimate evt]', event.type, JSON.stringify(event.data ?? event.content ?? event));
            }
            if (event.type === 'user_message' && event.data) {
              const confirmedUserMsg = mapCopilotMessageToUi(event.data);
              setMessages((prev) =>
                prev.map((msg) => (msg.id === tempUserMessage.id ? confirmedUserMsg : msg))
              );
            } else if (event.type === 'thinking') {
              setIsThinking(true);
            } else if (event.type === 'node' && event.node) {
              const labels: Record<string, string> = {
                identify: 'Identifying equipment',
                build_quote: 'Building quote',
                ask_questions: 'Preparing follow-up questions',
              };
              upsertStep(event.node, labels[event.node] ?? event.node, {
                status: event.phase === 'end' ? 'done' : 'active',
              });
              upsertAssistant();
            } else if (event.type === 'identified') {
              const eq = event.data as unknown as IdentifiedEquipment | null;
              const detail =
                eq && (eq.brand || eq.model)
                  ? `${[eq.brand, eq.model].filter(Boolean).join(' ')}${
                      eq.confidence != null ? ` · ${Math.round(eq.confidence * 100)}%` : ''
                    }`
                  : 'No confident match';
              upsertStep('identify', 'Identifying equipment', { detail });
              upsertAssistant();
            } else if (event.type === 'message' && event.content) {
              // New model: the full chat-bubble text arrives once (no token streaming).
              assistantContent = event.content;
              upsertAssistant();
              addToQueue(event.content);
            } else if (event.type === 'chunk' && event.content) {
              // Legacy fallback: append streamed tokens if an older backend still sends them.
              assistantContent += event.content;
              upsertAssistant();
              addToQueue(event.content);
            } else if (event.type === 'quote' && event.data) {
              // The quote payload arrives in `data` typed as CopilotMessage; it is an EstimateQuote.
              quoteData = event.data as unknown as EstimateQuote;
              upsertAssistant();
            } else if (event.type === 'questions') {
              questionsData = extractQuestions(event);
              upsertAssistant();
            } else if (event.type === 'done') {
              flush();
              responseKind = event.responseKind ?? responseKind;
              const finalAi = event.data ? mapCopilotMessageToUi(event.data) : undefined;
              const serverMeta = (finalAi?.metadata ?? {}) as NonNullable<Message['metadata']>;
              const finalMeta: NonNullable<Message['metadata']> = {
                mode: 'estimate',
                responseKind: responseKind ?? serverMeta.responseKind,
              };
              const quote = quoteData ?? serverMeta.quote;
              const questions = questionsData ?? serverMeta.questions;
              const requiresSignature = event.requiresSignature ?? serverMeta.requiresSignature;
              if (quote) finalMeta.quote = quote;
              if (questions) finalMeta.questions = questions;
              if (requiresSignature) finalMeta.requiresSignature = true;
              // Preserve a previously-signed PDF if the message is re-hydrated/updated.
              if (serverMeta.quotePdf) finalMeta.quotePdf = serverMeta.quotePdf;
              trace.forEach((s) => {
                if (s.status === 'active') s.status = 'done';
              });
              const finalTrace = trace.length ? trace.map((s) => ({ ...s })) : serverMeta.thinkingTrace;
              if (finalTrace?.length) finalMeta.thinkingTrace = finalTrace;

              const creating = !messageCreated;
              if (creating) {
                messageCreated = true;
                const start = thinkingStartedAtRef.current ?? Date.now();
                const thoughtSecs = Math.max(1, Math.round((Date.now() - start) / 1000));
                setIsThinking(false);
                streamingMessageIdRef.current = aiMessageId;
                setStreamingMessageId(aiMessageId);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: finalAi?.id || aiMessageId,
                    role: 'assistant',
                    content: finalAi?.content ?? assistantContent,
                    timestamp: finalAi?.timestamp ?? new Date(),
                    attachments: finalAi?.attachments ?? [],
                    thoughtDurationSeconds: thoughtSecs,
                    metadata: finalMeta,
                  },
                ]);
              } else {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          id: finalAi?.id || aiMessageId,
                          content: finalAi?.content ?? msg.content,
                          metadata: finalMeta,
                        }
                      : msg
                  )
                );
              }
            } else if (event.type === 'error') {
              console.warn('[AskAI] Estimate stream error:', event.error);
              setIsThinking(false);
              stopTTS();
            }
          },
        });
      } catch (err) {
        console.warn('[AskAI] Estimate send failed', err);
        stopTTS();
        setIsThinking(false);
      } finally {
        setIsLoading(false);
        setIsThinking(false);
        setStreamingMessageId(null);
        streamingMessageIdRef.current = null;
        thinkingStartedAtRef.current = null;
      }
    },
    [ensureConversation, isAllowed, mapCopilotMessageToUi, user?.id, pendingImages, addToQueue, flush, stopTTS]
  );

  // Estimate Cost follow-up: tapping an option (or submitting "Other") re-sends the
  // chosen value to the estimate endpoint in the same conversation.
  const handleAnswerQuestion = useCallback(
    (value: string) => {
      void handleSendEstimate(value);
    },
    [handleSendEstimate]
  );

  // Estimate Cost: download the generated quotation PDF. Resolves a fresh presigned URL via the
  // durable re-download endpoint (links expire ~24h), falling back to the URL captured during the
  // turn, then opens it in an in-app browser.
  const handleDownloadPdf = useCallback(
    async (message: Message) => {
      try {
        const convId = conversationId ?? (await ensureConversation());
        let url: string | null = null;
        if (convId && message.id) {
          url = await copilotChatService.getEstimatePdfUrl({
            conversationId: convId,
            messageId: message.id,
          });
        }
        url = url ?? message.metadata?.quotePdf?.url ?? null;
        if (!url) {
          console.warn('[AskAI] No PDF URL available for message', message.id);
          return;
        }
        await WebBrowser.openBrowserAsync(url);
      } catch (err) {
        console.warn('[AskAI] Failed to open quotation PDF', err);
      }
    },
    [conversationId, ensureConversation]
  );

  // Estimate Cost: open the signature pad for a quote message.
  const handleSignDocument = useCallback((message: Message) => {
    setSigningMessage(message);
  }, []);

  // Estimate Cost: POST the captured signature → generate the signed PDF, persist the result
  // on the message (so the card flips to "Download PDF"), then open the PDF.
  const handleSubmitSignature = useCallback(
    async (signatureBase64: string, signerName: string) => {
      const target = signingMessage;
      if (!target || isSigning) return;
      setIsSigning(true);
      try {
        const convId = conversationId ?? (await ensureConversation());
        if (!convId) {
          console.warn('[AskAI] No conversation ID, cannot sign');
          return;
        }
        const result = await copilotChatService.signEstimate({
          conversationId: convId,
          messageId: target.id,
          signatureBase64,
          signerName,
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === target.id
              ? {
                  ...msg,
                  metadata: {
                    ...msg.metadata,
                    requiresSignature: false,
                    quote: msg.metadata?.quote
                      ? {
                          ...msg.metadata.quote,
                          signed: true,
                          signedAt: result.signedAt,
                          signerName,
                          pdfKey: result.key ?? msg.metadata.quote.pdfKey,
                          estimateNumber: result.estimateNumber ?? msg.metadata.quote.estimateNumber,
                        }
                      : msg.metadata?.quote,
                    quotePdf: {
                      url: result.url,
                      key: result.key,
                      filename: result.filename,
                      estimateNumber: result.estimateNumber,
                      signedAt: result.signedAt,
                    },
                  },
                }
              : msg
          )
        );
        setSigningMessage(null);
        await WebBrowser.openBrowserAsync(result.url);
      } catch (err) {
        console.warn('[AskAI] Failed to sign estimate', err);
      } finally {
        setIsSigning(false);
      }
    },
    [signingMessage, isSigning, conversationId, ensureConversation]
  );

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
      // Estimate Cost mode routes to the dedicated estimate endpoint.
      if (estimateMode) {
        await handleSendEstimate(content);
        return;
      }

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
          fileName: img.name || '',
          fileType: img.type || 'image/jpeg',
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

          setIsUploadingImages(true);
          setPendingImages((prev) => prev.map((img) => ({ ...img, isUploading: true })));

          try {
            const imagesToUpload = pendingImages.map((img) => ({
              uri: img.uri,
            type: img.type || 'image/jpeg',
            name: img.name || `image-${img.id}.jpg`,
            }));

            console.log('[AskAI] Uploading images:', imagesToUpload.length);

            // Upload images (this creates the user message with images)
            const uploadResult = await copilotChatService.uploadImages(
              convId,
              imagesToUpload,
              hasContent ? content : undefined
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

            thinkingStartedAtRef.current = Date.now();
            setIsThinking(true);

            try {
              await copilotChatService.streamMessage({
                conversationId: convId,
                content,
                senderId: user?.id ? String(user.id) : undefined,
                onEvent: (event) => {
                  if (event.type === 'thinking') {
                    setIsThinking(true);
                  } else if (event.type === 'chunk' && event.content) {
                    if (!messageCreated) {
                      messageCreated = true;
                      const start = thinkingStartedAtRef.current ?? Date.now();
                      const thoughtSecs = Math.max(1, Math.round((Date.now() - start) / 1000));
                      setIsThinking(false);
                      streamingMessageIdRef.current = aiMessageId;
                      setStreamingMessageId(aiMessageId);
                      streamedContent = event.content;
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: aiMessageId,
                          role: 'assistant',
                          content: streamedContent,
                          timestamp: new Date(),
                          attachments: [],
                          thoughtDurationSeconds: thoughtSecs,
                        },
                      ]);
                      addToQueue(event.content);
                    } else {
                      streamedContent += event.content;
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === aiMessageId ? { ...msg, content: streamedContent } : msg
                        )
                      );
                      addToQueue(event.content);
                    }
                  } else if (event.type === 'done' && event.data) {
                    flush();
                    if (!messageCreated) {
                      messageCreated = true;
                      const start = thinkingStartedAtRef.current ?? Date.now();
                      const thoughtSecs = Math.max(1, Math.round((Date.now() - start) / 1000));
                      setIsThinking(false);
                      const finalAi = mapCopilotMessageToUi(event.data);
                      streamingMessageIdRef.current = aiMessageId;
                      setStreamingMessageId(aiMessageId);
                      setMessages((prev) => [
                        ...prev,
                        {
                          ...finalAi,
                          id: finalAi.id || aiMessageId,
                          thoughtDurationSeconds: thoughtSecs,
                        },
                      ]);
                    } else {
                      const finalAi = mapCopilotMessageToUi(event.data);
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === aiMessageId
                            ? {
                                ...finalAi,
                                id: finalAi.id || aiMessageId,
                                thoughtDurationSeconds: msg.thoughtDurationSeconds,
                              }
                            : msg
                        )
                      );
                    }
                  } else if (event.type === 'error') {
                    console.warn('[AskAI] Stream error:', event.error);
                    setIsThinking(false);
                    stopTTS();
                  }
                },
              });
            } catch (streamErr) {
              console.warn('[AskAI] Streaming failed, falling back to sendMessage', streamErr);
              stopTTS();

              const { aiMessage } = await copilotChatService.sendMessage({
                conversationId: convId,
                content,
                senderId: user?.id ? String(user.id) : undefined,
              });

              const thoughtSecs = Math.max(
                1,
                Math.round((Date.now() - (thinkingStartedAtRef.current ?? Date.now())) / 1000)
              );
              setIsThinking(false);

              setMessages((prev) => {
                if (!messageCreated) {
                  return [
                    ...prev,
                    {
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
                      thoughtDurationSeconds: thoughtSecs,
                    },
                  ];
                }
                return prev.map((msg) =>
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
                        thoughtDurationSeconds: msg.thoughtDurationSeconds ?? thoughtSecs,
                      }
                    : msg
                );
              });
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
           * Assistant row appears on first chunk (copilot-style Thinking... indicator until then).
           */
          const aiMessageId = `ai-${Date.now()}`;
          let streamedContent = '';
          let messageCreated = false;

          thinkingStartedAtRef.current = Date.now();
          setIsThinking(true);

          try {
            await copilotChatService.streamMessage({
              conversationId: convId,
              content,
              senderId: user?.id ? String(user.id) : undefined,
              onEvent: (event) => {
                if (event.type === 'user_message' && event.data) {
                  const confirmedUserMsg = mapCopilotMessageToUi(event.data);
                  setMessages((prev) =>
                    prev.map((msg) => (msg.id === tempUserMessage.id ? confirmedUserMsg : msg))
                  );
                } else if (event.type === 'thinking') {
                  setIsThinking(true);
                } else if (event.type === 'chunk' && event.content) {
                  if (!messageCreated) {
                    messageCreated = true;
                    const start = thinkingStartedAtRef.current ?? Date.now();
                    const thoughtSecs = Math.max(1, Math.round((Date.now() - start) / 1000));
                    setIsThinking(false);
                    streamingMessageIdRef.current = aiMessageId;
                    setStreamingMessageId(aiMessageId);
                    streamedContent = event.content;
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: aiMessageId,
                        role: 'assistant',
                        content: streamedContent,
                        timestamp: new Date(),
                        attachments: [],
                        thoughtDurationSeconds: thoughtSecs,
                      },
                    ]);
                    addToQueue(event.content);
                  } else {
                    streamedContent += event.content;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === aiMessageId ? { ...msg, content: streamedContent } : msg
                      )
                    );
                    addToQueue(event.content);
                  }
                } else if (event.type === 'done' && event.data) {
                  flush();
                  if (!messageCreated) {
                    messageCreated = true;
                    const start = thinkingStartedAtRef.current ?? Date.now();
                    const thoughtSecs = Math.max(1, Math.round((Date.now() - start) / 1000));
                    setIsThinking(false);
                    const finalAi = mapCopilotMessageToUi(event.data);
                    streamingMessageIdRef.current = aiMessageId;
                    setStreamingMessageId(aiMessageId);
                    setMessages((prev) => [
                      ...prev,
                      {
                        ...finalAi,
                        id: finalAi.id || aiMessageId,
                        thoughtDurationSeconds: thoughtSecs,
                      },
                    ]);
                  } else {
                    const finalAi = mapCopilotMessageToUi(event.data);
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === aiMessageId
                          ? {
                              ...finalAi,
                              id: finalAi.id || aiMessageId,
                              thoughtDurationSeconds: msg.thoughtDurationSeconds,
                            }
                          : msg
                      )
                    );
                  }
                } else if (event.type === 'error') {
                  console.warn('[AskAI] Stream error:', event.error);
                  setIsThinking(false);
                  stopTTS();
                }
              },
            });
          } catch (streamErr) {
            console.warn('[AskAI] Streaming failed, falling back to sendMessage', streamErr);
            stopTTS();

            const { userMessage, aiMessage } = await copilotChatService.sendMessage({
              conversationId: convId,
              content,
              senderId: user?.id ? String(user.id) : undefined,
            });

            const thoughtSecs = Math.max(
              1,
              Math.round((Date.now() - (thinkingStartedAtRef.current ?? Date.now())) / 1000)
            );
            setIsThinking(false);

            setMessages((prev) => {
              const withUser = prev.map((msg) =>
                msg.id === tempUserMessage.id ? mapCopilotMessageToUi(userMessage) : msg
              );
              if (!messageCreated) {
                return [
                  ...withUser,
                  {
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
                    thoughtDurationSeconds: thoughtSecs,
                  },
                ];
              }
              return withUser.map((msg) =>
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
                      thoughtDurationSeconds: msg.thoughtDurationSeconds ?? thoughtSecs,
                    }
                  : msg
              );
            });
          }
        }
      } catch (err) {
        console.warn('[AskAI] Send failed', err);
        stopTTS();
        setIsThinking(false);
      } finally {
        setIsLoading(false);
        setIsThinking(false);
        setStreamingMessageId(null);
        streamingMessageIdRef.current = null;
        thinkingStartedAtRef.current = null;
      }
    },
    [ensureConversation, isAllowed, mapCopilotMessageToUi, user?.id, pendingImages, addToQueue, flush, stopTTS, estimateMode, handleSendEstimate]
  );

  // Handle image selection (from camera or gallery)
  const handleImageSelected = useCallback((asset: MediaAsset) => {
    console.log('[AskAI] Image selected:', asset.uri);
    const newImage: PendingImage = {
      id: `img-${Date.now()}`,
      uri: asset.uri,
      name: asset.name,
      type: asset.type,
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

    // Prefer Bluetooth mic when available (fallback handled natively)
    try {
      if (ExpoLiveAudio?.preferBluetoothInput) {
        const inputInfo = await ExpoLiveAudio.preferBluetoothInput();
        if (__DEV__) {
          console.log('[AskAI] Preferred input device:', inputInfo);
        }
      }
    } catch (error) {
      console.warn('[AskAI] Failed to prefer Bluetooth mic input:', error);
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

        if (resp?.text?.trim()) {
          await handleSendMessage(resp.text.trim(), pendingImages.length > 0 ? 'image' : 'voice');
          return;
        }

        if (__DEV__) {
          console.log('[AskAI] No speech detected in recording, ignoring');
        }
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
          <Ionicons name="sparkles" size={32} color={colors.primary} />
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

  const renderProcessingIndicator = () => {
    if (isTranscribing) {
      return (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Ionicons name="mic-outline" size={18} color={colors.textSecondary} />
          <ThemedText style={[styles.processingText, { color: colors.textSecondary }]}>
            Converting voice...
          </ThemedText>
        </View>
      );
    }
    if (isThinking) {
      return <ThinkingIndicator isThinking />;
    }
    if (!isLoading && isSpeaking) {
      return (
        <View style={styles.processingContainer}>
          <View style={[styles.speakingPulse, { backgroundColor: `${colors.success}40` }]} />
          <Ionicons name="radio-outline" size={18} color={colors.textSecondary} />
          <ThemedText style={[styles.processingText, { color: colors.textSecondary }]}>
            Clara is speaking...
          </ThemedText>
        </View>
      );
    }
    return null;
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
    ({ item }: { item: Message }) => (
      <ChatMessage
        message={item}
        isStreaming={item.role === 'assistant' && item.id === streamingMessageId}
        onAnswerQuestion={handleAnswerQuestion}
        onDownloadPdf={handleDownloadPdf}
        onSignDocument={handleSignDocument}
      />
    ),
    [streamingMessageId, handleAnswerQuestion, handleDownloadPdf, handleSignDocument]
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const listExtraData = useMemo(
    () => ({
      isLoading,
      isTranscribing,
      isSpeaking,
      isUploadingImages,
      isThinking,
      streamingMessageId,
    }),
    [isLoading, isTranscribing, isSpeaking, isUploadingImages, isThinking, streamingMessageId]
  );

  const showJumpToLatest =
    isUserScrolledUp && (Boolean(streamingMessageId) || isLoading || isThinking);

  const HORIZONTAL_PADDING = 12;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.messagesArea}>
      <FlatList
        ref={messagesContainerRef}
        style={styles.messagesFlatList}
        data={messages}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={listExtraData}
        windowSize={8}
        maxToRenderPerBatch={8}
        initialNumToRender={12}
        removeClippedSubviews
        ListEmptyComponent={isFetchingHistory ? <ActivityIndicator /> : renderEmptyState}
        ListFooterComponent={renderProcessingIndicator}
        contentContainerStyle={[styles.messagesList, { paddingHorizontal: HORIZONTAL_PADDING }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => maybeScrollToEnd(false)}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />
      {showJumpToLatest && (
        <Pressable
          style={[styles.jumpButton, { backgroundColor: colors.primary }]}
          onPress={forceScrollToBottom}
          accessibilityRole="button"
          accessibilityLabel="Jump to latest message">
          <Ionicons name="chevron-down" size={16} color="#ffffff" />
          <ThemedText style={styles.jumpButtonText}>Jump to latest</ThemedText>
        </Pressable>
      )}
      </View>

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
          estimateMode={estimateMode}
          onToggleEstimateMode={() => setEstimateMode((v) => !v)}
        />
      </View>
      </View>
      <SignaturePad
        visible={!!signingMessage}
        submitting={isSigning}
        onCancel={() => setSigningMessage(null)}
        onSubmit={handleSubmitSignature}
      />
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
  messagesArea: {
    flex: 1,
    position: 'relative',
  },
  messagesFlatList: {
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
    paddingHorizontal: 4,
  },
  speakingPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  processingText: {
    fontSize: 12,
    flex: 1,
  },
  jumpButton: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  jumpButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
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
