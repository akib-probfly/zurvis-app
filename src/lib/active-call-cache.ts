import type { QueryClient } from '@tanstack/react-query';
import type { ConversationCallSession, ConversationCallSessionsResponse } from '../api/inbox';
import type { UserProfile } from '../api/profile';
import { dismissIncomingCallNotification } from './call-notification';
import { clearIncomingCallPrompt, writeIncomingCallPrompt } from './incoming-call-prompt';
import { isCallSessionTerminal } from './inbox-utils';
import { activeCallQueryKey, callScopeFromAccessToken } from './jwt-workspace';

export type CallSessionUpdatedEvent = {
  workspaceId: string;
  conversationId: string;
  callSessionId: string;
  status: ConversationCallSession['status'] | string;
  direction?: 'INBOUND' | 'OUTBOUND';
  provider?: string;
  providerCallId?: string | null;
  providerSessionId?: string | null;
  permissionStatus?: ConversationCallSession['permissionStatus'];
  permissionRequestMessageId?: string | null;
  requestedPermissionAt?: string | null;
  permissionRespondedAt?: string | null;
  startedAt?: string | null;
  connectedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  endedReason?: string | null;
  metadata?: unknown;
  claimedByWorkspaceMemberId?: string | null;
  claimedByUserId?: string | null;
  claimedAt?: string | null;
  conversation?: ConversationCallSession['conversation'] | null;
  targetUserIds?: string[] | null;
  createdAt?: string;
  updatedAt?: string;
};

const INCOMING_STATUSES = new Set(['REQUESTED', 'PERMISSION_REQUESTED', 'RINGING']);
const ACTIVE_STATUSES = new Set(['REQUESTED', 'PERMISSION_REQUESTED', 'RINGING', 'CONNECTED']);

function currentUserId(queryClient: QueryClient) {
  return queryClient.getQueryData<UserProfile>(['me-profile'])?.id;
}

function isIncomingUnclaimed(payload: CallSessionUpdatedEvent) {
  return (
    payload.direction === 'INBOUND'
    && !payload.claimedByUserId
    && INCOMING_STATUSES.has(payload.status)
  );
}

function isRoutedToUser(payload: CallSessionUpdatedEvent, userId: string | undefined) {
  if (!userId) return false;
  if (!Array.isArray(payload.targetUserIds)) return true;
  return payload.targetUserIds.includes(userId);
}

