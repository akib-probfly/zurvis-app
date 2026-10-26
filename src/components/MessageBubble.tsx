import { createThemedStyles } from '../theme/createThemedStyles';
import { borderWidth, fontSize, fontWeight, letterSpacing, lineHeight, radius, spacing } from '../theme/tokens';
import * as Clipboard from 'expo-clipboard';
import { Check, CheckCheck, FileText, ExternalLink, ChevronDown, ChevronUp, Megaphone, Sparkles, Image as ImageIcon, Video, Mic, MapPin, ContactRound, Copy, Phone, Mail, Building2, PackagePlus } from 'lucide-react-native';
import { memo, useState, useMemo } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { AuthenticatedImage } from './AuthenticatedImage';
import { VideoThumb } from './VideoThumb';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import {
  readWebchatPostchatForm,
  isEmojiOnlyMessage,
  parseMessageTextParts,
  getOutboundStatusMeta,
  isMessageEdited,
  getMessageFailureReason,
  getTemplateMessageDisplay,
  isTemplateLikeMessage,
  isInstagramSharedPostTemplateMessage,
  getSystemMessageLabel,
  isMissedCall,
  formatMessageTime,
  getMessageReferralPreview,
  getReplyPreviewPresentation,
  getWhatsappLocation,
  getWhatsappContacts,
  getWhatsappOrder,
  type WhatsappLocation,
  type WhatsappContactCard,
  ATTACHMENT_ONLY_PLACEHOLDERS,
} from '../lib/inbox-utils';
import { LinkPreviewCard } from './LinkPreviewCard';
import { MessageReferralPreviewCard } from './MessageReferralPreviewCard';
import { WhatsappOrderCard } from './WhatsappOrderCard';
import { findFirstUrlInText } from '../lib/link-preview';
import { openDownloadedAttachment } from '../lib/open-attachment';
import { useTheme } from '../theme/ThemeContext';

const COLLAPSED_LINE_COUNT = 4;

function openLink(href?: string) {
  if (!href) return;
  Linking.openURL(href).catch(() => {});
}

const UnderlinedMessageLink = memo(function UnderlinedMessageLink({ value, href, color, size = fontSize.body }: { value: string; href: string; color: string; size?: number }) {
  const { fontScale } = useWindowDimensions();
  const [measurement, setMeasurement] = useState<{ key: string; width: number } | null>(null);
  const measurementKey = `${value}:${size}:${fontScale}`;
  const width = measurement?.key === measurementKey ? measurement.width : value.length * size * fontScale * 0.65;
  const textStyle = { color, fontSize: size, fontWeight: fontWeight.bold, lineHeight: lineHeight.body };
  // Explicit dimensions let this view participate in native inline text layout.
  // Draw a solid 2dp line close to the text without changing text layout.
  return (
    <View style={{ width, height: lineHeight.body * fontScale + 2 }}>
      {measurement?.key !== measurementKey ? <Text
        accessible={false}
        pointerEvents="none"
        style={[textStyle, { position: 'absolute', width: 1000, opacity: 0 }]}
        onTextLayout={(event) => {
          const measuredWidth = Math.ceil(event.nativeEvent.lines[0]?.width ?? 0);
          if (measuredWidth > 0 && (measurement?.key !== measurementKey || measurement.width !== measuredWidth)) {
            setMeasurement({ key: measurementKey, width: measuredWidth });
          }
        }}
      >{value}</Text> : null}
      <Text style={textStyle} numberOfLines={1} accessibilityRole="link" onPress={() => openLink(href)}>{value}</Text>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 3 * fontScale, height: 2, backgroundColor: color }} />
    </View>
  );
});

function normalizeLocationBody(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isLocationFallbackBody(body: string, location: WhatsappLocation | null) {
  if (!location) return false;
  const normalizedBody = normalizeLocationBody(body);
  const latitude = String(location.latitude);
  const longitude = String(location.longitude);
  const coordinatePair = `${latitude}, ${longitude}`;
  const compactCoordinatePair = `${latitude},${longitude}`;
  return (
    normalizedBody === normalizeLocationBody(coordinatePair) ||
    normalizedBody === normalizeLocationBody(compactCoordinatePair) ||
    normalizedBody === normalizeLocationBody(`Shared location: (${coordinatePair})`) ||
    normalizedBody === normalizeLocationBody(`Shared location: (${compactCoordinatePair})`)
  );
}

function getContactInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return initials || '?';
}

function getContactClipboardText(contact: WhatsappContactCard) {
  return [
    contact.displayName,
    contact.organization ? `Organization: ${contact.organization}` : null,
    ...contact.phones.map((phoneItem) => `Phone${phoneItem.label ? ` (${phoneItem.label})` : ''}: ${phoneItem.value}`),
    ...contact.emails.map((email) => `Email${email.label ? ` (${email.label})` : ''}: ${email.value}`),
    contact.address ? `Address: ${contact.address}` : null,
    contact.url ? `Website: ${contact.url}` : null,
  ].filter((value): value is string => Boolean(value)).join('\n');
}

