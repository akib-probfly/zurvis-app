import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Bell, CheckCheck, MessageSquare, PhoneCall, Trash2, UserMinus, UserRoundCheck } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet, SheetScrollView } from './BottomSheet';
import {
  deleteAllNotifications,
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notificationQueryKeys,
  type NotificationListItem,
  type NotificationType,
} from '../api/notifications';
import { ChannelLogo, normalizeChannelType } from './ChannelLogo';
import { PanelSkeleton } from './Skeleton';
import { fetchChannels, fetchInboxChannelOptions } from '../api/channels';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { isBillingLocked, pollingWhileUnlocked } from '../lib/billing-lock';

function formatNotificationTime(isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function getMetadataString(metadata: NotificationListItem['metadata'], key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNotificationActorLabel(notification: NotificationListItem) {
  const metadata = notification.metadata;
  switch (notification.type) {
    case 'CONVERSATION_ASSIGNED':
    case 'CONVERSATION_UNASSIGNED':
      return getMetadataString(metadata, 'contactDisplayName') ?? getMetadataString(metadata, 'contactPhone') ?? (notification.type === 'CONVERSATION_ASSIGNED' ? 'Conversation assigned' : 'Conversation unassigned');
    case 'INCOMING_CALL':
      return getMetadataString(metadata, 'contactDisplayName') ?? getMetadataString(metadata, 'contactPhone') ?? 'Incoming call';
    case 'NEW_MESSAGE':
    default:
      return getMetadataString(metadata, 'senderDisplayName') ?? getMetadataString(metadata, 'contactDisplayName') ?? getMetadataString(metadata, 'contactPhone') ?? 'New message';
  }
}

function getNotificationContextLabel(notification: NotificationListItem) {
  const channelName = getMetadataString(notification.metadata, 'channelName');
  if (notification.type === 'NEW_MESSAGE') return channelName ?? null;
  if (notification.type === 'CONVERSATION_ASSIGNED' || notification.type === 'CONVERSATION_UNASSIGNED') return channelName ?? 'Conversation';
  if (notification.type === 'INCOMING_CALL') return channelName ?? 'Call';
  return null;
}

function inferChannelTypeFromLabel(value?: string | null) {
  const label = (value ?? '').toLowerCase();
  if (!label) return null;
  if (label.includes('whatsapp')) return 'WHATSAPP';
  if (label.includes('messenger') || label.includes('facebook')) return 'MESSENGER';
  if (label.includes('instagram')) return 'INSTAGRAM';
  if (label.includes('telegram')) return 'TELEGRAM';
  if (label.includes('tiktok')) return 'TIKTOK';
  if (label.includes('email')) return 'EMAIL';
  if (label.includes('sms')) return 'SMS';
  return null;
}

function getMappedNotificationChannelType(
  notification: NotificationListItem,
  channelTypeById?: Map<string, string>,
) {
  const candidateIds = [
    notification.channelId,
    notification.conversationId,
    getMetadataString(notification.metadata, 'channelId'),
    getMetadataString(notification.metadata, 'channelAccountId'),
    getMetadataString(notification.metadata, 'channel_account_id'),
    getMetadataString(notification.metadata, 'channelName'),
    getMetadataString(notification.metadata, 'accountId'),
    getMetadataString(notification.metadata, 'externalAccountId'),
    getMetadataString(notification.metadata, 'pageId'),
    getMetadataString(notification.metadata, 'phoneNumberId'),
    getMetadataString(notification.metadata, 'wabaId'),
  ];

  for (const id of candidateIds) {
    if (!id) continue;
    const mapped = channelTypeById?.get(id);
    if (mapped) return mapped;
  }
  return null;
}

function getNotificationChannelType(
  notification: NotificationListItem,
  channelTypeById?: Map<string, string>,
) {
  const fromMetadata =
    getMetadataString(notification.metadata, 'channelType') ??
    getMetadataString(notification.metadata, 'channel') ??
    getMetadataString(notification.metadata, 'provider');
  const fromMappedId = getMappedNotificationChannelType(notification, channelTypeById);
  const fromLabel =
    inferChannelTypeFromLabel(getMetadataString(notification.metadata, 'channelName')) ??
    inferChannelTypeFromLabel(notification.title) ??
    inferChannelTypeFromLabel(notification.body);
  const normalized = normalizeChannelType(fromMetadata ?? fromMappedId ?? fromLabel);
  return normalized || null;
}

function getNotificationRowCopy(notification: NotificationListItem) {
  const title = notification.title?.trim() || 'Notification';
  const body = notification.body?.trim();

  if (notification.type === 'NEW_MESSAGE' && body) {
    return { title, body };
  }

  const actor = getNotificationActorLabel(notification);
  const context = getNotificationContextLabel(notification);
  return { title, body: context ? `${actor} · ${context}` : actor };
}

function getNotificationAppearance(type: NotificationType) {
  switch (type) {
    case 'CONTACT_EXPORT_READY':
    case 'CAMPAIGN_EXPORT_READY':
      return { icon: 'download' as const, wrap: '#dcfce7', accent: '#10b981', iconColor: '#059669' };
    case 'INCOMING_CALL':
      return { icon: 'call' as const, wrap: '#fee2e2', accent: '#ef4444', iconColor: '#dc2626' };
    case 'CONVERSATION_ASSIGNED':
      return { icon: 'assigned' as const, wrap: '#d1fae5', accent: '#10b981', iconColor: '#059669' };
    case 'CONVERSATION_UNASSIGNED':
      return { icon: 'unassigned' as const, wrap: '#fef3c7', accent: '#f59e0b', iconColor: '#d97706' };
    case 'NEW_MESSAGE':
    default:
      return { icon: 'message' as const, wrap: '#dbeafe', accent: '#3b82f6', iconColor: '#2563eb' };
  }
}

function NotificationTypeIcon({ kind, color }: { kind: 'message' | 'call' | 'assigned' | 'unassigned' | 'download'; color: string }) {
  switch (kind) {
    case 'call': return <PhoneCall color={color} size={16} />;
    case 'assigned': return <UserRoundCheck color={color} size={16} />;
    case 'unassigned': return <UserMinus color={color} size={16} />;
    case 'download': return <CheckCheck color={color} size={16} />;
    default: return <MessageSquare color={color} size={16} />;
  }
}

function NotificationRow({
  notification,
  channelTypeById,
  onOpen,
  onMarkRead,
}: {
  notification: NotificationListItem;
  channelTypeById?: Map<string, string>;
  onOpen: (notification: NotificationListItem) => void;
  onMarkRead: (notification: NotificationListItem) => void;
}) {
  const { colors } = useTheme();
  const appearance = getNotificationAppearance(notification.type);
  const copy = getNotificationRowCopy(notification);
  const channelType = getNotificationChannelType(notification, channelTypeById);

  return (
      <Pressable
      style={[styles.notificationRow, { backgroundColor: colors.surface, borderColor: colors.cardBorder }, notification.isUnread && styles.notificationRowUnread]}
      onPress={() => {
        if (notification.isUnread) onMarkRead(notification);
        onOpen(notification);
      }}
    >
      <View style={[styles.notificationAccent, { backgroundColor: notification.isUnread ? appearance.accent : 'transparent' }]} />
      <View style={styles.notificationIconStack}>
        {channelType ? (
          <ChannelLogo type={channelType} box={36} glyph={18} radius={12} />
        ) : (
          <View style={[styles.notificationIconWrap, { backgroundColor: appearance.wrap }]}>
            <NotificationTypeIcon kind={appearance.icon} color={appearance.iconColor} />
          </View>
        )}
        {channelType && appearance.icon !== 'message' ? (
          <View style={[styles.notificationTypeBadge, { backgroundColor: appearance.wrap, borderColor: colors.surface }]}>
            <NotificationTypeIcon kind={appearance.icon} color={appearance.iconColor} />
          </View>
        ) : null}
      </View>
      <View style={styles.notificationCopy}>
        <Text style={[styles.notificationRowTitle, { color: colors.text }]} numberOfLines={1}>{copy.title}</Text>
        <Text style={[styles.notificationBody, { color: colors.textSecondary }]} numberOfLines={2}>{copy.body}</Text>
      </View>
      <View style={styles.notificationMeta}>
        <Text style={[styles.notificationTime, { color: colors.textMuted }]}>{formatNotificationTime(notification.createdAt)}</Text>
        {notification.isUnread ? <View style={styles.notificationUnreadDot} /> : <View style={styles.notificationReadDot} />}
      </View>
    </Pressable>
  );
}

export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const { colors } = useTheme();
  // Keep the list query mounted so realtime cache patches + invalidations stay active.
  useQuery({
    queryKey: notificationQueryKeys.list({ page: 1, limit: 50 }),
    queryFn: () => fetchNotifications({ page: 1, limit: 50 }),
    staleTime: 15_000,
  });
  const unreadQuery = useQuery({
    queryKey: notificationQueryKeys.unreadCount(),
    queryFn: fetchUnreadNotificationCount,
    staleTime: 30_000,
    // Badge is also patched/invalidated by realtime; keep a light fallback poll.
    refetchInterval: pollingWhileUnlocked(60_000),
    refetchOnWindowFocus: false,
  });
  const unreadCount = unreadQuery.data ?? 0;
  const blink = useRef(new Animated.Value(1)).current;

  useFocusEffect(
    useCallback(() => {
      if (isBillingLocked()) return;
      void unreadQuery.refetch();
    }, [unreadQuery]),
  );

  useEffect(() => {
    if (unreadCount > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.3, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 600, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    blink.setValue(1);
  }, [unreadCount, blink]);

  return (
    <Pressable style={[styles.bellButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={onOpen} hitSlop={8}>
      <Bell color={colors.primary} size={18} />
      {unreadCount > 0 ? (
        <Animated.View style={[styles.bellBadge, { borderColor: colors.surface, opacity: blink }]}>
          <Text style={styles.bellBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

function NotificationScrollList({
  notifications,
  channelTypeById,
  onOpen,
  onMarkRead,
}: {
  notifications: NotificationListItem[];
  channelTypeById?: Map<string, string>;
  onOpen: (notification: NotificationListItem) => void;
  onMarkRead: (notification: NotificationListItem) => void;
}) {
  return (
    <SheetScrollView showsVerticalScrollIndicator={false} style={styles.notificationList}>
      {notifications.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          channelTypeById={channelTypeById}
          onOpen={onOpen}
          onMarkRead={onMarkRead}
        />
      ))}
    </SheetScrollView>
  );
}

export function NotificationCenter({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { workspace, canManage } = useWorkspaceAccess();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [optimisticIds, setOptimisticIds] = useState<Set<string>>(new Set());

  const notificationsQuery = useQuery({
    queryKey: notificationQueryKeys.list({ page: 1, limit: 50 }),
    queryFn: () => fetchNotifications({ page: 1, limit: 50 }),
    staleTime: 15_000,
  });
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.unreadCount(),
    queryFn: fetchUnreadNotificationCount,
    staleTime: 15_000,
  });
  const channelsQuery = useQuery({
    queryKey: ['channels'],
    queryFn: fetchChannels,
    enabled: canManage,
    staleTime: 2 * 60_000,
  });
  const inboxChannelsQuery = useQuery({
    queryKey: ['channels', 'inbox-filter-options', workspace?.id],
    queryFn: () => fetchInboxChannelOptions(workspace!.id),
    enabled: Boolean(workspace?.id) && !canManage,
    staleTime: 2 * 60_000,
  });
  const channelTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of inboxChannelsQuery.data?.items ?? []) {
      map.set(channel.id, channel.type);
      if (channel.name) map.set(channel.name, channel.type);
    }
    for (const channel of canManage ? channelsQuery.data?.items ?? [] : []) {
      map.set(channel.id, channel.type);
      if (channel.name) map.set(channel.name, channel.type);
      for (const account of channel.accounts ?? []) {
        map.set(account.id, channel.type);
        if (account.provider) map.set(account.provider, channel.type);
        if (account.displayName) map.set(account.displayName, channel.type);
        if (account.pageName) map.set(account.pageName, channel.type);
        if (account.externalAccountId) map.set(account.externalAccountId, channel.type);
        if (account.pageId) map.set(account.pageId, channel.type);
        if (account.phoneNumberId) map.set(account.phoneNumberId, channel.type);
        if (account.wabaId) map.set(account.wabaId, channel.type);
      }
    }
    for (const [, data] of queryClient.getQueriesData({ queryKey: ['conversations'] })) {
      const pages = (data as { pages?: Array<{ items?: Array<{ id?: string; channel?: { channelType?: string | null } | null }> }> } | undefined)?.pages ?? [];
      for (const page of pages) {
        for (const conversation of page.items ?? []) {
          if (conversation.id && conversation.channel?.channelType) {
            map.set(conversation.id, conversation.channel.channelType);
          }
        }
      }
    }
    return map;
  }, [canManage, channelsQuery.data?.items, inboxChannelsQuery.data?.items, queryClient]);

  const refetchNotifications = notificationsQuery.refetch;
  const refetchUnreadCount = unreadCountQuery.refetch;

  useEffect(() => {
    if (!visible) return;
    void refetchNotifications();
    void refetchUnreadCount();
  }, [visible, refetchNotifications, refetchUnreadCount]);

  const notifications = useMemo(() => {
    const items = notificationsQuery.data?.items ?? [];
    return items.map((item) => ({ ...item, isUnread: (item.isUnread ?? item.readAt == null) && !optimisticIds.has(item.id) }));
  }, [notificationsQuery.data?.items, optimisticIds]);

  const unreadCount = unreadCountQuery.data ?? 0;

  const markRead = async (notification: NotificationListItem) => {
    setOptimisticIds((current) => new Set(current).add(notification.id));
    try {
      await markNotificationAsRead(notification.id);
      await queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all });
    } catch {
      setOptimisticIds((current) => { const next = new Set(current); next.delete(notification.id); return next; });
    }
  };

  const markAllRead = async () => {
    try {
      await markAllNotificationsAsRead();
      await queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all });
    } catch { /* ignore */ }
  };

  const deleteAll = async () => {
    try {
      await deleteAllNotifications();
      await queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all });
    } catch { /* ignore */ }
  };

  const handleOpenNotification = (notification: NotificationListItem) => {
    if (notification.conversationId) {
      navigation.navigate('Inbox', { screen: 'Conversation', initial: false, params: { conversationId: notification.conversationId, contactName: getMetadataString(notification.metadata, 'contactDisplayName') ?? '' } });
    }
    onClose();
  };

  const isLoading = notificationsQuery.isLoading && !notificationsQuery.data;
  const isError = notificationsQuery.isError;

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={{ height: '82%' }}>
          <View style={[styles.notificationHeader, { borderBottomColor: colors.separator }]}>
            <View style={styles.notificationHeaderCopy}>
              <View style={[styles.notificationHeaderIcon, { backgroundColor: colors.primary }]}><Bell color={colors.surface} size={15} /></View>
              <Text style={[styles.notificationTitle, { color: colors.text }]}>Notifications</Text>
              {unreadCount > 0 ? <View style={styles.unreadPill}><Text style={styles.unreadPillText}>{unreadCount} unread</Text></View> : null}
            </View>
          </View>

          <View style={styles.notificationActions}>
             <Pressable style={[styles.notificationAction, { borderColor: colors.cardBorder }, unreadCount === 0 && styles.notificationActionDisabled]} disabled={unreadCount === 0} onPress={() => void markAllRead()}>
              <CheckCheck color={colors.textSecondary} size={15} /><Text style={[styles.notificationActionText, { color: colors.textSecondary }]}>Mark all read</Text>
            </Pressable>
             <Pressable style={[styles.notificationAction, { borderColor: colors.cardBorder }, notifications.length === 0 && styles.notificationActionDisabled]} disabled={notifications.length === 0} onPress={() => void deleteAll()}>
              <Trash2 color={colors.error} size={15} /><Text style={[styles.notificationActionText, { color: colors.error }]}>Remove all</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.notificationLoading}><PanelSkeleton rows={5} /></View>
          ) : isError ? (
            <View style={styles.notificationEmpty}>
              <View style={styles.notificationEmptyIcon}><Bell color={colors.error} size={22} /></View>
              <Text style={[styles.notificationEmptyTitle, { color: colors.text }]}>Couldn’t load notifications</Text>
              <Text style={[styles.notificationEmptyBody, { color: colors.textSecondary }]}>
                {notificationsQuery.error instanceof Error ? notificationsQuery.error.message : 'Please try again.'}
              </Text>
              <Pressable style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => void notificationsQuery.refetch()}>
                <Text style={[styles.retryButtonText, { color: colors.surface }]}>Retry</Text>
              </Pressable>
            </View>
          ) : notifications.length === 0 ? (
            <View style={styles.notificationEmpty}>
              <View style={styles.notificationEmptyIcon}><Bell color={colors.primary} size={22} /></View>
              <Text style={[styles.notificationEmptyTitle, { color: colors.text }]}>No notifications yet</Text>
              <Text style={[styles.notificationEmptyBody, { color: colors.textSecondary }]}>When messages, assignments, or calls arrive, they will appear here.</Text>
            </View>
          ) : (
            <NotificationScrollList
              notifications={notifications}
              channelTypeById={channelTypeById}
              onOpen={handleOpenNotification}
              onMarkRead={(item) => void markRead(item)}
            />
          )}
        </BottomSheet>
  );
}