export function upsertActiveCallSessionCache(queryClient: QueryClient, payload: CallSessionUpdatedEvent) {
  const scope = callScopeFromAccessToken();
  if (!scope || payload.workspaceId !== scope.workspaceId) return;
  // Keep the locally owned call observable even after it leaves the active list.
  queryClient.setQueryData<ConversationCallSession>(
    ['call-session-state', payload.conversationId, payload.callSessionId],
    (current) => current ? {
      ...current,
      status: payload.status as ConversationCallSession['status'],
      endedAt: payload.endedAt ?? current.endedAt,
      updatedAt: payload.updatedAt ?? current.updatedAt,
    } : undefined,
  );
  void queryClient.invalidateQueries({
    queryKey: ['call-session-state', payload.conversationId, payload.callSessionId],
    refetchType: 'active',
  });
  const userId = scope.userId || currentUserId(queryClient);
  const isActiveStatus = ACTIVE_STATUSES.has(payload.status);
  const isClaimedByOther = Boolean(userId && payload.claimedByUserId && payload.claimedByUserId !== userId);
  const shouldKeep =
    isActiveStatus
    && !isCallSessionTerminal(payload.status)
    && !isClaimedByOther
    && (isIncomingUnclaimed(payload) || payload.claimedByUserId === userId || payload.direction === 'OUTBOUND')
    && isRoutedToUser(payload, userId);

  queryClient.cancelQueries({ queryKey: ['active-calls'] });
  queryClient.setQueryData<ConversationCallSessionsResponse>(activeCallQueryKey(), (current) => {
    const items = current?.items ?? [];
    const existing = items.find((session) => session.id === payload.callSessionId);
    const without = items.filter((session) => session.id !== payload.callSessionId);
    if (!shouldKeep) {
      return { items: without, pageInfo: current?.pageInfo };
    }

    const nextSession: ConversationCallSession = {
      ...(existing ?? {
        id: payload.callSessionId,
        workspaceId: payload.workspaceId,
        conversationId: payload.conversationId,
        channelAccountId: payload.conversation?.channel?.channelId ?? '',
        initiatedByWorkspaceMemberId: null,
        claimedByWorkspaceMemberId: payload.claimedByWorkspaceMemberId ?? null,
        claimedByUserId: payload.claimedByUserId ?? null,
        claimedAt: payload.claimedAt ?? null,
        initiatedBy: null,
        claimedBy: null,
        direction: payload.direction ?? 'INBOUND',
        provider: payload.provider ?? (payload.conversation?.channel.channelType === 'WEBCHAT' ? 'webchat' : 'WHATSAPP'),
        providerCallId: payload.providerCallId ?? null,
        providerSessionId: payload.providerSessionId ?? null,
        permissionRequestMessageId: payload.permissionRequestMessageId ?? null,
        recipientIdentityValue: payload.conversation?.contact?.primaryPhone ?? '',
        recipientDisplayName: payload.conversation?.contact?.displayName ?? null,
        status: payload.status as ConversationCallSession['status'],
        permissionStatus: payload.permissionStatus ?? 'REQUESTED',
        requestedPermissionAt: payload.requestedPermissionAt ?? null,
        permissionRespondedAt: payload.permissionRespondedAt ?? null,
        startedAt: payload.startedAt ?? null,
        connectedAt: payload.connectedAt ?? null,
        endedAt: payload.endedAt ?? null,
        durationSeconds: payload.durationSeconds ?? null,
        endedReason: payload.endedReason ?? null,
        metadata: payload.metadata ?? null,
        conversation: payload.conversation ?? undefined,
        createdAt: payload.createdAt ?? payload.updatedAt ?? new Date().toISOString(),
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      }),
      provider: payload.provider ?? (payload.conversation?.channel.channelType === 'WEBCHAT' ? 'webchat' : existing?.provider ?? 'WHATSAPP'),
      providerCallId: payload.providerCallId ?? existing?.providerCallId ?? null,
      providerSessionId: payload.providerSessionId ?? existing?.providerSessionId ?? null,
      permissionRequestMessageId: payload.permissionRequestMessageId ?? existing?.permissionRequestMessageId ?? null,
      status: payload.status as ConversationCallSession['status'],
      permissionStatus: payload.permissionStatus ?? existing?.permissionStatus ?? 'REQUESTED',
      requestedPermissionAt: payload.requestedPermissionAt ?? existing?.requestedPermissionAt ?? null,
      permissionRespondedAt: payload.permissionRespondedAt ?? existing?.permissionRespondedAt ?? null,
      startedAt: payload.startedAt ?? existing?.startedAt ?? null,
      connectedAt: payload.connectedAt ?? existing?.connectedAt ?? null,
      endedAt: payload.endedAt ?? existing?.endedAt ?? null,
      durationSeconds: payload.durationSeconds ?? existing?.durationSeconds ?? null,
      endedReason: payload.endedReason ?? existing?.endedReason ?? null,
      metadata: payload.metadata ?? existing?.metadata ?? null,
      claimedByWorkspaceMemberId: payload.claimedByWorkspaceMemberId ?? existing?.claimedByWorkspaceMemberId ?? null,
      claimedByUserId: payload.claimedByUserId ?? existing?.claimedByUserId ?? null,
      claimedAt: payload.claimedAt ?? existing?.claimedAt ?? null,
      conversation: payload.conversation ?? existing?.conversation,
      direction: payload.direction ?? existing?.direction ?? 'INBOUND',
      updatedAt: payload.updatedAt ?? existing?.updatedAt ?? new Date().toISOString(),
    };

    return { items: [nextSession, ...without], pageInfo: current?.pageInfo };
  });
}

export function syncIncomingCallPromptFromSession(
  payload: CallSessionUpdatedEvent,
  options: { incomingCallAlertsEnabled: boolean; currentUserId?: string },
) {
  const terminalOrClaimed =
    isCallSessionTerminal(payload.status)
    || !INCOMING_STATUSES.has(payload.status)
    || Boolean(payload.claimedByUserId)
    || payload.direction !== 'INBOUND';

  if (terminalOrClaimed) {
    clearIncomingCallPrompt(payload.callSessionId);
    void dismissIncomingCallNotification(payload.callSessionId);
    return;
  }

  if (!options.incomingCallAlertsEnabled) return;
  if (!isRoutedToUser(payload, options.currentUserId)) return;

  const contactDisplayName = payload.conversation?.contact?.displayName ?? null;
  const contactPhone = payload.conversation?.contact?.primaryPhone ?? null;
  const channelName = payload.conversation?.channel?.channelName ?? 'WhatsApp';

  writeIncomingCallPrompt({
    notificationId: `call-session:${payload.callSessionId}`,
    workspaceId: payload.workspaceId,
    type: 'INCOMING_CALL',
    entityType: 'CALL_SESSION',
    entityId: payload.callSessionId,
    conversationId: payload.conversationId,
    channelId: payload.conversation?.channel?.channelId ?? null,
    targetScope: 'USER',
    title: 'Incoming call',
    body: contactDisplayName || contactPhone || (payload.conversation?.channel.channelType === 'WEBCHAT' || payload.provider?.toLowerCase() === 'webchat' ? 'Incoming Web chat call' : 'Incoming WhatsApp call'),
    createdAt: payload.updatedAt ?? payload.createdAt ?? new Date().toISOString(),
    metadata: {
      contactDisplayName,
      contactPhone,
      channelName,
      channelType: payload.conversation?.channel.channelType,
      provider: payload.provider ?? (payload.conversation?.channel.channelType === 'WEBCHAT' ? 'webchat' : 'WHATSAPP'),
      ...(payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata as Record<string, unknown>
        : {}),
    },
    recipientUserIds: payload.targetUserIds ?? null,
  });
}
