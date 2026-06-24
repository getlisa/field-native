import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';

interface PdfPreviewProps {
  visible: boolean;
  /** Local file:// URI of the downloaded PDF. */
  uri: string | null;
  filename?: string;
  onClose: () => void;
}

/**
 * Full-screen inline preview of a downloaded PDF (rendered in a WebView so the user can read
 * it without saving). A Share button presents the iOS share sheet for those who want to save.
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ visible, uri, filename, onClose }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  // Grant WKWebView read access to the folder holding the local file.
  const readAccess = uri ? uri.slice(0, uri.lastIndexOf('/') + 1) : undefined;

  const share = async () => {
    if (!uri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: filename || 'Quotation PDF',
        });
      }
    } catch {
      // ignore — preview still available
    }
  };

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
          {uri ? (
            <WebView
              source={{ uri }}
              originWhitelist={['*']}
              allowFileAccess
              allowFileAccessFromFileURLs
              allowingReadAccessToURL={readAccess}
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
            onPress={share}
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
