import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/contexts/ThemeContext';

interface EmailModalProps {
  visible: boolean;
  /** Pre-fill from the job (sign response `suggestedCustomerEmail`); null/undefined → empty input. */
  suggestedEmail?: string | null;
  sending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSend: (to: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Confirm/edit the customer's email, then send the signed estimate PDF. Pre-fills with the
 * job's suggested address when available; otherwise the tech types one in.
 */
export const EmailModal: React.FC<EmailModalProps> = ({ visible, suggestedEmail, sending = false, error, onCancel, onSend }) => {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');

  // Re-seed the field whenever the modal (re)opens with a (possibly new) suggested address.
  useEffect(() => {
    if (visible) setEmail(suggestedEmail ?? '');
  }, [visible, suggestedEmail]);

  const valid = EMAIL_RE.test(email.trim());

  const send = () => {
    if (!valid || sending) return;
    onSend(email.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.header}>
            <ThemedText style={[styles.title, { color: colors.text }]}>Email estimate</ThemedText>
            <Pressable onPress={onCancel} disabled={sending} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Send the signed estimate to</ThemedText>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="customer@example.com"
            placeholderTextColor={colors.textTertiary}
            editable={!sending}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            inputMode="email"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
            returnKeyType="send"
            onSubmitEditing={send}
            autoFocus
          />
          {error ? <ThemedText style={[styles.error, { color: colors.warning }]}>{error}</ThemedText> : null}

          <View style={styles.footer}>
            <Pressable
              style={[styles.cancel, { borderColor: colors.border }]}
              onPress={onCancel}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <ThemedText style={[styles.cancelLabel, { color: colors.textSecondary }]}>Cancel</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.send, { backgroundColor: valid && !sending ? colors.primary : colors.backgroundTertiary }]}
              onPress={send}
              disabled={!valid || sending}
              accessibilityRole="button"
              accessibilityLabel="Send estimate email"
              accessibilityState={{ disabled: !valid || sending }}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="send" size={16} color={valid ? '#ffffff' : colors.textTertiary} />
              )}
              <ThemedText style={[styles.sendLabel, { color: valid && !sending ? '#ffffff' : colors.textTertiary }]}>
                {sending ? 'Sending…' : 'Send'}
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
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  error: {
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  cancel: {
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
  send: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  sendLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default EmailModal;
