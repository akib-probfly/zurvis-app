import * as Clipboard from 'expo-clipboard';
import { Check, CheckCheck, FileText, ExternalLink, ChevronDown, ChevronUp, Megaphone, Sparkles, Image as ImageIcon, Video, Mic, MapPin, ContactRound, Copy, Phone, Mail, Building2, PackagePlus } from 'lucide-react-native';
import { useEffect, useState, useMemo } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  const mediaType = (message.type ?? '').toUpperCase();
  const isInstagramSharedPostTemplate =
    String(channelType ?? '').toUpperCase() === 'INSTAGRAM' &&
    isInstagramSharedPostTemplateMessage(message);
  const templateDisplay = isTemplateLikeMessage(message) && !isInstagramSharedPostTemplate ? getTemplateMessageDisplay(message) : null;
  const templateHeaderUrl = templateDisplay?.headerMediaUrl ?? null;
  const templateBodyParts = useMemo(
    () => templateDisplay?.bodyText ? parseMessageTextParts(templateDisplay.bodyText) : [],
    [templateDisplay?.bodyText],
  );
  const messageText = typeof message.text === 'string' ? message.text : '';
  const hasStructuredOrderDetails = /(?:^|\n)\s*name\s*:\s*\S+/im.test(messageText) &&
    /(?:^|\n)\s*address\s*:\s*\S+/im.test(messageText) &&
    /(?:^|\n)\s*(?:number|phone)\s*:\s*\S+/im.test(messageText);
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
  const { imageAttachments, voiceAttachments, videoAttachments, documentAttachments } = useMemo(() => {
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
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  useEffect(() => {
    setExpanded(false);
    setCanExpand(false);
  }, [message.id]);

  function renderBody() {
    if (!body) return null;
    if (isEmojiOnlyMessage(body)) {
      return <Text style={[styles.emojiOnly, outgoing && styles.outgoingText, !outgoing && { color: colors.text }]}>{body}</Text>;
    }
    const clamp = canExpand && !expanded;
    return (
      <View>
        <Text
          style={outgoing ? styles.outgoingText : [styles.messageText, { color: colors.text }]}
          numberOfLines={clamp ? COLLAPSED_LINE_COUNT : undefined}
          onTextLayout={(e) => {
            if (!canExpand && e.nativeEvent.lines.length > COLLAPSED_LINE_COUNT) setCanExpand(true);
          }}
        >
          {bodyParts.map((part, index) => part.type === 'url' ? (
            <Text key={index} style={[styles.link, outgoing && styles.outgoingLink, !outgoing && { color: colors.primary }]} onPress={() => openLink(part.href)}>{part.value}</Text>
          ) : (
            <Text key={index}>{part.value}</Text>
          ))}
        </Text>
        {canExpand ? (
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6} style={styles.readMoreRow}>
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
          <View style={{ gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FileText size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Post-chat form</Text>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{postchatForm.formName}</Text>
              </View>
            </View>
            {postchatForm.values.length ? postchatForm.values.map((field) => (
              <View key={field.id} style={{ gap: 3 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>{field.label}</Text>
                {field.type === 'RATING' ? (
                  <View style={styles.postchatRating} accessibilityLabel={`${Math.min(5, Math.max(0, Number.parseInt(field.value, 10) || 0))} out of 5 stars`}>
                    {Array.from({ length: 5 }, (_, index) => {
                      const rating = Math.min(5, Math.max(0, Number.parseInt(field.value, 10) || 0));
                      return <Text key={index} style={[styles.postchatStar, { color: index < rating ? '#f59e0b' : colors.cardBorder }]}>{'★'}</Text>;
                    })}
                    <Text style={[styles.postchatScore, { color: colors.textSecondary }]}>{Math.min(5, Math.max(0, Number.parseInt(field.value, 10) || 0))}/5</Text>
                  </View>
                ) : <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{field.value}</Text>}
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
                <Text selectable style={[styles.templateBodyText, { color: colors.text }]}>
                  {templateBodyParts.map((part, index) => part.type === 'url' ? (
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

const styles = StyleSheet.create({
  systemWrap: { alignItems: 'center', alignSelf: 'stretch' },
  systemPill: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)', borderColor: '#e0f2fe', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 6, shadowColor: '#2563eb', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8 },
  systemPillMissed: { backgroundColor: 'rgba(255,255,255,0.85)', borderColor: '#fef3c7' },
  systemIconCircle: { alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: 10, height: 20, justifyContent: 'center', width: 20 },
  systemIconCircleMissed: { backgroundColor: '#fffbeb' },
  systemText: { color: '#475569', fontSize: 12, fontWeight: '500' },
  systemTextMissed: { color: '#d97706' },
  systemTime: { color: '#94a3b8', fontSize: 11 },
  wrap: { alignSelf: 'flex-start', maxWidth: '82%', minWidth: 0 },
  wrapWithCreateOrder: { alignItems: 'center', flexDirection: 'row', gap: 6, maxWidth: '90%' },
  bubblePressableWithAction: { flexShrink: 1, minWidth: 0 },
  createOrderFromMessage: { alignItems: 'center', borderRadius: 16, borderWidth: 1, height: 32, justifyContent: 'center', width: 32, shadowColor: '#2563eb', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 },
  wrapOutgoing: { alignSelf: 'flex-end' },
  wrapWithReactions: { marginBottom: 8 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 1,
  },
  bubbleIncoming: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 6,
  },
  bubbleOutgoing: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 6,
  },
  postchatRating: { alignItems: 'center', flexDirection: 'row', gap: 2, marginTop: 2 },
  postchatStar: { fontSize: 18, lineHeight: 22 },
  postchatScore: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  linkPreviewBubble: { width: '100%' },
  incoming: { backgroundColor: '#fff', borderColor: '#d7e6fb', borderWidth: 1 },
  referralBubble: { borderColor: '#f6d78d', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9 },
  outgoing: { backgroundColor: '#315efb' },
  embeddedCardOnlyBubble: { backgroundColor: 'transparent', borderWidth: 0, elevation: 0, paddingHorizontal: 0, paddingVertical: 0, shadowOpacity: 0 },
  incomingTemplate: { backgroundColor: '#fff', borderColor: '#d7e6fb', borderWidth: 1, padding: 6 },
  outgoingTemplate: { backgroundColor: '#315efb', padding: 6 },
  messageText: { color: '#334155', fontSize: 15 },
  outgoingText: { color: '#fff', fontSize: 15 },
  emojiOnly: { fontSize: 44, lineHeight: 52 },
  // RN 0.88 Android can crash drawing decorated spans beyond numberOfLines.
  // Keep links colored and tappable without invoking that native drawing path.
  link: { color: '#2563eb', textDecorationLine: Platform.OS === 'android' ? 'none' : 'underline' },
  outgoingLink: { color: '#eaf1ff' },
  readMore: { color: '#2563eb', fontSize: 12, fontWeight: '600' },
  readMoreRow: { alignItems: 'center', flexDirection: 'row', gap: 3, marginTop: 4 },
  broadcastBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#315efb', borderRadius: 6, flexDirection: 'row', gap: 4, marginBottom: 6, paddingHorizontal: 6, paddingVertical: 3 },
  broadcastBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  referralWrap: { width: '100%' },
  referralWrapWithContent: { marginBottom: 10 },
  referralImageWrap: { width: '100%', marginTop: 8 },
  outgoingMuted: { color: '#dbeafe' },
  quoted: { alignSelf: 'stretch', backgroundColor: '#ffffff22', borderColor: '#ffffff55', borderRadius: 12, borderWidth: 1, marginBottom: 8, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 7 },
  quotedPressed: { opacity: 0.6 },
  quotedIncoming: { backgroundColor: '#f1f5f9', borderColor: '#dbe4f1' },
  quotedName: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  quotedNameIncoming: { color: '#2563eb' },
  quotedRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 5 },
  quotedThumb: { borderRadius: 6, height: 40, width: 40 },
  quotedType: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 6, minWidth: 0 },
  quotedText: { color: '#eef2ff', flex: 1, fontSize: 12 },
  quotedTextIncoming: { color: '#526987' },
  templateCard: { backgroundColor: '#fff', borderColor: '#d7e6fb', borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  templateCardOutgoing: { borderColor: 'rgba(255,255,255,0.2)' },
  templateCardHeader: { alignItems: 'center', borderBottomColor: '#e5e7eb', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  templateBadge: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  templateBadgeText: { color: '#2563eb', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  templateCategoryBadge: { backgroundColor: '#eef4ff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  templateCategoryText: { color: '#2563eb', fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  templateHeaderMedia: { borderBottomColor: '#e5e7eb', borderBottomWidth: 1 },
  templateHeaderImage: { height: 140, width: '100%' },
  templateHeaderDoc: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 12 },
  templateHeaderDocText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  templateHeaderTextWrap: { borderBottomColor: '#e5e7eb', borderBottomWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  templateHeaderText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  templateBodyWrap: { paddingHorizontal: 12, paddingVertical: 10 },
  templateBodyText: { fontSize: 13, lineHeight: 20, color: '#334155' },
  templateFooter: { color: '#64748b', fontSize: 11, paddingHorizontal: 12, paddingBottom: 8 },
  templateButtons: { borderTopColor: '#e5e7eb', borderTopWidth: 1, gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  templateButton: { alignItems: 'center', borderColor: '#d7e6fb', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  templateButtonText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  image: { borderRadius: 18, backgroundColor: '#e8eef7' },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 18, overflow: 'hidden', width: 250 },
  gridCell: { height: 123, position: 'relative', width: 123 },
  gridImage: { width: 123, height: 123 },
  gridOverflow: { ...StyleSheet.absoluteFill, alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.58)', justifyContent: 'center' },
  gridOverflowText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  voiceWrap: { gap: 6, maxWidth: 260 },
  docList: { gap: 6 },
  documentCard: { borderColor: '#d7e6fb', borderRadius: 16, borderWidth: 1, overflow: 'hidden', width: 250 },
  documentCardOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.24)' },
  documentPreview: { backgroundColor: '#f8fafc', height: 170, width: '100%' },
  documentPreviewImage: { height: '100%', width: '100%' },
  documentFooter: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  documentIcon: { alignItems: 'center', backgroundColor: '#eef4ff', borderRadius: 13, height: 36, justifyContent: 'center', width: 36 },
  documentIconOutgoing: { backgroundColor: 'rgba(255,255,255,0.16)' },
  documentCopy: { flex: 1, minWidth: 0 },
  locationCard: { borderColor: '#d7e6fb', borderRadius: 16, borderWidth: 1, overflow: 'hidden', width: 250 },
  locationCardOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.24)' },
  locationMap: { height: 145, overflow: 'hidden', width: '100%' },
  locationWebView: { backgroundColor: 'transparent', height: '100%', width: '100%' },
  locationMapOverlay: { bottom: 0, left: 0, padding: 8, position: 'absolute', right: 0, top: 0, alignItems: 'flex-end', justifyContent: 'flex-end' },
  locationMapButton: { alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.78)', borderRadius: 999, flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 6 },
  locationMapButtonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  locationDetails: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  locationDetailsOutgoing: { backgroundColor: 'rgba(255,255,255,0.03)' },
  locationDetailsPressed: { opacity: 0.72 },
  locationIcon: { marginTop: 2 },
  locationCopy: { flex: 1, minWidth: 0 },
  locationTitle: { fontSize: 13, fontWeight: '700' },
  locationAddress: { fontSize: 11, marginTop: 2 },
  locationCoordinates: { color: '#94a3b8', fontSize: 10, marginTop: 3 },
  locationCoordinatesOutgoing: { color: 'rgba(255,255,255,0.58)' },
  contactCard: { borderColor: '#d7e6fb', borderRadius: 16, borderWidth: 1, overflow: 'hidden', width: 250 },
  contactCardOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.24)' },
  contactHeader: { alignItems: 'center', borderBottomColor: '#d7e6fb', borderBottomWidth: 1, flexDirection: 'row', gap: 8, minHeight: 48, paddingHorizontal: 10, paddingVertical: 8 },
  contactHeaderOutgoing: { borderBottomColor: 'rgba(255,255,255,0.18)' },
  contactHeaderIcon: { alignItems: 'center', borderRadius: 10, height: 28, justifyContent: 'center', width: 28 },
  contactHeaderIconOutgoing: { backgroundColor: 'rgba(16,185,129,0.2)' },
  contactHeaderTitle: { flex: 1, fontSize: 12, fontWeight: '800' },
  contactIconButton: { alignItems: 'center', borderRadius: 13, height: 26, justifyContent: 'center', width: 26 },
  contactIconButtonOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)' },
  contactCount: { alignItems: 'center', borderRadius: 999, height: 22, justifyContent: 'center', minWidth: 22, paddingHorizontal: 7 },
  contactCountOutgoing: { backgroundColor: 'rgba(255,255,255,0.16)' },
  contactCountText: { fontSize: 10, fontWeight: '700' },
  contactRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 10, paddingVertical: 11 },
  contactRowDivider: { borderTopWidth: 1 },
  contactRowDividerOutgoing: { borderTopColor: 'rgba(255,255,255,0.18)' },
  contactAvatar: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  contactAvatarOutgoing: { backgroundColor: 'rgba(16,185,129,0.2)' },
  contactAvatarText: { fontSize: 12, fontWeight: '800' },
  contactBody: { flex: 1, minWidth: 0, paddingRight: 2 },
  contactName: { fontSize: 13, fontWeight: '700' },
  contactInfoRow: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 4 },
  contactInfoText: { flex: 1, fontSize: 11, minWidth: 0 },
  contactCopyButton: { alignItems: 'center', borderRadius: 13, height: 26, justifyContent: 'center', width: 26 },
  contactCopyButtonOutgoing: { backgroundColor: 'rgba(255,255,255,0.12)' },
  file: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 2 },
  fileName: { color: '#17233a', flex: 1, fontSize: 14 },
  fileMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },
  missingMedia: { color: '#94a3b8', fontSize: 13, fontStyle: 'italic' },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 6 },
  embeddedCardMetaRow: { paddingHorizontal: 8 },
  metaRight: { alignItems: 'center', flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  status: { color: '#dbeafe', fontSize: 11 },
  statusSeen: { color: '#7dd3fc' },
  statusFailed: { color: '#fda4af' },
  incomingTime: { color: '#94a3b8' },
  editedChip: { borderRadius: 999, fontSize: 9, paddingHorizontal: 6, paddingVertical: 1 },
  editedOutgoing: { borderColor: '#ffffff33', borderWidth: 1, color: '#dbeafe' },
  editedIncoming: { borderColor: '#dbe4f1', borderWidth: 1, color: '#64748b' },
  failedText: { color: '#fda4af', fontSize: 11, marginTop: 4 },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: -10,
    paddingHorizontal: 2,
    zIndex: 2,
  },
  reactionRowOutgoing: { justifyContent: 'flex-end' },
  reactionPill: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
    borderRadius: 999,
    borderWidth: 1,
    elevation: 2,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { color: '#475569', fontSize: 11, fontWeight: '700' },
});
