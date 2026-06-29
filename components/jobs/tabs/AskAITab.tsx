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
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
import { EmailModal } from '@/components/chat/EmailModal';
import { PdfPreview } from '@/components/chat/PdfPreview';
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
  ActionItem,
  CitationItem,
  EstimateQuote,
  FollowUpChip,
  FollowUpQuestion,
  Identification,
  Message,
  PendingImage,
  SourceItem,
  ThinkingStep,
} from '@/components/chat/types';
import { api } from '@/lib/apiClient';

// Conversation starter prompts shown in the empty state — tapping one starts a normal turn.
const COPILOT_STARTERS = [
  'What does this fault code mean?',
  'How do I reset this device?',
  'What would it cost to replace this unit?',
  'What are the inspection steps for this asset?',
];

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
  // Estimate mode — explicit toggle in the chat bar. When on, forces `mode: 'estimate'`
  // on the unified copilot stream (the endpoint still auto-routes when this is off).
  const [estimateMode, setEstimateMode] = useState(false);
  // Signing: the quote message whose signature pad is open, + in-flight flag.
  const [signingMessage, setSigningMessage] = useState<Message | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  // Estimate Cost: the downloaded PDF being previewed (local file URI + filename).
  const [pdfPreview, setPdfPreview] = useState<{ previewUrl: string; downloadUrl: string; filename?: string } | null>(null);
  // Estimate Cost emailing: the quote message whose email modal is open, + in-flight flag + error.
  const [emailingMessage, setEmailingMessage] = useState<Message | null>(null);
  const [isEmailing, setIsEmailing] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  // Live step label shown in the "Thinking…" indicator (e.g. "Identifying equipment").
  const [stepLabel, setStepLabel] = useState<string | null>(null);

  // Suspend tab-swipe while a signature pad / PDF preview / email modal is open (gestures stay put).
  useEffect(() => {
    const blocking = !!signingMessage || !!pdfPreview || !!emailingMessage;
    setSwipeEnabled?.(!blocking);
    return () => setSwipeEnabled?.(true);
  }, [signingMessage, pdfPreview, emailingMessage, setSwipeEnabled]);

  const userScrolledUpRef = useRef(false);
  const thinkingStartedAtRef = useRef<number | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  // Aborts the in-flight copilot stream (Stop button + job-change + unmount).
  const abortControllerRef = useRef<AbortController | null>(null);
  // Signed PDF to open once the signature modal has fully dismissed (avoids an iOS
  // present-while-dismissing freeze). Opened by openPendingPdf via onDismiss / a timeout.
  const pendingPdfRef = useRef<{ previewUrl: string; downloadUrl: string; filename?: string } | null>(null);
  // Re-entrancy guard so rapid Download taps don't stack downloads/preview sheets.
  const isOpeningPdfRef = useRef(false);

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
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setConversationId(null);
    setMessages([]);
    setPendingImages([]);
    setIsThinking(false);
    setStepLabel(null);
    setStreamingMessageId(null);
    streamingMessageIdRef.current = null;
    thinkingStartedAtRef.current = null;
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    if (__DEV__) {
      console.log('[AskAI] Job changed - resetting conversation state for jobId:', jobId);
    }
  }, [jobId]);

  // Abort any in-flight stream when the tab unmounts.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

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

  // Share/Save: download the attachment PDF to a local file and present the iOS share sheet.
  // (The inline preview renders the remote URL directly; this is only for the explicit Share action.)
  const openPdfInApp = useCallback(async (downloadUrl: string, filename?: string) => {
    if (isOpeningPdfRef.current) return;
    isOpeningPdfRef.current = true;
    try {
      const safeName = (filename || 'Estimate.pdf').replace(/[^\w.\-]+/g, '_');
      const localUri = `${cacheDirectory ?? ''}${safeName}`;
      const { uri } = await downloadAsync(downloadUrl, localUri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: safeName,
        });
      }
    } catch (err) {
      console.warn('[AskAI] Failed to share quotation PDF', err);
    } finally {
      isOpeningPdfRef.current = false;
    }
  }, []);

  // Estimate Cost: open the inline PDF preview (WebView loads …/pdf?inline=1 directly — no download).
  // previewUrl renders in the WebView; downloadUrl (permanent attachment endpoint) backs Share/Save.
  const handleDownloadPdf = useCallback(
    async (message: Message) => {
      const convId = conversationId ?? (await ensureConversation());
      if (!convId || !message.id) {
        console.warn('[AskAI] No conversation/message id for PDF preview');
        return;
      }
      const previewUrl = copilotChatService.estimatePdfUrl({
        conversationId: convId,
        messageId: message.id,
        inline: true,
      });
      const downloadUrl =
        message.metadata?.quotePdf?.url ??
        copilotChatService.estimatePdfUrl({ conversationId: convId, messageId: message.id });
      setPdfPreview({ previewUrl, downloadUrl, filename: message.metadata?.quotePdf?.filename });
    },
    [conversationId, ensureConversation]
  );

  // Estimate Cost: open the signature pad for a quote message.
  const handleSignDocument = useCallback((message: Message) => {
    setSigningMessage(message);
  }, []);

  // Estimate Cost: open the email modal for a signed quote (prefill comes from quote.suggestedCustomerEmail).
  const handleEmailDocument = useCallback((message: Message) => {
    setEmailError(null);
    setEmailingMessage(message);
  }, []);

  // Estimate Cost: POST the confirmed customer email → server attaches the signed PDF + sends.
  const handleSendEmail = useCallback(
    async (to: string) => {
      const target = emailingMessage;
      if (!target || isEmailing) return;
      setIsEmailing(true);
      setEmailError(null);
      try {
        const convId = conversationId ?? (await ensureConversation());
        if (!convId) {
          setEmailError('No conversation available.');
          return;
        }
        const result = await copilotChatService.sendEstimateEmail({
          conversationId: convId,
          messageId: target.id,
          to,
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === target.id && msg.metadata?.quote
              ? {
                  ...msg,
                  metadata: {
                    ...msg.metadata,
                    quote: {
                      ...msg.metadata.quote,
                      emailedTo: result.to ?? to,
                      emailedAt: result.sentAt ?? new Date().toISOString(),
                    },
                  },
                }
              : msg
          )
        );
        setEmailingMessage(null);
      } catch (err) {
        console.warn('[AskAI] Failed to email estimate', err);
        setEmailError(err instanceof Error ? err.message : 'Failed to send email. Try again.');
      } finally {
        setIsEmailing(false);
      }
    },
    [emailingMessage, isEmailing, conversationId, ensureConversation]
  );

  // Open the signed PDF queued during signing. Captures-and-clears the ref so whichever of
  // onDismiss / the timeout safety-net fires first wins and the other is a no-op.
  const openPendingPdf = useCallback(() => {
    const pending = pendingPdfRef.current;
    if (!pending) return;
    pendingPdfRef.current = null;
    setPdfPreview(pending);
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
                          suggestedCustomerEmail: result.suggestedCustomerEmail ?? msg.metadata.quote.suggestedCustomerEmail,
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
        // Queue the inline preview and close the pad. Opening it is deferred until the modal has
        // fully dismissed (via onDismiss / the timeout) to avoid an iOS present-while-dismissing freeze.
        pendingPdfRef.current = {
          previewUrl: copilotChatService.estimatePdfUrl({ conversationId: convId, messageId: target.id, inline: true }),
          downloadUrl: result.url,
          filename: result.filename,
        };
        setSigningMessage(null);
        setTimeout(openPendingPdf, 350);
      } catch (err) {
        console.warn('[AskAI] Failed to sign estimate', err);
      } finally {
        setIsSigning(false);
      }
    },
    [signingMessage, isSigning, conversationId, ensureConversation, openPendingPdf]
  );

  /**
   * Unified message handler — routes all turns (text, voice, image, follow-up) through
   * the single copilot stream endpoint. The backend auto-routes to general chat or
   * cost-estimation; all block types are handled by one reducer.
   */
  const handleSendMessage = useCallback(
    async (content: string, _type: 'text' | 'voice' | 'image') => {
      const hasContent = content.trim().length > 0;
      const hasImages = pendingImages.length > 0;
      if (!isAllowed || (!hasContent && !hasImages)) return;

      // Clear any followUp chips from previous AI messages when user sends a new turn.
      setMessages((prev) =>
        prev.map((msg) =>
          msg.role === 'assistant' && msg.metadata?.followUps?.length
            ? { ...msg, metadata: { ...msg.metadata, followUps: undefined } }
            : msg
        )
      );

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

      // ── Shared streaming helper ───────────────────────────────────────────────
      const streamAiResponse = async (convId: string, userMsgId: string) => {
        const aiMessageId = `ai-${Date.now()}`;
        let assistantContent = '';
        let messageCreated = false;
        let quoteData: EstimateQuote | undefined;
        let questionsData: FollowUpQuestion[] | undefined;
        let citationsData: CitationItem[] | undefined;
        let sourcesData: SourceItem[] | undefined;
        let followUpsData: FollowUpChip[] | undefined;
        let actionsData: ActionItem[] | undefined;
        let identifiedData: Identification | undefined;
        let responseKind: 'quote' | 'questions' | 'message' | undefined;
        const trace: ThinkingStep[] = [];

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

        const buildMeta = (): NonNullable<Message['metadata']> => {
          const meta: NonNullable<Message['metadata']> = {};
          if (responseKind) meta.responseKind = responseKind;
          if (quoteData) meta.quote = quoteData;
          if (questionsData) meta.questions = questionsData;
          if (citationsData) meta.citations = citationsData;
          if (sourcesData) meta.sources = sourcesData;
          if (followUpsData) meta.followUps = followUpsData;
          if (actionsData) meta.actions = actionsData;
          if (identifiedData) meta.identifiedEquipment = identifiedData;
          if (trace.length) meta.thinkingTrace = trace.map((s) => ({ ...s }));
          return meta;
        };

        const extractQuestions = (ev: any): FollowUpQuestion[] | undefined => {
          const d = ev?.data;
          if (Array.isArray(d)) return d;
          if (Array.isArray(d?.questions)) return d.questions;
          if (Array.isArray(ev?.questions)) return ev.questions;
          if (Array.isArray(d?.data?.questions)) return d.data.questions;
          return undefined;
        };

        const upsertAssistant = () => {
          if (!messageCreated) {
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

        thinkingStartedAtRef.current = Date.now();
        setIsThinking(true);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        await copilotChatService.streamCopilot({
          conversationId: convId,
          content,
          senderId: user?.id ? String(user.id) : undefined,
          mode: estimateMode ? 'estimate' : undefined,
          signal: controller.signal,
          onEvent: (event) => {
            if (__DEV__) {
              console.log('[Copilot evt]', event.type, JSON.stringify(event.data ?? event.content ?? event.items ?? event));
            }
            if (event.type === 'user_message' && event.data) {
              const confirmed = mapCopilotMessageToUi(event.data);
              setMessages((prev) =>
                prev.map((msg) => (msg.id === userMsgId ? confirmed : msg))
              );
            } else if (event.type === 'thinking') {
              setIsThinking(true);
            } else if (event.type === 'routing') {
              if (messageCreated && (event.reason ?? event.route)) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId
                      ? { ...msg, metadata: { ...msg.metadata, routingHint: event.reason ?? event.route } }
                      : msg
                  )
                );
              }
            } else if (event.type === 'node' && event.node) {
              const labels: Record<string, string> = {
                identify: 'Identifying equipment',
                build_quote: 'Building quote',
                ask_questions: 'Preparing follow-up questions',
              };
              const nodeLabel = labels[event.node] ?? event.node;
              // Surface the active step in the "Thinking…" indicator (cleared on first content).
              if (event.phase !== 'end') setStepLabel(nodeLabel);
              upsertStep(event.node, nodeLabel, {
                status: event.phase === 'end' ? 'done' : 'active',
              });
              upsertAssistant();
            } else if (event.type === 'identified') {
              const eq = event.data as unknown as Identification | null;
              if (eq) identifiedData = eq;
              const detail =
                eq && (eq.brand || eq.model)
                  ? `${[eq.brand, eq.model].filter(Boolean).join(' ')}${
                      eq.confidence != null ? ` · ${Math.round(eq.confidence * 100)}%` : ''
                    }`
                  : 'No confident match';
              upsertStep('identify', 'Identifying equipment', { detail });
              upsertAssistant();
            } else if (event.type === 'message' && event.content) {
              setStepLabel(null);
              assistantContent = event.content;
              upsertAssistant();
              addToQueue(event.content);
            } else if (event.type === 'chunk' && event.content) {
              setStepLabel(null);
              assistantContent += event.content;
              upsertAssistant();
              addToQueue(event.content);
            } else if (event.type === 'quote' && event.data) {
              quoteData = event.data as unknown as EstimateQuote;
              upsertAssistant();
            } else if (event.type === 'questions') {
              questionsData = extractQuestions(event);
              upsertAssistant();
            } else if (event.type === 'citations' && event.items) {
              citationsData = event.items as CitationItem[];
              upsertAssistant();
            } else if (event.type === 'sources' && event.items) {
              sourcesData = event.items as SourceItem[];
              upsertAssistant();
            } else if (event.type === 'followUps' && event.items) {
              followUpsData = event.items as FollowUpChip[];
              upsertAssistant();
            } else if (event.type === 'done') {
              flush();
              responseKind = event.responseKind ?? responseKind;
              const finalAi = event.data ? mapCopilotMessageToUi(event.data) : undefined;
              const serverMeta = (finalAi?.metadata ?? {}) as NonNullable<Message['metadata']>;

              // Use done.response.blocks as the source of truth for final render.
              const blocks = event.response?.blocks ?? [];
              const quoteBlock = blocks.find((b) => b.kind === 'quote');
              const questionsBlock = blocks.find((b) => b.kind === 'questions');
              const citationsBlock = blocks.find((b) => b.kind === 'citations');
              const sourcesBlock = blocks.find((b) => b.kind === 'sources');
              const followUpsBlock = blocks.find((b) => b.kind === 'followUps');
              const actionsBlock = blocks.find((b) => b.kind === 'actions');

              trace.forEach((s) => { if (s.status === 'active') s.status = 'done'; });
              const finalTrace = trace.length ? trace.map((s) => ({ ...s })) : serverMeta.thinkingTrace;

              const finalMeta: NonNullable<Message['metadata']> = {
                responseKind: responseKind ?? serverMeta.responseKind,
                blocks,
                requiresSignature: event.requiresSignature ?? serverMeta.requiresSignature,
                quotePdf: serverMeta.quotePdf,
                quote: ((quoteBlock?.kind === 'quote' ? quoteBlock.data : undefined) as EstimateQuote | undefined) ?? quoteData ?? serverMeta.quote,
                questions: ((questionsBlock?.kind === 'questions' ? questionsBlock.data?.questions : undefined) as FollowUpQuestion[] | undefined) ?? questionsData ?? serverMeta.questions,
                citations: (citationsBlock?.kind === 'citations' ? citationsBlock.items : undefined) ?? citationsData ?? serverMeta.citations,
                sources: (sourcesBlock?.kind === 'sources' ? sourcesBlock.items : undefined) ?? sourcesData ?? serverMeta.sources,
                followUps: (followUpsBlock?.kind === 'followUps' ? followUpsBlock.items : undefined) ?? followUpsData ?? serverMeta.followUps,
                actions: (actionsBlock?.kind === 'actions' ? actionsBlock.items : undefined) ?? actionsData ?? serverMeta.actions,
                identifiedEquipment: identifiedData ?? serverMeta.identifiedEquipment,
              };
              if (finalTrace?.length) finalMeta.thinkingTrace = finalTrace;

              if (!messageCreated) {
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
              console.warn('[AskAI] Stream error:', event.error);
              setIsThinking(false);
              stopTTS();
            }
          },
        });
      };
      // ── End shared streaming helper ───────────────────────────────────────────

      try {
        const convId = await ensureConversation();
        if (!convId) {
          console.warn('[AskAI] No conversation ID, aborting send');
          return;
        }

        if (hasImages) {
          setIsUploadingImages(true);
          setPendingImages((prev) => prev.map((img) => ({ ...img, isUploading: true })));
          try {
            const imagesToUpload = pendingImages.map((img) => ({
              uri: img.uri,
              type: img.type || 'image/jpeg',
              name: img.name || `image-${img.id}.jpg`,
            }));
            const uploadResult = await copilotChatService.uploadImages(
              convId,
              imagesToUpload,
              hasContent ? content : undefined
            );
            setPendingImages([]);
            setIsUploadingImages(false);
            if (uploadResult.message) {
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== tempUserMessage.id),
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
            await streamAiResponse(convId, tempUserMessage.id);
          } catch (uploadErr) {
            console.warn('[AskAI] Image upload failed', uploadErr);
            setIsUploadingImages(false);
            setPendingImages((prev) => prev.map((img) => ({ ...img, isUploading: false })));
          }
        } else {
          setPendingImages([]);
          await streamAiResponse(convId, tempUserMessage.id);
        }
      } catch (err) {
        console.warn('[AskAI] Send failed', err);
        stopTTS();
        setIsThinking(false);
      } finally {
        setIsLoading(false);
        setIsThinking(false);
        setStepLabel(null);
        setStreamingMessageId(null);
        streamingMessageIdRef.current = null;
        thinkingStartedAtRef.current = null;
        abortControllerRef.current = null;
      }
    },
    [ensureConversation, isAllowed, mapCopilotMessageToUi, user?.id, pendingImages, addToQueue, flush, stopTTS, estimateMode]
  );

  // Stop button — abort the in-flight stream and clear streaming state. Any partial
  // assistant text already streamed remains in the chat.
  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    flush();
    stopTTS();
    setIsThinking(false);
    setStepLabel(null);
    setStreamingMessageId(null);
    streamingMessageIdRef.current = null;
  }, [flush, stopTTS]);

  // Follow-up question answer: re-sends chosen option value as a new turn.
  const handleAnswerQuestion = useCallback(
    (value: string) => { void handleSendMessage(value, 'text'); },
    [handleSendMessage]
  );

  // Suggestion chip tapped: clear chips then send a new turn with the chip prompt.
  const handleFollowUpPress = useCallback(
    (prompt: string) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.role === 'assistant' && msg.metadata?.followUps?.length
            ? { ...msg, metadata: { ...msg.metadata, followUps: undefined } }
            : msg
        )
      );
      void handleSendMessage(prompt, 'text');
    },
    [handleSendMessage]
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
      <View style={styles.startersContainer}>
        {COPILOT_STARTERS.map((starter) => (
          <Pressable
            key={starter}
            style={[styles.starterChip, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
            onPress={() => handleSendMessage(starter, 'text')}
            disabled={!canUseAskAI}
            accessibilityRole="button"
            accessibilityLabel={starter}
          >
            <Ionicons name="sparkles-outline" size={13} color={colors.primary} />
            <ThemedText style={[styles.starterChipText, { color: colors.text }]} numberOfLines={2}>
              {starter}
            </ThemedText>
          </Pressable>
        ))}
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
      return <ThinkingIndicator isThinking label={stepLabel} />;
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

  // Derive the latest AI message ID so FollowUpChips only show on the most recent turn.
  const latestAiMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <ChatMessage
        message={item}
        isStreaming={item.role === 'assistant' && item.id === streamingMessageId}
        isLatestAiMessage={item.role === 'assistant' && item.id === latestAiMessageId}
        onAnswerQuestion={handleAnswerQuestion}
        onFollowUpPress={handleFollowUpPress}
        onDownloadPdf={handleDownloadPdf}
        onSignDocument={handleSignDocument}
        onEmailDocument={handleEmailDocument}
      />
    ),
    [streamingMessageId, latestAiMessageId, handleAnswerQuestion, handleFollowUpPress, handleDownloadPdf, handleSignDocument, handleEmailDocument]
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
      latestAiMessageId,
    }),
    [isLoading, isTranscribing, isSpeaking, isUploadingImages, isThinking, streamingMessageId, latestAiMessageId]
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
          streaming={Boolean(streamingMessageId) || isThinking}
          onStopGenerating={handleStopStreaming}
        />
      </View>
      </View>
      <SignaturePad
        visible={!!signingMessage}
        submitting={isSigning}
        onCancel={() => setSigningMessage(null)}
        onSubmit={handleSubmitSignature}
        onDismiss={openPendingPdf}
      />
      <PdfPreview
        visible={!!pdfPreview}
        url={pdfPreview?.previewUrl ?? null}
        filename={pdfPreview?.filename}
        onClose={() => setPdfPreview(null)}
        onShare={pdfPreview ? () => openPdfInApp(pdfPreview.downloadUrl, pdfPreview.filename) : undefined}
      />
      <EmailModal
        visible={!!emailingMessage}
        suggestedEmail={emailingMessage?.metadata?.quote?.suggestedCustomerEmail}
        sending={isEmailing}
        error={emailError}
        onCancel={() => {
          setEmailingMessage(null);
          setEmailError(null);
        }}
        onSend={handleSendEmail}
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
  startersContainer: {
    width: '100%',
    paddingHorizontal: 24,
    gap: 8,
    marginTop: 8,
  },
  starterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  starterChipText: {
    flex: 1,
    fontSize: 13,
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
