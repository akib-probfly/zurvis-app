import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Mail, MailOpen, MoreVertical, PackagePlus, Phone, RotateCcw, UserRound } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { ConversationAssignmentSheet } from '../components/ConversationAssignmentSheet';
import { ContactDetailsPanel, formatPhoneNumberDisplay, formatUsernameDisplay } from '../components/ContactDetailsPanel';
import { InCallConversationHeader } from '../components/InCallConversationHeader';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { showNotice } from '../components/AppToast';
import { SwipeToReply } from '../components/SwipeToReply';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch, isApiErrorWithStatus, uploadFile } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getRealtimeConnectionStatus, setActiveConversationId, subscribeRealtimeConnectionStatus } from '../api/realtime';
import { markRecentLocalMessageSend } from '../lib/inbox-realtime-suppression';
import { preserveMessageTextDuringAttachmentHydration } from '../lib/inbox-message-cache';
import { pollingWhileUnlocked } from '../lib/billing-lock';
import { unmuteConversationNotifications } from '../lib/muted-conversations';
import { setUnreadOverride } from '../lib/unread-count-override';
import {
  adjustInboxUnreadConversationCount,
  setConversationUnreadInCache,
} from '../lib/inbox-unread-cache';
import { ConversationComposer } from '../components/ConversationComposer';
import type { ComposerSendPayload, SendAttachment } from '../components/ConversationComposer';
import { ColorfulAvatar } from '../components/ColorfulAvatar';
import { ConversationSkeleton, ComposerSkeleton } from '../components/Skeleton';
import { InboxPatternBackground } from '../components/InboxPatternBackground';
import { MediaViewer } from '../components/MediaViewer';
import { VideoPlayerModal } from '../components/VideoPlayer';
import { MessageBubble } from '../components/MessageBubble';
import { AssignmentHistoryItem } from '../components/AssignmentHistoryItem';
import { ReactionPicker } from '../components/ReactionPicker';
import { fetchConversationAssignmentEvents, fetchConversationCallSessions, fetchConversationMessages, fetchMessagesPage, markConversationRead, markConversationUnread, sendReaction, sendTemplateMessage, updateConversationAssignment, updateConversationStar, updateConversationStatus, type AssigneeFilterOption, type ConversationCallSession } from '../api/inbox';
import { fetchConversationOrderDraft } from '../api/orders';
import { fetchConversationAttachments } from '../api/conversationDetails';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InboxStackParamList } from '../navigation/InboxStack';
import { buildConversationTimeline, buildReactionGroups, formatTimelineDayLabel, getConversationTitle, getConversationWindowLabel, getMessengerMessagingAvailability, getReplyPreviewBody, getVoiceCallButtonState, isConversationCustomerWindowExpired, isInlineReactionMessage, isLiveCallSession, type ConversationTimelineEntry, type MessengerMessagingMode } from '../lib/inbox-utils';
import { CallHistoryItem } from '../components/CallHistoryItem';
import { useCallController } from '../providers/CallControllerProvider';
import { getCallChrome, setFocusedCallConversationId, subscribeCallChrome, rememberCallParty, getCallUiRevision } from '../lib/call-chrome';
import { fetchWebchatSettings } from '../api/channels';
import { fetchMyWorkspaces } from '../api/workspaces';
import { isWhatsappCallSupported } from '../lib/whatsapp-calling';
import { useInboxAppearance } from '../hooks/useInboxAppearance';
import { useConversationScrollAnchor } from '../hooks/useConversationScrollAnchor';
import { getCountryCodeFromPhone, getCountryFlag } from '../lib/countryFromPhone';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type Attachment = { id: string; messageId?: string | null; mediaType: string; mimeType: string; originalName: string | null; downloadUrl: string; previewUrl: string | null; thumbnailUrl: string | null; durationMs: number | null; localPreviewUri?: string | null };
type Message = { id: string; workspaceId?: string; direction: 'INBOUND' | 'OUTBOUND'; senderType?: string | null; sender?: { userName?: string | null; userEmail?: string | null } | null; type: string; text: string | null; deliveryStatus?: string; failureReason?: string | null; campaignId?: string | null; campaignName?: string | null; templateName?: string | null; templateComponentsJson?: unknown; replyToMessageId?: string | null; replyTo?: { id?: string; sender?: { userName?: string | null } | null; text?: string | null; type?: string; attachments?: Attachment[] } | null; sentAt?: string | null; createdAt?: string; metadata?: any; orderConfirmation?: { eligible: boolean; confidence?: number; reason?: string } | null; attachments?: Attachment[] };
type MediaItem = { attachId: string; src: string; mediaType: string };
type TimelineRow = { entry: ConversationTimelineEntry<Message>; showDivider: boolean };

function readOrderRecipientFromMessage(text: string | null) {
  const fields: { name?: string; phone?: string; address?: string } = {};
  for (const line of (text ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*(name|address|number|phone)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === 'name') fields.name = match[2];
    else if (key === 'address') fields.address = match[2];
    else fields.phone = match[2];
  }
  return fields;
}

type IdleCallbackHandle = number | ReturnType<typeof setTimeout>;
type IdleCallbackWindow = typeof globalThis & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdle(callback: () => void): { cancel: () => void } {
  const idleWindow = globalThis as IdleCallbackWindow;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback);
    return { cancel: () => idleWindow.cancelIdleCallback?.(handle) };
  }
  const handle: IdleCallbackHandle = setTimeout(callback, 0);
  return { cancel: () => clearTimeout(handle as ReturnType<typeof setTimeout>) };
}

function timelineKeyExtractor(row: TimelineRow) {
  return `${row.entry.kind}:${row.entry.id}`;
}

function TimelineSeparator() {
  return <View style={styles.rowGap} />;
}

// Following new messages is handled explicitly below; native auto-scroll must
// not compete with preserving a historical message during pagination.
const timelineVisibleContentPosition = { minIndexForVisible: 0 };

