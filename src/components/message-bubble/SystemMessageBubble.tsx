import { Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { isMissedCall, formatMessageTime, getSystemMessageLabel } from '../../lib/inbox-utils';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './styles';

export function SystemMessageBubble({ message }: { message: any }) {
  const { colors, isDark } = useTheme();
  const styles = createStyles(colors);
  const missed = isMissedCall(message);
  const timestamp = message.sentAt ?? message.createdAt;

  return (
    <View style={styles.systemWrap}>
      <View style={[styles.systemPill, missed && styles.systemPillMissed, { backgroundColor: isDark ? 'rgba(30,41,59,0.9)' : 'rgba(255,255,255,0.85)', borderColor: missed ? '#fef3c7' : isDark ? colors.cardBorder : '#e0f2fe' }]}>
        <View style={[styles.systemIconCircle, missed && styles.systemIconCircleMissed, { backgroundColor: isDark ? colors.surfaceSecondary : missed ? '#fffbeb' : '#eff6ff' }]}>
          <Check color={missed ? '#f59e0b' : '#3b82f6'} size={12} />
        </View>
        <Text style={[styles.systemText, missed && styles.systemTextMissed, { color: missed ? '#d97706' : colors.textSecondary }]}>{getSystemMessageLabel(message)}</Text>
        <Text style={[styles.systemTime, { color: colors.textMuted }]}>{formatMessageTime(timestamp)}</Text>
      </View>
    </View>
  );
}

