import { Text, View } from 'react-native';
import { FileText, Image as ImageIcon, Mic, Video } from 'lucide-react-native';
import { getReplyPreviewPresentation } from '../../lib/inbox-utils';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './styles';

export function ReplyPreviewBody({ text, mediaType, outgoing, colors }: { text?: string | null; mediaType?: string | null; outgoing: boolean; colors: { textSecondary: string } }) {
  const { colors: styleColors } = useTheme();
  const styles = createStyles(styleColors);
  const presentation = getReplyPreviewPresentation(text, mediaType);
  const color = outgoing ? '#eef2ff' : colors.textSecondary;
  const Icon = presentation.kind === 'photo' || presentation.kind === 'sticker' ? ImageIcon
    : presentation.kind === 'video' ? Video
    : presentation.kind === 'audio' || presentation.kind === 'voice' ? Mic
    : presentation.kind === 'document' ? FileText
    : null;

  if (!Icon) {
    return (
      <Text numberOfLines={1} style={[styles.quotedText, !outgoing && styles.quotedTextIncoming, !outgoing && { color }]}>
        {presentation.label}
      </Text>
    );
  }

  return (
    <View style={styles.quotedType}>
      <Icon color={color} size={14} />
      <Text numberOfLines={1} style={[styles.quotedText, !outgoing && styles.quotedTextIncoming, !outgoing && { color }]}>
        {presentation.label}
      </Text>
    </View>
  );
}

