import { UnderlinedMessageLink } from './message-bubble/UnderlinedMessageLink';
import { SystemMessageBubble } from './message-bubble/SystemMessageBubble';
import { LocationMessageCard } from './message-bubble/LocationMessageCard';
import { ContactMessageCard } from './message-bubble/ContactMessageCard';
import { ReplyPreviewBody } from './message-bubble/ReplyPreviewBody';
import { createStyles } from './message-bubble/styles';
import { openLink } from './message-bubble/links';
import { isAudioAttachment, isImageAttachment, isVideoAttachment, previewUrl, videoPosterUrl, documentPreviewUrl, audioUrl, videoUrl, resolveMediaUrl } from './message-bubble/media';
import { borderWidth, fontSize, fontWeight, lineHeight, radius, spacing } from '../theme/tokens';
import { Check, CheckCheck, FileText, ExternalLink, ChevronDown, ChevronUp, Megaphone, Sparkles, PackagePlus } from 'lucide-react-native';
import { useState, useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
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
  getMessageReferralPreview,
  getWhatsappLocation,
  getWhatsappContacts,
  getWhatsappOrder,
  type WhatsappLocation,
  ATTACHMENT_ONLY_PLACEHOLDERS,
} from '../lib/inbox-utils';
import { LinkPreviewCard } from './LinkPreviewCard';
import { MessageReferralPreviewCard } from './MessageReferralPreviewCard';
import { WhatsappOrderCard } from './WhatsappOrderCard';
import { findFirstUrlInText } from '../lib/link-preview';
import { openDownloadedAttachment } from '../lib/open-attachment';
import { useTheme } from '../theme/ThemeContext';

const COLLAPSED_LINE_COUNT = 4;

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
      onLongPress={() => onLongPress?.(imageAttachments[0])}
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
                <AuthenticatedImage url={previewUrl(attachment)} style={styles.gridImage} onPress={() => onImage?.(attachment.id)} onLongPress={() => onLongPress?.(attachment)} adaptive />
                {index === 3 && imageAttachments.length > 4 ? (
                  <Pressable style={styles.gridOverflow} onPress={() => onImage?.(attachment.id)} onLongPress={() => onLongPress?.(attachment)} delayLongPress={350} accessibilityRole="button" accessibilityLabel={`Show ${imageAttachments.length - 3} more images`}>
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
