import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';

interface SignaturePadProps {
  visible: boolean;
  /** Close without signing. */
  onCancel: () => void;
  /** Submit the captured signature (PNG data URL) + the required customer name. */
  onSubmit: (signatureBase64: string, signerName: string) => void;
  /** Disable controls + show a spinner while the signed PDF is being generated. */
  submitting?: boolean;
}

/**
 * Digital signature board for confirming an estimate (Estimate Cost mode). The customer
 * types their name (required) and signs on the canvas; Submit exports the signature as a
 * PNG data URL and hands it back via onSubmit. Undo/Erase/Cancel manage the drawing.
 * Built on react-native-signature-canvas (WebView + signature_pad.js).
 */
export const SignaturePad: React.FC<SignaturePadProps> = ({ visible, onCancel, onSubmit, submitting = false }) => {
  const { colors } = useTheme();
  const ref = useRef<SignatureViewRef>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nameValid = name.trim().length > 0;

  // Hide the library's built-in footer; render the signature on a white canvas (reads well in the PDF).
  const webStyle = `
    .m-signature-pad--footer { display: none; margin: 0; }
    .m-signature-pad { box-shadow: none; border: none; }
    .m-signature-pad--body { border: none; }
    body, html { width: 100%; height: 100%; background-color: #ffffff; }
  `;

  const reset = () => {
    setName('');
    setError(null);
    ref.current?.clearSignature();
  };

  const handleSubmitPress = () => {
    if (submitting) return;
    if (!nameValid) {
      setError('Enter the customer name.');
      return;
    }
    setError(null);
    // Triggers onOK with the PNG data URL, or onEmpty if nothing was drawn.
    ref.current?.readSignature();
  };

  const handleOK = (signature: string) => {
    onSubmit(signature, name.trim());
  };

  const handleEmpty = () => {
    setError('Please sign above before submitting.');
  };

  const handleCancel = () => {
    if (submitting) return;
    reset();
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText style={[styles.title, { color: colors.text }]}>Sign the estimate</ThemedText>
            <Pressable
              onPress={handleCancel}
              disabled={submitting}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cancel signing"
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Customer name (required) */}
          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Customer name</ThemedText>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (error) setError(null);
            }}
            placeholder="e.g. Jane Doe"
            placeholderTextColor={colors.textTertiary}
            editable={!submitting}
            style={[styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
            returnKeyType="done"
          />

          {/* Signature canvas */}
          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Signature</ThemedText>
          <View style={[styles.canvas, { borderColor: colors.border }]}>
            <SignatureScreen
              ref={ref}
              onOK={handleOK}
              onEmpty={handleEmpty}
              webStyle={webStyle}
              backgroundColor="#ffffff"
              penColor="#111111"
              imageType="image/png"
              autoClear={false}
              androidHardwareAccelerationDisabled
            />
          </View>

          {error ? (
            <ThemedText style={[styles.error, { color: colors.warning }]}>{error}</ThemedText>
          ) : null}

          {/* Controls */}
          <View style={styles.controlsRow}>
            <Pressable
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              onPress={() => ref.current?.undo()}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Undo last stroke"
            >
              <Ionicons name="arrow-undo" size={16} color={colors.text} />
              <ThemedText style={[styles.secondaryLabel, { color: colors.text }]}>Undo</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              onPress={() => {
                ref.current?.clearSignature();
                setError(null);
              }}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Erase signature"
            >
              <Ionicons name="trash-outline" size={16} color={colors.text} />
              <ThemedText style={[styles.secondaryLabel, { color: colors.text }]}>Erase</ThemedText>
            </Pressable>
          </View>

          <View style={styles.footerRow}>
            <Pressable
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={handleCancel}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <ThemedText style={[styles.cancelLabel, { color: colors.textSecondary }]}>Cancel</ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.submitButton,
                { backgroundColor: nameValid && !submitting ? colors.primary : colors.backgroundTertiary },
              ]}
              onPress={handleSubmitPress}
              disabled={submitting || !nameValid}
              accessibilityRole="button"
              accessibilityLabel="Submit signature"
              accessibilityState={{ disabled: submitting || !nameValid }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="checkmark" size={18} color={nameValid ? '#ffffff' : colors.textTertiary} />
              )}
              <ThemedText style={[styles.submitLabel, { color: nameValid && !submitting ? '#ffffff' : colors.textTertiary }]}>
                {submitting ? 'Generating…' : 'Submit'}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  canvas: {
    height: 240,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  error: {
    fontSize: 12,
    marginTop: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  submitButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  submitLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default SignaturePad;
