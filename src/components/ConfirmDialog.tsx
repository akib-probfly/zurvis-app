import { borderWidth, fontSize, fontWeight, lineHeight, radius, spacing } from '../theme/tokens';
import { AlertTriangle, X, type LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  icon: Icon = AlertTriangle,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!loading) onClose(); }}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Pressable style={styles.close} onPress={() => !loading && onClose()} hitSlop={8}>
            <X color={colors.textMuted} size={20} />
          </Pressable>
          <View style={[styles.iconWrap, { backgroundColor: destructive ? colors.dangerSoft : colors.surfaceSecondary }]}>
            <Icon color={destructive ? colors.error : colors.textSecondary} size={28} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.cancel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}
              disabled={loading}
              onPress={onClose}
            >
              <Text style={[styles.cancelText, { color: colors.text }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirm, { backgroundColor: destructive ? colors.error : colors.primary }, loading && styles.disabled]}
              disabled={loading}
              onPress={onConfirm}
            >
              {loading ? <ActivityIndicator color={colors.primaryText} /> : <Text style={[styles.confirmText, { color: colors.primaryText }]}>{confirmLabel}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    borderRadius: radius.dialog,
    maxWidth: 420,
    paddingHorizontal: spacing.sectionInset,
    paddingVertical: spacing.xxl,
    width: '100%',
  },
  close: { position: 'absolute', right: 14, top: 14, zIndex: 2 },
  iconWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radius.dialog,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  title: {
    fontSize: fontSize.headingLarge,
    fontWeight: fontWeight.extrabold,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.section,
    lineHeight: lineHeight.subtitle,
    marginTop: spacing.control,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.control,
    marginTop: spacing.roomy,
  },
  cancel: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
    flex: 1,
    paddingVertical: spacing.md,
  },
  cancelText: { fontSize: fontSize.section, fontWeight: fontWeight.bold },
  confirm: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flex: 1,
    paddingVertical: spacing.md,
  },
  confirmText: { fontSize: fontSize.section, fontWeight: fontWeight.bold },
  disabled: { opacity: 0.55 },
});
