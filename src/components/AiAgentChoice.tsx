import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../ui';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export function AiAgentChoice({ label, description, selected, disabled, leading, onPress }: {
  label: string; description?: string; selected: boolean; disabled?: boolean; leading?: ReactNode; onPress: () => void;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.row, { borderColor: selected ? colors.primary : colors.cardBorder, backgroundColor: selected ? colors.primarySoft : colors.surface, opacity: disabled ? 0.6 : 1 }]}>
    {leading}
    <View style={styles.copy}><AppText variant="bodyStrong">{label}</AppText>{description ? <AppText variant="small" tone="secondary">{description}</AppText> : null}</View>
    <View style={[styles.check, { borderColor: selected ? colors.primary : colors.cardBorder, backgroundColor: selected ? colors.primary : colors.surface }]}>
      {selected ? <Check size={12} color={colors.primaryText} /> : null}
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({ row: { alignItems: 'center', flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }, copy: { flex: 1, gap: spacing.xs }, check: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.xs, width: 20, height: 20 } });
