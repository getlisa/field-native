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
    /** Set on AI messages produced by the Estimate Cost demo mode. */
    mode?: 'estimate';
    /** Structured cost estimate rendered as a quote card. */
    quote?: EstimateQuote;
  };
  /** Seconds Clara spent thinking before the first streamed token (copilot UI). */
  thoughtDurationSeconds?: number;
}

export type EstimateLineItemType = 'equipment' | 'part' | 'labor' | 'access' | 'other';

export interface EstimateLineItem {
  label: string;
  type: EstimateLineItemType;
  /** Quantity, or hours for labor line items. */
  quantity: number;
  unitCost: number;
  amount: number;
}

/** Structured quote returned by the Estimate Cost demo endpoint (`quote` SSE event). */
export interface EstimateQuote {
  identifiedEquipment: {
    brand: string;
    model: string;
    category: string;
    issue: string;
    decision: 'repair' | 'replace';
    /** Confidence 0..1. */
    confidence: number;
  };
  lineItems: EstimateLineItem[];
  laborHours: number;
  laborRate: number;
  subtotal: number;
  total: number;
  currency: string;
  assumptions: string[];
  notes: string;
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
  /** MIME type of the captured/selected image, when known. */
  type?: string;
  isUploading?: boolean;
}

