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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close preview">
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {filename || 'Quotation'}
          </ThemedText>
          <Pressable onPress={share} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share or save PDF">
            <Ionicons name="share-outline" size={24} color={colors.primary} />
          </Pressable>
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
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
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
});

export default PdfPreview;
