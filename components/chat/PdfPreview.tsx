import { Ionicons } from '@expo/vector-icons';
import { cacheDirectory, downloadAsync, readAsStringAsync } from 'expo-file-system/legacy';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';

// Android's WebView can't render PDFs (it hands them to the download manager), so on Android
// the PDF is downloaded to the cache and drawn page-by-page with pdf.js instead.
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const buildPdfJsHtml = (base64: string) => `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4">
<style>
  html, body { margin: 0; padding: 0; background: #525659; }
  canvas { display: block; width: 100%; height: auto; margin: 0 0 8px; background: #fff; }
  #error { color: #fff; font: 15px sans-serif; padding: 24px; text-align: center; }
</style>
<script src="${PDFJS_BASE}/pdf.min.js"></script>
</head>
<body>
<div id="pages"></div>
<script>
  (async function () {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS_BASE}/pdf.worker.min.js';
      const raw = atob('${base64}');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const container = document.getElementById('pages');
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (window.innerWidth / base.width) * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        container.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
      window.ReactNativeWebView.postMessage('loaded');
    } catch (e) {
      document.body.innerHTML = '<div id="error">Could not display this PDF. Use Share / Save to open it.</div>';
      window.ReactNativeWebView.postMessage('error:' + (e && e.message));
    }
  })();
</script>
</body>
</html>`;

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
 * Full-screen inline preview of the quotation PDF. On iOS the WebView loads the backend's inline
 * streaming endpoint directly; on Android the PDF is fetched into the cache and rendered with
 * pdf.js. The Share button delegates to the parent (download + share sheet) for saving.
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ visible, url, filename, onClose, onShare }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  // Android only: the pdf.js page wrapping the downloaded PDF.
  const [androidHtml, setAndroidHtml] = useState<string | null>(null);
  const [androidError, setAndroidError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android' || !visible || !url) return;
    let cancelled = false;
    setLoading(true);
    setAndroidHtml(null);
    setAndroidError(null);
    (async () => {
      try {
        const { uri, status } = await downloadAsync(url, `${cacheDirectory ?? ''}pdf-preview-${Date.now()}.pdf`);
        if (status < 200 || status >= 300) throw new Error(`Download failed (${status})`);
        const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
        if (!cancelled) setAndroidHtml(buildPdfJsHtml(base64));
      } catch (err) {
        console.warn('[PdfPreview] Failed to load PDF for preview', err);
        if (!cancelled) {
          setAndroidError('Could not load the PDF. Use Share / Save to open it.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, url]);

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
          {Platform.OS === 'android' ? (
            androidHtml ? (
              <WebView
                source={{ html: androidHtml }}
                originWhitelist={['*']}
                onMessage={(e) => {
                  // pdf.js posts 'loaded' or 'error:…' once rendering finishes.
                  if (e.nativeEvent.data.startsWith('error:')) {
                    console.warn('[PdfPreview] pdf.js render failed', e.nativeEvent.data);
                  }
                  setLoading(false);
                }}
                style={styles.webview}
              />
            ) : androidError ? (
              <View style={styles.loading}>
                <ThemedText style={[styles.errorText, { color: colors.textSecondary }]}>{androidError}</ThemedText>
              </View>
            ) : null
          ) : url ? (
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
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 24,
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
