import { borderWidth, controlSize, fontSize, radius, spacing } from '../theme/tokens';
import { Search, X } from 'lucide-react-native';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** `md` (44pt) suits full screens, `sm` (38pt) suits dense toolbars. */
  size?: 'sm' | 'md';
  /** Which surface the field sits on, so it stays readable in both themes. */
  tone?: 'surface' | 'background';
  showClear?: boolean;
  /** Extra work to run when clearing, e.g. resetting a debounced value. */
  onClear?: () => void;
  /** Fill remaining space in a toolbar row. Turn off inside column layouts like sheets. */
  fill?: boolean;
  autoFocus?: boolean;
};

export function AppSearchField({
  value,
  onChangeText,
  placeholder = 'Search…',
  size = 'md',
  tone = 'surface',
  showClear = true,
  onClear,
  fill = true,
  autoFocus,
}: Props) {
  const { colors } = useTheme();
  const height = size === 'sm' ? controlSize.compact : controlSize.touchTarget;
  const iconSize = size === 'sm' ? 15 : 18;
  const background = tone === 'surface' ? colors.surface : colors.background;

  const clear = () => {
    onChangeText('');
    onClear?.();
  };

  return (
    <View style={[styles.wrap, !fill && styles.wrapFlush, { backgroundColor: background, borderColor: colors.cardBorder, height }]}>
      <Search color={colors.textMuted} size={iconSize} />
      <TextInput
        autoFocus={autoFocus}
        underlineColorAndroid="transparent"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.text, height }]}
      />
      {showClear && value ? (
        <Pressable onPress={clear} hitSlop={8} accessibilityLabel="Clear search">
          <X color={colors.textMuted} size={iconSize - 2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  wrapFlush: { flex: 0, alignSelf: 'stretch' },
  input: { flex: 1, fontSize: fontSize.section, marginLeft: spacing.sm, paddingVertical: spacing.none },
});
