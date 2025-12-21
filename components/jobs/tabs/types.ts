/**
 * Shared types for job tabs
 * Re-exports from chat/types for backwards compatibility
 */

export type { Message, MessageAttachment, PendingImage } from '@/components/chat/types';

// Aliases for AskAI-specific usage
export type { Message as AskAIMessage } from '@/components/chat/types';
export type { MessageAttachment as AskAIMessageAttachment } from '@/components/chat/types';
export type { PendingImage as AskAIPendingImage } from '@/components/chat/types';