function SystemMessageBubble({ message }: { message: any }) {
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

// Dispatches before any hooks run, so the two branches never share a hook order.
export function MessageBubble(props: any) {
  const { message } = props;
  const isSystem = message.senderType === 'SYSTEM' && !message.campaignId && !readWebchatPostchatForm(message.metadata);
  if (isSystem) return <SystemMessageBubble message={message} />;
  return <StandardMessageBubble {...props} />;
}

function StandardMessageBubble({ message, outgoing, attachments, replyPreview, reactions, onImage, onVideo, onLongPress, onReplyPress, channelName, channelType, channelId, onCreateOrderFromMessage, creatingOrderDraft }: any) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const mediaType = (message.type ?? '').toUpperCase();
  const isInstagramSharedPostTemplate =
    String(channelType ?? '').toUpperCase() === 'INSTAGRAM' &&
    isInstagramSharedPostTemplateMessage(message);
  const templateDisplay = useMemo(
    () => isTemplateLikeMessage(message) && !isInstagramSharedPostTemplate ? getTemplateMessageDisplay(message) : null,
    [message, isInstagramSharedPostTemplate],
  );
  const templateHeaderUrl = templateDisplay?.headerMediaUrl ?? null;
  const templateBodyParts = useMemo(
    () => templateDisplay?.bodyText ? parseMessageTextParts(templateDisplay.bodyText) : [],
    [templateDisplay?.bodyText],
  );
  const messageText = typeof message.text === 'string' ? message.text : '';
  const hasStructuredOrderDetails = /(?:^|\n)\s*name\s*:\s*\S+/im.test(messageText) &&
    /(?:^|\n)\s*address\s*:\s*\S+/im.test(messageText) &&
    /(?:^|\n)\s*(?:number|phone)\s*:\s*\S+/im.test(messageText);
  const { imageAttachments, voiceAttachments, videoAttachments, documentAttachments } = useMemo(() => {
    const isTemplateHeaderAttachment = (attachment: any) => {
      if (!templateDisplay) return false;
      const attachmentMediaType = (attachment.mediaType ?? '').toUpperCase();
      if (!['IMAGE', 'VIDEO', 'DOCUMENT', 'STICKER'].includes(attachmentMediaType) && !(attachment.mimeType ?? '').toLowerCase().startsWith('image/') && !(attachment.mimeType ?? '').toLowerCase().startsWith('video/')) {
        return false;
      }
      if (!templateHeaderUrl) return false;
      const rawUrls = [attachment.previewUrl, attachment.thumbnailUrl, attachment.downloadUrl].filter(Boolean) as string[];
      if (rawUrls.includes(templateHeaderUrl)) return true;
      const urls = rawUrls.map((value) => resolveMediaUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1', value));
      return urls.includes(templateHeaderUrl);
    };
    const images: any[] = [];
    const voices: any[] = [];
    const videos: any[] = [];
    const documents: any[] = [];

    for (const attachment of attachments ?? []) {
      const isAudio = isAudioAttachment(attachment);
      const isTemplateHeader = isTemplateHeaderAttachment(attachment);
      const isImage = isImageAttachment(attachment) && !isAudio && !isTemplateHeader;
      const isVideo = !isAudio && isVideoAttachment(attachment) && !isTemplateHeader;

      if (isImage) images.push(attachment);
      if (isAudio) voices.push(attachment);
      if (isVideo) videos.push(attachment);
      if (!isImage && !isAudio && !isVideo && !isTemplateHeader) documents.push(attachment);
    }

    return {
      imageAttachments: images,
      voiceAttachments: voices,
      videoAttachments: videos,
      documentAttachments: documents,
    };
  }, [attachments, templateDisplay, templateHeaderUrl]);

  const referralPreview = useMemo(
    () => getMessageReferralPreview(message, channelName),
    [message, channelName],
  );
  const [referralImageWidth, setReferralImageWidth] = useState(250);
  const postchatForm = readWebchatPostchatForm(message.metadata);
  const whatsappLocation = useMemo(() => getWhatsappLocation(message), [message]);
  const whatsappContacts = useMemo(() => getWhatsappContacts(message), [message]);
  const whatsappOrder = useMemo(() => getWhatsappOrder(message), [message]);
  const canCreateOrderFromMessage = Boolean(
    onCreateOrderFromMessage &&
    (message.orderConfirmation?.eligible || message.metadata?.orderConfirmation?.eligible || whatsappOrder || hasStructuredOrderDetails),
  );
  const body = (message.text ?? '').trim();
  const bodyParts = useMemo(() => parseMessageTextParts(body), [body]);
  const bodyIsImageFilename = outgoing && imageAttachments.some(
    (attachment: any) => typeof attachment.originalName === 'string'
      && attachment.originalName.trim().toLowerCase() === body.toLowerCase(),
  );
  const isLocationFallbackText = isLocationFallbackBody(body, whatsappLocation);
  const isTikTokUnsupportedInboundVoice =
    !outgoing &&
    String(channelType ?? '').toUpperCase() === 'TIKTOK' &&
    mediaType === 'FILE' &&
    (attachments ?? []).length === 0 &&
    (body.length === 0 || ATTACHMENT_ONLY_PLACEHOLDERS.has(body.toLowerCase()));
  const showBody = templateDisplay || postchatForm
    ? false
    : !isTikTokUnsupportedInboundVoice &&
      !isLocationFallbackText &&
      !bodyIsImageFilename &&
      !whatsappContacts?.length &&
      !whatsappOrder &&
      body.length > 0 &&
      !ATTACHMENT_ONLY_PLACEHOLDERS.has(body.toLowerCase());
  const statusMeta = outgoing ? getOutboundStatusMeta(message.deliveryStatus) : null;
  const edited = isMessageEdited(message);
  const failedReason = outgoing && statusMeta?.showFailed ? getMessageFailureReason(message) : null;
  const bodyKey = `${message.id}\u0000${body}`;
  const [expandedBodyKey, setExpandedBodyKey] = useState<string | null>(null);
  const [overflowBodyKey, setOverflowBodyKey] = useState<string | null>(null);
  const expanded = expandedBodyKey === bodyKey;
  // Native line measurements can be missing or delayed in recycled list cells.
  // Clearly long bodies must still start collapsed and expose the toggle.
  // Android's decorated spans can crash when numberOfLines clips their range.
  // Keep inline links visible by rendering their entire message body.
  const hasAndroidInlineLink = Platform.OS === 'android' && bodyParts.some((part) => (part.href?.startsWith('tel:') || part.href?.startsWith('mailto:')));
  const canExpand = !hasAndroidInlineLink && (overflowBodyKey === bodyKey
    || body.length > 400
    || body.split('\n').length > COLLAPSED_LINE_COUNT);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);

  function renderBody() {
    if (!body) return null;
    if (isEmojiOnlyMessage(body)) {
      return <Text style={[styles.emojiOnly, outgoing && styles.outgoingText, !outgoing && { color: colors.text }]}>{body}</Text>;
    }
    const clamp = canExpand && !expanded;
    return (
      <View>
        <Text
          style={[outgoing ? styles.outgoingText : [styles.messageText, { color: colors.text }], hasAndroidInlineLink && styles.inlineLinkBody]}
          numberOfLines={clamp ? COLLAPSED_LINE_COUNT : undefined}
          onTextLayout={(e) => {
            if (!hasAndroidInlineLink && !canExpand && e.nativeEvent.lines.length > COLLAPSED_LINE_COUNT) setOverflowBodyKey(bodyKey);
          }}
        >
          {bodyParts.map((part, index) => (part.href?.startsWith('tel:') || part.href?.startsWith('mailto:')) ? (
            <UnderlinedMessageLink key={index} value={part.value} href={part.href} color={outgoing ? '#eaf1ff' : colors.primary} />
          ) : part.type === 'url' ? (
            <Text key={index} style={[styles.link, outgoing && styles.outgoingLink, !outgoing && { color: colors.primary }]} onPress={() => openLink(part.href)}>{part.value}</Text>
          ) : (
            <Text key={index}>{part.value}</Text>
          ))}
        </Text>
        {canExpand ? (
          <Pressable
            onPress={() => setExpandedBodyKey(expanded ? null : bodyKey)}
            hitSlop={6}
            style={styles.readMoreRow}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Read less' : 'Read more'}
            accessibilityState={{ expanded }}
          >
            {expanded ? <ChevronUp color={outgoing ? '#eaf1ff' : colors.primary} size={13} /> : <ChevronDown color={outgoing ? '#eaf1ff' : colors.primary} size={13} />}
            <Text style={[styles.readMore, outgoing && styles.outgoingLink, !outgoing && { color: colors.primary }]}>{expanded ? 'Read less' : 'Read more'}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  async function openDocument(attachment: any) {
    if (openingDocumentId) return;
    setOpeningDocumentId(attachment.id);
    try {
      await openDownloadedAttachment(attachment.downloadUrl ?? attachment.previewUrl ?? attachment.thumbnailUrl, attachment.mimeType);
    } finally {
      setOpeningDocumentId(null);
    }
  }

  const isTemplate = templateDisplay !== null;
  const firstUrl = useMemo(() => findFirstUrlInText(message.text ?? ''), [message.text]);
  const showLinkPreview = !postchatForm && !isTemplate && !referralPreview && firstUrl && !imageAttachments.length && !videoAttachments.length;
  const isLocationOnlyMessage = Boolean(
    whatsappLocation &&
    !showBody &&
    !postchatForm &&
    !templateDisplay &&
    !referralPreview &&
    !replyPreview &&
    imageAttachments.length === 0 &&
    videoAttachments.length === 0 &&
    voiceAttachments.length === 0 &&
    documentAttachments.length === 0,
  );
  const isContactOnlyMessage = Boolean(
    whatsappContacts?.length &&
    !showBody &&
    !postchatForm &&
    !templateDisplay &&
    !referralPreview &&
    !replyPreview &&
    !whatsappLocation &&
    imageAttachments.length === 0 &&
    videoAttachments.length === 0 &&
    voiceAttachments.length === 0 &&
    documentAttachments.length === 0,
  );

  const hasReactions = Boolean(reactions?.length);
  const reactionItems: Array<{ emoji: string; count: number }> = hasReactions ? reactions : [];
  const singleImage = imageAttachments.length === 1 ? (
    <AuthenticatedImage
      url={previewUrl(imageAttachments[0])}
      style={[styles.image, { backgroundColor: colors.surfaceSecondary }]}
      onPress={() => onImage?.(imageAttachments[0].id)}
      fitContent
      maxWidth={referralPreview ? referralImageWidth : 250}
      // Ad cards set the bubble width. Keep portrait media at that same width
      // without cropping screenshots or leaving a strip beside the image.
      maxHeight={referralPreview ? Number.MAX_SAFE_INTEGER : 340}
    />
  ) : null;

  return (
    <View style={[styles.wrap, outgoing && styles.wrapOutgoing, canCreateOrderFromMessage && styles.wrapWithCreateOrder, hasReactions && styles.wrapWithReactions]}>
      {canCreateOrderFromMessage && outgoing ? <Pressable onPress={() => onCreateOrderFromMessage(message)} disabled={creatingOrderDraft} style={[styles.createOrderFromMessage, { backgroundColor: colors.surface, borderColor: colors.cardBorder, opacity: creatingOrderDraft ? 0.65 : 1 }]} accessibilityRole="button" accessibilityLabel="Create order from message" accessibilityState={{ disabled: creatingOrderDraft }}>
        {creatingOrderDraft ? <ActivityIndicator color={colors.primary} size="small" /> : <PackagePlus color={colors.primary} size={17} />}
      </Pressable> : null}
      <Pressable onLongPress={onLongPress} delayLongPress={350} style={canCreateOrderFromMessage ? styles.bubblePressableWithAction : undefined}>
        <View style={[
          styles.bubble,
          outgoing ? styles.bubbleOutgoing : styles.bubbleIncoming,
          (showLinkPreview || referralPreview) && styles.linkPreviewBubble,
          !outgoing && referralPreview && styles.referralBubble,
          isTemplate ? (outgoing ? styles.outgoingTemplate : styles.incomingTemplate) : (outgoing ? styles.outgoing : styles.incoming),
    (isLocationOnlyMessage || isContactOnlyMessage || whatsappOrder) && styles.embeddedCardOnlyBubble,
          !outgoing && (referralPreview
            ? { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder }
            : isLocationOnlyMessage || isContactOnlyMessage
              ? null
              : { backgroundColor: colors.surface, borderColor: colors.cardBorder }),
        ]}>
        {message.campaignId ? (
          <View style={styles.broadcastBadge}>
            <Megaphone color="#fff" size={11} />
            <Text style={styles.broadcastBadgeText}>Broadcast</Text>
          </View>
        ) : null}
        {postchatForm ? (
          <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: borderWidth.thin }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <FileText size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textSecondary, fontSize: fontSize.compact }}>Post-chat form</Text>
                <Text style={{ color: colors.text, fontWeight: fontWeight.bold }}>{postchatForm.formName}</Text>
              </View>
            </View>
            {postchatForm.values.length ? postchatForm.values.map((field) => (
              <View key={field.id} style={{ gap: spacing.tight }}>
                <Text style={{ color: colors.textSecondary, fontSize: fontSize.compact, fontWeight: fontWeight.semibold }}>{field.label}</Text>
                {field.type === 'RATING' ? (
                  <View style={styles.postchatRating} accessibilityLabel={`${Math.min(5, Math.max(0, Number.parseInt(field.value, 10) || 0))} out of 5 stars`}>
                    {Array.from({ length: 5 }, (_, index) => {
                      const rating = Math.min(5, Math.max(0, Number.parseInt(field.value, 10) || 0));
                      return <Text key={index} style={[styles.postchatStar, { color: index < rating ? '#f59e0b' : colors.cardBorder }]}>{'★'}</Text>;
                    })}
                    <Text style={[styles.postchatScore, { color: colors.textSecondary }]}>{Math.min(5, Math.max(0, Number.parseInt(field.value, 10) || 0))}/5</Text>
                  </View>
                ) : <Text selectable style={{ color: colors.text, fontSize: fontSize.caption, lineHeight: lineHeight.section }}>{field.value}</Text>}
              </View>
            )) : <Text style={{ color: colors.textSecondary }}>No additional feedback provided.</Text>}
          </View>
        ) : null}
        {referralPreview ? (
          <View style={[styles.referralWrap, (showBody || voiceAttachments.length > 0) && styles.referralWrapWithContent]}>
            <MessageReferralPreviewCard referral={referralPreview} />
          </View>
        ) : null}
        {replyPreview ? (
          <Pressable disabled={!onReplyPress} onPress={() => onReplyPress?.()} hitSlop={4} style={({ pressed }) => pressed && onReplyPress ? styles.quotedPressed : undefined}>
            <View style={[styles.quoted, !outgoing && styles.quotedIncoming, !outgoing && { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
              <Text style={[styles.quotedName, !outgoing && styles.quotedNameIncoming, !outgoing && { color: colors.primary }]}>{replyPreview.name}</Text>
              <View style={styles.quotedRow}>
                {replyPreview.imageUrl ? <AuthenticatedImage url={replyPreview.imageUrl} style={styles.quotedThumb} /> : null}
                <ReplyPreviewBody
                  text={replyPreview.text}
                  mediaType={replyPreview.mediaType ?? (replyPreview.imageUrl ? 'IMAGE' : null)}
                  outgoing={outgoing}
                  colors={colors}
                />
              </View>
            </View>
          </Pressable>
        ) : null}
        {templateDisplay ? (
          <View style={[styles.templateCard, outgoing && styles.templateCardOutgoing, { backgroundColor: colors.surface }, !outgoing && { borderColor: colors.cardBorder }]}>
            <View style={[styles.templateCardHeader, { borderBottomColor: colors.separator }]}>
              <View style={styles.templateBadge}>
                <Sparkles color={colors.primary} size={11} />
                <Text style={[styles.templateBadgeText, { color: colors.primary }]}>Template</Text>
              </View>
              {templateDisplay.category ? (
                <View style={[styles.templateCategoryBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.templateCategoryText, { color: colors.primary }]}>{templateDisplay.category}</Text>
                </View>
              ) : null}
            </View>
            {templateDisplay.headerMediaUrl ? (
              <View style={[styles.templateHeaderMedia, { borderBottomColor: colors.separator }]}>
                {templateDisplay.headerType === 'IMAGE' ? (
                  <AuthenticatedImage url={templateDisplay.headerMediaUrl} style={styles.templateHeaderImage} />
                ) : templateDisplay.headerType === 'VIDEO' ? (
                  <VideoThumb
                    url={templateDisplay.headerMediaUrl}
                    posterUrl={templateDisplay.headerMediaUrl}
                    name="Video"
                    onPress={() => onVideo?.({ downloadUrl: templateDisplay.headerMediaUrl })}
                  />
                ) : templateDisplay.headerType === 'DOCUMENT' ? (
                  <View style={[styles.templateHeaderDoc, { borderBottomColor: colors.separator }]}>
                    <FileText color={colors.primary} size={20} />
                    <Text style={[styles.templateHeaderDocText, { color: colors.textSecondary }]} numberOfLines={1}>Document</Text>
                  </View>
                ) : templateDisplay.headerText ? (
                  <View style={[styles.templateHeaderTextWrap, { borderBottomColor: colors.separator }]}>
                    <Text style={[styles.templateHeaderText, { color: colors.textSecondary }]}>{templateDisplay.headerText}</Text>
                  </View>
                ) : null}
              </View>
            ) : templateDisplay.headerText ? (
              <View style={[styles.templateHeaderTextWrap, { borderBottomColor: colors.separator }]}>
                <Text style={[styles.templateHeaderText, { color: colors.textSecondary }]}>{templateDisplay.headerText}</Text>
              </View>
            ) : null}
            {templateDisplay.bodyText ? (
              <View style={styles.templateBodyWrap}>
                <Text selectable style={[styles.templateBodyText, { color: colors.text }, templateBodyParts.some((part) => (part.href?.startsWith('tel:') || part.href?.startsWith('mailto:'))) && styles.inlineLinkBody]}>
                  {templateBodyParts.map((part, index) => (part.href?.startsWith('tel:') || part.href?.startsWith('mailto:')) ? (
                    <UnderlinedMessageLink key={index} value={part.value} href={part.href} color={colors.primary} size={fontSize.caption} />
                  ) : part.type === 'url' ? (
                    <Text key={index} style={[styles.link, { color: colors.primary }]} onPress={() => openLink(part.href)}>{part.value}</Text>
                  ) : (
                    <Text key={index}>{part.value}</Text>
                  ))}
                </Text>
              </View>
            ) : null}
            {templateDisplay.footerText ? (
              <Text style={[styles.templateFooter, { color: colors.textSecondary }]}>{templateDisplay.footerText}</Text>
            ) : null}
            {templateDisplay.buttons.length ? (
              <View style={[styles.templateButtons, { borderTopColor: colors.separator }]}>
                {templateDisplay.buttons.map((button: any, index: number) => (
                  <Pressable
                    key={index}
                    style={[styles.templateButton, { borderColor: colors.cardBorder }]}
                    onPress={() => { if (button.type === 'URL' && button.url) openLink(button.url); }}
                  >
                    <Text style={[styles.templateButtonText, { color: colors.primary }]}>{button.label}</Text>
                    {button.type === 'URL' ? <ExternalLink color={colors.primary} size={12} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        {showBody && imageAttachments.length > 0 ? renderBody() : null}
        {imageAttachments.length > 1 ? (
          <View style={styles.imageGrid}>
            {imageAttachments.slice(0, 4).map((attachment: any, index: number) => (
              <View key={attachment.id} style={styles.gridCell}>
                <AuthenticatedImage url={previewUrl(attachment)} style={styles.gridImage} onPress={() => onImage?.(attachment.id)} adaptive />
                {index === 3 && imageAttachments.length > 4 ? (
                  <Pressable style={styles.gridOverflow} onPress={() => onImage?.(attachment.id)} accessibilityRole="button" accessibilityLabel={`Show ${imageAttachments.length - 3} more images`}>
                    <Text style={styles.gridOverflowText}>+{imageAttachments.length - 3}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : imageAttachments.length === 1 ? (
          referralPreview ? (
            <View
              style={styles.referralImageWrap}
              onLayout={({ nativeEvent }) => {
                const width = Math.floor(nativeEvent.layout.width);
                if (width > 0) setReferralImageWidth(width);
              }}
            >
              {singleImage}
            </View>
          ) : singleImage
        ) : null}
        {videoAttachments.map((attachment: any) => (
          <VideoThumb
            key={attachment.id}
            url={videoUrl(attachment)}
            posterUrl={videoPosterUrl(attachment)}
            name={attachment.originalName}
            sizeBytes={attachment.sizeBytes}
            durationMs={attachment.durationMs}
            onPress={() => onVideo?.(attachment)}
          />
        ))}
        {voiceAttachments.length ? (
          <View style={styles.voiceWrap}>
            {voiceAttachments.map((attachment: any) => (
              <VoiceNotePlayer key={attachment.id} url={audioUrl(attachment)} outgoing={outgoing} durationMs={attachment.durationMs} />
            ))}
          </View>
        ) : null}
        {whatsappOrder ? <WhatsappOrderCard order={whatsappOrder} channelId={channelId} onCreateOrder={onCreateOrderFromMessage ? () => onCreateOrderFromMessage(message) : undefined} creatingOrderDraft={creatingOrderDraft} /> : null}
        {whatsappLocation ? (
          <LocationMessageCard location={whatsappLocation} outgoing={outgoing} />
        ) : null}
        {whatsappContacts?.length ? (
          <ContactMessageCard contacts={whatsappContacts} outgoing={outgoing} />
        ) : null}
        {documentAttachments.length ? (
          <View style={styles.docList}>
            {documentAttachments.map((attachment: any) => {
              const docPreviewUrl = documentPreviewUrl(attachment);
              return (
                <Pressable
                  key={attachment.id}
                  onPress={() => void openDocument(attachment)}
                  disabled={openingDocumentId === attachment.id}
                  style={[
                    styles.documentCard,
                    outgoing && styles.documentCardOutgoing,
                    !outgoing && { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                >
                  {docPreviewUrl ? (
                    <View style={[styles.documentPreview, { backgroundColor: colors.surfaceSecondary }]}>
                      <AuthenticatedImage
                        url={docPreviewUrl}
                        style={styles.documentPreviewImage}
                        resizeMode="cover"
                      />
                    </View>
                  ) : null}
                  <View style={styles.documentFooter}>
                    <View style={[styles.documentIcon, outgoing && styles.documentIconOutgoing]}>
                      <FileText color={outgoing ? '#dbeafe' : colors.primary} size={16} />
                    </View>
                    <View style={styles.documentCopy}>
                      <Text numberOfLines={1} style={[styles.fileName, outgoing && styles.outgoingText, !outgoing && { color: colors.text }]}>{attachment.originalName ?? attachment.mediaType ?? 'Document'}</Text>
                      <Text numberOfLines={1} style={[styles.fileMeta, outgoing && styles.outgoingMuted, !outgoing && { color: colors.textSecondary }]}>
                        {attachment.mimeType || attachment.mediaType || 'Document'}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {isTikTokUnsupportedInboundVoice ? (
          <Text style={[styles.missingMedia, !outgoing && { color: colors.textMuted }]}>
            TikTok does not support receiving inbound voice messages through its API.
          </Text>
        ) : null}
        {!showBody && !isTikTokUnsupportedInboundVoice && !templateDisplay && !whatsappLocation && !whatsappContacts?.length && !imageAttachments.length && !videoAttachments.length && !voiceAttachments.length && !documentAttachments.length && ['IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'FILE', 'STICKER'].includes(mediaType) ? (
          <Text style={[styles.missingMedia, outgoing && styles.outgoingMuted, !outgoing && { color: colors.textMuted }]}>Attachment</Text>
        ) : null}
        {!imageAttachments.length && showBody ? renderBody() : null}
        {showLinkPreview ? <LinkPreviewCard url={firstUrl} outgoing={outgoing} /> : null}
        <View style={[styles.metaRow, (isLocationOnlyMessage || isContactOnlyMessage) && styles.embeddedCardMetaRow]}>
          {outgoing && statusMeta ? (
            <Text style={[styles.status, statusMeta.showFailed && styles.statusFailed, statusMeta.showRead && styles.statusSeen]}>
              {statusMeta.showSending ? <ActivityIndicator color="#dbeafe" size={11} /> : statusMeta.showRead ? <CheckCheck color="#7dd3fc" size={13} /> : statusMeta.showDelivered ? <CheckCheck color="#dbeafe" size={13} /> : statusMeta.showSingleTick ? <Check color="#dbeafe" size={13} /> : null}
              {' '}{statusMeta.label}
            </Text>
          ) : null}
          <View style={styles.metaRight}>
            {message.sentAt ? (
              <Text style={[styles.status, outgoing ? styles.outgoingMuted : styles.incomingTime, !outgoing && { color: colors.textMuted }]}>
                {outgoing && message.sender?.userName ? `${message.sender.userName}  ` : ''}
                {new Date(message.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            ) : outgoing && message.sender?.userName ? (
              <Text style={[styles.status, styles.outgoingMuted]}>{message.sender.userName}</Text>
            ) : null}
            {edited ? <Text style={[styles.editedChip, outgoing ? styles.editedOutgoing : styles.editedIncoming, !outgoing && { borderColor: colors.cardBorder, color: colors.textSecondary }]}>Edited</Text> : null}
          </View>
        </View>
        {failedReason ? (
          <Text style={styles.failedText}>Failed to send: {failedReason}</Text>
        ) : null}
        </View>
      </Pressable>
      {canCreateOrderFromMessage && !outgoing ? <Pressable onPress={() => onCreateOrderFromMessage(message)} disabled={creatingOrderDraft} style={[styles.createOrderFromMessage, { backgroundColor: colors.surface, borderColor: colors.cardBorder, opacity: creatingOrderDraft ? 0.65 : 1 }]} accessibilityRole="button" accessibilityLabel="Create order from message" accessibilityState={{ disabled: creatingOrderDraft }}>
        {creatingOrderDraft ? <ActivityIndicator color={colors.primary} size="small" /> : <PackagePlus color={colors.primary} size={17} />}
      </Pressable> : null}
      {hasReactions ? (
        <View style={[styles.reactionRow, outgoing && styles.reactionRowOutgoing]}>
          {reactionItems.map((reaction) => (
            <View key={reaction.emoji} style={[styles.reactionPill, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
              {reaction.count > 1 ? <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{reaction.count}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LocationMessageCard({ location, outgoing }: { location: WhatsappLocation; outgoing: boolean }) {
  const { colors, isDark } = useTheme();
  const styles = createStyles(colors);
  const coordinates = `${location.latitude},${location.longitude}`;
  const googleMapsUrl = location.url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
  const embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(coordinates)}&z=15&output=embed`;
  const embedHtml = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body, iframe { height: 100%; margin: 0; padding: 0; width: 100%; }
      body { overflow: hidden; background: #e8eef7; }
      iframe { border: 0; display: block; }
    </style>
  </head>
  <body>
    <iframe src="${embedUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
  </body>
</html>`;
  const locationLabel = location.name ?? 'Shared location';

  return (
    <View style={[
      styles.locationCard,
      outgoing ? styles.locationCardOutgoing : { backgroundColor: colors.surface, borderColor: colors.cardBorder },
    ]}>
      <View style={[styles.locationMap, { backgroundColor: isDark ? colors.surfaceSecondary : '#e8eef7' }]}>
        <WebView
          source={{ html: embedHtml, baseUrl: 'https://www.google.com' }}
          scrollEnabled={false}
          bounces={false}
          javaScriptEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={styles.locationWebView}
        />
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${locationLabel} in Google Maps`}
          onPress={() => openLink(googleMapsUrl)}
          style={styles.locationMapOverlay}
        >
          <View style={styles.locationMapButton}>
            <MapPin color="#fff" size={13} />
            <Text style={styles.locationMapButtonText}>Open in Google Maps</Text>
          </View>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => openLink(googleMapsUrl)}
        style={({ pressed }) => [
          styles.locationDetails,
          outgoing && styles.locationDetailsOutgoing,
          pressed && styles.locationDetailsPressed,
        ]}
      >
        <MapPin color={outgoing ? '#d1fae5' : colors.primary} size={17} style={styles.locationIcon} />
        <View style={styles.locationCopy}>
          <Text numberOfLines={1} style={[styles.locationTitle, outgoing ? styles.outgoingText : { color: colors.text }]}>{locationLabel}</Text>
          {location.address ? (
            <Text numberOfLines={1} style={[styles.locationAddress, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{location.address}</Text>
          ) : null}
          <Text style={[styles.locationCoordinates, outgoing ? styles.locationCoordinatesOutgoing : { color: colors.textMuted }]}>
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
          </Text>
        </View>
        <ExternalLink color={outgoing ? '#dbeafe' : colors.textMuted} size={15} />
      </Pressable>
    </View>
  );
}

function ContactMessageCard({ contacts, outgoing }: { contacts: WhatsappContactCard[]; outgoing: boolean }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [copiedContactIndex, setCopiedContactIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const title = contacts.length === 1 ? 'Shared contact' : 'Shared contacts';

  async function copyContact(contact: WhatsappContactCard, index: number) {
    await Clipboard.setStringAsync(getContactClipboardText(contact));
    setCopiedContactIndex(index);
    setTimeout(() => {
      setCopiedContactIndex((current) => (current === index ? null : current));
    }, 1400);
  }

  async function copyAllContacts() {
    await Clipboard.setStringAsync(contacts.map(getContactClipboardText).join('\n\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1400);
  }

  return (
    <View style={[
      styles.contactCard,
      outgoing ? styles.contactCardOutgoing : { backgroundColor: colors.surface, borderColor: colors.cardBorder },
    ]}>
      <View style={[styles.contactHeader, outgoing ? styles.contactHeaderOutgoing : { borderBottomColor: colors.cardBorder }]}>
        <View style={[styles.contactHeaderIcon, outgoing ? styles.contactHeaderIconOutgoing : { backgroundColor: colors.surfaceSecondary }]}>
          <ContactRound color={outgoing ? '#d1fae5' : colors.primary} size={15} />
        </View>
        <Text style={[styles.contactHeaderTitle, outgoing ? styles.outgoingText : { color: colors.text }]}>{title}</Text>
        <Pressable
          accessibilityLabel="Copy all contacts"
          onPress={() => void copyAllContacts()}
          hitSlop={8}
          style={[
            styles.contactIconButton,
            outgoing ? styles.contactIconButtonOutgoing : { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          {copiedAll ? <Check color="#10b981" size={15} /> : <Copy color={outgoing ? '#dbeafe' : colors.textMuted} size={15} />}
        </Pressable>
        <View style={[styles.contactCount, outgoing ? styles.contactCountOutgoing : { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.contactCountText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{contacts.length}</Text>
        </View>
      </View>
      {contacts.map((contact, index) => (
        <View
          key={`${contact.displayName}-${index}`}
          style={[
            styles.contactRow,
            index > 0 && styles.contactRowDivider,
            index > 0 && (outgoing ? styles.contactRowDividerOutgoing : { borderTopColor: colors.cardBorder }),
          ]}
        >
          <View style={[styles.contactAvatar, outgoing ? styles.contactAvatarOutgoing : { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.contactAvatarText, { color: outgoing ? '#d1fae5' : colors.primary }]}>{getContactInitials(contact.displayName)}</Text>
          </View>
          <View style={styles.contactBody}>
            <Text numberOfLines={1} style={[styles.contactName, outgoing ? styles.outgoingText : { color: colors.text }]}>{contact.displayName}</Text>
            {contact.organization ? (
              <View style={styles.contactInfoRow}>
                <Building2 color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={1} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{contact.organization}</Text>
              </View>
            ) : null}
            {contact.phones.map((phoneItem, phoneIndex) => (
              <View key={`phone-${phoneItem.value}-${phoneIndex}`} style={styles.contactInfoRow}>
                <Phone color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={1} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>
                  {phoneItem.value}{phoneItem.label ? ` - ${phoneItem.label}` : ''}
                </Text>
              </View>
            ))}
            {contact.emails.map((email, emailIndex) => (
              <View key={`email-${email.value}-${emailIndex}`} style={styles.contactInfoRow}>
                <Mail color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={1} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>
                  {email.value}{email.label ? ` - ${email.label}` : ''}
                </Text>
              </View>
            ))}
            {contact.address ? (
              <View style={styles.contactInfoRow}>
                <MapPin color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={2} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{contact.address}</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={`Copy ${contact.displayName}`}
            onPress={() => void copyContact(contact, index)}
            hitSlop={8}
            style={[
              styles.contactCopyButton,
              outgoing ? styles.contactCopyButtonOutgoing : { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            {copiedContactIndex === index ? <Check color="#10b981" size={15} /> : <Copy color={outgoing ? '#dbeafe' : colors.textMuted} size={15} />}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function ReplyPreviewBody({ text, mediaType, outgoing, colors }: { text?: string | null; mediaType?: string | null; outgoing: boolean; colors: { textSecondary: string } }) {
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

const IMAGE_FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];
const AUDIO_FILE_EXTENSIONS = ['.aac', '.amr', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.webm'];

function isAudioAttachment(attachment: any): boolean {
  const mediaType = (attachment?.mediaType ?? '').toUpperCase();
  if (mediaType === 'VOICE' || mediaType === 'AUDIO') return true;
  const mime = (attachment?.mimeType ?? '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  const name = (attachment?.originalName ?? '').toLowerCase();
  if (name.startsWith('voice-note-')) return true;
  if (AUDIO_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return false;
}

function isImageAttachment(attachment: any): boolean {
  const mediaType = (attachment?.mediaType ?? '').toUpperCase();
  if (mediaType === 'IMAGE' || mediaType === 'STICKER') return true;
  const mime = (attachment?.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  // WhatsApp images sent as document often arrive as DOCUMENT/FILE with an
  // image filename (or no mime at all) — still render them inline as images.
  const name = (attachment?.originalName ?? '').toLowerCase();
  if (IMAGE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return false;
}

function isVideoAttachment(attachment: any): boolean {
  const mediaType = (attachment?.mediaType ?? '').toUpperCase();
  if (mediaType === 'VIDEO') return true;
  const mime = (attachment?.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = (attachment?.originalName ?? '').toLowerCase();
  if (['.mp4', '.mov', '.webm'].some((ext) => name.endsWith(ext))) return true;
  return false;
}

function previewUrl(attachment: any): string {
  if (typeof attachment.localPreviewUri === 'string' && attachment.localPreviewUri) return attachment.localPreviewUri;
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  // Keep the image preview URL stable across optimistic-to-server message
  // reconciliation. The full download endpoint can be slower and may reload
  // the bubble while the preview derivative is already available.
  const value = attachment.previewUrl ?? attachment.thumbnailUrl ?? attachment.downloadUrl;
  return resolveMediaUrl(base, value);
}

function videoPosterUrl(attachment: any): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  if (attachment.previewProcessingStatus === 'FAILED') return '';
  const value = attachment.thumbnailUrl ?? attachment.previewUrl;
  return resolveMediaUrl(base, value);
}

function documentPreviewUrl(attachment: any): string | null {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  const value = attachment.previewUrl ?? attachment.thumbnailUrl;
  return value ? resolveMediaUrl(base, value) : null;
}

function audioUrl(attachment: any): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  return resolveMediaUrl(base, attachment.downloadUrl ?? attachment.previewUrl ?? attachment.thumbnailUrl);
}

function videoUrl(attachment: any): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  return resolveMediaUrl(base, attachment.downloadUrl ?? attachment.previewUrl ?? attachment.thumbnailUrl);
}

function resolveMediaUrl(base: string, value?: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value, `${base}/`);
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
      const apiBase = new URL(base);
      return `${apiBase.origin}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return `${base.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
  }
}

const createStyles = createThemedStyles((colors) => StyleSheet.create({
  systemWrap: { alignItems: 'center', alignSelf: 'stretch' },
  systemPill: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.infoBorder, borderRadius: radius.pill, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.md, paddingVertical: spacing.compact, shadowColor: '#2563eb', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8 },
  systemPillMissed: { backgroundColor: colors.surface, borderColor: colors.warningBorder },
  systemIconCircle: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.inset, height: 20, justifyContent: 'center', width: 20 },
  systemIconCircleMissed: { backgroundColor: colors.amberSoft },
  systemText: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.medium },
  systemTextMissed: { color: colors.warning },
  systemTime: { color: colors.textMuted, fontSize: fontSize.compact },
  wrap: { alignSelf: 'flex-start', maxWidth: '82%', minWidth: 0 },
  wrapWithCreateOrder: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact, maxWidth: '90%' },
  bubblePressableWithAction: { flexShrink: 1, minWidth: 0 },
  createOrderFromMessage: { alignItems: 'center', borderRadius: radius.control, borderWidth: borderWidth.thin, height: 32, justifyContent: 'center', width: 32, shadowColor: '#2563eb', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 },
  wrapOutgoing: { alignSelf: 'flex-end' },
  wrapWithReactions: { marginBottom: spacing.sm },
  bubble: {
    paddingHorizontal: spacing.inset,
    paddingVertical: spacing.control,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 1,
  },
  bubbleIncoming: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderBottomLeftRadius: radius.compact,
  },
  bubbleOutgoing: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.compact,
  },
  postchatRating: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xxs },
  postchatStar: { fontSize: fontSize.heading, lineHeight: lineHeight.body },
  postchatScore: { fontSize: fontSize.compact, fontWeight: fontWeight.semibold, marginLeft: spacing.xs },
  linkPreviewBubble: { width: '100%' },
  incoming: { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: borderWidth.thin },
  referralBubble: { borderColor: colors.warningBorder, borderWidth: borderWidth.thin, paddingHorizontal: spacing.control, paddingVertical: spacing.sm + spacing.hairline },
  outgoing: { backgroundColor: colors.primary },
  embeddedCardOnlyBubble: { backgroundColor: 'transparent', borderWidth: borderWidth.none, elevation: 0, paddingHorizontal: spacing.none, paddingVertical: spacing.none, shadowOpacity: 0 },
  incomingTemplate: { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: borderWidth.thin, padding: spacing.compact },
  outgoingTemplate: { backgroundColor: colors.primary, padding: spacing.compact },
  messageText: { color: colors.text, fontSize: fontSize.body },
  outgoingText: { color: colors.primaryText, fontSize: fontSize.body },
  emojiOnly: { fontSize: fontSize.emoji, lineHeight: lineHeight.emoji },
  // RN 0.88 Android can crash drawing decorated spans beyond numberOfLines.
  // Keep links colored and tappable without invoking that native drawing path.
  link: { color: colors.primary, textDecorationLine: Platform.OS === 'android' ? 'none' : 'underline' },
  outgoingLink: { color: '#eaf1ff' },
  inlineLinkBody: { lineHeight: 24, paddingBottom: 4 },
  readMore: { color: colors.primary, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  readMoreRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.tight, marginTop: spacing.xs },
  broadcastBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radius.compact, flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.compact, paddingHorizontal: spacing.compact, paddingVertical: spacing.tight },
  broadcastBadgeText: { color: colors.primaryText, fontSize: fontSize.tiny, fontWeight: fontWeight.bold, letterSpacing: letterSpacing.overline, textTransform: 'uppercase' },
  referralWrap: { width: '100%' },
  referralWrapWithContent: { marginBottom: spacing.control },
  referralImageWrap: { width: '100%', marginTop: spacing.sm },
  outgoingMuted: { color: '#dbeafe' },
  quoted: { alignSelf: 'stretch', backgroundColor: '#ffffff22', borderColor: '#ffffff55', borderRadius: radius.md, borderWidth: borderWidth.thin, marginBottom: spacing.sm, maxWidth: '100%', paddingHorizontal: spacing.control, paddingVertical: spacing.compact + spacing.hairline },
  quotedPressed: { opacity: 0.6 },
  quotedIncoming: { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder },
  quotedName: { color: colors.primaryText, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  quotedNameIncoming: { color: colors.primary },
  quotedRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs + spacing.hairline },
  quotedThumb: { borderRadius: radius.compact, height: 40, width: 40 },
  quotedType: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.compact, minWidth: 0 },
  quotedText: { color: '#eef2ff', flex: 1, fontSize: fontSize.small },
  quotedTextIncoming: { color: colors.textSecondary },
  templateCard: { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.lg, borderWidth: borderWidth.thin, overflow: 'hidden' },
  templateCardOutgoing: { borderColor: 'rgba(255,255,255,0.2)' },
  templateCardHeader: { alignItems: 'center', borderBottomColor: colors.separator, borderBottomWidth: borderWidth.thin, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  templateBadge: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  templateBadgeText: { color: colors.primary, fontSize: fontSize.tiny, fontWeight: fontWeight.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  templateCategoryBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  templateCategoryText: { color: colors.primary, fontSize: fontSize.badge, fontWeight: fontWeight.bold, letterSpacing: 0.3 },
  templateHeaderMedia: { borderBottomColor: colors.separator, borderBottomWidth: borderWidth.thin },
  templateHeaderImage: { height: 140, width: '100%' },
  templateHeaderDoc: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  templateHeaderDocText: { color: colors.text, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  templateHeaderTextWrap: { borderBottomColor: colors.separator, borderBottomWidth: borderWidth.thin, paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  templateHeaderText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.text },
  templateBodyWrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  templateBodyText: { fontSize: fontSize.caption, lineHeight: lineHeight.section, color: colors.text },
  templateFooter: { color: colors.textSecondary, fontSize: fontSize.compact, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  templateButtons: { borderTopColor: colors.separator, borderTopWidth: borderWidth.thin, gap: spacing.compact, paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  templateButton: { alignItems: 'center', borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.compact, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  templateButtonText: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  image: { borderRadius: radius.xl, backgroundColor: colors.surfaceSecondary },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.tight, borderRadius: radius.xl, overflow: 'hidden', width: 250 },
  gridCell: { height: 123, position: 'relative', width: 123 },
  gridImage: { width: 123, height: 123 },
  gridOverflow: { ...StyleSheet.absoluteFill, alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.58)', justifyContent: 'center' },
  gridOverflowText: { color: colors.primaryText, fontSize: fontSize.display, fontWeight: fontWeight.bold },
  voiceWrap: { gap: spacing.compact, maxWidth: 260 },
  docList: { gap: spacing.compact },
  documentCard: { borderColor: colors.cardBorder, borderRadius: radius.control, borderWidth: borderWidth.thin, overflow: 'hidden', width: 250 },
  documentCardOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.24)' },
  documentPreview: { backgroundColor: colors.background, height: 170, width: '100%' },
  documentPreviewImage: { height: '100%', width: '100%' },
  documentFooter: { alignItems: 'center', flexDirection: 'row', gap: spacing.control, paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  documentIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.chip, height: 36, justifyContent: 'center', width: 36 },
  documentIconOutgoing: { backgroundColor: 'rgba(255,255,255,0.16)' },
  documentCopy: { flex: 1, minWidth: 0 },
  locationCard: { borderColor: colors.cardBorder, borderRadius: radius.control, borderWidth: borderWidth.thin, overflow: 'hidden', width: 250 },
  locationCardOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.24)' },
  locationMap: { height: 145, overflow: 'hidden', width: '100%' },
  locationWebView: { backgroundColor: 'transparent', height: '100%', width: '100%' },
  locationMapOverlay: { bottom: 0, left: 0, padding: spacing.sm, position: 'absolute', right: 0, top: 0, alignItems: 'flex-end', justifyContent: 'flex-end' },
  locationMapButton: { alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.78)', borderRadius: radius.pill, flexDirection: 'row', gap: spacing.xs + spacing.hairline, paddingHorizontal: spacing.control, paddingVertical: spacing.compact },
  locationMapButtonText: { color: colors.primaryText, fontSize: fontSize.compact, fontWeight: fontWeight.bold },
  locationDetails: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.control, paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  locationDetailsOutgoing: { backgroundColor: 'rgba(255,255,255,0.03)' },
  locationDetailsPressed: { opacity: 0.72 },
  locationIcon: { marginTop: spacing.xxs },
  locationCopy: { flex: 1, minWidth: 0 },
  locationTitle: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  locationAddress: { fontSize: fontSize.compact, marginTop: spacing.xxs },
  locationCoordinates: { color: colors.textMuted, fontSize: fontSize.tiny, marginTop: spacing.tight },
  locationCoordinatesOutgoing: { color: 'rgba(255,255,255,0.58)' },
  contactCard: { borderColor: colors.cardBorder, borderRadius: radius.control, borderWidth: borderWidth.thin, overflow: 'hidden', width: 250 },
  contactCardOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.24)' },
  contactHeader: { alignItems: 'center', borderBottomColor: colors.cardBorder, borderBottomWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.control, paddingVertical: spacing.sm },
  contactHeaderOutgoing: { borderBottomColor: 'rgba(255,255,255,0.18)' },
  contactHeaderIcon: { alignItems: 'center', borderRadius: radius.inset, height: 28, justifyContent: 'center', width: 28 },
  contactHeaderIconOutgoing: { backgroundColor: 'rgba(16,185,129,0.2)' },
  contactHeaderTitle: { flex: 1, fontSize: fontSize.small, fontWeight: fontWeight.extrabold },
  contactIconButton: { alignItems: 'center', borderRadius: radius.chip, height: 26, justifyContent: 'center', width: 26 },
  contactIconButtonOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)' },
  contactCount: { alignItems: 'center', borderRadius: radius.pill, height: 22, justifyContent: 'center', minWidth: 22, paddingHorizontal: spacing.compact + spacing.hairline },
  contactCountOutgoing: { backgroundColor: 'rgba(255,255,255,0.16)' },
  contactCountText: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold },
  contactRow: { flexDirection: 'row', gap: spacing.sm + spacing.hairline, paddingHorizontal: spacing.control, paddingVertical: spacing.control + spacing.hairline },
  contactRowDivider: { borderTopWidth: borderWidth.thin },
  contactRowDividerOutgoing: { borderTopColor: 'rgba(255,255,255,0.18)' },
  contactAvatar: { alignItems: 'center', borderRadius: radius.xl, height: 36, justifyContent: 'center', width: 36 },
  contactAvatarOutgoing: { backgroundColor: 'rgba(16,185,129,0.2)' },
  contactAvatarText: { fontSize: fontSize.small, fontWeight: fontWeight.extrabold },
  contactBody: { flex: 1, minWidth: 0, paddingRight: spacing.xxs },
  contactName: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  contactInfoRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs + spacing.hairline, marginTop: spacing.xs },
  contactInfoText: { flex: 1, fontSize: fontSize.compact, minWidth: 0 },
  contactCopyButton: { alignItems: 'center', borderRadius: radius.chip, height: 26, justifyContent: 'center', width: 26 },
  contactCopyButtonOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)' },
  file: { alignItems: 'center', flexDirection: 'row', gap: spacing.control, paddingVertical: spacing.xxs },
  fileName: { color: colors.text, flex: 1, fontSize: fontSize.section },
  fileMeta: { color: colors.textSecondary, fontSize: fontSize.compact, marginTop: spacing.xxs },
  missingMedia: { color: colors.textMuted, fontSize: fontSize.caption, fontStyle: 'italic' },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact, marginTop: spacing.compact },
  embeddedCardMetaRow: { paddingHorizontal: spacing.sm },
  metaRight: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact, marginLeft: 'auto' },
  status: { color: '#dbeafe', fontSize: fontSize.compact },
  statusSeen: { color: '#7dd3fc' },
  statusFailed: { color: '#fda4af' },
  incomingTime: { color: colors.textMuted },
  editedChip: { borderRadius: radius.pill, fontSize: fontSize.badge, paddingHorizontal: spacing.compact, paddingVertical: spacing.hairline },
  editedOutgoing: { borderColor: '#ffffff33', borderWidth: borderWidth.thin, color: '#dbeafe' },
  editedIncoming: { borderColor: colors.cardBorder, borderWidth: borderWidth.thin, color: colors.textSecondary },
  failedText: { color: '#fda4af', fontSize: fontSize.compact, marginTop: spacing.xs },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.compact,
    marginTop: -10,
    paddingHorizontal: spacing.xxs,
    zIndex: 2,
  },
  reactionRowOutgoing: { justifyContent: 'flex-end' },
  reactionPill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
    elevation: 2,
    flexDirection: 'row',
    gap: spacing.tight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  reactionEmoji: { fontSize: fontSize.section },
  reactionCount: { color: colors.textSecondary, fontSize: fontSize.compact, fontWeight: fontWeight.bold },
}));
