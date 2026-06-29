import { useAuthStore } from '@/store/useAuthStore';
import type { CopilotResponse, CitationItem, SourceItem, FollowUpChip, ActionItem } from '@/copilot-contract';

export type { CopilotResponse };

const COPILOT_API_BASE = process.env.EXPO_PUBLIC_COPILOT_BASE_URL
  ? `${process.env.EXPO_PUBLIC_COPILOT_BASE_URL}/api/v1`
  : 'https://kzrvokx9if.execute-api.ap-south-1.amazonaws.com/staging/api/v1';

export interface MessageAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key?: string;
  url?: string;
  presignedUrl?: string;
}

export interface CopilotMessage {
  id: string;
  content: string;
  contentType?: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE';
  senderType: 'USER' | 'AI' | 'SYSTEM';
  senderId?: string | null;
  createdAt?: string;
  attachments?: MessageAttachment[];
  metadata?: Record<string, any>;
}

export interface ImageUploadResponse {
  message: CopilotMessage;
  attachments: MessageAttachment[];
}

export interface AudioUploadResponse {
  transcription: string;
  message?: CopilotMessage;
}

export interface StreamEvent {
  type:
    | 'user_message'
    | 'thinking'
    | 'routing'
    | 'chunk'
    | 'message'
    | 'tool_call'
    | 'node'
    | 'identified'
    | 'quote'
    | 'questions'
    | 'citations'
    | 'sources'
    | 'followUps'
    | 'error'
    | 'done';
  content?: string;
  error?: string;
  tool?: any;
  /** routing event: which route was chosen and why. */
  route?: string;
  reason?: string;
  source?: string;
  /** Workflow `node` event: graph step name + lifecycle phase. */
  node?: string;
  phase?: 'start' | 'end';
  /** On the `done` event: what the turn produced. */
  responseKind?: 'quote' | 'questions' | 'message';
  /** On the `done` event: true on a quote turn — collect a signature, then POST …/sign. */
  requiresSignature?: boolean;
  /** Structured blocks from the `done` event (source of truth for final render). */
  response?: CopilotResponse;
  /** Mid-stream block payloads. */
  items?: CitationItem[] | SourceItem[] | FollowUpChip[] | ActionItem[];
  /**
   * `CopilotMessage` for user_message/done. The `quote`/`questions` events also
   * arrive here; handler casts as needed.
   */
  data?: CopilotMessage;
}

interface ConversationResponse {
  data: { id: string };
  created?: boolean;
}

type HeadersShape = Record<string, string>;

const getDeviceTimezone = (): string | undefined => {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === 'string' && timezone.trim() ? timezone : undefined;
  } catch {
    return undefined;
  }
};

const buildHeaders = (asJson: boolean = true): HeadersShape => {
  const headers: HeadersShape = {};
  if (asJson) headers['Content-Type'] = 'application/json';

  const { access_token } = useAuthStore.getState();
  if (access_token) {
    headers['Authorization'] = `Bearer ${access_token}`;
  }

  const timezone = getDeviceTimezone();
  if (timezone) {
    headers['X-Device-Timezone'] = timezone;
  }

  return headers;
};

const buildMultipartHeaders = (): HeadersShape => {
  const headers: HeadersShape = {};

  const { access_token } = useAuthStore.getState();
  if (access_token) {
    headers['Authorization'] = `Bearer ${access_token}`;
  }

  const timezone = getDeviceTimezone();
  if (timezone) {
    headers['X-Device-Timezone'] = timezone;
  }

  return headers;
};

const handleJsonResponse = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      const errorValue = body?.error || body?.message;
      if (errorValue) {
        message = typeof errorValue === 'string' ? errorValue : JSON.stringify(errorValue);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json();
};

