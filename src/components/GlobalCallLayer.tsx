import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  fetchActiveConversationCallSessions,
  fetchConversationCallSession,
  type ConversationCallConversation,
  type ConversationCallSession,
} from '../api/inbox';
import { useAuth } from '../auth/AuthContext';
import { fetchMyProfile } from '../api/profile';
import {
  clearIncomingCallPrompt,
  hydrateIncomingCallPrompt,
  readIncomingCallPrompt,
  subscribeIncomingCallPrompt,
  type IncomingCallPrompt,
} from '../lib/incoming-call-prompt';
import { dismissIncomingCallNotification, isIncomingCallPromptExpired } from '../lib/call-notification';
import { extractWhatsappCallSignal } from '../lib/whatsapp-calling';
import { isCallSessionTerminal, isLiveCallSession } from '../lib/inbox-utils';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';
import { useCallController } from '../providers/CallControllerProvider';
import { getRealtimeConnectionStatus, subscribeRealtimeConnectionStatus } from '../api/realtime';
import { CallPanel } from './CallPanel';
import { getCallPartyHint, getCallUiRevision, isGenericCallLabel, subscribeCallChrome } from '../lib/call-chrome';
import { pollingWhileUnlocked, isBillingLocked } from '../lib/billing-lock';
import { latestAccessToken, subscribeAccessToken, ApiError } from '../api/client';
import { callScopeFromAccessToken, activeCallQueryKey } from '../lib/jwt-workspace';
import { INCOMING_CALL_TTL_MS, isIncomingCallPromptInScope, isActionableIncomingCall, isCallSessionRoutedToUser, isExpiredIncomingWhatsappCall } from '../lib/incoming-call-state';

function firstRealLabel(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !isGenericCallLabel(trimmed)) return trimmed;
  }
  return null;
}

function findCachedConversation(queryClient: ReturnType<typeof useQueryClient>, conversationId: string) {
  const messages = queryClient.getQueryData(['messages', conversationId]) as { conversation?: any } | undefined;
  if (messages?.conversation) return messages.conversation;
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['conversations'] })) {
    const pages = (data as { pages?: Array<{ items?: any[] }> } | undefined)?.pages ?? [];
    for (const page of pages) {
      const item = (page.items ?? []).find((conversation) => conversation.id === conversationId);
      if (item) return item;
    }
  }
  return null;
}

function selectVisibleCallSession(sessions: ConversationCallSession[], currentUserId: string | undefined) {
  if (sessions.length === 0) return null;

  const visibleSessions = sessions.filter((session) => {
    if (!isLiveCallSession(session)) return false;
    if (!session.claimedByUserId) {
      return session.direction === 'OUTBOUND' && (session.status === 'RINGING' || session.status === 'CONNECTED');
    }
    const isLiveClaimedSession =
      (session.direction === 'INBOUND'
        && (session.status === 'REQUESTED'
          || session.status === 'PERMISSION_REQUESTED'
          || session.status === 'RINGING'
          || session.status === 'CONNECTED'))
      || (session.direction === 'OUTBOUND' && (session.status === 'RINGING' || session.status === 'CONNECTED'));
    return Boolean(currentUserId) && session.claimedByUserId === currentUserId && isLiveClaimedSession;
  });

  const inboundAttentionSession = visibleSessions.find(
    (session) =>
      session.direction === 'INBOUND'
      && (session.status === 'REQUESTED' || session.status === 'PERMISSION_REQUESTED' || session.status === 'RINGING'),
  );
  if (inboundAttentionSession) return inboundAttentionSession;

  return (
    visibleSessions.find((session) => session.status === 'RINGING')
    ?? visibleSessions.find((session) => session.status === 'CONNECTED')
    ?? visibleSessions[0]
    ?? null
  );
}

function selectIncomingCallSession(sessions: ConversationCallSession[]) {
  return sessions.find(isActionableIncomingCall) ?? null;
}

