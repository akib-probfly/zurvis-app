import { borderWidth, fontSize, fontWeight, spacing } from '../theme/tokens';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  title: string;
  subtitle?: string;
  /** Omit to render a header without a back affordance. */
  onBack?: () => void;
  /** Trailing action, e.g. an add or refresh button. */
  right?: ReactNode;
  titleNumberOfLines?: number;
};

/** Standard stacked-screen header: back button, title/subtitle, optional trailing action. */
export function ScreenHeader({ title, subtitle, onBack, right, titleNumberOfLines }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + spacing.control, backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
      ]}
    >
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} style={styles.backButton} accessibilityLabel="Go back">
          <ArrowLeft color={colors.text} size={22} />
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={titleNumberOfLines}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    borderBottomWidth: borderWidth.thin,
    flexDirection: 'row',
    gap: spacing.control,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.inset,
  },
  backButton: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: fontSize.heading, fontWeight: fontWeight.extrabold },
  subtitle: { fontSize: fontSize.small, marginTop: spacing.xxs },
});
