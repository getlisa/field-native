import { useAuthStore } from '@/store/useAuthStore';

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
    | 'chunk'
    | 'message'
    | 'tool_call'
    | 'node'
    | 'identified'
    | 'quote'
    | 'questions'
    | 'error'
    | 'done';
  content?: string;
  error?: string;
  tool?: any;
  /** Estimate workflow `node` event: graph step name + lifecycle phase. */
  node?: string;
  phase?: 'start' | 'end';
  /** On the estimate `done` event: what the turn produced. */
  responseKind?: 'quote' | 'questions' | 'message';
  /** On the estimate `done` event: true on a quote turn — collect a signature, then POST …/sign. */
  requiresSignature?: boolean;
  /**
   * `CopilotMessage` for user_message/done. The estimate `quote`/`questions` events also
   * arrive here (an `EstimateQuote` / `{ questions: FollowUpQuestion[] }`); the estimate
   * handler casts as needed.
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

  async streamMessage(params: {
    conversationId: string;
    content: string;
    senderId?: string;
    signal?: AbortSignal;
    onEvent: (event: StreamEvent) => void;
  }): Promise<void> {
    if (__DEV__) {
      console.log('[StreamMessage] Starting stream to:', `${COPILOT_API_BASE}/chat/${params.conversationId}/stream`);
    }

    // Use XMLHttpRequest for React Native compatibility (supports progressive streaming)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `${COPILOT_API_BASE}/chat/${params.conversationId}/stream`;
      
      xhr.open('POST', url, true);
      
      // Set headers
      const headers = buildHeaders(true);
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      let buffer = '';
      let processedLength = 0;

      // Handle progressive data as it arrives
      xhr.onprogress = () => {
        const responseText = xhr.responseText;
        const newData = responseText.substring(processedLength);
        processedLength = responseText.length;

        buffer += newData;

        // Process complete lines
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload) continue;

          if (payload === '[DONE]') {
            params.onEvent({ type: 'done' });
            continue;
          }

          try {
            const rawEvt = JSON.parse(payload);
            const evt = this.normalizeEvent(rawEvt);
            params.onEvent(evt);
          } catch (err) {
            if (__DEV__) {
              console.warn('[StreamMessage] Failed to parse SSE payload:', payload, err);
            }
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Process any remaining buffer
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data:')) {
              const payload = trimmed.slice(5).trim();
              if (payload && payload !== '[DONE]') {
                try {
                  const rawEvt = JSON.parse(payload);
                  const evt = this.normalizeEvent(rawEvt);
                  params.onEvent(evt);
                } catch (err) {
                  if (__DEV__) {
                    console.warn('[StreamMessage] Failed to parse final buffer:', payload, err);
                  }
                }
              }
            }
          }
          if (__DEV__) {
            console.log('[StreamMessage] Stream completed successfully');
          }
          resolve();
        } else {
          reject(new Error(`Stream failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Stream request failed'));
      };

      xhr.ontimeout = () => {
        reject(new Error('Stream request timed out'));
      };

      // Handle abort signal
      if (params.signal) {
        params.signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error('Stream aborted'));
        });
      }

      // Send request
      xhr.send(JSON.stringify({
        content: params.content,
        senderId: params.senderId,
      }));
    });
  },

  /**
   * Estimate Cost (demo) — streams a markdown estimate plus a structured `quote` event.
   * Self-contained endpoint; same SSE-over-POST framing as streamMessage.
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
      console.log('[StreamEstimate] Starting stream to:', url);
    }

    // Use XMLHttpRequest for React Native compatibility (supports progressive streaming)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open('POST', url, true);

      const headers = buildHeaders(true);
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      let buffer = '';
      let processedLength = 0;

      const processPayload = (payload: string) => {
        if (!payload || payload === '[DONE]') {
          if (payload === '[DONE]') params.onEvent({ type: 'done' });
          return;
        }
        try {
          const rawEvt = JSON.parse(payload);
          params.onEvent(this.normalizeEvent(rawEvt));
        } catch (err) {
          if (__DEV__) {
            console.warn('[StreamEstimate] Failed to parse SSE payload:', payload, err);
          }
        }
      };

      xhr.onprogress = () => {
        const responseText = xhr.responseText;
        const newData = responseText.substring(processedLength);
        processedLength = responseText.length;

        buffer += newData;

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          processPayload(trimmed.slice(5).trim());
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data:')) {
            processPayload(trimmed.slice(5).trim());
          }
          if (__DEV__) {
            console.log('[StreamEstimate] Stream completed successfully');
          }
          resolve();
        } else {
          reject(new Error(`Estimate stream failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error('Estimate stream request failed'));
      xhr.ontimeout = () => reject(new Error('Estimate stream request timed out'));

      if (params.signal) {
        params.signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error('Estimate stream aborted'));
        });
      }

      xhr.send(
        JSON.stringify({
          content: params.content,
          imageUrl: params.imageUrl,
          imageBase64: params.imageBase64,
          imageMimeType: params.imageMimeType,
          senderId: params.senderId,
        })
      );
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
  }): Promise<{ url: string; key?: string; filename?: string; estimateNumber?: string; signedAt?: string }> {
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
   * Resolve a fresh, downloadable URL for a signed quote's PDF. Presigned URLs expire (~24h),
   * so this hits the durable re-download endpoint which always re-presigns:
   *   GET /copilot/:conversationId/estimate/:messageId/pdf → 302 to a fresh presigned URL.
   * Returns null on 404 (no such message) or 409 (not signed yet) or any error, so callers
   * can fall back to a stored URL.
   */
  async getEstimatePdfUrl(params: {
    conversationId: string;
    messageId: string;
  }): Promise<string | null> {
    const endpoint = `${COPILOT_API_BASE}/copilot/${params.conversationId}/estimate/${params.messageId}/pdf`;
    try {
      // Prefer reading the redirect target directly (no PDF bytes transferred).
      const manual = await fetch(endpoint, {
        method: 'GET',
        headers: buildHeaders(false),
        redirect: 'manual',
      });
      const location = manual.headers.get('location') || manual.headers.get('Location');
      if (location) return location;
      // 404 = no such message; 409 = not signed yet → nothing to download.
      if (manual.status === 404 || manual.status === 409) return null;
      // RN often can't expose the Location header on a manual redirect; follow it and use the
      // final resolved URL instead (the presigned S3 link). Body is ignored.
      const followed = await fetch(endpoint, {
        method: 'GET',
        headers: buildHeaders(false),
        redirect: 'follow',
      });
      if (followed.status === 404 || followed.status === 409) return null;
      if (followed.url && followed.url !== endpoint) return followed.url;
      return null;
    } catch (err) {
      if (__DEV__) {
        console.warn('[getEstimatePdfUrl] Failed to resolve PDF URL:', err);
      }
      return null;
    }
  },

  normalizeEvent(rawEvt: any): StreamEvent {
    if (typeof rawEvt === 'string') {
      return { type: 'chunk', content: rawEvt };
    }

    if (rawEvt.type) {
      return rawEvt as StreamEvent;
    } else if (rawEvt.choices?.[0]?.delta?.content !== undefined) {
      return { type: 'chunk', content: rawEvt.choices[0].delta.content };
    } else if (rawEvt.content !== undefined && !rawEvt.type) {
      return { type: 'chunk', content: rawEvt.content };
    } else if (rawEvt.text !== undefined) {
      return { type: 'chunk', content: rawEvt.text };
    } else if (rawEvt.delta !== undefined) {
      return { type: 'chunk', content: rawEvt.delta };
    } else if (rawEvt.message?.content !== undefined) {
      return { type: 'chunk', content: rawEvt.message.content };
    }
    return rawEvt as StreamEvent;
  },
};

export default copilotChatService;