const styles = StyleSheet.create({
  bellButton: { alignItems: 'center', borderRadius: 22, borderWidth: 1, height: 40, justifyContent: 'center', position: 'relative', width: 40 },
  bellBadge: { alignItems: 'center', backgroundColor: '#ef4444', borderRadius: 9, borderWidth: 1.5, height: 18, justifyContent: 'center', minWidth: 18, paddingHorizontal: 3, position: 'absolute', right: -5, top: -5 },
  bellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  notificationOverlay: { backgroundColor: 'rgba(15,23,42,0.45)', flex: 1, justifyContent: 'flex-end' },
  notificationSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '82%', overflow: 'hidden' },  notificationHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16 },
  notificationHeaderCopy: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  notificationHeaderIcon: { alignItems: 'center', borderRadius: 10, height: 30, justifyContent: 'center', width: 30 },
  notificationTitle: { fontSize: 17, fontWeight: '800' },
  unreadPill: { alignItems: 'center', backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  unreadPillText: { color: '#2563eb', fontSize: 11, fontWeight: '700' },

  notificationActions: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingVertical: 12 },
  notificationAction: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 13, paddingVertical: 8 },
  notificationActionDisabled: { opacity: 0.45 },
  notificationActionText: { fontSize: 12, fontWeight: '600' },

  notificationList: { flex: 1, paddingHorizontal: 14, paddingTop: 6 },
  notificationLoading: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingTop: 8, width: '100%' },
  notificationEmpty: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  notificationEmptyIcon: { alignItems: 'center', backgroundColor: '#dbeafe', borderRadius: 16, height: 52, justifyContent: 'center', width: 52 },
  notificationEmptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 12 },
  notificationEmptyBody: { fontSize: 13, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  retryButton: { borderRadius: 12, marginTop: 14, paddingHorizontal: 16, paddingVertical: 10 },
  retryButtonText: { fontSize: 13, fontWeight: '700' },

  notificationRow: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 8, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10 },
  notificationRowUnread: {},
  notificationAccent: { borderRadius: 999, height: 40, marginRight: 10, width: 4 },
  notificationIconStack: { marginRight: 10, position: 'relative' },
  notificationIconWrap: { alignItems: 'center', borderRadius: 12, height: 36, justifyContent: 'center', width: 36 },
  notificationTypeBadge: { alignItems: 'center', borderRadius: 8, borderWidth: 2, bottom: -3, height: 18, justifyContent: 'center', position: 'absolute', right: -3, width: 18 },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationRowTitle: { fontSize: 13, fontWeight: '700' },
  notificationBody: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  notificationMeta: { alignItems: 'flex-end', gap: 6, marginLeft: 8 },
  notificationTime: { fontSize: 10, fontWeight: '600' },
  notificationUnreadDot: { backgroundColor: '#3b82f6', borderRadius: 4, height: 8, width: 8 },
  notificationReadDot: { backgroundColor: 'transparent', borderRadius: 4, height: 8, width: 8 },
});
