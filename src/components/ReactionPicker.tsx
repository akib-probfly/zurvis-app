import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Copy, Reply as ReplyIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function ReactionPicker({
  visible,
  onPick,
  onClose,
  onReply,
  onCopy,
  onCopyImage,
}: {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
  onReply?: () => void;
  onCopy?: () => void;
  onCopyImage?: () => void;
}) {
  const { colors } = useTheme();
  useEffect(() => {
    if (!visible) return;
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.panel, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textSecondary }]}>React to message</Text>
          <View style={styles.emojis}>
            {REACTION_EMOJIS.map((emoji) => (
              <Pressable key={emoji} style={[styles.emojiButton, { backgroundColor: colors.surfaceSecondary }]} onPress={() => onPick(emoji)}>
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actionRow}>
            {onReply ? <Pressable style={[styles.actionButton, { borderColor: colors.cardBorder }]} onPress={() => { onClose(); onReply(); }}>
              <ReplyIcon color={colors.primary} size={20} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Reply</Text>
            </Pressable> : null}
            {onCopy ? (
              <Pressable style={[styles.actionButton, { borderColor: colors.cardBorder }]} onPress={() => { onClose(); onCopy(); }}>
                <Copy color={colors.primary} size={20} />
                <Text style={[styles.actionText, { color: colors.primary }]}>Copy</Text>
              </Pressable>
            ) : null}
          </View>
          {onCopyImage ? (
            <Pressable style={[styles.actionButton, { borderColor: colors.cardBorder, marginTop: 12, flex: 0, alignSelf: 'stretch' }]} onPress={() => { onClose(); onCopyImage(); }}>
              <Copy color={colors.primary} size={20} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Copy image</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#0004', flex: 1, justifyContent: 'center', padding: 32 },
  panel: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 20 },
  title: { color: '#334155', fontSize: 14, fontWeight: '700', marginBottom: 16 },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  emojiButton: { alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  emoji: { fontSize: 24 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 18, width: '100%' },
  actionButton: { alignItems: 'center', borderColor: '#cfe0fa', borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 9 },
  actionText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
});