function fallbackConversation(session: ConversationCallSession): ConversationCallConversation {
  return session.conversation ?? {
    id: session.conversationId,
    workspaceId: session.workspaceId,
    status: 'OPEN',
    unreadCount: 0,
    contact: {
      id: session.conversationId,
      displayName: session.recipientDisplayName?.trim() || null,
      primaryPhone: session.recipientIdentityValue?.trim() || null,
      avatarUrl: null,
    },
    channel: {
      channelId: session.channelAccountId,
      channelType: session.provider?.toLowerCase() === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channelName: session.provider?.toLowerCase() === 'webchat' ? 'Web chat' : 'WhatsApp',
      displayPhoneNumber: null,
    },
    assignee: null,
  };
}

function getBizOpaqueCallbackData(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).bizOpaqueCallbackData;
  return typeof value === 'string' ? value : null;
}

export function GlobalCallLayer() {
  const { session } = useAuth();
  const accessToken = useSyncExternalStore(subscribeAccessToken, () => latestAccessToken);
  const callScope = useMemo(() => callScopeFromAccessToken(accessToken), [accessToken]);
  const hasWorkspaceContext = Boolean(session && callScope?.canManageCalls);
  const queryClient = useQueryClient();
  useSyncExternalStore(subscribeCallChrome, getCallUiRevision);
  const callController = useCallController();
  const resetPeerContext = callController.resetPeerContext;
  useEffect(() => () => resetPeerContext(), [callScope?.userId, callScope?.workspaceId, hasWorkspaceContext, resetPeerContext]);
  useSyncExternalStore(subscribeRealtimeConnectionStatus, getRealtimeConnectionStatus);
  const appState = useSyncExternalStore(
    (onStoreChange) => {
      const sub = AppState.addEventListener('change', onStoreChange);
      return () => sub.remove();
    },
    () => AppState.currentState,
  );
  const profileQuery = useQuery({
    queryKey: ['me-profile'],
    queryFn: fetchMyProfile,
    enabled: Boolean(session),
    staleTime: 5 * 60_000,
  });
  const currentUserId = callScope?.userId ?? profileQuery.data?.id;

  const activeCallsQuery = useQuery({
    queryKey: activeCallQueryKey(),
    queryFn: () => fetchActiveConversationCallSessions({ limit: 5 }),
    enabled: hasWorkspaceContext && appState === 'active',
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    select: (data) => ({ ...data, items: data.items.filter((item) => item.workspaceId === callScope?.workspaceId && !isExpiredIncomingWhatsappCall(item) && isCallSessionRoutedToUser(item, currentUserId ?? '')) }),
    refetchIntervalInBackground: false,
    refetchInterval: pollingWhileUnlocked(() => {
      if (appState !== 'active') return false;
      return (queryClient.getQueryData<{ items?: ConversationCallSession[] }>(activeCallQueryKey())?.items ?? []).some(isLiveCallSession) ? 5000 : 60_000;
    }),
  });

  const peerCallIdentity = callController.peerCallIdentity;
  const peerCallQuery = useQuery({
    queryKey: ['call-session-state', peerCallIdentity?.conversationId, peerCallIdentity?.callSessionId],
    queryFn: () => fetchConversationCallSession(peerCallIdentity!),
    enabled: hasWorkspaceContext && Boolean(peerCallIdentity) && !callController.isBusy,
    retry: false,
    refetchInterval: appState === 'active' ? 5000 : false,
  });
  useEffect(() => {
    if (!peerCallIdentity) return;
    const unavailable = peerCallQuery.error instanceof ApiError && [403, 404].includes(peerCallQuery.error.status);
    if (unavailable || peerCallQuery.data?.endedAt || (peerCallQuery.data && isCallSessionTerminal(peerCallQuery.data.status))) {
      resetPeerContext();
    }
  }, [peerCallIdentity, peerCallQuery.data, peerCallQuery.error, resetPeerContext]);

  const [incomingCallPrompt, setIncomingCallPrompt] = useState<IncomingCallPrompt | null>(() => readIncomingCallPrompt());
  const dismissedPromptSessionIdsRef = useRef(new Set<string>());
  const { incomingCallAlertsEnabled, isLoaded: areNotificationPrefsLoaded } = useNotificationPreferences();
  const canShowIncomingCallAlerts = hasWorkspaceContext && areNotificationPrefsLoaded && incomingCallAlertsEnabled;

  useEffect(() => {
    setIncomingCallPrompt(readIncomingCallPrompt());
    return subscribeIncomingCallPrompt((prompt) => {
      if (!prompt) { setIncomingCallPrompt(null); return; }
      if (!canShowIncomingCallAlerts || dismissedPromptSessionIdsRef.current.has(prompt.entityId)) return;
      setIncomingCallPrompt(prompt);
    });
  }, [canShowIncomingCallAlerts]);

  // A call that rang while the app was killed is restored from storage on launch.
  useEffect(() => {
    if (!hasWorkspaceContext || appState !== 'active') return;
    void hydrateIncomingCallPrompt().then((prompt) => {
      if (prompt && isIncomingCallPromptExpired(prompt)) {
        clearIncomingCallPrompt(prompt.entityId);
        void dismissIncomingCallNotification(prompt.entityId);
      }
    });
  }, [hasWorkspaceContext, appState, callScope?.userId, callScope?.workspaceId]);

  // Once the in-app call screen is on top the OS notification is redundant noise,
  // but it must keep ringing while the app sits in the background.
  useEffect(() => {
    if (!incomingCallPrompt || appState !== 'active') return;
    void dismissIncomingCallNotification(incomingCallPrompt.entityId);
  }, [incomingCallPrompt, appState]);

  const visibleCallSession = useMemo(
    () => selectVisibleCallSession(activeCallsQuery.data?.items ?? [], currentUserId),
    [activeCallsQuery.data?.items, currentUserId],
  );
  const incomingCallSession = useMemo(
    () => (canShowIncomingCallAlerts ? selectIncomingCallSession(activeCallsQuery.data?.items ?? []) : null),
    [activeCallsQuery.data?.items, canShowIncomingCallAlerts],
  );
  const promptValid = isIncomingCallPromptInScope(incomingCallPrompt, callScope);
  const resolvedPrompt = useQuery({
    queryKey: ['call-session-state', callScope?.workspaceId, callScope?.userId, incomingCallPrompt?.conversationId, incomingCallPrompt?.entityId],
    queryFn: () => fetchConversationCallSession({ conversationId: incomingCallPrompt!.conversationId!, callSessionId: incomingCallPrompt!.entityId }),
    enabled: canShowIncomingCallAlerts && promptValid && appState === 'active',
    staleTime: 0, gcTime: 0,
    refetchOnMount: 'always', refetchOnReconnect: 'always', refetchOnWindowFocus: 'always',
    refetchIntervalInBackground: false,
    refetchInterval: pollingWhileUnlocked(() => appState === 'active' && promptValid ? 5000 : false),
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  const promptCallSession = canShowIncomingCallAlerts && promptValid && isActionableIncomingCall(resolvedPrompt.data)
    ? resolvedPrompt.data! : null;

  useEffect(() => {
    if (!hasWorkspaceContext || appState !== 'active' || isBillingLocked()) return;
    void activeCallsQuery.refetch({ cancelRefetch: false });
    if (promptValid) void resolvedPrompt.refetch({ cancelRefetch: false });
  }, [appState, hasWorkspaceContext, callScope?.userId, callScope?.workspaceId]);

  useEffect(() => {
    const prompt = incomingCallPrompt;
    if (!prompt || !callScope || !areNotificationPrefsLoaded) return;
    const unavailable = resolvedPrompt.error instanceof ApiError && [403, 404].includes(resolvedPrompt.error.status);
    if (!canShowIncomingCallAlerts || !promptValid || unavailable || (resolvedPrompt.data && !isActionableIncomingCall(resolvedPrompt.data))) {
      clearIncomingCallPrompt(prompt.entityId);
      void dismissIncomingCallNotification(prompt.entityId);
      return;
    }
    const timer = setTimeout(() => {
      clearIncomingCallPrompt(prompt.entityId);
      void dismissIncomingCallNotification(prompt.entityId);
    }, Math.max(0, INCOMING_CALL_TTL_MS - (Date.now() - Date.parse(prompt.createdAt))));
    return () => clearTimeout(timer);
  }, [incomingCallPrompt, callScope, areNotificationPrefsLoaded, canShowIncomingCallAlerts, promptValid, resolvedPrompt.data, resolvedPrompt.error]);

  const activeCallSession = visibleCallSession ?? incomingCallSession ?? promptCallSession;
  const activeCallSignal = useMemo(
    () => (activeCallSession ? extractWhatsappCallSignal(activeCallSession.metadata) : null),
    [activeCallSession],
  );

  useEffect(() => {
    const promptSessionId = incomingCallPrompt?.entityId;
    if (!promptSessionId) return;
    const matchingSession = activeCallsQuery.data?.items.find((item) => item.id === promptSessionId);
    if (!matchingSession) return;
    const shouldClear =
      isCallSessionTerminal(matchingSession.status)
      || Boolean(matchingSession.claimedByUserId && matchingSession.claimedByUserId !== currentUserId);
    if (!shouldClear) return;
    dismissedPromptSessionIdsRef.current.add(promptSessionId);
    clearIncomingCallPrompt(promptSessionId);
    void dismissIncomingCallNotification(promptSessionId);
    setIncomingCallPrompt(null);
  }, [activeCallsQuery.data?.items, currentUserId, incomingCallPrompt?.entityId]);

  useEffect(() => {
    if (activeCallSignal?.sdpType === 'answer') {
      void callController.applyRemoteSignal(activeCallSignal);
    }
  }, [activeCallSignal, callController]);

  useEffect(() => {
    if (
      !activeCallSession
      && (callController.connectionState === 'disconnected' || callController.connectionState === 'failed')
    ) {
      callController.resetPeerContext();
    }
  }, [activeCallSession, callController]);

  if (!session || !hasWorkspaceContext) return null;

  if (
    !activeCallSession
    && callController.connectionState === 'idle'
    && !callController.errorMessage
    && !callController.remoteStream
  ) {
    return null;
  }

  if (!activeCallSession && callController.connectionState === 'idle') return null;

  const conversation = (() => {
    if (!activeCallSession) return null;
    const base = fallbackConversation(activeCallSession);
    const cached = findCachedConversation(queryClient, base.id);
    const hint = getCallPartyHint(base.id);
    const displayName = firstRealLabel(
      cached?.contact?.displayName,
      hint?.label,
      base.contact.displayName,
      activeCallSession.recipientDisplayName,
      cached?.contact?.primaryPhone,
      cached?.contact?.username,
      base.contact.primaryPhone,
      activeCallSession.recipientIdentityValue,
    );
    return {
      ...base,
      contact: {
        ...base.contact,
        displayName: displayName ?? base.contact.displayName,
        primaryPhone: cached?.contact?.primaryPhone ?? base.contact.primaryPhone,
        avatarUrl: cached?.contact?.avatarUrl ?? hint?.avatarUrl ?? base.contact.avatarUrl,
      },
    };
  })();
  if (!conversation || !activeCallSession) return null;

  const conversationId = activeCallSession.conversationId;
  const callSessionId = activeCallSession.id;
  const callMetadata = activeCallSession.metadata;

  return (
    <CallPanel
      conversation={conversation}
      activeCallSession={activeCallSession}
      activeCallSignal={activeCallSignal}
      isBusy={callController.isBusy}
      connectionState={callController.connectionState}
      errorMessage={callController.errorMessage}
      remoteStream={callController.remoteStream}
      isMuted={callController.isMuted}
      onAnswerCall={() => {
        if (!activeCallSignal) return;
        void callController.answerCall({
          conversationId,
          callSessionId,
          remoteOffer: activeCallSignal,
          bizOpaqueCallbackData: getBizOpaqueCallbackData(callMetadata),
        });
      }}
      onDeclineCall={() => {
        void callController.declineCall({
          conversationId,
          callSessionId,
        });
        dismissedPromptSessionIdsRef.current.add(callSessionId);
        clearIncomingCallPrompt(callSessionId);
        void dismissIncomingCallNotification(callSessionId);
      }}
      onEndCall={() => {
        void callController.endCall({
          conversationId,
          callSessionId,
        });
        dismissedPromptSessionIdsRef.current.add(callSessionId);
        clearIncomingCallPrompt(callSessionId);
        void dismissIncomingCallNotification(callSessionId);
      }}
      onToggleMute={() => callController.toggleMute()}
    />
  );
}
