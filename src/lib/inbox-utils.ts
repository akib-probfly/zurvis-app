import type { ConversationAssignmentEvent, ConversationAssignmentMember, ConversationCallSession } from '../api/inbox';

const EMOJI_ONLY_MESSAGE_PATTERN = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u200d|\ufe0f|\s)+$/u;

export type MessageLike = {
  id: string;
  direction?: string;
  senderType?: string | null;
  type?: string;
  text?: string | null;
  deliveryStatus?: string;
  failureReason?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  templateName?: string | null;
  templateComponentsJson?: unknown;
  replyToMessageId?: string | null;
  replyTo?: { sender?: { userName?: string | null; displayName?: string | null } | null; text?: string | null } | null;
  senderWorkspaceMemberId?: string | null;
  sentAt?: string | null;
  createdAt?: string;
  metadata?: any;
  attachments?: Array<{ id: string; mediaType: string; mimeType?: string | null; originalName?: string | null; caption?: string | null; previewUrl?: string | null; thumbnailUrl?: string | null; downloadUrl?: string; durationMs?: number | null }>;
};

export function getInitials(value?: string | null): string {
  const parts = (value ?? '?').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]);
  return (parts.join('') || '?').toUpperCase();
}

export function isEmojiOnlyMessage(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  const emojiMatches = trimmed.match(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu) ?? [];
  if (emojiMatches.length === 0 || emojiMatches.length > 3) return false;
  return EMOJI_ONLY_MESSAGE_PATTERN.test(trimmed);
}

export const ATTACHMENT_ONLY_PLACEHOLDERS = new Set(['[image]', '[video]', '[audio]', '[voice note]', '[document]', '[location]', '[sticker]', '[reaction]', '[template]', '[attachment]']);

export type MessageTextPart = { type: 'text' | 'url'; value: string; href?: string };
const URL_PATTERN = /(^|[^\w@])((?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:\/[\w!#%&'()*+,./:;=?@~-]*)?)/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type WhatsappLocation = {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
  url: string | null;
};

export type WhatsappContactCard = {
  displayName: string;
  phones: Array<{ value: string; label: string | null }>;
  emails: Array<{ value: string; label: string | null }>;
  organization: string | null;
  address: string | null;
  url: string | null;
};

export type WhatsappOrderItem = {
  productRetailerId: string;
  quantity: number;
  itemPrice: number | null;
  currency: string | null;
  lineTotal: number | null;
};

export type WhatsappOrder = {
  catalogId: string | null;
  text: string | null;
  items: WhatsappOrderItem[];
  totalQuantity: number;
  totalPrice: number | null;
  currency: string | null;
};

function metadataRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

export function getWhatsappOrder(message: { metadata?: unknown }): WhatsappOrder | null {
  const metadata = metadataRecord(message.metadata);
  const whatsappContent = metadataRecord(metadata?.whatsappContent);
  const rawPayload = metadataRecord(metadata?.payload);
  const rawMessage = metadataRecord(rawPayload?.message);
  const rawOrder = metadataRecord(whatsappContent?.order) ?? metadataRecord(rawMessage?.order);
  if (!rawOrder) return null;

  const items = (Array.isArray(rawOrder.product_items) ? rawOrder.product_items : [])
    .map((rawItem: unknown) => {
      const item = metadataRecord(rawItem);
      if (!item) return null;
      const productRetailerId = typeof item.product_retailer_id === 'string' ? item.product_retailer_id : null;
      if (!productRetailerId) return null;
      const parsedQuantity = Number(item.quantity ?? 1);
      const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
      const parsedPrice = Number(item.item_price);
      const itemPrice = Number.isFinite(parsedPrice) ? parsedPrice : null;
      return {
        productRetailerId,
        quantity,
        itemPrice,
        currency: typeof item.currency === 'string' ? item.currency.toUpperCase() : null,
        lineTotal: itemPrice === null ? null : itemPrice * quantity,
      };
    })
    .filter((item: WhatsappOrderItem | null): item is WhatsappOrderItem => item !== null);
  if (!items.length) return null;
  return {
    catalogId: typeof rawOrder.catalog_id === 'string' ? rawOrder.catalog_id : null,
    text: typeof rawOrder.text === 'string' ? rawOrder.text : null,
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalPrice: items.every((item) => item.lineTotal !== null) ? items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0) : null,
    currency: items.find((item) => item.currency)?.currency ?? (typeof rawOrder.currency === 'string' ? rawOrder.currency.toUpperCase() : null),
  };
}

function tokenBounds(text: string, start: number, end: number) {
  let tokenStart = start;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) tokenStart -= 1;
  const nextWhitespace = text.slice(end).search(/\s/);
  const tokenEnd = nextWhitespace === -1 ? text.length : end + nextWhitespace;
  return { tokenStart, tokenEnd, token: text.slice(tokenStart, tokenEnd) };
}

export function parseMessageTextParts(text: string): MessageTextPart[] {
  const markers: Array<{ start: number; end: number; part: MessageTextPart }> = [];

  for (const match of text.matchAll(new RegExp(EMAIL_PATTERN.source, 'gi'))) {
    const value = match[0];
    const start = match.index ?? 0;
    markers.push({
      start,
      end: start + value.length,
      part: { type: 'url', value, href: `mailto:${value}` },
    });
  }

  const urlRegex = new RegExp(URL_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    const leading = match[1] ?? '';
    const rawUrl = match[2];
    if (!rawUrl) continue;
    const start = match.index + leading.length;
    const end = start + rawUrl.length;
    if (markers.some((marker) => start < marker.end && end > marker.start)) continue;

    const { token } = tokenBounds(text, start, end);
    // Dotted email local-parts (name.store@gmail.com) look like bare domains.
    if (!/^https?:\/\//i.test(rawUrl) && token.includes('@')) continue;

    const hasScheme = /^https?:\/\//i.test(rawUrl);
    markers.push({
      start,
      end,
      part: { type: 'url', value: rawUrl, href: hasScheme ? rawUrl : `https://${rawUrl}` },
    });
  }

  // Keep phone links out of URLs/emails and avoid matching inside identifiers.
  // Match one complete BD mobile number at a time, including formatted numbers.
  // An unbounded digit/space match swallows consecutive numbers and newlines.
  const phonePattern = /(?<![\p{L}\p{N}_+])(?:\+?88[ ()-]*)?0[ ()-]*1[ ()-]*[3-9](?:[ ()-]*\d){8}(?![\p{L}\p{N}_])/gu;
  for (const phoneMatch of text.matchAll(phonePattern)) {
    const value = phoneMatch[0];
    const start = phoneMatch.index ?? 0;
    const end = start + value.length;
    const digits = value.replace(/\D/g, '');
    // Bangladesh mobile numbers: local 01[3-9] or international +880/880.
    if (!/^(?:01[3-9]\d{8}|8801[3-9]\d{8})$/.test(digits)) continue;
    if (value.startsWith('+') && !digits.startsWith('880')) continue;
    if (markers.some((marker) => start < marker.end && end > marker.start)) continue;
    markers.push({
      start,
      end,
      part: { type: 'url', value, href: `tel:${digits.startsWith('880') ? '+' : ''}${digits}` },
    });
  }

  markers.sort((a, b) => a.start - b.start);
  const parts: MessageTextPart[] = [];
  let lastIndex = 0;
  for (const marker of markers) {
    if (marker.start < lastIndex) continue;
    if (marker.start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, marker.start) });
    parts.push(marker.part);
    lastIndex = marker.end;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  if (parts.length === 0) parts.push({ type: 'text', value: text });
  return parts;
}