const TimelineRowItem = memo(function TimelineRowItem({
  row,
  highlighted,
  channelName,
  channelType,
  channelId,
  replyTarget,
  reactions,
  dayLabelBg,
  dayLabelColor,
  onReply,
  onReact,
  onImage,
  onVideo,
  onJumpToMessage,
  onCreateOrderFromMessage,
  creatingOrderDraftFor,
}: {
  row: TimelineRow;
  highlighted: boolean;
  channelName?: string | null;
  channelType?: string | null;
  channelId?: string | null;
  replyTarget: Message | null;
  reactions?: Array<{ emoji: string; count: number }>;
  dayLabelBg: string;
  dayLabelColor: string;
  onReply: (message: Message) => void;
  onReact: (message: Message) => void;
  onImage: (attachId: string) => void;
  onVideo: (attachment: any) => void;
  onJumpToMessage: (messageId: string) => void;
  onCreateOrderFromMessage?: (message: Message) => void;
  creatingOrderDraftFor: string | null;
}) {
  const { entry, showDivider } = row;
  return (
    <View style={[styles.timelineRow, highlighted ? styles.highlightRow : undefined]}>
      {showDivider ? <Text style={[styles.dayDivider, { backgroundColor: dayLabelBg, color: dayLabelColor }]}>{formatTimelineDayLabel(new Date(entry.timestamp))}</Text> : null}
      {entry.kind === 'call' ? (
        <CallHistoryItem session={entry.session} />
      ) : entry.kind === 'assignment' ? (
        <AssignmentHistoryItem event={entry.event} />
      ) : (
        <SwipeableMessage
          message={entry.message}
          channelName={channelName}
          channelType={channelType}
          channelId={channelId}
          setReplyTo={onReply}
          setReactTarget={onReact}
          onImage={onImage}
          onVideo={onVideo}
          replyTarget={replyTarget}
          reactions={reactions}
          onJumpToMessage={onJumpToMessage}
          onCreateOrderFromMessage={onCreateOrderFromMessage}
          creatingOrderDraftFor={creatingOrderDraftFor}
        />
      )}
    </View>
  );
});
const apiUrl = (value: string | null) => {
  if (!value) return null;
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  try {
    const parsed = new URL(value, `${base}/`);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0') {
      const apiBase = new URL(base);
      return `${apiBase.origin}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return `${base.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
  }
};

export function ConversationScreen() {
  const insets = useSafeAreaInsets(); const navigation = useNavigation<NativeStackNavigationProp<InboxStackParamList, 'Conversation'>>(); const route = useRoute<RouteProp<InboxStackParamList, 'Conversation'>>(); const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const [secondaryDataReady, setSecondaryDataReady] = useState(false);
  const realtimeStatus = useSyncExternalStore(subscribeRealtimeConnectionStatus, getRealtimeConnectionStatus);
  const { session } = useAuth();
  const { colors } = useTheme();
  const callController = useCallController();
  const listRef = useRef<FlatList>(null);
  const [draft, setDraft] = useState(''); const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [gallery, setGallery] = useState<MediaItem[]>([]); const [galleryIndex, setGalleryIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [reactTarget, setReactTarget] = useState<Message | null>(null);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [creatingOrderDraftFor, setCreatingOrderDraftFor] = useState<string | null>(null);
  const [header, setHeader] = useState({ isStarred: false, unreadCount: 0, status: 'OPEN' as string, conversation: null as any });
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [messengerMessagingMode, setMessengerMessagingMode] = useState<MessengerMessagingMode>('STANDARD');
  const [windowLabelNow, setWindowLabelNow] = useState(() => new Date());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedMessengerModeConversationIdRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  const loadingOlderRef = useRef(false);
  const listReadyRef = useRef(false);
  const timelineRef = useRef<ConversationTimelineEntry<Message>[]>([]);
  const isAtBottomRef = useRef(true);
  const olderLoadLockOffsetRef = useRef<number | null>(null);
  const lastScrollOffsetRef = useRef(0);
  const latestMessageIdsRef = useRef<Set<string>>(new Set());
  const pinToLatestRef = useRef(true);
  const {
    register: registerTimelineNode, onViewableItemsChanged, capture: captureScrollAnchor,
    restore: restoreScrollAnchor, cancel: cancelScrollAnchor, isRestoring: isRestoringScrollAnchor,
  } = useConversationScrollAnchor(listRef, lastScrollOffsetRef, olderMessages, route.params.conversationId);

  const pendingOptimisticRef = useRef<Map<string, Message>>(new Map());
  const localImagePreviewsRef = useRef<Map<string, Array<string | null>>>(new Map());
  const awaitingDeliveryRef = useRef(false);
  const deliveryPollUntilRef = useRef(0);

  const handleBack = useCallback(() => {
    if (navigation.getState().index > 0) {
      navigation.goBack();
      return;
    }
    navigation.navigate('InboxList');
  }, [navigation]);

  const updateAwaitingDelivery = (items: Message[]) => {
    const cutoff = Date.now() - 90_000;
    awaitingDeliveryRef.current = items.some((message) => {
      if (message.direction !== 'OUTBOUND') return false;
      const status = message.deliveryStatus ?? '';
      if (status !== 'SENDING' && status !== 'QUEUED' && status !== 'SENT') return false;
      const ts = new Date(message.sentAt ?? message.createdAt ?? 0).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (!awaitingDeliveryRef.current) deliveryPollUntilRef.current = 0;
  };

  const messages = useQuery({
    queryKey: ['messages', route.params.conversationId],
    queryFn: async () => {
      // The messages endpoint includes each message's attachments. Avoid the broad
      // conversation attachment request here; it was duplicating every page load.
      const page = await fetchConversationMessages<Message>(route.params.conversationId);
      const cachedItems = queryClient.getQueryData<{ items?: Message[] }>(['messages', route.params.conversationId])?.items;
      const cachedMessagesById = new Map((cachedItems ?? []).map((message) => [message.id, message]));
      const hydratedItems = preserveMessageTextDuringAttachmentHydration(page.items, cachedItems);
      const items: Message[] = hydratedItems.map((message) => {
        const messageAttachments = message.attachments ?? [];
        const localImagePreviews = localImagePreviewsRef.current.get(message.id);
        const attachmentsWithLocalPreview = localImagePreviews
          ? messageAttachments.map((attachment, index) => ({ ...attachment, localPreviewUri: localImagePreviews[index] ?? null }))
          : messageAttachments;
        const cachedMetadata = cachedMessagesById.get(message.id)?.metadata;
        const cachedBatchId = cachedMetadata?.mediaBatchId;
        return {
          ...message,
          ...(typeof cachedBatchId === 'string' ? { metadata: {
            ...message.metadata, mediaBatchId: cachedBatchId, mediaBatchIndex: cachedMetadata?.mediaBatchIndex,
          } } : {}),
          attachments: attachmentsWithLocalPreview,
        };
      });

      // Keep in-flight optimistic bubbles across polling/refetch overwrites.
      const serverIds = new Set(items.map((item) => item.id));
      pendingOptimisticRef.current.forEach((optimistic, tempId) => {
        const serverId = typeof optimistic.metadata?.serverId === 'string' ? optimistic.metadata.serverId : null;
        const clientKey = typeof optimistic.metadata?.clientKey === 'string' ? optimistic.metadata.clientKey : tempId;
        if (serverId && serverIds.has(serverId)) {
          const idx = items.findIndex((item) => item.id === serverId);
          if (idx >= 0) {
            items[idx] = {
              ...items[idx],
              metadata: {
                ...(typeof items[idx].metadata === 'object' && items[idx].metadata ? items[idx].metadata : {}),
                clientKey,
              },
            };
          }
          pendingOptimisticRef.current.delete(tempId);
          return;
        }
        if (!serverIds.has(tempId) && !items.some((item) => item.metadata?.clientKey === clientKey)) {
          items.push(optimistic);
        }
      });

      updateAwaitingDelivery(items);

      return { items, nextCursor: page.nextCursor, hasMore: page.hasMore, conversation: page.conversation };
    },
    enabled: isFocused,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    // Render cached messages immediately when returning to a thread. Realtime
    // events and the safety poll keep the active conversation current, while
    // stale cached data refreshes in the background.
    refetchOnMount: true,
    refetchOnReconnect: false,
    // Realtime updates the open thread; keep a slow poll as a safety net for zombie sockets.
    // Briefly poll faster after send for delivery receipts.
    refetchInterval: pollingWhileUnlocked(() => {
      if (!isFocused) return false;
      if (pendingOptimisticRef.current.size > 0) return 2500;
      if (awaitingDeliveryRef.current && Date.now() < deliveryPollUntilRef.current) return 2500;
      return realtimeStatus === 'connected' ? 45_000 : 15_000;
    }),
    refetchOnWindowFocus: false,
  });
  const workspacesQuery = useQuery({
    queryKey: ['workspaces', 'mine'],
    queryFn: fetchMyWorkspaces,
    staleTime: 30_000,
  });
  const attachmentsQuery = useQuery({
    queryKey: ['conversation-attachments', route.params.conversationId],
    queryFn: () => fetchConversationAttachments({ conversationId: route.params.conversationId, limit: 100 }),
    enabled: isFocused && secondaryDataReady,
    staleTime: 15000,
  });

  const suppressAutoMarkReadRef = useRef(false);
  const lastAutoMarkedReadSignatureRef = useRef<string | null>(null);
  const manualReadToggleRef = useRef(false);

  useEffect(() => {
    setSecondaryDataReady(false);
    if (!isFocused) return;
    const task = scheduleIdle(() => {
      setSecondaryDataReady(true);
    });
    return task.cancel;
  }, [isFocused, route.params.conversationId]);

  useEffect(() => {
    suppressAutoMarkReadRef.current = false;
    lastAutoMarkedReadSignatureRef.current = null;
    awaitingDeliveryRef.current = false;
    deliveryPollUntilRef.current = 0;
    setOlderMessages([]);
    setOlderCursor(null);
    setHasMoreOlder(true);
    loadingOlderRef.current = false;
    listReadyRef.current = false;
    isAtBottomRef.current = true;
    olderLoadLockOffsetRef.current = null;
    lastScrollOffsetRef.current = 0;
    pinToLatestRef.current = true;
    setAtBottom(true);
  }, [route.params.conversationId]);

  useEffect(() => {
    void unmuteConversationNotifications(route.params.conversationId);
  }, [route.params.conversationId]);

  useEffect(() => {
    const intervalId = setInterval(() => setWindowLabelNow(new Date()), 30_000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (messages.data?.conversation) {
      setHeader((current) => ({
        ...current,
        conversation: messages.data.conversation,
        isStarred: messages.data.conversation.isStarred ?? current.isStarred,
        unreadCount: (suppressAutoMarkReadRef.current ? current.unreadCount : null) ?? messages.data.conversation.unreadCount ?? current.unreadCount,
        status: messages.data.conversation.status ?? current.status,
      }));
    }
  }, [messages.data?.conversation]);

  useEffect(() => {
    updateAwaitingDelivery(messages.data?.items ?? []);
  }, [messages.data?.items]);

  const reactionChannelType = (header.conversation ?? (messages.data as any)?.conversation ?? null)?.channel?.channelType ?? route.params.channelType;
  const allMessages = useMemo(() => {
    const seen = new Set<string>();
    const merged: Message[] = [];
    [...olderMessages, ...(messages.data?.items ?? [])].forEach((message) => {
      const key = typeof message.metadata?.clientKey === 'string' ? message.metadata.clientKey : message.id;
      if (seen.has(key) || seen.has(message.id)) return;
      seen.add(key);
      seen.add(message.id);
      merged.push(message);
    });
    return merged;
  }, [olderMessages, messages.data?.items]);
  const latestMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages.data?.items ?? []) ids.add(message.id);
    return ids;
  }, [messages.data?.items]);
  latestMessageIdsRef.current = latestMessageIds;
  hasMoreRef.current = messages.data?.hasMore ?? false;
  const reactionGroups = useMemo(() => buildReactionGroups(allMessages, reactionChannelType), [allMessages, reactionChannelType]);

  const messageById = useMemo(() => { const map = new Map<string, Message>(); allMessages.forEach((message) => map.set(message.id, message)); return map; }, [allMessages]);

  const send = useMutation({
    mutationFn: async (payload?: ComposerSendPayload) => {
      const selectedAttachments = payload?.attachments ?? attachments;
      const draftText = payload?.text !== undefined ? payload.text : draft;
      const workspaceId = route.params.workspaceId ?? allMessages.find((message) => message.workspaceId)?.workspaceId;
      if (!workspaceId && selectedAttachments.length) throw new Error('Workspace information is unavailable. Please reload the conversation.');
      const attachmentIds: string[] = [];
      let quickReplySnippetId: string | undefined;
      for (const selected of selectedAttachments) {
        if (selected.fileId) {
          attachmentIds.push(selected.fileId);
          if (selected.quickReplySnippetId) quickReplySnippetId = selected.quickReplySnippetId;
          continue;
        }
        const uploaded = await uploadFile('/files/upload', selected.uri, selected.name, selected.mimeType, workspaceId ? { workspaceId } : {});
        attachmentIds.push(uploaded.id);
      }
      const text = draftText.replace(/\u200B/g, '').trim() || undefined;
      const type = selectedAttachments.length ? (selectedAttachments[0].type === 'VOICE' ? 'VOICE' : selectedAttachments[0].type) : 'TEXT';
      const channelTypeForSend = (header.conversation?.channel?.channelType ?? route.params.channelType ?? '').toUpperCase();
      const response = await apiFetch<any>(`/conversations/${route.params.conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          type,
          text,
          attachmentIds,
          quickReplySnippetId,
          replyToMessageId: replyTo?.id,
          ...(channelTypeForSend === 'MESSENGER' ? { messengerMessagingMode } : {}),
        }),
      });
      // API returns { message, messages, conversation } — not a bare message.
      const createdMessages: Message[] = Array.isArray(response?.messages)
        ? response.messages.filter((message: unknown): message is Message => Boolean(message && typeof message === 'object' && 'id' in message))
        : response?.message?.id
          ? [response.message as Message]
          : [];
      const created: Message | null = createdMessages[createdMessages.length - 1]
        ?? (response?.id && response?.direction ? response as Message : null);
      if (!created?.id) throw new Error('Message was sent but the server response was incomplete.');
      return { ...created, __createdMessages: createdMessages } as Message;
    },
    onMutate: async (payload) => {
      const selectedAttachments = payload?.attachments ?? attachments;
      const draftText = payload?.text !== undefined ? payload.text : draft;
      await queryClient.cancelQueries({ queryKey: ['messages', route.params.conversationId] });
      const previous = queryClient.getQueryData<any>(['messages', route.params.conversationId]);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const clientKey = tempId;
      const text = draftText.replace(/\u200B/g, '').trim() || undefined;
      const type = selectedAttachments.length ? (selectedAttachments[0].type === 'VOICE' ? 'VOICE' : selectedAttachments[0].type) : 'TEXT';
      const optimistic: Message = {
        id: tempId,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        type,
        text: text ?? null,
        deliveryStatus: 'SENDING',
        sender: { userName: session?.user?.name ?? 'You' },
        replyToMessageId: replyTo?.id ?? null,
        replyTo: replyTo ? { sender: replyTo.sender ?? null, text: replyTo.text } : undefined,
        createdAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        metadata: { optimistic: true, clientKey },
        attachments: selectedAttachments.map((selected) => ({
          id: `${tempId}-${selected.uri}`,
          mediaType: selected.type,
          mimeType: selected.mimeType,
          originalName: selected.name,
          downloadUrl: selected.uri,
          previewUrl: selected.type === 'IMAGE' || selected.type === 'VIDEO' ? selected.uri : null,
          thumbnailUrl: selected.type === 'IMAGE' || selected.type === 'VIDEO' ? selected.uri : null,
          durationMs: selected.durationMs ?? null,
        })),
      };
      pendingOptimisticRef.current.set(tempId, optimistic);
      setDraft(''); setAttachments([]); setReplyTo(null);
      queryClient.setQueryData<any>(['messages', route.params.conversationId], (current: any) => {
        if (!current || !Array.isArray(current.items)) return current;
        return { ...current, items: [...current.items, optimistic] };
      });
      pinToLatestRef.current = true;
      cancelScrollAnchor();
      isAtBottomRef.current = true;
      setAtBottom(true);
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
      return {
        tempId,
        clientKey,
        previous,
        previousDraft: draft,
        previousAttachments: payload?.attachments ?? attachments,
        previousReplyTo: replyTo,
      };
    },
    onSuccess: (created, _vars, context) => {
      markRecentLocalMessageSend(route.params.conversationId, created.id);
      // An agent's own message must never make this conversation unread.
      setUnreadOverride(route.params.conversationId, 0);
      setConversationUnreadInCache(queryClient, route.params.conversationId, 0);
      awaitingDeliveryRef.current = true;
      deliveryPollUntilRef.current = Date.now() + 45_000;
      const clientKey = context?.clientKey ?? context?.tempId;
      const optimisticAttachments = context?.tempId ? pendingOptimisticRef.current.get(context.tempId)?.attachments ?? [] : [];
      const sentAttachments = context?.previousAttachments ?? [];
      const imageAttachmentCount = sentAttachments.filter((attachment) =>
        attachment.type === 'IMAGE' || attachment.mimeType.toLowerCase().startsWith('image/'),
      ).length;
      const isMultiImageSend = imageAttachmentCount > 1;
      const createdMessages = (created as Message & { __createdMessages?: Message[] }).__createdMessages ?? [created];
      const confirmedMessages = createdMessages.map((createdMessage, messageIndex) => {
        const messageAttachments = (createdMessage.attachments ?? []).map((attachment, index) => {
          const optimisticAttachment = optimisticAttachments[index];
          const localPreviewUri = messageIndex === createdMessages.length - 1
            && (attachment.mediaType ?? '').toUpperCase() === 'IMAGE'
            ? optimisticAttachment?.previewUrl ?? optimisticAttachment?.thumbnailUrl ?? null
            : null;
          return { ...attachment, localPreviewUri };
        });
        return {
          ...createdMessage,
          attachments: messageAttachments,
          deliveryStatus: createdMessage.deliveryStatus && createdMessage.deliveryStatus !== 'SENDING' ? createdMessage.deliveryStatus : 'SENT',
          metadata: {
            ...(typeof createdMessage.metadata === 'object' && createdMessage.metadata ? createdMessage.metadata : {}),
            clientKey: messageIndex === createdMessages.length - 1 ? clientKey : `${clientKey}:${messageIndex}`,
            ...(isMultiImageSend
              ? { mediaBatchId: clientKey, mediaBatchIndex: messageIndex }
              : {}),
            optimistic: false,
          },
        } as Message;
      });
      const confirmed = confirmedMessages[confirmedMessages.length - 1] ?? created;
      const imageMessage = confirmedMessages.find((message) => (message.attachments ?? []).some((attachment) => (attachment.mediaType ?? '').toUpperCase() === 'IMAGE'));
      if (imageMessage && context?.tempId) {
        localImagePreviewsRef.current.set(imageMessage.id, (imageMessage.attachments ?? []).map((attachment) => attachment.localPreviewUri ?? null));
      }
      // Keep until a later refetch sees the server id — preserves clientKey / avoids blink.
      if (context?.tempId) {
        pendingOptimisticRef.current.set(context.tempId, {
          ...confirmed,
          metadata: { ...confirmed.metadata, serverId: confirmed.id, clientKey },
        });
      }
      queryClient.setQueryData<any>(['messages', route.params.conversationId], (current: any) => {
        if (!current || !Array.isArray(current.items)) return current;
        let replaced = false;
        const items = current.items.flatMap((item: any) => {
          if (item.id === context?.tempId || item.metadata?.clientKey === clientKey || item.id === confirmed.id) {
            replaced = true;
            return confirmedMessages;
          }
          return [item];
        });
        if (!replaced) items.push(...confirmedMessages);
        // Drop any duplicate server copy that arrived from a racey refetch.
        const deduped: Message[] = [];
        const seen = new Set<string>();
        items.forEach((item: any) => {
          const key = item.metadata?.clientKey || item.id;
          if (seen.has(key) || seen.has(item.id)) return;
          seen.add(key);
          seen.add(item.id);
          deduped.push(item);
        });
        const knownIds = new Set(deduped.map((item) => item.id));
        confirmedMessages.forEach((message) => {
          if (!knownIds.has(message.id)) deduped.push(message);
        });
        return { ...current, items: deduped };
      });
      // Soft-refresh inbox list only — avoid wiping the thread cache (that caused the blink).
      void queryClient.invalidateQueries({ queryKey: ['conversations'], refetchType: 'active' });
    },
    onError: (error, _vars, context) => {
      if (context?.tempId) pendingOptimisticRef.current.delete(context.tempId);
      queryClient.setQueryData<any>(['messages', route.params.conversationId], (current: any) => {
        if (!current || !Array.isArray(current.items)) return current;
        return {
          ...current,
          items: current.items.filter((item: any) => item.id !== context?.tempId && item.metadata?.clientKey !== context?.clientKey),
        };
      });
      if (context?.previousDraft) setDraft(context.previousDraft);
      if (context?.previousAttachments?.length) setAttachments(context.previousAttachments);
      if (context?.previousReplyTo) setReplyTo(context.previousReplyTo);
      showNotice('Could not send message', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) => sendReaction(route.params.conversationId, messageId, emoji, 'REACT'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['messages', route.params.conversationId], refetchType: 'active' }); },
  });

  const starMutation = useMutation({ mutationFn: (isStarred: boolean) => updateConversationStar(route.params.conversationId, isStarred), onSuccess: (_, isStarred) => setHeader((c) => ({ ...c, isStarred })) });
  const readMutation = useMutation({
    mutationFn: () => markConversationRead(route.params.conversationId),
    onMutate: async () => {
      // Match web: an older fetch must not overwrite the optimistic read state.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['conversations'] }),
        queryClient.cancelQueries({ queryKey: ['inbox-unread-count'] }),
        queryClient.cancelQueries({ queryKey: ['messages', route.params.conversationId] }),
      ]);
      suppressAutoMarkReadRef.current = false;
      const previousUnreadCount = header.unreadCount;
      setUnreadOverride(route.params.conversationId, 0);
      setHeader((c) => ({ ...c, unreadCount: 0 }));
      setConversationUnreadInCache(queryClient, route.params.conversationId, 0);
      adjustInboxUnreadConversationCount(queryClient, previousUnreadCount, 0);
      return { previousUnreadCount };
    },
    onError: (error, _vars, context) => {
      const previousUnreadCount = context?.previousUnreadCount ?? 0;
      setUnreadOverride(route.params.conversationId, previousUnreadCount);
      setHeader((c) => ({ ...c, unreadCount: previousUnreadCount }));
      setConversationUnreadInCache(queryClient, route.params.conversationId, previousUnreadCount);
      adjustInboxUnreadConversationCount(queryClient, 0, previousUnreadCount);
      showNotice('Could not mark as read', error instanceof Error ? error.message : 'Please try again.');
      manualReadToggleRef.current = false;
    },
    onSuccess: () => {
      // A successful read is authoritative for the open thread. The API can
      // briefly return a stale unread count while its read receipt propagates.
      // Keep zero locally until a later fetch reports zero, instead of
      // immediately restoring a badge for a message the user just read.
      setUnreadOverride(route.params.conversationId, 0);
      setHeader((c) => ({ ...c, unreadCount: 0 }));
      setConversationUnreadInCache(queryClient, route.params.conversationId, 0);
      void queryClient.invalidateQueries({ queryKey: ['inbox-unread-count'], refetchType: 'active' });
      manualReadToggleRef.current = false;
    },
  });
  const unreadMutation = useMutation({
    mutationFn: () => markConversationUnread(route.params.conversationId),
    onMutate: () => {
      // Stay on the latest messages while viewing — don't auto-read again after a manual unread.
      suppressAutoMarkReadRef.current = true;
      lastAutoMarkedReadSignatureRef.current = null;
      manualReadToggleRef.current = true;
      const previousUnreadCount = header.unreadCount;
      const nextUnreadCount = Math.max(1, previousUnreadCount);
      setUnreadOverride(route.params.conversationId, nextUnreadCount);
      setHeader((c) => ({ ...c, unreadCount: nextUnreadCount }));
      setConversationUnreadInCache(queryClient, route.params.conversationId, nextUnreadCount);
      adjustInboxUnreadConversationCount(queryClient, previousUnreadCount, nextUnreadCount);
      return { previousUnreadCount };
    },
    onError: (error, _vars, context) => {
      const previousUnreadCount = context?.previousUnreadCount ?? 0;
      suppressAutoMarkReadRef.current = false;
      setUnreadOverride(route.params.conversationId, previousUnreadCount);
      setHeader((c) => ({ ...c, unreadCount: previousUnreadCount }));
      setConversationUnreadInCache(queryClient, route.params.conversationId, previousUnreadCount);
      adjustInboxUnreadConversationCount(queryClient, Math.max(1, previousUnreadCount), previousUnreadCount);
      showNotice('Could not mark as unread', error instanceof Error ? error.message : 'Please try again.');
      manualReadToggleRef.current = false;
    },
    onSuccess: (updated) => {
      const nextUnread = typeof updated?.unreadCount === 'number' ? Math.max(1, updated.unreadCount) : 1;
      setUnreadOverride(route.params.conversationId, nextUnread);
      setHeader((c) => ({ ...c, unreadCount: nextUnread }));
      setConversationUnreadInCache(queryClient, route.params.conversationId, nextUnread);
      manualReadToggleRef.current = false;
    },
  });
  const statusMutation = useMutation({
    mutationFn: (status: string) => updateConversationStatus(route.params.conversationId, status as 'OPEN' | 'CLOSED'),
    onSuccess: async (_, status) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      setHeader((c) => ({
        ...c,
        status,
        conversation: c.conversation ? { ...c.conversation, status } : c.conversation,
      }));
      queryClient.setQueryData(['messages', route.params.conversationId], (current: { conversation?: { status?: string } } | undefined) => {
        if (!current?.conversation) return current;
        return { ...current, conversation: { ...current.conversation, status } };
      });
      queryClient.setQueriesData({ queryKey: ['conversations'] }, (current: any) => {
        if (!current?.pages) return current;
        return {
          ...current,
          pages: current.pages.map((page: any) => ({
            ...page,
            items: (page.items ?? []).map((item: any) => (
              item.id === route.params.conversationId ? { ...item, status } : item
            )),
          })),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-count'] });
    },
    onError: (error: Error) => showNotice('Could not update conversation status', error.message || 'Please try again.'),
  });
  const assignmentMutation = useMutation({
    mutationFn: (assignee: AssigneeFilterOption | null) => updateConversationAssignment(route.params.conversationId, assignee?.workspaceMemberId ?? null),
    onSuccess: (_, assignee) => {
      setHeader((c) => ({
        ...c,
        conversation: {
          ...(c.conversation ?? {}),
          assignee: assignee
            ? {
                workspaceMemberId: assignee.workspaceMemberId,
                userName: assignee.name,
                userEmail: assignee.email,
                avatarUrl: assignee.avatarUrl,
              }
            : null,
        },
      }));
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['assignment-events', route.params.conversationId], refetchType: 'all' });
    },
    onError: (error: Error) => showNotice('Could not update assignment', error.message),
  });

  useEffect(() => {
    if (!isFocused || !messages.data || messages.isLoading || messages.isError) return;
    if (readMutation.isPending || !atBottom || suppressAutoMarkReadRef.current) return;

    // Opening the loaded thread is a read even when its cached count is already zero.
    // Key subsequent reads to inbound messages, not the read response's updatedAt.
    const latestInbound = messages.data.items
      .filter((message) => message.direction === 'INBOUND')
      .reduce<Message | null>((latest, message) => !latest ||
        new Date(message.sentAt ?? message.createdAt ?? 0).getTime() > new Date(latest.sentAt ?? latest.createdAt ?? 0).getTime()
        ? message : latest, null);
    const signature = `${route.params.conversationId}:${latestInbound?.id ?? 'opened'}`;
    if (lastAutoMarkedReadSignatureRef.current === signature) return;
    lastAutoMarkedReadSignatureRef.current = signature;
    readMutation.mutate();
  }, [isFocused, messages.data, messages.isLoading, messages.isError, atBottom, readMutation, route.params.conversationId]);

  useEffect(() => {
    if (!isFocused) {
      setActiveConversationId(null);
      return;
    }

    setActiveConversationId(route.params.conversationId);
    return () => setActiveConversationId(null);
  }, [isFocused, route.params.conversationId]);

  useEffect(() => {
    if (!isFocused) {
      setFocusedCallConversationId(null);
      return;
    }
    setFocusedCallConversationId(route.params.conversationId);
    return () => setFocusedCallConversationId(null);
  }, [isFocused, route.params.conversationId]);

  useEffect(() => () => { if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current); }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreOlder || !olderCursor) return;
    loadingOlderRef.current = true;
    olderLoadLockOffsetRef.current = lastScrollOffsetRef.current;
    setLoadingOlder(true);
    try {
      const page = await fetchMessagesPage(route.params.conversationId, olderCursor, 50);
      const latestIds = latestMessageIdsRef.current;
      const items = page.items.map((message: any) => {
        const messageAttachments = message.attachments ?? [];
        return { ...message, attachments: messageAttachments };
      });
      // Capture immediately before inserting, so scrolling while the request is
      // in flight does not restore an outdated position.
      await captureScrollAnchor();
      setOlderMessages((current) => {
        const existing = new Set(current.map((message) => message.id));
        const fresh = items.filter((message) => !existing.has(message.id) && !latestIds.has(message.id));
        return [...fresh, ...current];
      });
      const nextHasMore = Boolean(page.pageInfo?.hasMore && page.pageInfo?.nextCursor) && items.length > 0;
      setOlderCursor(nextHasMore ? (page.pageInfo?.nextCursor ?? null) : null);
      setHasMoreOlder(nextHasMore);
    } catch (error) {
      console.error('[conversation] load older failed', error);
      olderLoadLockOffsetRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [olderCursor, hasMoreOlder, route.params.conversationId, captureScrollAnchor]);

  loadOlderRef.current = loadOlder;

  const clearHighlight = useCallback(() => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    setHighlightedMessageId(null);
  }, []);

  const highlightMessage = useCallback((messageId: string) => {
    clearHighlight();
    setHighlightedMessageId(messageId);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 1800);
  }, [clearHighlight]);

  const jumpToMessage = useCallback((messageId: string) => {
    const scrollToTarget = () => {
      const index = timelineRef.current.findIndex((entry) => entry.kind === 'message' && entry.message.id === messageId);
      if (index < 0) return false;
      const invertedIndex = timelineRef.current.length - 1 - index;
      cancelScrollAnchor();
      void listRef.current?.scrollToIndex({ index: invertedIndex, viewPosition: 0.5, animated: true });
      highlightMessage(messageId);
      return true;
    };

    if (scrollToTarget()) return;

    if (!hasMoreRef.current) return;

    (async () => {
      let guard = 0;
      while (hasMoreRef.current && guard < 20) {
        guard += 1;
        await loadOlderRef.current();
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (scrollToTarget()) return;
      }
    })();
  }, [highlightMessage, cancelScrollAnchor]);

  useEffect(() => {
    if (!messages.data) return;
    if (!messages.data.hasMore) {
      setHasMoreOlder(false);
      setOlderCursor(null);
      return;
    }
    if (!hasMoreOlder) return;
    if (messages.data.nextCursor && !olderCursor) setOlderCursor(messages.data.nextCursor);
  }, [messages.data, olderCursor, hasMoreOlder]);

  const messageImageAttachments = useMemo(() => allMessages.flatMap((message) => message.attachments ?? []), [allMessages]);
  const gallerySourceAttachments = useMemo(() => {
    const seen = new Set<string>();
    return [...(attachmentsQuery.data?.items ?? []), ...messageImageAttachments].filter((attachment) => {
      if (seen.has(attachment.id)) return false;
      seen.add(attachment.id);
      return true;
    });
  }, [attachmentsQuery.data?.items, messageImageAttachments]);
  const imageUrls = useMemo(() => gallerySourceAttachments.filter((attachment) => {
    const mediaType = (attachment.mediaType ?? '').toUpperCase();
    if (mediaType === 'IMAGE' || mediaType === 'STICKER') return true;
    const mime = (attachment.mimeType ?? '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    // Images sent as WhatsApp documents (DOCUMENT/FILE + image filename).
    const name = (attachment.originalName ?? '').toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'].some((ext) => name.endsWith(ext));
  }).map((attachment) => {
    const raw = attachment.downloadUrl || attachment.previewUrl || attachment.thumbnailUrl;
    const preferred = typeof raw === 'string' ? raw.replace(/\/preview\/?(?:\?.*)?$/i, '/download') : raw;
    const src = apiUrl(preferred ?? null);
    return src ? { attachId: attachment.id, src, mediaType: attachment.mediaType } as MediaItem : null;
  }).filter((item): item is MediaItem => Boolean(item)), [gallerySourceAttachments]);

  const openImage = useCallback((attachId: string) => {
    setGallery(imageUrls);
    setGalleryIndex(Math.max(0, imageUrls.findIndex((media) => media.attachId === attachId)));
  }, [imageUrls]);

  const openVideo = useCallback((attachment: { downloadUrl: string; previewUrl?: string | null }) => {
    setVideoUrl(apiUrl(attachment.downloadUrl ?? attachment.previewUrl ?? null));
  }, []);

  const { pattern: inboxPattern } = useInboxAppearance();
  const currentConversation = header.conversation ?? (messages.data as any)?.conversation ?? null;
  const channelType = currentConversation?.channel?.channelType ?? route.params.channelType;
  const channelId = currentConversation?.channel?.channelId ?? currentConversation?.channel?.id ?? route.params.channelId;
  const conversationWorkspaceId = currentConversation?.workspaceId ?? route.params.workspaceId;
  const ecommerceEnabled = conversationWorkspaceId
    ? Boolean(workspacesQuery.data?.items.find((workspace) => workspace.id === conversationWorkspaceId)?.ecommerceEnabled)
    : workspacesQuery.data?.items.length === 1 && Boolean(workspacesQuery.data.items[0]?.ecommerceEnabled);
  const handleCreateOrderFromMessage = useCallback(async (message: Message) => {
    if (!ecommerceEnabled || creatingOrderDraftFor) return;
    setCreatingOrderDraftFor(message.id);
    try {
      const draft = await fetchConversationOrderDraft(route.params.conversationId, message.id, 30);
      const messageRecipient = readOrderRecipientFromMessage(message.text);
      navigation.navigate('CreateOrder', {
        presentation: 'sheet',
        initialRecipient: {
          name: draft.recipient.name ?? messageRecipient.name ?? currentConversation?.contact?.displayName ?? route.params.contactName,
          phone: draft.recipient.phone ?? messageRecipient.phone ?? currentConversation?.contact?.primaryPhone,
          email: draft.recipient.email ?? currentConversation?.contact?.primaryEmail,
          address: draft.recipient.address ?? messageRecipient.address,
        },
        initialSourceChannelId: draft.sourceChannelId || channelId,
        initialItems: draft.items.map(({ product, ...item }) => ({
          productId: product.id,
          name: product.name,
          imageUrl: product.coverImageUrl ?? product.imageUrls?.[0] ?? null,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor ?? product.salePriceMinor ?? product.priceMinor ?? 0,
          weightGrams: item.weightGrams ?? product.weightGrams ?? 0,
        })),
      });
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Could not prepare the order draft.');
    } finally {
      setCreatingOrderDraftFor(null);
    }
  }, [channelId, creatingOrderDraftFor, currentConversation?.contact?.displayName, currentConversation?.contact?.primaryEmail, currentConversation?.contact?.primaryPhone, ecommerceEnabled, navigation, route.params.contactName, route.params.conversationId]);
  const isWhatsAppConversation = (channelType ?? '').toUpperCase() === 'WHATSAPP';
  const isWebchatConversation = (channelType ?? '').toUpperCase() === 'WEBCHAT';
  const webchatSettingsQuery = useQuery({
    queryKey: ['channel-webchat-settings', channelId],
    queryFn: () => fetchWebchatSettings(channelId!),
    enabled: secondaryDataReady && isWebchatConversation && Boolean(channelId),
  });
  const isMessengerConversation = (channelType ?? '').toUpperCase() === 'MESSENGER';
  const isTikTokConversation = (channelType ?? '').toUpperCase() === 'TIKTOK';
  const headerMessagingLoaded = Boolean(currentConversation?.messaging);
  const isWhatsAppCustomerWindow = isWhatsAppConversation && currentConversation?.messaging?.policyType === 'CUSTOMER_WINDOW';
  const whatsappWindowExpired = isConversationCustomerWindowExpired(currentConversation);
  const conversationWindowLabel = getConversationWindowLabel(currentConversation, messengerMessagingMode, windowLabelNow);
  const showConversationWindowLabel = headerMessagingLoaded && conversationWindowLabel.tone !== 'none';
  const messengerAvailability = getMessengerMessagingAvailability(currentConversation);
  const messengerMessagingReady = Boolean(currentConversation);
  const canSendSelectedMessengerMode = messengerMessagingMode === 'STANDARD'
    ? messengerAvailability.canSendStandardMessage
    : messengerAvailability.canSendHumanAgentMessage;
  const canSendFreeform = isMessengerConversation
    ? (messengerMessagingReady ? canSendSelectedMessengerMode : true)
    : isTikTokConversation
      ? (currentConversation?.messaging?.canSendFreeformMessage ?? true)
      : currentConversation?.messaging?.canSendFreeformMessage;
  const showHeaderPresenceDot = !isWhatsAppConversation || headerMessagingLoaded;
  const contactPhone = formatPhoneNumberDisplay(currentConversation?.contact?.primaryPhone);
  const contactCountryCode = getCountryCodeFromPhone(currentConversation?.contact?.primaryPhone);
  const contactSubtitle = contactPhone ?? formatUsernameDisplay(currentConversation?.contact?.username);
  const title = getConversationTitle(currentConversation, route.params.contactName);

  useEffect(() => {
    rememberCallParty(
      route.params.conversationId,
      title,
      currentConversation?.contact?.avatarUrl ?? null,
    );
  }, [currentConversation?.contact?.avatarUrl, route.params.conversationId, title]);

  useEffect(() => {
    const conversationId = route.params.conversationId;
    if (!isMessengerConversation || !header.conversation) {
      initializedMessengerModeConversationIdRef.current = null;
      if (!isMessengerConversation) setMessengerMessagingMode('STANDARD');
      return;
    }
    if (initializedMessengerModeConversationIdRef.current === conversationId) return;
    initializedMessengerModeConversationIdRef.current = conversationId;
    const availability = getMessengerMessagingAvailability(header.conversation);
    setMessengerMessagingMode(availability.canSendStandardMessage ? 'STANDARD' : 'HUMAN_AGENT');
  }, [
    header.conversation,
    isMessengerConversation,
    route.params.conversationId,
    header.conversation?.messaging?.standardWindowExpiresAt,
    header.conversation?.messaging?.humanAgentWindowExpiresAt,
  ]);

  useEffect(() => {
    if (!isMessengerConversation || !header.conversation) return;
    if (messengerMessagingMode === 'STANDARD' && !messengerAvailability.canSendStandardMessage && messengerAvailability.canSendHumanAgentMessage) {
      setMessengerMessagingMode('HUMAN_AGENT');
    }
  }, [
    isMessengerConversation,
    messengerMessagingMode,
    messengerAvailability.canSendStandardMessage,
    messengerAvailability.canSendHumanAgentMessage,
    header.conversation,
  ]);
  const callsQuery = useQuery({
    queryKey: ['conversation-calls', route.params.conversationId],
    queryFn: () => fetchConversationCallSessions({ conversationId: route.params.conversationId, limit: 100 }),
    enabled: secondaryDataReady && (isWhatsAppConversation || isWebchatConversation),
    staleTime: 15_000,
    refetchOnMount: 'always',
  });
  const callSessions: ConversationCallSession[] = useMemo(() => callsQuery.data?.items ?? [], [callsQuery.data?.items]);
  const assignmentHistoryQuery = useQuery({
    queryKey: ['assignment-events', route.params.conversationId],
    queryFn: () => fetchConversationAssignmentEvents({ conversationId: route.params.conversationId, limit: 100 }),
    enabled: secondaryDataReady,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });
  const assignmentEvents = useMemo(() => assignmentHistoryQuery.data?.items ?? [], [assignmentHistoryQuery.data?.items]);
  // Match web: only RINGING/CONNECTED count as an active call for the start-call button.
  // PERMISSION_REQUESTED is handled separately via latestCallSession (granted → enable).
  const activeCallSession = useMemo(
    () => callSessions.find(
      (session) => isLiveCallSession(session) && (session.status === 'RINGING' || session.status === 'CONNECTED'),
    ) ?? null,
    [callSessions],
  );
  const latestCallSession = callSessions[0] ?? null;
  // Match web agent behavior: do not gate the call button on channel-details calling
  // settings. Web only loads those for workspace admin/manager; agents see the button
  // enabled and the backend enforces calling capability on start.
  const voiceCallButton = getVoiceCallButtonState({
    isWhatsAppConversation,
    isWebchatConversation,
    webchatVoiceCallEnabled: webchatSettingsQuery.data?.voiceCall === true,
    isWebchatSettingsLoading: webchatSettingsQuery.isLoading,
    canManageCalls: Boolean(session),
    isCallSessionsLoading: callsQuery.isLoading && !callsQuery.data,
    isCallControllerBusy: callController.isBusy,
    activeCallSession,
    latestCallSession,
    businessCallingDisabledReason: null,
    businessCallingStatus: null,
  });
  const startVoiceCall = async () => {
    if (!voiceCallButton.canStartVoiceCall) {
      Toast.show({ type: 'info', text1: 'Unable to start call', text2: voiceCallButton.tooltipMessage });
      return;
    }
    if (!isWhatsappCallSupported()) {
      Toast.show({
        type: 'error',
        text1: 'Custom build required',
        text2: 'Voice calling needs a development build with WebRTC (not Expo Go).',
      });
      return;
    }
    await callController.startOutboundCall({ conversationId: route.params.conversationId });
    void queryClient.invalidateQueries({ queryKey: ['conversation-calls', route.params.conversationId] });
    void queryClient.invalidateQueries({ queryKey: ['active-calls'] });
  };
  const timeline = useMemo<ConversationTimelineEntry<Message>[]>(() => {
    const entries = buildConversationTimeline(allMessages, callSessions, assignmentEvents);
    const grouped: ConversationTimelineEntry<Message>[] = [];
    const batchEntryIndexes = new Map<string, number>();
    const isImageBatchMessage = (message: Message) =>
      Array.isArray(message.attachments)
      && message.attachments.length > 0
      && message.attachments.every((attachment) => {
        const mediaType = (attachment.mediaType ?? '').toUpperCase();
        const mimeType = (attachment.mimeType ?? '').toLowerCase();
        return mediaType === 'IMAGE' || mimeType.startsWith('image/')
          || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(attachment.originalName ?? '');
      });

    // Older messages have no album marker. Infer only adjacent outgoing image runs;
    // keep the API/cache records intact and stop at new captions or other events.
    let previousImage: Message | null = null;
    let previousTimestamp = 0;
    let historicalBatchId = '';
    let historicalBatchIndex = 0;
    for (const originalEntry of entries) {
      let entry = originalEntry;
      if (entry.kind === 'message' && entry.message.direction === 'OUTBOUND'
        && isImageBatchMessage(entry.message) && !entry.message.metadata?.mediaBatchId
        && !entry.message.metadata?.optimistic && !entry.message.campaignId) {
        const message = entry.message;
        const body = message.text?.trim() ?? '';
        const filenameOnly = message.attachments?.some((attachment) =>
          attachment.originalName?.trim().toLowerCase() === body.toLowerCase());
        const sameSender = previousImage !== null
          && previousImage.senderType === message.senderType
          && previousImage.sender?.userEmail === message.sender?.userEmail
          && previousImage.sender?.userName === message.sender?.userName;
        const continuesRun = sameSender && (!body || filenameOnly)
          && previousImage?.replyToMessageId === message.replyToMessageId
          && entry.timestamp >= previousTimestamp
          && entry.timestamp - previousTimestamp <= 3 * 60 * 1000
          && new Date(entry.timestamp).toDateString() === new Date(previousTimestamp).toDateString();
        if (!continuesRun) {
          historicalBatchId = `historical:${message.id}`;
          historicalBatchIndex = 0;
        } else {
          historicalBatchIndex += 1;
        }
        previousImage = message;
        previousTimestamp = entry.timestamp;
        entry = { ...entry, message: { ...message, metadata: {
          ...message.metadata, mediaBatchId: historicalBatchId, mediaBatchIndex: historicalBatchIndex,
        } } };
      } else {
        previousImage = null;
      }
      const batchId = entry.kind === 'message' && entry.message.direction === 'OUTBOUND'
        ? entry.message.metadata?.mediaBatchId
        : null;

      if (
        typeof batchId === 'string'
        && batchId.length > 0
        && entry.kind === 'message'
        && isImageBatchMessage(entry.message)
      ) {
        const entryIndex = Number(entry.message.metadata?.mediaBatchIndex ?? 0);
        const existingIndex = batchEntryIndexes.get(batchId);
        const existing = existingIndex === undefined ? null : grouped[existingIndex];
        const existingMessage = existing?.kind === 'message' ? existing.message : null;
        const existingParts = existingMessage && Array.isArray(existingMessage.metadata?.mediaBatchParts)
          ? existingMessage.metadata.mediaBatchParts
          : existingMessage
            ? [{ index: Number(existingMessage.metadata?.mediaBatchIndex ?? 0), attachments: existingMessage.attachments ?? [] }]
            : [];
        const orderedParts = [...existingParts, { index: entryIndex, attachments: entry.message.attachments ?? [] }]
          .sort((left, right) => left.index - right.index);
        const mediaBatchParts = orderedParts.flatMap((part) => part.attachments);

        if (existing?.kind === 'message' && existingIndex !== undefined) {
          const currentMessage = existing.message;
          grouped[existingIndex] = {
            ...existing,
            timestamp: Math.min(existing.timestamp, entry.timestamp),
            message: {
              ...currentMessage,
              ...entry.message,
              text: currentMessage.text ?? entry.message.text,
              attachments: mediaBatchParts,
              metadata: {
                ...currentMessage.metadata,
                ...entry.message.metadata,
                mediaBatchId: batchId,
                mediaBatchIndex: Math.min(Number(currentMessage.metadata?.mediaBatchIndex ?? 0), entryIndex),
                mediaBatchParts: orderedParts,
              },
            },
          };
        } else {
          batchEntryIndexes.set(batchId, grouped.length);
          grouped.push({
            ...entry,
            id: `media-batch:${batchId}`,
            message: {
              ...entry.message,
              attachments: mediaBatchParts,
              metadata: { ...entry.message.metadata, mediaBatchId: batchId, mediaBatchParts: orderedParts },
            },
          });
        }
        continue;
      }

      grouped.push(entry);
    }

    return grouped;
  }, [allMessages, callSessions, assignmentEvents]);
  timelineRef.current = timeline;
  const displayEntries = useMemo<TimelineRow[]>(() => {
    let previousDay: string | null = null;
    const chronological = timeline.map((entry) => {
      const currentDay = new Date(entry.timestamp).toDateString();
      const showDivider = previousDay !== currentDay;
      previousDay = currentDay;
      return { entry, showDivider };
    });
    chronological.reverse();
    return chronological;
  }, [timeline]);

  useEffect(() => {
    if (!messages.data) return;
    const timeout = setTimeout(() => {
      listReadyRef.current = true;
    }, 400);
    return () => clearTimeout(timeout);
  }, [messages.data, route.params.conversationId]);

  const channelName = header.conversation?.channel?.channelName ?? null;
  useSyncExternalStore(subscribeCallChrome, getCallUiRevision);
  const callChrome = getCallChrome();
  const showInCallHeader = Boolean(
    callChrome && callChrome.conversationId === route.params.conversationId,
  );
  const onScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    lastScrollOffsetRef.current = offsetY;
    const nextAtBottom = Math.abs(offsetY) <= 96;
    // Pagination/layout correction events are not a request to follow latest.
    if (loadingOlderRef.current || isRestoringScrollAnchor()) return;
    isAtBottomRef.current = nextAtBottom;
    pinToLatestRef.current = nextAtBottom;
    setAtBottom((current) => (current === nextAtBottom ? current : nextAtBottom));
    const lockedAt = olderLoadLockOffsetRef.current;
    if (lockedAt != null && Math.abs(offsetY - lockedAt) > 140) {
      olderLoadLockOffsetRef.current = null;
    }
  }, [isRestoringScrollAnchor]);
  const renderTimelineItem = useCallback(({ item }: { item: TimelineRow }) => {
    const message = item.entry.kind === 'message' ? item.entry.message : null;
    return (
      <View collapsable={false} ref={(node) => registerTimelineNode(timelineKeyExtractor(item), node)}>
        <TimelineRowItem
          row={item}
          highlighted={Boolean(message && message.id === highlightedMessageId)}
          channelName={channelName}
          channelType={channelType}
          channelId={channelId}
          replyTarget={message ? (messageById.get(message.replyToMessageId ?? '') ?? null) : null}
          reactions={message ? reactionGroups[message.id] : undefined}
          dayLabelBg={colors.surfaceSecondary}
          dayLabelColor={colors.textSecondary}
          onReply={setReplyTo}
          onReact={setReactTarget}
          onImage={openImage}
          onVideo={openVideo}
          onJumpToMessage={jumpToMessage}
          onCreateOrderFromMessage={ecommerceEnabled ? handleCreateOrderFromMessage : undefined}
          creatingOrderDraftFor={creatingOrderDraftFor}
        />
      </View>
    );
  }, [channelId, channelName, channelType, colors.surfaceSecondary, colors.textSecondary, creatingOrderDraftFor, ecommerceEnabled, handleCreateOrderFromMessage, highlightedMessageId, jumpToMessage, messageById, openImage, openVideo, reactionGroups, registerTimelineNode]);

  const handleContentSizeChange = useCallback(() => {
    if (isRestoringScrollAnchor()) { restoreScrollAnchor(); return; }
    if (loadingOlderRef.current) return;
    if (!pinToLatestRef.current) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [isRestoringScrollAnchor, restoreScrollAnchor]);
  const handleEndReached = useCallback(() => {
    if (!listReadyRef.current || loadingOlderRef.current || olderLoadLockOffsetRef.current != null || !hasMoreOlder || !olderCursor) return;
    void loadOlder();
  }, [hasMoreOlder, olderCursor, loadOlder]);
  const timelineFooter = useMemo(() => (
    <View style={styles.olderSpacer}>
      {loadingOlder ? <Text style={[styles.olderPill, { color: colors.textSecondary }]}>Loading older messages...</Text> : null}
    </View>
  ), [loadingOlder, colors.textSecondary]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, flex: 1 }]}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {showInCallHeader && callChrome ? (
        <InCallConversationHeader
          chrome={{
            ...callChrome,
            label: title || callChrome.label,
            avatarUrl: header.conversation?.contact?.avatarUrl ?? callChrome.avatarUrl,
          }}
          onBack={handleBack}
        />
      ) : (
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
        <Pressable onPress={handleBack}><ArrowLeft color={colors.textSecondary} size={23} /></Pressable>
        <Pressable
          onPress={() => { if (header.conversation) setDetailsOpen(true); }}
          style={styles.headerIdentity}
        >
          <View style={styles.avatarWrap}>
            <ColorfulAvatar
              name={title}
              size={42}
              url={header.conversation?.contact?.avatarUrl ?? null}
            />
            {showHeaderPresenceDot ? (
              <View
                style={[
                  styles.presence,
                  { borderColor: colors.surface },
                  isWhatsAppCustomerWindow && whatsappWindowExpired ? styles.presenceExpired : undefined,
                ]}
              />
            ) : null}
          </View>
          <View style={styles.titleBlock}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{title}</Text>
            {contactSubtitle ? (
              <View style={styles.contactSubtitleRow}>
                {contactPhone && contactCountryCode ? (
                  <Text style={styles.contactCountryFlag} accessibilityLabel={`${contactCountryCode} flag`}>
                    {getCountryFlag(contactCountryCode)}
                  </Text>
                ) : null}
                <Text style={[styles.contactSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                  {contactSubtitle}
                </Text>
              </View>
            ) : null}
            {showConversationWindowLabel ? (
              <Text
                style={[
                  styles.windowLabel,
                  {
                    color: conversationWindowLabel.tone === 'expired'
                        ? colors.error
                      : colors.success,
                  },
                ]}
                numberOfLines={1}
              >
                {conversationWindowLabel.label}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.headerActions}>
          {ecommerceEnabled && currentConversation ? (
            <Pressable
              onPress={() => navigation.navigate('CreateOrder', {
                presentation: 'sheet',
                initialRecipient: {
                  name: currentConversation.contact?.displayName ?? title,
                  phone: currentConversation.contact?.primaryPhone,
                  email: currentConversation.contact?.primaryEmail,
                },
                initialSourceChannelId: channelId,
              })}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Create order"
            >
              <PackagePlus color={colors.primary} size={19} />
            </Pressable>
          ) : null}
          {isWhatsAppConversation || isWebchatConversation ? (
            <Pressable
              onPress={startVoiceCall}
              hitSlop={6}
              style={!voiceCallButton.canStartVoiceCall || callController.isBusy ? { opacity: 0.35 } : undefined}
            >
              <Phone color={voiceCallButton.canStartVoiceCall && !callController.isBusy ? colors.primary : colors.textMuted} size={19} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              if (readMutation.isPending || unreadMutation.isPending) return;
              if (header.unreadCount > 0) {
                manualReadToggleRef.current = true;
                readMutation.mutate();
              } else {
                unreadMutation.mutate();
              }
            }}
            hitSlop={6}
          >
            {header.unreadCount > 0 ? <Mail color={colors.textSecondary} size={19} /> : <MailOpen color={colors.textSecondary} size={19} />}
          </Pressable>
          <Pressable onPress={() => setAssignmentOpen(true)} hitSlop={6}><UserRound color={colors.textSecondary} size={19} /></Pressable>
          <Pressable onPress={() => setDetailsOpen(true)} hitSlop={6}><MoreVertical color={colors.textSecondary} size={19} /></Pressable>
        </View>
      </View>
      )}
      <View style={styles.body}>
        <InboxPatternBackground pattern={inboxPattern} />
        <View style={styles.listWrap}>
          {messages.data ? (
            <FlatList
                ref={listRef}
                key={route.params.conversationId}
                style={styles.list}
                inverted
                data={displayEntries}
                extraData={highlightedMessageId}
                keyExtractor={timelineKeyExtractor}
                ItemSeparatorComponent={TimelineSeparator}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="none"
                initialNumToRender={14}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                windowSize={13}
                removeClippedSubviews={false}
                maintainVisibleContentPosition={timelineVisibleContentPosition}
                onContentSizeChange={handleContentSizeChange}
                onScroll={onScroll}
                onScrollBeginDrag={cancelScrollAnchor}
                onViewableItemsChanged={onViewableItemsChanged}
                scrollEventThrottle={16}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.08}
                ListFooterComponent={timelineFooter}
                renderItem={renderTimelineItem}
            />
          ) : (
            <ConversationSkeleton />
          )}
          {!atBottom ? (
            <Pressable style={[styles.fab, { backgroundColor: colors.primary }]} onPress={() => { cancelScrollAnchor(); listRef.current?.scrollToOffset({ offset: 0, animated: true }); }}><ChevronDown color={colors.primaryText} size={22} /></Pressable>
          ) : null}
        </View>
        {messages.isError ? (
          <Text style={[styles.error, { color: colors.error }]}>
            {isApiErrorWithStatus(messages.error, 404) || isApiErrorWithStatus(messages.error, 403)
              ? 'This conversation is no longer available to you.'
              : messages.error instanceof Error ? messages.error.message : 'Unable to load messages.'}
          </Text>
        ) : null}
        {(header.conversation || messages.data?.conversation) ? (
        <View style={{ paddingBottom: insets.bottom }}>
        {header.status === 'CLOSED' ? (
          <View style={styles.reopenWrap}>
            <Pressable
              onPress={() => { if (!statusMutation.isPending) statusMutation.mutate('OPEN'); }}
              disabled={statusMutation.isPending}
              style={[
                styles.reopenBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              {statusMutation.isPending ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <View style={[styles.reopenIcon, { backgroundColor: colors.primarySoft }]}>
                  <RotateCcw color={colors.primary} size={14} strokeWidth={2.4} />
                </View>
              )}
              <Text style={[styles.reopenText, { color: colors.primary }]}>Reopen conversation</Text>
            </Pressable>
          </View>
        ) : (
        <ConversationComposer
          value={draft} onChange={setDraft} sending={send.isPending}
          attachments={attachments} onAttachments={setAttachments}
          workspaceId={route.params.workspaceId ?? header.conversation?.workspaceId}
          channelId={channelId} channelType={channelType} conversationId={route.params.conversationId} contactName={title}
          onSendTemplate={(params) => sendTemplateMutation(route.params.conversationId, params, queryClient, setDraft)}
          replyPreview={replyTo ? { name: replyTo.direction === 'INBOUND' ? title : 'You', text: getReplyPreviewBody(replyTo), mediaType: replyTo.attachments?.[0]?.mediaType ?? replyTo.type } : null}
          onCancelReply={() => setReplyTo(null)}
          onSend={(payload) => { if (!send.isPending) send.mutate(payload); }}
          canSendFreeform={canSendFreeform}
          messengerMessagingMode={messengerMessagingMode}
          onMessengerMessagingModeChange={setMessengerMessagingMode}
          canSendStandardMessage={messengerAvailability.canSendStandardMessage}
          canSendHumanAgentMessage={messengerAvailability.canSendHumanAgentMessage}
          messengerMessagingReady={messengerMessagingReady}
        />
        )}
        </View>
        ) : (
          <View style={{ paddingBottom: insets.bottom }}>
            <ComposerSkeleton />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
      <ReactionPicker
        visible={Boolean(reactTarget)}
        onClose={() => setReactTarget(null)}
        onPick={(emoji) => { if (reactTarget) reactMutation.mutate({ messageId: reactTarget.id, emoji }); setReactTarget(null); }}
        onReply={(channelType ?? '').toUpperCase() === 'INSTAGRAM' ? undefined : () => { if (reactTarget) setReplyTo(reactTarget); setReactTarget(null); }}
        onCopy={reactTarget?.text ? () => {
          const text = reactTarget.text ?? '';
          setReactTarget(null);
          void Clipboard.setStringAsync(text);
          Toast.show({ type: 'copy', text1: 'Copied', position: 'bottom', visibilityTime: 1600 });
        } : undefined}
      />
      <MediaViewer images={gallery} index={galleryIndex} onClose={() => setGallery([])} onIndex={setGalleryIndex} />
      <VideoPlayerModal url={videoUrl} visible={Boolean(videoUrl)} onClose={() => setVideoUrl(null)} />
      <ConversationAssignmentSheet
        visible={assignmentOpen}
        onClose={() => setAssignmentOpen(false)}
        title={title}
        workspaceId={header.conversation?.workspaceId ?? route.params.workspaceId}
        channelId={channelId}
        assignee={header.conversation?.assignee ?? null}
        status={header.status}
        unreadCount={header.unreadCount}
        isStarred={header.isStarred}
        isUpdating={assignmentMutation.isPending}
        isUpdatingRead={readMutation.isPending || unreadMutation.isPending}
        isUpdatingStatus={statusMutation.isPending}
        isUpdatingStar={starMutation.isPending}
        errorMessage={assignmentMutation.error instanceof Error ? assignmentMutation.error.message : null}
        onAssign={(member) => assignmentMutation.mutate(member)}
        onToggleRead={() => {
          if (readMutation.isPending || unreadMutation.isPending) return;
          if (header.unreadCount > 0) {
            manualReadToggleRef.current = true;
            readMutation.mutate();
          } else {
            unreadMutation.mutate();
          }
        }}
        onToggleStatus={() => statusMutation.mutate(header.status === 'CLOSED' ? 'OPEN' : 'CLOSED')}
        onToggleStar={() => starMutation.mutate(!header.isStarred)}
      />
      {header.conversation ? (
        <ContactDetailsPanel
          visible={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          conversation={{ ...header.conversation, status: header.status } as any}
          isUpdatingStatus={statusMutation.isPending}
          onToggleStatus={() => statusMutation.mutate(header.status === 'CLOSED' ? 'OPEN' : 'CLOSED')}
        />
      ) : null}
    </View>
  );
}

async function sendTemplateMutation(conversationId: string, params: { templateName: string; templateCategory?: string | null; languageCode?: string; text?: string; templateComponents?: unknown[] }, queryClient: any, setDraft: (v: string) => void) {
  try {
    await sendTemplateMessage({
      conversationId,
      templateName: params.templateName,
      templateCategory: params.templateCategory ?? null,
      languageCode: params.languageCode,
      text: params.text,
      templateComponents: params.templateComponents,
    });
    queryClient.invalidateQueries({ queryKey: ['messages', conversationId], refetchType: 'active' });
    setDraft('');
  } catch (error) {
    showNotice('Could not send template', error instanceof Error ? error.message : 'Please try again.');
  }
}

const SwipeableMessage = memo(function SwipeableMessage({ message, channelName, channelType, channelId, setReplyTo, setReactTarget, onImage, onVideo, replyTarget, reactions, onJumpToMessage, onCreateOrderFromMessage, creatingOrderDraftFor }: { message: Message; channelName?: string | null; channelType?: string | null; channelId?: string | null; setReplyTo: (message: Message) => void; setReactTarget: (message: Message) => void; onImage: (attachId: string) => void; onVideo: (attachment: any) => void; replyTarget: Message | null; reactions?: Array<{ emoji: string; count: number }>; onJumpToMessage?: (messageId: string) => void; onCreateOrderFromMessage?: (message: Message) => void; creatingOrderDraftFor: string | null }) {
  const outgoing = message.direction === 'OUTBOUND';
  const onReply = useCallback(() => setReplyTo(message), [setReplyTo, message]);
  const onReact = useCallback(() => setReactTarget(message), [setReactTarget, message]);
  const replyTargetId = message.replyToMessageId ?? replyTarget?.id ?? message.replyTo?.id ?? null;
  const replyPreview = useMemo(() => {
    const quotedSource = replyTarget ?? message.replyTo;
    const replyImage = replyTarget?.attachments?.find((attachment) =>
      (attachment.mediaType ?? '').toUpperCase() === 'IMAGE'
      || (attachment.mimeType ?? '').toLowerCase().startsWith('image/'));
    return quotedSource ? {
    name: (message.replyTo?.sender?.userName ?? replyTarget?.sender?.userName) || (replyTarget?.direction === 'OUTBOUND' ? 'You' : 'Message'),
    text: getReplyPreviewBody({
      id: quotedSource.id ?? message.id,
      text: quotedSource.text,
      type: replyTarget?.type ?? quotedSource.type,
      attachments: replyTarget?.attachments ?? quotedSource.attachments,
      metadata: replyTarget?.metadata,
      campaignId: replyTarget?.campaignId,
      campaignName: replyTarget?.campaignName,
    }),
    mediaType: replyTarget?.attachments?.[0]?.mediaType ?? replyTarget?.type ?? quotedSource.type,
    imageUrl: replyTarget ? apiUrl(replyImage?.previewUrl ?? replyImage?.thumbnailUrl ?? null) : null,
  } : null;
  }, [message.id, message.replyTo, replyTarget]);
  if (isInlineReactionMessage(message)) return null;
  return (
    <SwipeToReply onReply={onReply} enabled={(channelType ?? '').toUpperCase() !== 'INSTAGRAM'}>
      <View style={[styles.group, outgoing && styles.outgoingGroup]}>
        <MessageBubble message={message} outgoing={outgoing} attachments={message.attachments ?? []} replyPreview={replyPreview} reactions={reactions} channelName={channelName} channelType={channelType} channelId={channelId} onImage={onImage} onVideo={onVideo} onLongPress={onReact} onReplyPress={onJumpToMessage && replyTargetId ? () => onJumpToMessage(replyTargetId) : undefined} onCreateOrderFromMessage={onCreateOrderFromMessage} creatingOrderDraft={creatingOrderDraftFor === message.id} />
      </View>
    </SwipeToReply>
  );
});

const styles = StyleSheet.create({
  screen: { backgroundColor: 'transparent', flex: 1 },
  body: { backgroundColor: 'transparent', flex: 1 },
  header: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: '#dbe4f1', borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm + 1 },
  avatarWrap: { flexShrink: 0, position: 'relative' },
  headerIdentity: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm, minWidth: 0 },
  presence: { backgroundColor: '#22c55e', borderColor: '#fff', borderRadius: radius.sm - 2, borderWidth: 1.5, bottom: 1, height: 12, position: 'absolute', right: 1, width: 12 },
  presenceExpired: { backgroundColor: '#ef4444' },
  titleBlock: { flex: 1, minWidth: 0 },
  name: { color: '#0f172a', fontWeight: fontWeight.bold },
  contactSubtitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs + 1, marginTop: 1, minWidth: 0 },
  contactCountryFlag: { fontSize: fontSize.small },
  contactSubtitle: { color: '#64748b', flexShrink: 1, fontSize: fontSize.small, fontWeight: fontWeight.medium, minWidth: 0 },
  windowLabel: { fontSize: fontSize.tiny + 1, fontWeight: fontWeight.bold, marginTop: 1, width: '100%' },
  headerActions: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: spacing.sm },
  list: { backgroundColor: 'transparent', flex: 1 },
  listWrap: { backgroundColor: 'transparent', flex: 1, minHeight: 0 },
  error: { backgroundColor: 'transparent', color: '#dc2626', padding: spacing.md + 2, textAlign: 'center' },
  listContent: { paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md + 2 },
  rowGap: { height: spacing.sm + 2 },
  timelineRow: { paddingBottom: 2 },
  highlightRow: { backgroundColor: 'rgba(50,102,246,0.10)', borderRadius: radius.lg, paddingVertical: 2 },
  group: { alignItems: 'flex-start', gap: spacing.sm - 2 },
  outgoingGroup: { alignItems: 'flex-end' },
  dayDivider: { alignSelf: 'center', backgroundColor: '#e8eef7', borderRadius: radius.pill, color: '#526987', fontSize: fontSize.small, fontWeight: fontWeight.semibold, marginVertical: spacing.sm, overflow: 'hidden', paddingHorizontal: spacing.md + 2, paddingVertical: spacing.xs + 2 },
  olderPill: { alignSelf: 'center', color: '#64748b', fontSize: fontSize.small },
  olderSpacer: { alignItems: 'center', height: spacing.xxl + spacing.xs, justifyContent: 'center' },
  reopenWrap: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  reopenBtn: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 2,
  },
  reopenIcon: { alignItems: 'center', borderRadius: 11, height: 22, justifyContent: 'center', width: 22 },
  reopenText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  fab: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: radius.xxl + 2, bottom: spacing.lg, elevation: 3, height: 44, justifyContent: 'center', position: 'absolute', right: spacing.lg, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, width: 44 },
});
