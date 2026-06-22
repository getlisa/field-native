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
    /** What the estimate turn produced — drives whether the card/buttons render. */
    responseKind?: EstimateResponseKind;
    /** Structured cost estimate rendered as a quote card (responseKind === 'quote'). */
    quote?: EstimateQuote;
    /** Follow-up questions rendered as option buttons (responseKind === 'questions'). */
    questions?: FollowUpQuestion[];
  };
  /** Seconds Clara spent thinking before the first streamed token (copilot UI). */
  thoughtDurationSeconds?: number;
}

export type EstimateResponseKind = 'quote' | 'questions' | 'message';

export interface FollowUpOption {
  id: string;
  /** Button text, e.g. "Drop tile ceiling". */
  label: string;
  /** The answer text sent back to the estimate endpoint when tapped. */
  value: string;
}

/** A required follow-up question the copilot asks when a request is too vague to price. */
export interface FollowUpQuestion {
  id: string;
  question: string;
  options: FollowUpOption[];
  /** Always true → also offer an "Other" (type/speak) free-text entry. */
  allowOther: boolean;
}

export type EstimateLineItemKind =
  | 'material'
  | 'service'
  | 'labor'
  | 'rental'
  | 'permit'
  | 'other';

export interface EstimateLineItem {
  /** Pricebook sheet the row came from, e.g. "Sprinkler Materials" | "Labor Benchmarks". */
  sourceSheet: string;
  /** Pricebook code, e.g. "SP-010" | "LH-002". */
  code: string;
  description: string;
  kind: EstimateLineItemKind;
  /** Quantity, or hours for labor line items. */
  quantity: number;
  /** Unit, e.g. "EA" | "HR" | "DAY" | "CALL". */
  unit: string;
  unitPrice: number;
  /** quantity * unitPrice. */
  lineTotal: number;
}

/**
 * Structured quote returned by the Estimate Cost demo endpoint (`quote` SSE event).
 * Shape matches the fire-protection pricebook quotation format.
 */
export interface EstimateQuote {
  /** Always "estimate" for a quote you receive ("needs_info" never emits a quote frame). */
  status: 'estimate' | 'needs_info';
  title: string;
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
  /** Sum of non-labor lineTotals. */
  materialsServicesSubtotal: number;
  /** Sum of labor lineTotals. */
  laborSubtotal: number;
  /** 0 unless applicable. */
  taxOther: number;
  /** materials+services + labor + tax. */
  total: number;
  currency: string;
  assumptions: string[];
  /** NFPA compliance flags / advisories. */
  customerNotes: string[];
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