export function isSameCalendarDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function formatTimelineDayLabel(value: string | Date): string {
  const d = new Date(value);
  return d.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatMessageTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export type OutboundStatusMeta = { showQueued: boolean; showSending: boolean; showFailed: boolean; showSingleTick: boolean; showDelivered: boolean; showRead: boolean; label: string };
export function getOutboundStatusMeta(deliveryStatus?: string): OutboundStatusMeta {
  switch (deliveryStatus) {
    case 'SENDING': return { showQueued: false, showSending: true, showFailed: false, showSingleTick: false, showDelivered: false, showRead: false, label: 'Sending' };
    case 'QUEUED': return { showQueued: true, showSending: false, showFailed: false, showSingleTick: true, showDelivered: false, showRead: false, label: 'Sent' };
    case 'SENT': return { showQueued: false, showSending: false, showFailed: false, showSingleTick: true, showDelivered: false, showRead: false, label: 'Sent' };
    case 'DELIVERED': return { showQueued: false, showSending: false, showFailed: false, showSingleTick: false, showDelivered: true, showRead: false, label: 'Delivered' };
    case 'READ': return { showQueued: false, showSending: false, showFailed: false, showSingleTick: false, showDelivered: false, showRead: true, label: 'Seen' };
    case 'FAILED': return { showQueued: false, showSending: false, showFailed: true, showSingleTick: false, showDelivered: false, showRead: false, label: 'Failed' };
    default: return { showQueued: false, showSending: false, showFailed: false, showSingleTick: false, showDelivered: false, showRead: false, label: '' };
  }
}

export function isMessageEdited(message: MessageLike): boolean {
  return Boolean(message.metadata?.providerEdit);
}

export function getMessageFailureReason(message: MessageLike): string | null {
  if (message.failureReason) return message.failureReason;
  const meta = message.metadata ?? {};
  const errorPayload = meta.responsePayload?.error;
  return meta.sendFailureReason ?? meta.errorMessage ?? meta.error ?? errorPayload?.message ?? errorPayload?.error_description ?? errorPayload?.errorMessage ?? null;
}

export function isInlineReactionMessage(message: MessageLike): boolean {
  return message.type === 'REACTION' && Boolean(message.replyToMessageId);
}

export type ReactionGroup = { emoji: string; count: number };
function getMessageTimestamp(message: MessageLike) {
  const timestamp = Date.parse(message.sentAt ?? message.createdAt ?? '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildReactionGroups(messages: MessageLike[], channelType?: string | null): Record<string, ReactionGroup[]> {
  const latestReactionByActorAndTarget = new Map<string, MessageLike>();
  messages.forEach((message) => {
    if (!isInlineReactionMessage(message) || !message.replyToMessageId) return;
    const actorKey =
      channelType === 'MESSENGER' && message.direction === 'OUTBOUND'
        ? 'messenger:page'
        : message.direction === 'INBOUND'
          ? `contact:${message.senderType ?? ''}`
          : `member:${message.senderWorkspaceMemberId ?? 'self'}`;
    const mapKey = `${message.replyToMessageId}:${actorKey}`;
    const previous = latestReactionByActorAndTarget.get(mapKey);
    const previousTimestamp = previous ? getMessageTimestamp(previous) : null;
    const nextTimestamp = getMessageTimestamp(message);

    if (!previous || nextTimestamp === null || previousTimestamp === null || nextTimestamp >= previousTimestamp) {
      latestReactionByActorAndTarget.set(mapKey, message);
    }
  });
  const byTarget = new Map<string, Map<string, number>>();
  latestReactionByActorAndTarget.forEach((message) => {
    if (!message.replyToMessageId) return;
    const emoji = message.text?.trim() || '👍';
    if (!byTarget.has(message.replyToMessageId)) byTarget.set(message.replyToMessageId, new Map());
    const emojiMap = byTarget.get(message.replyToMessageId)!;
    emojiMap.set(emoji, (emojiMap.get(emoji) ?? 0) + 1);
  });
  const result: Record<string, ReactionGroup[]> = {};
  byTarget.forEach((emojiMap, targetId) => {
    result[targetId] = [...emojiMap.entries()].map(([emoji, count]) => ({ emoji, count }));
  });
  return result;
}

export type TemplateMessageButton = { label: string; type: string; url?: string | null };
export type TemplateMessageDisplay = { headerType?: string; headerText?: string; headerMediaUrl?: string | null; bodyText: string; footerText: string; buttons: TemplateMessageButton[]; category?: string | null; templateName?: string | null };

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function getWhatsappLocation(message: { metadata?: unknown }): WhatsappLocation | null {
  const metadata = readRecord(message.metadata);
  const whatsappContent = readRecord(metadata?.whatsappContent);
  const rawPayload = readRecord(metadata?.payload);
  const rawMessage = readRecord(rawPayload?.message);
  const location = readRecord(whatsappContent?.location) ?? readRecord(rawMessage?.location);

  if (!location) return null;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    name: readTrimmedString(location.name),
    address: readTrimmedString(location.address),
    url: readTrimmedString(location.url),
  };
}

export function getWhatsappContacts(message: { metadata?: unknown }): WhatsappContactCard[] | null {
  const metadata = readRecord(message.metadata);
  const whatsappContent = readRecord(metadata?.whatsappContent);
  const rawPayload = readRecord(metadata?.payload);
  const rawMessage = readRecord(rawPayload?.message);
  const rawContacts = Array.isArray(whatsappContent?.contacts)
    ? whatsappContent.contacts
    : Array.isArray(rawMessage?.contacts)
      ? rawMessage.contacts
      : null;

  if (!rawContacts) return null;

  const contacts = rawContacts.map((rawContact) => {
    const contact = readRecord(rawContact);
    const name = readRecord(contact?.name);
    const displayName =
      readTrimmedString(name?.formatted_name) ??
      ([
        name && readTrimmedString(name.prefix),
        name && readTrimmedString(name.first_name),
        name && readTrimmedString(name.middle_name),
        name && readTrimmedString(name.last_name),
        name && readTrimmedString(name.suffix),
      ].filter(Boolean).join(' ') || 'Unnamed contact');
    const phones = Array.isArray(contact?.phones)
      ? contact.phones
        .map((rawPhone) => {
          const phone = readRecord(rawPhone);
          const value = readTrimmedString(phone?.phone) ?? readTrimmedString(phone?.wa_id);
          return value ? { value, label: readTrimmedString(phone?.type) } : null;
        })
        .filter((phone): phone is { value: string; label: string | null } => phone !== null)
      : [];
    const emails = Array.isArray(contact?.emails)
      ? contact.emails
        .map((rawEmail) => {
          const email = readRecord(rawEmail);
          const value = readTrimmedString(email?.email);
          return value ? { value, label: readTrimmedString(email?.type) } : null;
        })
        .filter((email): email is { value: string; label: string | null } => email !== null)
      : [];
    const organization = readRecord(contact?.org);
    const organizationParts = [
      readTrimmedString(organization?.company),
      readTrimmedString(organization?.title),
      readTrimmedString(organization?.department),
    ].filter(Boolean);
    const addresses = Array.isArray(contact?.addresses)
      ? contact.addresses
        .map((rawAddress) => {
          const address = readRecord(rawAddress);
          return [
            readTrimmedString(address?.street),
            readTrimmedString(address?.city),
            readTrimmedString(address?.state),
            readTrimmedString(address?.zip),
            readTrimmedString(address?.country),
          ].filter(Boolean).join(', ');
        })
        .filter((value) => value.length > 0)
      : [];
    const urls = Array.isArray(contact?.urls)
      ? contact.urls
        .map((rawUrl) => readTrimmedString(readRecord(rawUrl)?.url))
        .filter((value): value is string => Boolean(value))
      : [];

    return {
      displayName,
      phones,
      emails,
      organization: organizationParts.length > 0 ? organizationParts.join(' - ') : null,
      address: addresses[0] ?? null,
      url: urls[0] ?? null,
    };
  });

  return contacts.length > 0 ? contacts : null;
}

export function isTemplateLikeMessage(message: MessageLike): boolean {
  return (
    message.type === 'TEMPLATE'
    || Boolean(readRecord(message.metadata)?.templateSnapshot)
    || Array.isArray(message.templateComponentsJson)
  );
}

export function isEmptyInstagramTemplateMessage(message: { metadata?: unknown }): boolean {
  const metadata = readRecord(message.metadata);
  const source = readTrimmedString(metadata?.source)?.toLowerCase() ?? '';
  if (!source.startsWith('instagram_')) return false;

  const payload = readRecord(metadata?.payload);
  const rawMessage = readRecord(payload?.message);
  if (!rawMessage) return false;

  const messageType = readTrimmedString(rawMessage.type)?.toLowerCase() ?? null;
  if (messageType && messageType !== 'template') return false;

  const text =
    typeof rawMessage.text === 'string'
      ? rawMessage.text.trim()
      : readTrimmedString(readRecord(rawMessage.text)?.body);
  if (text) return false;

  const attachments = Array.isArray(rawMessage.attachments) ? rawMessage.attachments : [];
  if (attachments.length === 0) return false;

  return attachments.every((attachment) => {
    const attachmentRecord = readRecord(attachment);
    if (readTrimmedString(attachmentRecord?.type)?.toLowerCase() !== 'template') return false;

    const attachmentPayload = readRecord(attachmentRecord?.payload);
    const generic = readRecord(attachmentPayload?.generic);
    return Array.isArray(generic?.elements) && generic.elements.length === 0;
  });
}

function readInstagramTemplateText(message: { text?: string | null; metadata?: unknown }): string | null {
  if (message.text?.trim()) return message.text.trim();

  const metadata = readRecord(message.metadata);
  const rendered =
    readTrimmedString(metadata?.templateRenderedText) ??
    readTrimmedString(metadata?.renderedText) ??
    readTrimmedString(metadata?.bodyText);
  if (rendered) return rendered;

  const payload = readRecord(metadata?.payload);
  const rawMessage = readRecord(payload?.message);
  const rawText =
    typeof rawMessage?.text === 'string'
      ? rawMessage.text.trim()
      : readTrimmedString(readRecord(rawMessage?.text)?.body);
  return rawText || null;
}

export function isInstagramSharedPostTemplateMessage(message: MessageLike): boolean {
  const metadata = readRecord(message.metadata);
  const source = readTrimmedString(metadata?.source)?.toLowerCase() ?? '';
  if (!source.startsWith('instagram_') || !isTemplateLikeMessage(message)) return false;
  if (isEmptyInstagramTemplateMessage(message)) return true;

  const text = readInstagramTemplateText(message);
  if (!text) return false;

  const firstUrl = text.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
  if (!firstUrl) return false;

  try {
    const parsed = new URL(firstUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'facebook.com' ||
      host === 'www.facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'fb.watch'
    );
  } catch {
    return /https?:\/\/(?:www\.)?facebook\.com\/(?:share|posts|reel|watch|story)/i.test(firstUrl);
  }
}

function extractTemplateButtons(buttonsJson: unknown): TemplateMessageButton[] {
  if (!Array.isArray(buttonsJson)) return [];
  const result: TemplateMessageButton[] = [];
  for (const group of buttonsJson) {
    const record = readRecord(group);
    if (!record || !Array.isArray(record.buttons)) {
      if (record && (record.text || record.label)) {
        result.push({
          label: String(record.text ?? record.label ?? ''),
          type: String(record.type ?? ''),
          url: readTrimmedString(record.url),
        });
      }
      continue;
    }
    for (const button of record.buttons) {
      const buttonRecord = readRecord(button);
      if (!buttonRecord) continue;
      const label = readTrimmedString(buttonRecord.text) ?? readTrimmedString(buttonRecord.label) ?? readTrimmedString(buttonRecord.payload);
      if (label) {
        result.push({
          label,
          type: readTrimmedString(buttonRecord.type) ?? '',
          url: readTrimmedString(buttonRecord.url),
        });
      }
    }
  }
  return result;
}

function extractHeaderMediaUrl(component: Record<string, unknown> | null): string | null {
  if (!component) return null;
  const params = Array.isArray(component.parameters) ? component.parameters : [];
  for (const parameter of params) {
    const record = readRecord(parameter);
    if (!record) continue;
    const parameterType = readTrimmedString(record.type)?.toLowerCase();
    const mediaRecord =
      readRecord(record.image)
      ?? readRecord(record.video)
      ?? readRecord(record.document)
      ?? (parameterType === 'image' || parameterType === 'video' || parameterType === 'document' ? record : null);
    if (!mediaRecord) continue;
    const url =
      readTrimmedString(mediaRecord.link)
      ?? readTrimmedString(mediaRecord.url)
      ?? readTrimmedString(mediaRecord.downloadUrl);
    if (url) return url;
  }
  return null;
}

function extractComponentText(component: Record<string, unknown> | null): string {
  if (!component) return '';
  const direct = readTrimmedString(component.text);
  if (direct) return direct;
  const location = readRecord(component.location);
  if (location) {
    return [readTrimmedString(location.name), readTrimmedString(location.address)].filter(Boolean).join('\n');
  }
  const params = Array.isArray(component.parameters) ? component.parameters : [];
  return params
    .map((parameter) => {
      const record = readRecord(parameter);
      return readTrimmedString(record?.text) ?? readTrimmedString(record?.payload) ?? '';
    })
    .filter(Boolean)
    .join(' ');
}

function templateComponentsSource(message: MessageLike): unknown[] {
  const snapshot = readRecord(readRecord(message.metadata)?.templateSnapshot) ?? {};
  if (Array.isArray(message.templateComponentsJson)) return message.templateComponentsJson;
  if (Array.isArray(message.metadata?.templateComponents)) return message.metadata.templateComponents;
  if (Array.isArray(snapshot.displayComponents)) return snapshot.displayComponents;
  if (Array.isArray(snapshot.components)) return snapshot.components;
  return [];
}

function attachmentHeaderMediaUrl(message: MessageLike): { headerType: string; url: string } | null {
  const attachment = message.attachments?.find((item) => {
    const mediaType = (item.mediaType ?? '').toUpperCase();
    return mediaType === 'IMAGE' || mediaType === 'VIDEO' || mediaType === 'DOCUMENT';
  });
  if (!attachment) return null;
  const url = attachment.previewUrl ?? attachment.downloadUrl ?? attachment.thumbnailUrl ?? null;
  if (!url) return null;
  return { headerType: (attachment.mediaType ?? '').toUpperCase(), url };
}

export function getTemplateMessageDisplay(message: MessageLike): TemplateMessageDisplay | null {
  const snapshot = readRecord(readRecord(message.metadata)?.templateSnapshot) ?? {};
  const components = templateComponentsSource(message);
  const buttons: TemplateMessageButton[] = [];
  let headerType = '';
  let headerText = '';
  let headerMediaUrl: string | null = null;
  let bodyText = '';
  let footerText = '';
  const snapshotButtons = extractTemplateButtons(snapshot.buttonsJson ?? snapshot.buttons);
  let buttonIndex = 0;

  for (const component of components) {
    const record = readRecord(component);
    if (!record) continue;
    const type = readTrimmedString(record.type)?.toLowerCase();
    if (type === 'header') {
      headerType = (readTrimmedString(record.format) ?? headerType).toUpperCase();
      headerText = extractComponentText(record);
      headerMediaUrl = extractHeaderMediaUrl(record) ?? headerMediaUrl;
    } else if (type === 'body') {
      bodyText = extractComponentText(record);
    } else if (type === 'footer') {
      footerText = extractComponentText(record);
    } else if (type === 'button') {
      const buttonType = readTrimmedString(record.sub_type) ?? readTrimmedString(record.buttonType) ?? readTrimmedString(record.button_type);
      const params = Array.isArray(record.parameters) ? record.parameters : [];
      const labels = params
        .map((parameter) => {
          const parameterRecord = readRecord(parameter);
          return readTrimmedString(parameterRecord?.text) ?? readTrimmedString(parameterRecord?.label) ?? readTrimmedString(parameterRecord?.payload);
        })
        .filter((label): label is string => Boolean(label));
      const snapBtn = snapshotButtons[buttonIndex] ?? null;
      if (labels.length > 0) {
        for (const label of labels) {
          buttons.push({
            label,
            type: buttonType ?? snapBtn?.type ?? '',
            url: buttonType?.toLowerCase() === 'url' ? (snapBtn?.url ?? readTrimmedString(record.url) ?? null) : null,
          });
        }
      } else if (snapBtn) {
        buttons.push(snapBtn);
      }
      buttonIndex += 1;
    } else if (type === 'buttons') {
      const params = Array.isArray(record.parameters) ? record.parameters : [];
      params.forEach((parameter) => {
        const parameterRecord = readRecord(parameter);
        const nested = readRecord(parameterRecord?.button);
        if (nested) {
          buttons.push({
            label: readTrimmedString(nested.text) ?? '',
            type: readTrimmedString(nested.type) ?? readTrimmedString(parameterRecord?.sub_type) ?? 'QUICK_REPLY',
            url: readTrimmedString(nested.url),
          });
        } else if (parameterRecord?.text || parameterRecord?.label) {
          buttons.push({
            label: readTrimmedString(parameterRecord?.text) ?? readTrimmedString(parameterRecord?.label) ?? '',
            type: readTrimmedString(parameterRecord?.sub_type) ?? readTrimmedString(parameterRecord?.type) ?? '',
            url: readTrimmedString(parameterRecord?.url),
          });
        }
      });
    }
  }

  if (!bodyText) bodyText = readTrimmedString(snapshot.bodyText) ?? readTrimmedString(snapshot.displayText) ?? '';
  if (!headerText) headerText = readTrimmedString(snapshot.headerText) ?? '';
  if (!footerText) footerText = readTrimmedString(snapshot.footerText) ?? '';
  if (!headerType) headerType = (readTrimmedString(snapshot.headerType) ?? '').toUpperCase();
  if (!headerMediaUrl) headerMediaUrl = readTrimmedString(snapshot.headerMediaUrl);
  if (!headerMediaUrl) {
    const attachmentHeader = attachmentHeaderMediaUrl(message);
    if (attachmentHeader) {
      headerMediaUrl = attachmentHeader.url;
      if (!headerType) headerType = attachmentHeader.headerType;
    }
  }
  if (!bodyText) {
    const messageText = readTrimmedString(message.text);
    if (messageText && !ATTACHMENT_ONLY_PLACEHOLDERS.has(messageText.toLowerCase())) {
      bodyText = messageText;
    }
  }
  if (!bodyText && !headerText && !footerText && !headerMediaUrl && buttons.length === 0) {
    buttons.push(...extractTemplateButtons(snapshot.buttonsJson ?? snapshot.buttons));
  }
  if (buttons.length === 0 && snapshotButtons.length > 0) {
    buttons.push(...snapshotButtons);
  }
  if (!bodyText && !headerText && !footerText && !headerMediaUrl && buttons.length === 0) return null;
  const category = readTrimmedString(snapshot.category) ?? readTrimmedString(snapshot.templateCategory) ?? readTrimmedString(message.metadata?.templateCategory) ?? null;
  const templateName = readTrimmedString(snapshot.templateName) ?? readTrimmedString(snapshot.name) ?? readTrimmedString(message.templateName) ?? readTrimmedString(message.metadata?.templateName) ?? null;
  return { headerType, headerText, headerMediaUrl, bodyText, footerText, buttons, category, templateName };
}

export function readSystemMessageDurationSeconds(message: MessageLike): number | null {
  const meta = message.metadata ?? {};
  const candidate = meta.callSession ?? meta.call ?? meta.payload ?? meta.rawWebhookCallItem;
  if (candidate) {
    if (typeof candidate.durationSeconds === 'number') return candidate.durationSeconds;
    if (typeof candidate.duration === 'number') return candidate.duration;
    if (candidate.start_time && candidate.end_time) {
      const diff = (new Date(candidate.end_time).getTime() - new Date(candidate.start_time).getTime()) / 1000;
      if (Number.isFinite(diff) && diff > 0) return diff;
    }
  }
  return null;
}

export function getSystemMessageLabel(message: MessageLike): string {
  const body = message.text?.trim() ?? '';
  if (body.toLowerCase() !== 'call ended') return body;
  const seconds = readSystemMessageDurationSeconds(message);
  const durationLabel = formatCallDurationLabel(seconds);
  return durationLabel ? `Call ended · ${durationLabel}` : 'Call ended';
}

export function isMissedCall(message: MessageLike): boolean {
  return /missed call/i.test(message.text ?? '');
}

export type MessengerMessagingMode = 'STANDARD' | 'HUMAN_AGENT';

function isFutureDate(value: string | null | undefined, now: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now;
}

function formatWindowRemaining(expiresAt: string, now: number) {
  const remainingMs = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours <= 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

export function getMessengerMessagingAvailability(
  conversation: {
    messaging?: {
      standardWindowExpiresAt?: string | null;
      humanAgentWindowExpiresAt?: string | null;
      canSendStandardMessage?: boolean;
      canSendHumanAgentMessage?: boolean;
    } | null;
  } | undefined,
  now = Date.now(),
) {
  const messaging = conversation?.messaging;
  return {
    canSendStandardMessage:
      typeof messaging?.canSendStandardMessage === 'boolean'
        ? messaging.canSendStandardMessage
        : isFutureDate(messaging?.standardWindowExpiresAt, now),
    canSendHumanAgentMessage:
      typeof messaging?.canSendHumanAgentMessage === 'boolean'
        ? messaging.canSendHumanAgentMessage
        : isFutureDate(messaging?.humanAgentWindowExpiresAt, now),
  };
}

export function getConversationWindowLabel(
  conversation: {
    channel?: { channelType?: string | null } | null;
    messaging?: {
      windowExpiresAt?: string | null;
      standardWindowExpiresAt?: string | null;
      humanAgentWindowExpiresAt?: string | null;
      canSendStandardMessage?: boolean;
      canSendHumanAgentMessage?: boolean;
      canSendFreeformMessage?: boolean;
      windowState?: string | null;
      policyType?: string | null;
    } | null;
  } | undefined,
  messengerMessagingMode: MessengerMessagingMode = 'STANDARD',
  now = new Date(),
): { label: string; tone: 'open' | 'expired' | 'none' } {
  const nowMs = now.getTime();
  if ((conversation?.channel?.channelType ?? '').toUpperCase() === 'MESSENGER') {
    const availability = getMessengerMessagingAvailability(conversation, nowMs);
    if (!availability.canSendStandardMessage && !availability.canSendHumanAgentMessage) {
      return { label: 'Messaging window expired', tone: 'expired' };
    }
    const isHumanAgent = messengerMessagingMode === 'HUMAN_AGENT';
    const expiresAt = isHumanAgent
      ? conversation?.messaging?.humanAgentWindowExpiresAt
      : conversation?.messaging?.standardWindowExpiresAt;
    const remaining = expiresAt ? formatWindowRemaining(expiresAt, nowMs) : null;
    const selectedOpen = isHumanAgent
      ? availability.canSendHumanAgentMessage
      : availability.canSendStandardMessage;
    return {
      label: `${isHumanAgent ? 'Human Agent' : 'Standard'} window${remaining ? ` · ${remaining}` : ''}`,
      tone: selectedOpen ? 'open' : 'expired',
    };
  }

  if (conversation?.messaging?.policyType === 'UNRESTRICTED') {
    return { label: 'Free-form replies available', tone: 'open' };
  }

  if (conversation?.messaging?.canSendFreeformMessage === false) {
    return { label: 'Window Expired', tone: 'expired' };
  }

  const expiresAt = conversation?.messaging?.windowExpiresAt ?? conversation?.messaging?.standardWindowExpiresAt;
  if (!expiresAt) {
    return {
      label: conversation?.messaging?.windowState === 'EXPIRED' ? 'Window Expired' : 'Open',
      tone: conversation?.messaging?.windowState === 'EXPIRED' ? 'expired' : 'none',
    };
  }
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return { label: 'Open', tone: 'none' };
  if (expires <= now) return { label: 'Window Expired', tone: 'expired' };
  const diffMs = expires.getTime() - nowMs;
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return { label: `${hours}h ${minutes}m left`, tone: 'open' };
  return { label: minutes > 0 ? `${minutes}m left` : 'Open', tone: 'open' };
}

export function isConversationCustomerWindowExpired(
  conversation: {
    messaging?: {
      windowExpiresAt?: string | null;
      standardWindowExpiresAt?: string | null;
      windowState?: string | null;
      canSendFreeformMessage?: boolean;
    } | null;
  } | undefined,
  now = new Date(),
): boolean {
  const messaging = conversation?.messaging;
  if (messaging?.windowState === 'EXPIRED') return true;
  if (messaging?.canSendFreeformMessage === false) return true;

  const expiresAt = messaging?.windowExpiresAt ?? messaging?.standardWindowExpiresAt;
  if (!expiresAt) return false;

  const expires = new Date(expiresAt);
  return !Number.isNaN(expires.getTime()) && expires <= now;
}

export function getConversationTitle(conversation: { contact?: { displayName?: string | null; primaryPhone?: string | null; username?: string | null } | null; channel?: { channelName?: string | null; displayPhoneNumber?: string | null } | null } | undefined, fallback = 'Unknown contact'): string {
  const title = conversation?.contact?.displayName ?? conversation?.contact?.primaryPhone ?? conversation?.contact?.username ?? conversation?.channel?.displayPhoneNumber ?? conversation?.channel?.channelName;
  return title?.trim() ? title : fallback;
}

export function getMessageBody(message: MessageLike): string {
  if (isTemplateLikeMessage(message)) {
    const display = getTemplateMessageDisplay(message);
    if (display) {
      return [display.headerText, display.bodyText, display.footerText].filter(Boolean).join('\n\n');
    }
  }
  const metadata = message.metadata ?? {};
  const rendered = metadata.templateRenderedText ?? metadata.renderedText ?? metadata.bodyText;
  if (typeof rendered === 'string' && rendered.trim()) return rendered;
  if (message.text?.trim()) return message.text;
  const firstAttachment = message.attachments?.[0];
  if (firstAttachment?.caption?.trim()) return firstAttachment.caption;
  if (firstAttachment?.originalName) return firstAttachment.originalName;
  if (message.campaignName) return message.campaignName;
  const fallbackMap: Record<string, string> = { IMAGE: '[Image]', VIDEO: '[Video]', AUDIO: '[Audio]', VOICE: '[Voice note]', DOCUMENT: '[Document]', FILE: '[Document]', LOCATION: '[Location]', STICKER: '[Sticker]', REACTION: '[Reaction]', TEMPLATE: '[Template]' };
  return fallbackMap[(message.type ?? '').toUpperCase()] ?? '';
}

const REPLY_PREVIEW_TYPE_LABELS: Record<string, string> = {
  IMAGE: '[Image]',
  VIDEO: '[Video]',
  AUDIO: '[Audio]',
  VOICE: '[Voice note]',
  DOCUMENT: '[Document]',
  STICKER: '[Sticker]',
  FILE: '[Attachment]',
};

export function getReplyPreviewBody(message: MessageLike): string {
  const body = getMessageBody(message);
  const firstAttachment = message.attachments?.[0];
  const attachmentName = firstAttachment?.originalName?.trim() ?? null;
  const trimmedText = message.text?.trim() ?? null;
  const hasMeaningfulTextBody =
    trimmedText !== null
    && trimmedText !== ''
    && (!attachmentName || trimmedText.toLowerCase() !== attachmentName.toLowerCase());
  const replyPreviewAttachmentType = (firstAttachment?.mediaType ?? message.type ?? '').toUpperCase();

  if (hasMeaningfulTextBody || !attachmentName) {
    return body;
  }

  if (body.trim().toLowerCase() === attachmentName.toLowerCase()) {
    return REPLY_PREVIEW_TYPE_LABELS[replyPreviewAttachmentType] ?? '[Attachment]';
  }

  return body;
}

export type ReplyPreviewKind = 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'text';

export function getReplyPreviewPresentation(body: string | null | undefined, mediaType?: string | null): { kind: ReplyPreviewKind; label: string } {
  const trimmed = body?.trim() ?? '';
  const normalized = trimmed.toLowerCase();
  const type = (mediaType ?? '').toUpperCase();
  const placeholderKind = (
    normalized === '[image]' || normalized === 'image' || normalized === 'photo' ? 'photo'
    : normalized === '[video]' || normalized === 'video' ? 'video'
    : normalized === '[audio]' || normalized === 'audio' ? 'audio'
    : normalized === '[voice note]' || normalized === 'voice' || normalized === 'voice note' ? 'voice'
    : normalized === '[document]' || normalized === 'document' ? 'document'
    : normalized === '[sticker]' || normalized === 'sticker' ? 'sticker'
    : normalized === '[attachment]' || normalized === 'attachment' || !trimmed ? null
    : 'text'
  ) as ReplyPreviewKind | 'text' | null;

  const typeKind: ReplyPreviewKind | null = (
    type === 'IMAGE' ? 'photo'
    : type === 'VIDEO' ? 'video'
    : type === 'AUDIO' ? 'audio'
    : type === 'VOICE' ? 'voice'
    : type === 'DOCUMENT' || type === 'FILE' ? 'document'
    : type === 'STICKER' ? 'sticker'
    : null
  );

  const kind = placeholderKind === 'text' ? 'text' : (placeholderKind ?? typeKind ?? 'text');
  const labels: Record<ReplyPreviewKind, string> = {
    photo: 'Photo',
    video: 'Video',
    audio: 'Audio',
    voice: 'Voice note',
    document: 'Document',
    sticker: 'Sticker',
    text: trimmed || 'Message',
  };
  return { kind, label: labels[kind] };
}

// --- Call history ---

export type CallHistoryTone = 'noAnswer' | 'permission' | 'permissionGranted' | 'permissionDenied' | 'permissionExpired' | 'ringing' | 'connected' | 'completed' | 'missed' | 'declined' | 'failed' | 'ended' | 'requested';

const TERMINAL_CALL_OUTCOME_PRIORITY = ['MISSED', 'REJECTED', 'FAILED', 'CANCELLED'] as const;
const ENDED_REASON_OUTCOME_RULES = [
  { outcome: 'MISSED', keywords: ['missed', 'no answer', 'not answered'] },
  { outcome: 'REJECTED', keywords: ['reject', 'declin'] },
  { outcome: 'CANCELLED', keywords: ['cancel'] },
  { outcome: 'FAILED', keywords: ['fail'] },
] as const;

export function formatCallDurationLabel(seconds: number | null): string | null {
  if (seconds === null || Number.isNaN(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(remaining).padStart(2, '0')}s`;
  return `${remaining}s`;
}

export function formatCallHistoryTime(value?: string | null): string {
  if (!value) return 'Now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Now';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatCallOutcomeReason(reason: string | null): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s+/g, ' ');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized) || /^wacid\./i.test(normalized) || /^wamid\./i.test(normalized)) return null;
  return normalized;
}

function formatDateTimeLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function readStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => `${item}`.toUpperCase());
  return [`${value}`.toUpperCase()];
}

function resolveOutcomeByPriority(statuses: string[]): string | null {
  return (TERMINAL_CALL_OUTCOME_PRIORITY as readonly string[]).find((outcome) => statuses.includes(outcome)) ?? null;
}

function resolveOutcomeFromEndedReason(endedReason: string | null): string | null {
  const normalized = `${endedReason ?? ''}`.toLowerCase();
  for (const rule of ENDED_REASON_OUTCOME_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) return rule.outcome;
  }
  return null;
}

const LIVE_CALL_SESSION_STATUSES = new Set(['REQUESTED', 'PERMISSION_REQUESTED', 'RINGING', 'CONNECTED']);

export function isCallSessionTerminal(status: string): boolean {
  return ['ENDED', 'MISSED', 'REJECTED', 'FAILED', 'CANCELLED'].includes(status);
}

export function isLiveCallSession(session: Pick<ConversationCallSession, 'status' | 'endedAt'>) {
  return session.endedAt == null && LIVE_CALL_SESSION_STATUSES.has(session.status);
}

export function getCallSessionStatusLabel(
  status: ConversationCallSession['status'],
  permissionStatus?: ConversationCallSession['permissionStatus'],
  direction?: ConversationCallSession['direction'] | null,
) {
  switch (getNormalizedCallSessionOutcome(status, direction)) {
    case 'REQUESTED':
      return 'Call requested';
    case 'PERMISSION_REQUESTED':
      if (permissionStatus === 'GRANTED') return 'Permission granted';
      if (permissionStatus === 'DENIED') return 'Permission declined';
      return 'Waiting for approval';
    case 'RINGING':
      return 'Ringing';
    case 'CONNECTED':
      return 'In call';
    case 'ENDED':
      return 'Call ended';
    case 'MISSED':
      return 'Call missed';
    case 'REJECTED':
      return 'Call rejected';
    case 'FAILED':
      return 'Call failed';
    case 'CANCELLED':
      return 'Call cancelled';
    default:
      return status;
  }
}

/** Sidebar/list preview labels aligned with osaas-frontend `getCallSessionSidebarPreview`. */
export function getCallSessionSidebarPreview(session: ConversationCallSession): string {
  const status =
    session.endedAt !== null && !isCallSessionTerminal(session.status)
      ? 'ENDED'
      : inferCallOutcome(session);

  switch (status) {
    case 'MISSED':
      return 'Missed call';
    case 'REJECTED':
      return 'Call declined';
    case 'FAILED':
      return 'Call failed';
    case 'CANCELLED':
      return 'Call cancelled';
    case 'ENDED':
      return session.durationSeconds !== null
        ? `Call ended · ${formatCallDurationLabel(session.durationSeconds) ?? 'Live'}`
        : 'Call ended';
    case 'CONNECTED':
      return 'In call';
    case 'REQUESTED':
      return 'Call requested';
    case 'PERMISSION_REQUESTED':
      if (session.permissionStatus === 'GRANTED') return 'Permission granted';
      if (session.permissionStatus === 'DENIED') return 'Permission declined';
      return 'Waiting for approval';
    case 'RINGING':
      return 'Ringing';
    default:
      return 'Call update';
  }
}

export type VoiceCallButtonState = {
  canStartVoiceCall: boolean;
  tooltipMessage: string;
};

export function getVoiceCallButtonState(input: {
  isWhatsAppConversation: boolean;
  isWebchatConversation?: boolean;
  webchatVoiceCallEnabled?: boolean;
  isWebchatSettingsLoading?: boolean;
  canManageCalls: boolean;
  isCallSessionsLoading: boolean;
  isCallControllerBusy: boolean;
  activeCallSession: ConversationCallSession | null;
  latestCallSession: ConversationCallSession | null;
  businessCallingStatus?: 'PENDING' | 'ENABLED' | 'FAILED' | 'DISABLED' | null;
  businessCallingDisabledReason?: string | null;
}): VoiceCallButtonState {
  if (input.isCallSessionsLoading) {
    return { canStartVoiceCall: false, tooltipMessage: 'Loading call status...' };
  }
  if (!input.isWhatsAppConversation && !input.isWebchatConversation) {
    return { canStartVoiceCall: false, tooltipMessage: 'Voice calls are only available for WhatsApp and Web Chat conversations.' };
  }
  if (!input.canManageCalls) {
    return { canStartVoiceCall: false, tooltipMessage: 'You do not have permission to start voice calls.' };
  }
  if (input.isWebchatConversation) {
    if (input.isWebchatSettingsLoading) return { canStartVoiceCall: false, tooltipMessage: 'Loading Web Chat voice settings...' };
    if (!input.webchatVoiceCallEnabled) return { canStartVoiceCall: false, tooltipMessage: 'Voice calling is disabled for this Web Chat channel.' };
  }
  if (input.isWhatsAppConversation && input.businessCallingDisabledReason) {
    return { canStartVoiceCall: false, tooltipMessage: input.businessCallingDisabledReason };
  }
  if (input.isWhatsAppConversation && input.businessCallingStatus === 'DISABLED') {
    return { canStartVoiceCall: false, tooltipMessage: 'Business calling is disabled for this WhatsApp number.' };
  }
  if (input.isCallControllerBusy) {
    return { canStartVoiceCall: false, tooltipMessage: 'Preparing the call...' };
  }
  if (input.activeCallSession) {
    return { canStartVoiceCall: false, tooltipMessage: 'A voice call is already active in this conversation.' };
  }
  if (input.latestCallSession?.status === 'PERMISSION_REQUESTED') {
    const permissionStatus = input.latestCallSession.permissionStatus;
    if (permissionStatus === 'GRANTED') {
      return { canStartVoiceCall: true, tooltipMessage: 'Permission granted. Start a voice call.' };
    }
    // DENIED / EXPIRED / NONE: allow starting again so a new permission request can be sent.
    // Only block while actively waiting on the customer.
    if (permissionStatus === 'REQUESTED') {
      return { canStartVoiceCall: false, tooltipMessage: 'Permission message sent. Waiting for customer confirmation.' };
    }
  }
  return { canStartVoiceCall: true, tooltipMessage: 'Start a voice call' };
}

export function getNormalizedCallSessionOutcome(status: string, direction?: ConversationCallSession['direction'] | null): string {
  if (direction === 'INBOUND' && status === 'CANCELLED') return 'MISSED';
  return status;
}

function inferCallOutcome(session: ConversationCallSession): string {
  let outcome: string = session.status;
  if (session.status === 'ENDED') {
    const metadata = (session.metadata ?? {}) as Record<string, unknown>;
    const rawCallItem = metadata.rawCallItem as Record<string, unknown> | null;
    const rawWebhook = metadata.rawWebhook as Record<string, unknown> | null;
    const rawStatusOutcome = resolveOutcomeByPriority(readStringArray(rawCallItem?.status));
    if (rawStatusOutcome) {
      outcome = rawStatusOutcome;
    } else {
      const webhookOutcome = resolveOutcomeByPriority([`${rawWebhook?.status ?? ''}`.toUpperCase()]);
      if (webhookOutcome) {
        outcome = webhookOutcome;
      } else {
        const endedReasonOutcome = resolveOutcomeFromEndedReason(session.endedReason);
        if (endedReasonOutcome) {
          outcome = endedReasonOutcome;
        } else if (session.durationSeconds !== null) {
          outcome = 'CONNECTED';
        } else {
          outcome = 'ENDED';
        }
      }
    }
  }
  return getNormalizedCallSessionOutcome(outcome, session.direction);
}

export function getCallSessionHistoryPresentation(session: ConversationCallSession, variant: 'session' | 'permission' = 'session'): { tone: CallHistoryTone; title: string; body: string; detail: string | null } {
  if (variant === 'permission' || session.status === 'PERMISSION_REQUESTED') {
    const metadata = (session.metadata ?? {}) as Record<string, unknown>;
    const permissionExpirationTimestamp = typeof metadata.permissionExpirationTimestamp === 'string' ? metadata.permissionExpirationTimestamp : null;
    const permissionIsPermanent = metadata.permissionIsPermanent === true;
    const permissionExpiresLabel = formatDateTimeLabel(permissionExpirationTimestamp);

    if (session.permissionStatus === 'GRANTED') {
      return {
        tone: 'permissionGranted',
        title: 'Permission granted',
        body: permissionIsPermanent ? 'Customer granted permanent call permission' : 'Customer granted call permission',
        detail: permissionIsPermanent ? 'Permission does not expire until revoked' : permissionExpiresLabel ? `Valid until ${permissionExpiresLabel}` : null,
      };
    }
    if (session.permissionStatus === 'DENIED') {
      return { tone: 'permissionDenied', title: 'Permission declined', body: 'Customer rejected the call permission request', detail: formatCallOutcomeReason(session.endedReason) };
    }
    if (session.permissionStatus === 'EXPIRED') {
      return { tone: 'permissionExpired', title: 'Permission expired', body: 'Call permission request expired', detail: permissionExpiresLabel ? `Expired on ${permissionExpiresLabel}` : null };
    }
    return { tone: 'permission', title: 'Waiting for approval', body: session.permissionStatus === 'REQUESTED' ? 'Customer approval request sent' : 'Customer approval is pending', detail: null };
  }

  const outcome = session.endedAt !== null && !isCallSessionTerminal(session.status) ? 'ENDED' : inferCallOutcome(session);

  switch (outcome) {
    case 'REQUESTED':
      return {
        tone: 'requested',
        title: 'Call requested',
        body: session.direction === 'INBOUND' ? 'Inbound call session created' : 'Outbound call session created',
        detail: null,
      };
    case 'PERMISSION_REQUESTED':
      return { tone: 'permission', title: 'Waiting for approval', body: session.permissionStatus === 'REQUESTED' ? 'Customer approval request sent' : 'Customer approval is pending', detail: null };
    case 'RINGING':
      return { tone: 'ringing', title: 'Ringing', body: session.direction === 'INBOUND' ? 'Customer is calling in' : 'Outbound call is ringing', detail: null };
    case 'CONNECTED':
      return { tone: 'connected', title: 'Accepted call', body: 'Call connected', detail: session.durationSeconds !== null ? `Connected for ${formatCallDurationLabel(session.durationSeconds)}` : null };
    case 'MISSED':
      return {
        tone: 'missed',
        title: 'Missed call',
        body: 'No answer',
        detail: formatCallOutcomeReason(session.endedReason) ?? (session.direction === 'INBOUND' ? `Missed from ${session.recipientDisplayName ?? session.recipientIdentityValue}` : `Missed to ${session.recipientDisplayName ?? session.recipientIdentityValue}`),
      };
    case 'REJECTED':
      return { tone: 'declined', title: 'Call declined', body: 'Rejected before connecting', detail: formatCallOutcomeReason(session.endedReason) ?? `Declined by ${session.recipientDisplayName ?? session.recipientIdentityValue}` };
    case 'FAILED':
      return { tone: 'failed', title: 'Call failed', body: session.endedReason ?? 'Could not connect', detail: formatCallOutcomeReason(session.endedReason) };
    case 'CANCELLED':
      return { tone: 'ended', title: 'Call cancelled', body: session.endedReason ?? 'Cancelled before connection', detail: formatCallOutcomeReason(session.endedReason) };
    case 'ENDED':
    default: {
      const reason = formatCallOutcomeReason(session.endedReason);
      const detail = reason && reason !== 'Call ended' ? reason : null;
      return {
        tone: session.durationSeconds !== null ? 'completed' : 'ended',
        title: session.durationSeconds !== null ? 'Accepted call' : 'Call ended',
        body: session.durationSeconds !== null ? `Connected for ${formatCallDurationLabel(session.durationSeconds)}` : 'Ended',
        detail,
      };
    }
  }
}

export function getCallSessionTimelineTimestamp(session: ConversationCallSession, variant: 'session' | 'permission' = 'session'): string {
  if (variant === 'permission' || session.status === 'PERMISSION_REQUESTED') {
    return session.permissionRespondedAt ?? session.requestedPermissionAt ?? session.createdAt;
  }
  return session.endedAt ?? session.permissionRespondedAt ?? session.connectedAt ?? session.startedAt ?? session.requestedPermissionAt ?? session.createdAt;
}

export function getCallDisplayTone(session: ConversationCallSession | null, tone: CallHistoryTone, outcomeLabel: string): CallHistoryTone {
  if (outcomeLabel === 'No answer') return 'noAnswer';
  if (outcomeLabel === 'Missed') return 'missed';
  if (outcomeLabel === 'Declined') return 'declined';
  if (outcomeLabel === 'Connected' || outcomeLabel.startsWith('Connected')) {
    return session?.direction === 'INBOUND' ? 'connected' : 'completed';
  }
  return tone;
}

export function getCallOutcomeLabel(session: ConversationCallSession | null, tone: CallHistoryTone, presentationTitle: string, durationLabel: string | null): string {
  const isInbound = session?.direction === 'INBOUND';
  const isOutbound = session?.direction === 'OUTBOUND';
  const connectedLabel = durationLabel ? `Connected · ${durationLabel}` : 'Connected';
  if (presentationTitle === 'Call cancelled') return 'Cancelled';
  switch (tone) {
    case 'connected':
    case 'completed':
      return connectedLabel;
    case 'ended':
      if (durationLabel) return connectedLabel;
      if (isInbound) return 'Missed';
      if (isOutbound) return 'No answer';
      return presentationTitle;
    case 'missed':
      return isOutbound ? 'No answer' : 'Missed';
    case 'declined':
      return 'Declined';
    case 'ringing':
      return 'Ringing';
    default:
      return presentationTitle;
  }
}

export function getCallAgentLabel(session: ConversationCallSession | null): string | null {
  if (!session) return null;
  const inbound = session.direction === 'INBOUND';
  const names = inbound
    ? [session.claimedBy, session.initiatedBy, session.conversation?.assignee]
    : [session.initiatedBy, session.claimedBy, session.conversation?.assignee];
  for (const member of names) {
    const label = member?.userName?.trim() || member?.userEmail?.trim() || '';
    if (label) return label;
  }
  return null;
}

const CALL_TONE_STYLES: Record<CallHistoryTone, { text: string; iconBg: string; iconColor: string }> = {
  noAnswer: { text: '#d97706', iconBg: '#fffbeb', iconColor: '#d97706' },
  permission: { text: '#d97706', iconBg: '#fffbeb', iconColor: '#d97706' },
  permissionGranted: { text: '#059669', iconBg: '#ecfdf5', iconColor: '#059669' },
  permissionDenied: { text: '#e11d48', iconBg: '#fff1f2', iconColor: '#e11d48' },
  permissionExpired: { text: '#d97706', iconBg: '#fffbeb', iconColor: '#d97706' },
  ringing: { text: '#0284c7', iconBg: '#f0f9ff', iconColor: '#0284c7' },
  connected: { text: '#059669', iconBg: '#ecfdf5', iconColor: '#059669' },
  completed: { text: '#059669', iconBg: '#ecfdf5', iconColor: '#059669' },
  missed: { text: '#e11d48', iconBg: '#fff1f2', iconColor: '#e11d48' },
  declined: { text: '#e11d48', iconBg: '#fff1f2', iconColor: '#e11d48' },
  failed: { text: '#e11d48', iconBg: '#fff1f2', iconColor: '#e11d48' },
  ended: { text: '#334155', iconBg: '#f1f5f9', iconColor: '#475569' },
  requested: { text: '#334155', iconBg: '#f1f5f9', iconColor: '#475569' },
};

export function getCallHistoryToneStyles(tone: CallHistoryTone): { text: string; iconBg: string; iconColor: string } {
  return CALL_TONE_STYLES[tone] ?? CALL_TONE_STYLES.requested;
}

export type ConversationTimelineEntry<TMessage extends MessageLike = MessageLike> =
  | { kind: 'message'; id: string; timestamp: number; message: TMessage }
  | { kind: 'call'; id: string; timestamp: number; session: ConversationCallSession }
  | { kind: 'assignment'; id: string; timestamp: number; event: ConversationAssignmentEvent };

export type AssignmentEventPresentation = {
  actorLabel: string;
  actionLabel: string;
  targetLabel: string | null;
  body: string;
};

function getAssignmentMemberLabel(member: ConversationAssignmentMember | null, fallback = 'Someone') {
  if (!member) return fallback;
  if (member.userName?.trim()) return member.userName.trim();
  if (member.userEmail?.trim()) return member.userEmail.trim();
  return fallback;
}

function getAssignmentActorLabel(event: ConversationAssignmentEvent) {
  if (event.reason.startsWith('AI_')) return 'System';
  if (event.actedBy) return getAssignmentMemberLabel(event.actedBy);
  if (event.reason === 'DEFAULT_OWNER' || event.reason === 'ROUND_ROBIN') return 'System';
  return getAssignmentMemberLabel(event.actedBy);
}

export function getAssignmentEventPresentation(event: ConversationAssignmentEvent): AssignmentEventPresentation {
  const actorLabel = getAssignmentActorLabel(event);
  if (event.reason === 'AI_ASSIGNED') {
    const name = event.toAiAgent?.name ?? 'AI Agent';
    return { actorLabel, actionLabel: 'assigned', targetLabel: name, body: `AI Agent ${name} was assigned to this conversation` };
  }
  if (event.reason === 'AI_HANDOFF') {
    const target = event.toMember ? getAssignmentMemberLabel(event.toMember) : 'a human agent';
    return { actorLabel, actionLabel: 'handed off to', targetLabel: target,
      body: `AI Agent ${event.fromAiAgent?.name ?? ''} handed off to ${target}${event.note ? `: ${event.note}` : ''}` };
  }
  if (event.reason === 'AI_HANDOFF_PENDING') {
    return { actorLabel, actionLabel: 'requested a human handoff', targetLabel: null,
      body: `AI Agent handoff is pending${event.note ? `: ${event.note}` : ''}` };
  }
  const fromLabel = event.fromMember ? getAssignmentMemberLabel(event.fromMember, 'someone') : null;
  const toLabel = event.toMember ? getAssignmentMemberLabel(event.toMember, 'someone') : null;

  if (event.reason === 'SELF') {
    if (event.toMember?.workspaceMemberId && event.actedBy?.workspaceMemberId === event.toMember.workspaceMemberId) {
      return {
        actorLabel,
        actionLabel: 'assigned',
        targetLabel: 'themselves',
        body: `${actorLabel} assigned this conversation to themselves`,
      };
    }
    return {
      actorLabel,
      actionLabel: 'assigned',
      targetLabel: toLabel,
      body: `${actorLabel} self-assigned this conversation`,
    };
  }

  if (event.reason === 'UNASSIGNED' || (!event.toMember && event.fromMember)) {
    return {
      actorLabel,
      actionLabel: 'unassigned this conversation',
      targetLabel: null,
      body: `${actorLabel} unassigned this conversation`,
    };
  }

  if (event.reason === 'REASSIGNED' || (event.fromMember && event.toMember)) {
    if (event.fromMember && event.toMember) {
      return {
        actorLabel,
        actionLabel: 'reassigned',
        targetLabel: toLabel,
        body: `${actorLabel} reassigned the conversation from ${fromLabel} to ${toLabel}`,
      };
    }
    if (event.toMember) {
      return {
        actorLabel,
        actionLabel: 'assigned',
        targetLabel: toLabel,
        body: `${actorLabel} assigned ${toLabel} to this conversation`,
      };
    }
  }

  if (event.toMember) {
    return {
      actorLabel,
      actionLabel: 'assigned',
      targetLabel: toLabel,
      body: `${actorLabel} assigned ${toLabel} to this conversation`,
    };
  }

  if (event.fromMember) {
    return {
      actorLabel,
      actionLabel: 'unassigned this conversation',
      targetLabel: null,
      body: `${actorLabel} unassigned this conversation`,
    };
  }

  return {
    actorLabel,
    actionLabel: 'updated the assignment',
    targetLabel: null,
    body: actorLabel === 'System'
      ? 'System updated the assignment for this conversation'
      : 'Someone updated the assignment for this conversation',
  };
}

function readMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = decoded.replace(
      /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
      (match, entity: string) => {
        const normalized = `${entity}`.toLowerCase();
        if (normalized.startsWith('#x')) {
          const codePoint = Number.parseInt(normalized.slice(2), 16);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        if (normalized.startsWith('#')) {
          const codePoint = Number.parseInt(normalized.slice(1), 10);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        return HTML_NAMED_ENTITIES[normalized] ?? match;
      },
    );
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function resolveReferralPreviewLabel(
  metadata: Record<string, unknown>,
  referral: Record<string, unknown> | null,
): string | null {
  const explicitLabel = readTrimmedString(referral?.previewLabel);
  if (explicitLabel) return explicitLabel;

  const metadataSource = readTrimmedString(metadata.source);
  const referralSource = readTrimmedString(referral?.sourceType)?.toUpperCase();

  if (
    metadataSource === 'whatsapp_ctwa_referral'
    || metadataSource === 'messenger_ad_referral'
    || referralSource === 'ADS'
  ) {
    return 'Ad click';
  }

  return metadataSource === 'messenger_referral' ? 'Referral' : null;
}

function buildFacebookPostUrl(postId: string | null): string | null {
  if (!postId || !/^\d+_\d+$/.test(postId)) return null;
  const [pageId, storyId] = postId.split('_');
  return `https://www.facebook.com/${pageId}/posts/${storyId}`;
}

export type MessageReferralPreview = {
  previewLabel: string;
  body: string | null;
  headline: string | null;
  pageName: string | null;
  imageUrl: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  sourceUrl: string | null;
  welcomeMessageText: string | null;
};

/** Mirrors osaas-frontend `getMessageReferralPreview` for CTWA / Messenger ad referrals. */
export function getMessageReferralPreview(
  message: { metadata?: unknown },
  fallbackPageName?: string | null,
): MessageReferralPreview | null {
  const metadata = readMetadataRecord(message.metadata);
  if (!metadata) return null;

  const referral = readMetadataRecord(metadata.referral);
  if (!referral) return null;

  const previewLabel = resolveReferralPreviewLabel(metadata, referral);
  if (!previewLabel) return null;

  const postId = readTrimmedString(referral.postId);
  const emptyToNull = (value: string | null) => (value && value.length > 0 ? value : null);

  return {
    previewLabel: decodeHtmlEntities(previewLabel),
    body: emptyToNull(decodeHtmlEntities(readTrimmedString(referral.body) ?? '')),
    headline: emptyToNull(decodeHtmlEntities(readTrimmedString(referral.headline) ?? '')),
    pageName: emptyToNull(
      decodeHtmlEntities(readTrimmedString(referral.pageName) ?? fallbackPageName ?? ''),
    ),
    imageUrl: readTrimmedString(referral.imageUrl),
    mediaUrl: readTrimmedString(referral.mediaUrl) ?? readTrimmedString(referral.videoUrl),
    thumbnailUrl: readTrimmedString(referral.thumbnailUrl),
    mediaType: readTrimmedString(referral.mediaType),
    sourceUrl: readTrimmedString(referral.sourceUrl) ?? buildFacebookPostUrl(postId),
    welcomeMessageText: emptyToNull(
      decodeHtmlEntities(readTrimmedString(referral.welcomeMessageText) ?? ''),
    ),
  };
}

export function getMessageListKey(message: MessageLike & { metadata?: any }): string {
  const clientKey = typeof message.metadata?.clientKey === 'string' ? message.metadata.clientKey : null;
  return clientKey || message.id;
}

export function buildConversationTimeline<TMessage extends MessageLike>(
  messages: TMessage[],
  callSessions: ConversationCallSession[],
  assignmentEvents: ConversationAssignmentEvent[] = [],
): ConversationTimelineEntry<TMessage>[] {
  const entries: ConversationTimelineEntry<TMessage>[] = [];
  for (const message of messages) {
    if (isInlineReactionMessage(message)) continue;
    const timestamp = new Date(message.sentAt ?? message.createdAt ?? '').getTime();
    entries.push({ kind: 'message', id: getMessageListKey(message), timestamp: Number.isNaN(timestamp) ? 0 : timestamp, message });
  }
  for (const session of callSessions) {
    const timestamp = new Date(getCallSessionTimelineTimestamp(session)).getTime();
    entries.push({ kind: 'call', id: session.id, timestamp: Number.isNaN(timestamp) ? 0 : timestamp, session });
  }
  for (const event of assignmentEvents) {
    const timestamp = new Date(event.createdAt).getTime();
    entries.push({ kind: 'assignment', id: event.id, timestamp: Number.isNaN(timestamp) ? 0 : timestamp, event });
  }
  entries.sort((a, b) => (a.timestamp - b.timestamp) || a.id.localeCompare(b.id));
  return entries;
}

/** Read the submitted webchat form using its original field labels. */
export function readWebchatPostchatForm(metadata: unknown) {
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const data = record(metadata);
  const fields = record(data?.fields);
  if (data?.source !== 'webchat_postchat' || !fields) return null;
  const labels = record(data.fieldLabels);
  const fieldTypes = record(data.fieldTypes);
  return {
    formName: typeof data.formName === 'string' && data.formName.trim() ? data.formName.trim() : 'Post-chat form',
    values: Object.entries(fields).flatMap(([id, value]) => {
      if (typeof value !== 'string' || !value.trim()) return [];
      const label = labels?.[id];
      const resolvedLabel = typeof label === 'string' && label.trim() ? label.trim() : id.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase());
      const normalizedId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedLabel = resolvedLabel.toLowerCase();
      const isRating = String(fieldTypes?.[id] ?? '').toUpperCase() === 'RATING' || normalizedId === 'rating' || (/rating|experience|score/.test(normalizedLabel) && /^[1-5]$/.test(value.trim()));
      return [{ id, label: resolvedLabel, type: isRating ? 'RATING' as const : 'TEXT' as const, value: value.trim() }];
    }),
  };
}
