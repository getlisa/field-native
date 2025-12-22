import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { formatDistanceToNow } from 'date-fns';
import React, { useState, useMemo } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';
interface MessageAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url?: string;
  presignedUrl?: string;
}

interface Message {
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

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
  const { colors } = useTheme();
  const isAssistant = message.role === 'assistant';
  const isProactive = message.content.startsWith('💡');
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());

  const isChecklistUpdate = message.metadata?.type === 'checklist_update';
  const isProactiveSuggestion = message.metadata?.type === 'proactive_suggestion';

  // Create theme-aware markdown styles
  const markdownStyles = useMemo(() => ({
    body: {
      color: isAssistant ? colors.text : '#ffffff',
      fontSize: 14,
      lineHeight: 20,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
    },
    strong: {
      fontWeight: '600' as const,
      color: isAssistant ? colors.text : '#ffffff',
    },
    em: {
      fontStyle: 'italic' as const,
      color: isAssistant ? colors.text : '#ffffff',
    },
    link: {
      color: isAssistant ? colors.primary : '#ffffff',
      textDecorationLine: 'underline' as const,
    },
    code_inline: {
      backgroundColor: isAssistant ? colors.backgroundSecondary : 'rgba(255,255,255,0.2)',
      color: isAssistant ? colors.text : '#ffffff',
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      fontSize: 13,
      fontFamily: 'monospace',
    },
    code_block: {
      backgroundColor: isAssistant ? colors.backgroundSecondary : 'rgba(255,255,255,0.2)',
      color: isAssistant ? colors.text : '#ffffff',
      padding: 8,
      borderRadius: 8,
      fontSize: 13,
      fontFamily: 'monospace',
      marginVertical: 8,
    },
    fence: {
      backgroundColor: isAssistant ? colors.backgroundSecondary : 'rgba(255,255,255,0.2)',
      color: isAssistant ? colors.text : '#ffffff',
      padding: 8,
      borderRadius: 8,
      fontSize: 13,
      fontFamily: 'monospace',
      marginVertical: 8,
    },
    heading1: {
      fontSize: 18,
      fontWeight: '700' as const,
      color: isAssistant ? colors.text : '#ffffff',
      marginTop: 8,
      marginBottom: 8,
    },
    heading2: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: isAssistant ? colors.text : '#ffffff',
      marginTop: 8,
      marginBottom: 6,
    },
    heading3: {
      fontSize: 15,
      fontWeight: '600' as const,
      color: isAssistant ? colors.text : '#ffffff',
      marginTop: 6,
      marginBottom: 4,
    },
    bullet_list: {
      marginVertical: 4,
    },
    ordered_list: {
      marginVertical: 4,
    },
    list_item: {
      marginVertical: 2,
      flexDirection: 'row' as const,
    },
    bullet_list_icon: {
      color: isAssistant ? colors.text : '#ffffff',
      marginLeft: 4,
      marginRight: 8,
    },
    ordered_list_icon: {
      color: isAssistant ? colors.text : '#ffffff',
      marginLeft: 4,
      marginRight: 8,
    },
    blockquote: {
      backgroundColor: isAssistant ? colors.backgroundSecondary : 'rgba(255,255,255,0.1)',
      borderLeftColor: isAssistant ? colors.primary : '#ffffff',
      borderLeftWidth: 4,
      marginVertical: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
  }), [colors, isAssistant]);

  const imageAttachments = (message.attachments || []).filter((a: MessageAttachment) => {
    const type = a.fileType || '';
    return (a.url || a.presignedUrl);
  });

  const getImageUrl = (attachment: MessageAttachment) =>
    attachment.url || attachment.presignedUrl;

  const handleImageError = (attachmentId: string) => {
    setFailedImages((prev) => new Set(prev).add(attachmentId));
    setLoadingImages((prev) => {
      const next = new Set(prev);
      next.delete(attachmentId);
      return next;
    });
  };

  const handleImageLoadStart = (attachmentId: string) => {
    setLoadingImages((prev) => new Set(prev).add(attachmentId));
  };

  const handleImageLoadEnd = (attachmentId: string) => {
    setLoadingImages((prev) => {
      const next = new Set(prev);
      next.delete(attachmentId);
      return next;
    });
  };

  if (isChecklistUpdate) {
    const itemNames = message.metadata?.itemIds?.join(', ') || 'Unknown item';
    return (
      <View style={styles.messageRow}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Ionicons name="chatbubble-ellipses" size={16} color="#ffffff" />
        </View>
        <View style={styles.messageContent}>
          <View
            style={[
              styles.bubble,
              styles.checklistBubble,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
            ]}
          >
            <View style={styles.checklistHeader}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <ThemedText style={[styles.checklistTitle, { color: colors.text }]}>Detected Completion</ThemedText>
            </View>
            <ThemedText style={[styles.checklistItem, { color: colors.text }]}>{itemNames}</ThemedText>
            <ThemedText style={[styles.checklistEvidence, { color: colors.textSecondary }]}>
              Evidence: {message.content}
            </ThemedText>
          </View>
          <ThemedText style={[styles.timestamp, { color: colors.textSecondary }]}>
            {formatDistanceToNow(message.timestamp, { addSuffix: true })}
          </ThemedText>
        </View>
      </View>
    );
  }

  if (isProactiveSuggestion) {
    const itemId = message.metadata?.itemId || 'General';
    return (
      <View style={styles.messageRow}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Ionicons name="chatbubble-ellipses" size={16} color="#ffffff" />
        </View>
        <View style={styles.messageContent}>
          <View
            style={[
              styles.bubble,
              styles.suggestionBubble,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
            ]}
          >
            <View style={styles.suggestionHeader}>
              <Ionicons name="bulb" size={16} color={colors.warning} />
              <ThemedText style={[styles.suggestionTitle, { color: colors.text }]}>
                Proactive Suggestion
              </ThemedText>
            </View>
            <ThemedText style={[styles.suggestionRegarding, { color: colors.textSecondary }]}>
              Regarding: {itemId}
            </ThemedText>
            <ThemedText style={[styles.suggestionText, { color: colors.text }]}>{message.content}</ThemedText>
          </View>
          <ThemedText style={[styles.timestamp, { color: colors.textSecondary }]}>
            {formatDistanceToNow(message.timestamp, { addSuffix: true })}
          </ThemedText>
        </View>
      </View>
    );
  }

  const isImageMessage = message.contentType === 'IMAGE' || imageAttachments.length > 0;

  const assistantBubbleStyle = isProactive
    ? [
        styles.proactiveBubble,
        { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
      ]
    : [styles.assistantBubble, { backgroundColor: colors.backgroundSecondary }];

  const userBubbleStyle = [styles.userBubble, { backgroundColor: colors.primary }];

  return (
    <View style={[styles.messageRow, !isAssistant && styles.userMessageRow]}>
      <View
        style={[
          styles.avatar,
          isAssistant ? { backgroundColor: colors.primary } : { backgroundColor: colors.backgroundSecondary },
        ]}
      >
        <Ionicons
          name={isAssistant ? 'chatbubble-ellipses' : 'person'}
          size={16}
          color={isAssistant ? '#ffffff' : colors.text}
        />
      </View>
      <View style={[styles.messageContent, !isAssistant && styles.userMessageContent]}>
        <View
          style={[
            styles.bubble,
            isAssistant ? assistantBubbleStyle : userBubbleStyle,
          ]}>
          {isImageMessage && imageAttachments.length > 0 && (
            <View style={styles.attachmentsContainer}>
              {imageAttachments.map((attachment: MessageAttachment) => (
                <View key={attachment.id} style={styles.attachmentWrapper}>
                  {failedImages.has(attachment.id) ? (
                    <View style={[styles.failedImage, { backgroundColor: colors.backgroundSecondary }]}>
                      <Ionicons name="image-outline" size={24} color={colors.textSecondary} />
                      <ThemedText style={[styles.failedImageText, { color: colors.textSecondary }]}>
                        Image expired
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={styles.imageContainer}>
                      {loadingImages.has(attachment.id) && (
                        <View style={[styles.loadingOverlay, { backgroundColor: colors.backgroundSecondary }]}>
                          <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                      )}
                    <Image
                        source={{ uri: getImageUrl(attachment) || '' }}
                      style={styles.messageImage}
                        contentFit="contain"
                        transition={200}
                        cachePolicy="memory-disk"
                        priority="normal"
                        recyclingKey={attachment.id}
                        onLoadStart={() => handleImageLoadStart(attachment.id)}
                        onLoadEnd={() => handleImageLoadEnd(attachment.id)}
                      onError={() => handleImageError(attachment.id)}
                    />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Show content text (e.g., question) even for image messages */}
          {message.content ? (
            <Markdown
              style={markdownStyles}
              onLinkPress={(url) => {
                Linking.canOpenURL(url).then((supported) => {
                  if (supported) {
                    Linking.openURL(url);
                  }
                });
                return false;
              }}
            >
              {message.content}
            </Markdown>
          ) : null}
        </View>
        <ThemedText
          style={[
            styles.timestamp,
            { color: colors.textSecondary },
            !isAssistant && styles.userTimestamp,
          ]}>
          {formatDistanceToNow(message.timestamp, { addSuffix: true })}
        </ThemedText>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 12,
  },
  userMessageRow: {
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContent: {
    flex: 1,
    maxWidth: '80%',
  },
  userMessageContent: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistantBubble: {},
  userBubble: {},
  proactiveBubble: {
    borderWidth: 1,
  },
  checklistBubble: {
    borderWidth: 1,
  },
  suggestionBubble: {
    borderWidth: 1,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
  },
  userTimestamp: {
    textAlign: 'right',
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  checklistTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  checklistItem: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  checklistEvidence: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  suggestionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  suggestionRegarding: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  suggestionText: {
    fontSize: 14,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    minHeight: 150,
    maxHeight: 300,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  messageImage: {
    width: '100%',
    height: '100%',
    minHeight: 150,
    maxHeight: 300,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  attachmentsContainer: {
    gap: 8,
    marginBottom: 8,
  },
  attachmentWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  failedImage: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
  },
  failedImageText: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default ChatMessage;
