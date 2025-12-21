export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  contentType?: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE';
  imageUrl?: string;
  attachments?: MessageAttachment[];
  metadata?: {
    type?: 'checklist_update' | 'proactive_suggestion';
    itemIds?: string[];
    itemId?: string;
  };
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url?: string;
  presignedUrl?: string;
}

export interface PendingImage {
  id: string;
  uri: string;
  isUploading?: boolean;
}