export const copilotChatService = {
  async createConversation(params: {
    userId: string;
    jobId: string;
    channelType?: 'MESSAGING';
    members?: string[];
    metadata?: Record<string, any>;
  }): Promise<ConversationResponse> {
    console.log('[createConversation] Creating conversation for params:', params);
    const res = await fetch(`${COPILOT_API_BASE}/conversations`, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({
        ...params,
        channelType: params.channelType || 'MESSAGING',
      }),
    });
    return handleJsonResponse<ConversationResponse>(res);
  },

  // Fetch full conversation by jobId (conversationId no longer required)
  async getConversationFull(jobId: string, messageLimit: number = 200) {
    console.log('[getConversationFull] Fetching conversation for jobId:', jobId);
    const res = await fetch(
      `${COPILOT_API_BASE}/conversations/${jobId}/full?messageLimit=${messageLimit}`,
      {
        headers: buildHeaders(false),
      }
    );
    return handleJsonResponse<{
      data: { messages: CopilotMessage[] };
    }>(res);
  },

  async uploadImages(
    conversationId: string,
    images: { uri: string; type?: string; name?: string }[],
    question?: string
  ): Promise<ImageUploadResponse> {
    if (images.length === 0) {
      throw new Error('At least one image is required');
    }
    if (images.length > 4) {
      throw new Error('Maximum 4 images allowed per upload');
    }

    const formData = new FormData();

    images.forEach((image, index) => {
      const file = {
        uri: image.uri,
        type: image.type || 'image/jpeg',
        name: image.name || `image-${index}.jpg`,
      } as any;
      formData.append('images', file);
    });

    if (question) {
      formData.append('question', question);
    }

    const res = await fetch(`${COPILOT_API_BASE}/conversations/${conversationId}/images`, {
      method: 'POST',
      headers: buildMultipartHeaders(),
      body: formData,
    });

    const json = await handleJsonResponse<any>(res);
    const message = json?.message || json?.data?.message;
    const attachments = json?.attachments || json?.data?.attachments || message?.attachments || [];

    if (!message) {
      throw new Error('Upload response missing message');
    }

    return { message, attachments };
  },

  /**
   * Upload audio for transcription
   * @param conversationId - Conversation ID
   * @param audio - Audio data (uri or base64)
   * @param mimeType - Audio MIME type (e.g., 'audio/m4a')
   * @returns Transcription text and optional message
   */
  async uploadAudio(
    conversationId: string,
    audio: { uri: string; base64Data?: string; mimeType?: string }
  ): Promise<AudioUploadResponse> {
    const formData = new FormData();

    // For React Native, we need to pass the file as an object with uri, type, name
    const audioFile = {
      uri: audio.uri,
      type: audio.mimeType || 'audio/m4a',
      name: `audio-${Date.now()}.m4a`,
    } as any;
    formData.append('audio', audioFile);

    const endpoint = `${COPILOT_API_BASE}/conversations/${conversationId}/audio`;
    
    if (__DEV__) {
      console.log('[uploadAudio] Uploading to:', endpoint);
      console.log('[uploadAudio] Audio file:', { uri: audio.uri, type: audio.mimeType });
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildMultipartHeaders(),
      body: formData,
    });

    if (__DEV__) {
      console.log('[uploadAudio] Response status:', res.status);
    }

    const json = await handleJsonResponse<any>(res);
    
    if (__DEV__) {
      console.log('[uploadAudio] Response JSON:', json);
    }

    const transcription = json?.transcription || json?.data?.transcription || json?.text || '';
    const message = json?.message || json?.data?.message;

    return { transcription, message };
  },

  async transcribeVoice(params: {
    audioBase64: string;
    mimeType?: string;
    language?: string;
  }): Promise<{ success: boolean; text: string }> {
    console.log('[transcribeVoice] Transcribing voice with language:', params.language);  
    const res = await fetch(`${COPILOT_API_BASE}/voice/transcribe`, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({
        audioBase64: params.audioBase64,
        mimeType: params.mimeType || 'audio/webm',
        // language: params.language || 'en',
      }),
    });
    const responseText = await res.text();

    if (__DEV__) {
      console.log('[transcribeVoice] Response text:', responseText);
    }

    if (!res.ok) {
      if (__DEV__) {
        console.warn('[transcribeVoice] Failed to transcribe voice:', res);
      }
      throw new Error(
        `voice/transcribe failed (${res.status}): ${responseText || 'no response body'}`
      );
    }

    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      throw new Error('voice/transcribe failed to parse JSON response');
    }
  },

  async sendMessage(params: {
    conversationId: string;
    content: string;
    senderId?: string;
  }): Promise<{ userMessage: CopilotMessage; aiMessage: CopilotMessage }> {
    const res = await fetch(`${COPILOT_API_BASE}/chat/${params.conversationId}/send`, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({
        content: params.content,
        senderId: params.senderId,
      }),
    });
    // Backend returns { success, data: { userMessage, aiMessage } }
    const json = await handleJsonResponse<{
      success?: boolean;
      data?: { userMessage: CopilotMessage; aiMessage: CopilotMessage };
      userMessage?: CopilotMessage;
      aiMessage?: CopilotMessage;
    }>(res);

    // Unwrap the data field if present, otherwise use top-level fields
    const userMessage = json.data?.userMessage ?? json.userMessage;
    const aiMessage = json.data?.aiMessage ?? json.aiMessage;

    if (!userMessage || !aiMessage) {
      throw new Error('sendMessage response missing userMessage or aiMessage');
    }

    return { userMessage, aiMessage };
  },

  /**
   * Unified copilot stream — auto-routes between general chat and cost-estimation.
   * Use this for all new sends. The backend decides the route; pass `mode` only to
   * explicitly force one (optional escape hatch, no UI toggle needed).
   *   POST /api/v1/copilot/:conversationId/stream
   */
  async streamCopilot(params: {
    conversationId: string;
    content?: string;
    senderId?: string;
    mode?: 'estimate' | 'general';
    /** Presigned image URLs already uploaded to S3. */
    imageUrls?: string[];
    /** Inline base64 images (data URLs or raw base64). */
    images?: string[];
    signal?: AbortSignal;
    onEvent: (event: StreamEvent) => void;
  }): Promise<void> {
    const url = `${COPILOT_API_BASE}/copilot/${params.conversationId}/stream`;
    if (__DEV__) {
      console.log('[streamCopilot] Starting stream to:', url);
    }
    return this._xhrStream({
      url,
      body: {
        content: params.content,
        senderId: params.senderId,
        mode: params.mode,
        imageUrls: params.imageUrls,
        images: params.images,
      },
      signal: params.signal,
      onEvent: params.onEvent,
      tag: 'streamCopilot',
    });
  },

  /** @deprecated Use streamCopilot() — the unified endpoint auto-routes. */
  async streamMessage(params: {
    conversationId: string;
    content: string;
    senderId?: string;
    signal?: AbortSignal;
    onEvent: (event: StreamEvent) => void;
  }): Promise<void> {
    return this.streamCopilot({
      conversationId: params.conversationId,
      content: params.content,
      senderId: params.senderId,
      signal: params.signal,
      onEvent: params.onEvent,
    });
  },

  /** Shared XHR streaming helper used by streamCopilot and streamEstimate. */
  _xhrStream(params: {
    url: string;
    body: Record<string, unknown>;
    signal?: AbortSignal;
    onEvent: (event: StreamEvent) => void;
    tag?: string;
  }): Promise<void> {
    const tag = params.tag ?? 'xhrStream';
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', params.url, true);

      const headers = buildHeaders(true);
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      let buffer = '';
      let processedLength = 0;
      let eventType = 'message'; // tracks the current SSE `event:` line

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // blank line = end of frame; reset event type
          eventType = 'message';
          return;
        }
        if (trimmed.startsWith('event:')) {
          eventType = trimmed.slice(6).trim();
          return;
        }
        if (!trimmed.startsWith('data:')) return;

        const payload = trimmed.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') {
          params.onEvent({ type: 'done' });
          return;
        }
        try {
          const rawEvt = JSON.parse(payload);
          const evt = this.normalizeEvent(rawEvt, eventType);
          params.onEvent(evt);
        } catch (err) {
          if (__DEV__) {
            console.warn(`[${tag}] Failed to parse SSE payload:`, payload, err);
          }
        }
      };

      xhr.onprogress = () => {
        const newData = xhr.responseText.substring(processedLength);
        processedLength = xhr.responseText.length;
        buffer += newData;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        lines.forEach(processLine);
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (buffer.trim()) processLine(buffer.trim());
          if (__DEV__) console.log(`[${tag}] Stream completed successfully`);
          resolve();
        } else {
          reject(new Error(`Stream failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error(`${tag} request failed`));
      xhr.ontimeout = () => reject(new Error(`${tag} request timed out`));

      if (params.signal) {
        params.signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error(`${tag} aborted`));
        });
      }

      // Strip undefined fields before serialising
      const body = Object.fromEntries(
        Object.entries(params.body).filter(([, v]) => v !== undefined)
      );
      xhr.send(JSON.stringify(body));
    });
  },

  /**
   * Estimate Cost — streams a markdown estimate plus a structured `quote` event.
   * Self-contained endpoint; kept for backwards-compat. New code should use streamCopilot()
   * with `mode: 'estimate'` (or let the unified endpoint auto-route).
   * At least one of `content`, `imageUrl`, or `imageBase64` must be provided.
   * `imageBase64` must NOT include a `data:` prefix.
   */
  async streamEstimate(params: {
    conversationId: string;
    content?: string;
    imageUrl?: string;
    imageBase64?: string;
    imageMimeType?: string;
    senderId?: string;
    signal?: AbortSignal;
    onEvent: (event: StreamEvent) => void;
  }): Promise<void> {
    const url = `${COPILOT_API_BASE}/copilot/${params.conversationId}/estimate/stream`;
    if (__DEV__) {
      console.log('[streamEstimate] Starting stream to:', url);
    }
    return this._xhrStream({
      url,
      body: {
        content: params.content,
        imageUrl: params.imageUrl,
        imageBase64: params.imageBase64,
        imageMimeType: params.imageMimeType,
        senderId: params.senderId,
      },
      signal: params.signal,
      onEvent: params.onEvent,
      tag: 'streamEstimate',
    });
  },

  /**
   * Confirm the estimate with the customer's signature → generates the signed PDF.
   *   POST /copilot/:conversationId/estimate/:messageId/sign
   * `signatureBase64` is the canvas PNG data URL (raw base64 also accepted). Returns the
   * downloadable PDF metadata. Throws on 400 (empty signature) / 404 / 409 (not a quote turn).
   */
  async signEstimate(params: {
    conversationId: string;
    messageId: string;
    signatureBase64: string;
    signerName?: string;
  }): Promise<{ url: string; directUrl?: string; key?: string; filename?: string; estimateNumber?: string; signedAt?: string; suggestedCustomerEmail?: string | null }> {
    const res = await fetch(
      `${COPILOT_API_BASE}/copilot/${params.conversationId}/estimate/${params.messageId}/sign`,
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          signatureBase64: params.signatureBase64,
          signatureMimeType: 'image/png',
          signerName: params.signerName,
        }),
      }
    );
    const json = await handleJsonResponse<{ success?: boolean; data?: any }>(res);
    const data = json?.data ?? json;
    if (!data?.url) {
      throw new Error('Sign response missing PDF url');
    }
    return data;
  },

  /**
   * Email the signed estimate PDF to the customer (call after signing + confirming the address).
   *   POST /copilot/:conversationId/estimate/:messageId/email  body { to }
   * The signed PDF is attached server-side. Throws (via handleJsonResponse) on 400 (invalid email),
   * 404 (message not found), 409 (not a quote turn / not signed yet), 503 (email not configured).
   */
  async sendEstimateEmail(params: {
    conversationId: string;
    messageId: string;
    to: string;
  }): Promise<{ to: string; from?: string; cc?: string | null; sentAt?: string }> {
    const res = await fetch(
      `${COPILOT_API_BASE}/copilot/${params.conversationId}/estimate/${params.messageId}/email`,
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ to: params.to }),
      }
    );
    const json = await handleJsonResponse<{ success?: boolean; data?: any }>(res);
    return json?.data ?? json;
  },

  /**
   * Build the permanent PDF endpoint URL for a signed quote (no network — the endpoint streams the
   * PDF straight from S3 and never expires):
   *   GET /copilot/:conversationId/estimate/:messageId/pdf            → downloadable (attachment)
   *   GET /copilot/:conversationId/estimate/:messageId/pdf?inline=1   → renders in-browser (inline)
   * Use `inline: true` for the WebView preview; omit for Download/Share. The estimate API is public,
   * so the URL can be loaded directly with no auth header.
   */
  estimatePdfUrl(params: { conversationId: string; messageId: string; inline?: boolean }): string {
    const base = `${COPILOT_API_BASE}/copilot/${params.conversationId}/estimate/${params.messageId}/pdf`;
    return params.inline ? `${base}?inline=1` : base;
  },

  /**
   * Coerce an SSE payload to a typed StreamEvent.
   * `namedType` is the value from the `event:` SSE line (for named-event frames);
   * it takes precedence over a missing `type` field in the JSON payload.
   */
  normalizeEvent(rawEvt: any, namedType?: string): StreamEvent {
    if (typeof rawEvt === 'string') {
      return { type: (namedType as StreamEvent['type']) ?? 'chunk', content: rawEvt };
    }

    // If the JSON payload already carries a `type` field, trust it (mirrors the
    // migration guide: "clients that already read data.type keep working").
    if (rawEvt.type) {
      return rawEvt as StreamEvent;
    }

    // Named event frame where the payload has no `type` — use the `event:` line.
    if (namedType) {
      return { ...rawEvt, type: namedType as StreamEvent['type'] };
    }

    // Legacy / OpenAI-compat shapes
    if (rawEvt.choices?.[0]?.delta?.content !== undefined) {
      return { type: 'chunk', content: rawEvt.choices[0].delta.content };
    }
    if (rawEvt.content !== undefined) {
      return { type: 'chunk', content: rawEvt.content };
    }
    if (rawEvt.text !== undefined) {
      return { type: 'chunk', content: rawEvt.text };
    }
    if (rawEvt.delta !== undefined) {
      return { type: 'chunk', content: rawEvt.delta };
    }
    if (rawEvt.message?.content !== undefined) {
      return { type: 'chunk', content: rawEvt.message.content };
    }
    return rawEvt as StreamEvent;
  },
};

export default copilotChatService;

