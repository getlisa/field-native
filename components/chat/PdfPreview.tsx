import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';

interface PdfPreviewProps {
  visible: boolean;
  /** Remote inline PDF URL (…/pdf?inline=1) — rendered directly in the WebView. */
  url: string | null;
  filename?: string;
  onClose: () => void;
  /** Download + share the PDF (parent handles the file write + iOS share sheet). */
  onShare?: () => void;
}

/**
 * Full-screen inline preview of the signed quotation PDF. Loads the backend's inline streaming
 * endpoint directly in a WebView so the user can read it without downloading. The Share button
 * delegates to the parent (download + iOS share sheet) for saving.
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ visible, url, filename, onClose, onShare }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom', 'left', 'right']}>
        {/* Title only — non-interactive so it's fine near the notch/Dynamic Island. */}
        <View style={[styles.titleRow, { borderBottomColor: colors.border }]}>
          <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {filename || 'Quotation'}
          </ThemedText>
        </View>
        <View style={styles.body}>
          {url ? (
            <WebView
              source={{ uri: url }}
              originWhitelist={['*']}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              style={styles.webview}
            />
          ) : null}
          {loading ? (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : null}
        </View>
        {/* Reachable bottom action bar (clears the status bar / Dynamic Island). */}
        <View style={[styles.actionBar, { borderTopColor: colors.border }]}>
          <Pressable
            style={[styles.actionButton, { borderColor: colors.border }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
          >
            <Ionicons name="close" size={18} color={colors.text} />
            <ThemedText style={[styles.actionLabel, { color: colors.text }]}>Close</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.actionPrimary, { backgroundColor: colors.primary }]}
            onPress={onShare}
            disabled={!onShare}
            accessibilityRole="button"
            accessibilityLabel="Share or save PDF"
          >
            <Ionicons name="share-outline" size={18} color="#ffffff" />
            <ThemedText style={[styles.actionLabel, { color: '#ffffff' }]}>Share / Save</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  titleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionPrimary: {
    flex: 2,
    borderWidth: 0,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default PdfPreview;
