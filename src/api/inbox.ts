import { apiFetch } from './client';

export type QuickReplySnippet = {
  id: string;
  workspaceId?: string | null;
  title?: string | null;
  shortcut?: string | null;
  body: string;
  category?: string | null;
  channelScope?: string | null;
  isActive?: boolean;
  usageCount?: number;
  attachments?: Array<{ id: string; mediaType: string; originalName?: string | null }>;
};

export type WhatsappTemplateButton = { id?: string; type?: string; label?: string; url?: string | null; phoneNumber?: string | null; offerCode?: string | null };
export type WhatsappTemplate = {
  id: string;
  name: string;
  category?: string | null;
  status?: string | null;
  language?: string | null;
  header?: { enabled?: boolean; type?: string; content?: string } | null;
  body?: string | null;
  footer?: string | null;
  buttons?: WhatsappTemplateButton[] | null;
  variables?: Array<{ index?: number; label?: string; sampleValue?: string | null; section?: string }>;
  rejectionReason?: string | null;
};

export type ReactionAction = 'REACT' | 'UNREACT';

export type ConversationMessaging = {
  policyType?: 'UNRESTRICTED' | 'CUSTOMER_WINDOW' | null;
  windowState?: 'NOT_APPLICABLE' | 'OPEN' | 'EXPIRED' | null;
  windowExpiresAt?: string | null;
  canSendFreeformMessage?: boolean;
  standardWindowExpiresAt?: string | null;
  humanAgentWindowExpiresAt?: string | null;
  canSendStandardMessage?: boolean;
  canSendHumanAgentMessage?: boolean;
};

export type ConversationListTag = {
  id: string;
  text: string;
  color?: string | null;
  isArchived?: boolean;
};

export type ConversationListLastMessage = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  text: string | null;
  sentAt?: string | null;
  createdAt?: string;
  campaignId?: string | null;
  campaignName?: string | null;
  metadata?: unknown;
  attachments?: Array<{
    caption?: string | null;
    originalName?: string | null;
    mediaType?: string;
  }>;
};

export type ConversationLastInteraction =
  | {
      kind: 'MESSAGE';
      at: string;
      message: ConversationListLastMessage;
    }
  | {
      kind: 'CALL';
      at: string;
      call: ConversationCallSession;
    };

export type ConversationAiAgent = { id: string; name: string; status: string };

export type ConversationListItem = {
  id: string;
  workspaceId: string;
  status: 'OPEN' | 'ASSIGNED' | 'CLOSED';
  isStarred?: boolean;
  unreadCount: number;
  isUnreplied: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastInteraction?: ConversationLastInteraction | null;
  blockedAt?: string | null;
  contact: { id: string; displayName: string | null; avatarUrl: string | null; primaryPhone?: string | null; username?: string | null; blockedAt?: string | null };
  channel: { channelId: string; channelType: string; channelName: string; displayPhoneNumber: string | null; activeAiAgent?: { id: string; name: string } | null };
  assignee?: { workspaceMemberId: string; userName: string | null; userEmail: string; avatarUrl: string | null } | null;
  assignedAiAgent?: ConversationAiAgent | null;
  messaging?: ConversationMessaging | null;
  tags?: ConversationListTag[] | null;
};

export type ConversationsListResponse = { items: ConversationListItem[]; pageInfo?: { nextCursor?: string | null; hasMore?: boolean } };

export type ConversationMessagesResponse<TMessage = Record<string, any>> = {
  items: TMessage[];
  nextCursor: string | null;
  hasMore: boolean;
  conversation: any;
};

export async function fetchConversationMessages<TMessage = Record<string, any>>(conversationId: string): Promise<ConversationMessagesResponse<TMessage>> {
  const page = await apiFetch<{ items: TMessage[]; pageInfo?: { nextCursor?: string | null; hasMore?: boolean }; conversation?: any }>(
    `/conversations/${conversationId}/messages?limit=50`,
  );
  return {
    items: page.items,
    nextCursor: page.pageInfo?.nextCursor ?? null,
    hasMore: page.pageInfo?.hasMore ?? false,
    conversation: page.conversation ?? null,
  };
}

export type ConversationsFilters = {
  workspaceId?: string;
  status?: 'OPEN' | 'ASSIGNED' | 'CLOSED';
  search?: string;
  tagIds?: string[];
  tagText?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
  unrepliedOnly?: boolean;
  assignment?: 'any' | 'assigned' | 'unassigned';
  channelTypes?: string[];
  channelIds?: string[];
  countryCodes?: string[];
  assigneeWorkspaceMemberIds?: string[];
  includeEmpty?: boolean;
  blockedStatus?: 'blocked' | 'unblocked';
  createdAtFrom?: string;
  createdAtTo?: string;
  cursor?: string;
  limit?: number;
};

function buildQueryString(params: Record<string, string | number | boolean | string[] | null | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      // Backend accepts comma-separated values (same encoding as osaas-frontend).
      query.set(key, value.map((item) => String(item)).join(','));
    } else if (value === true) {
      query.set(key, 'true');
    } else {
      query.set(key, String(value));
    }
  });
  const raw = query.toString();
  return raw ? `?${raw}` : '';
}

export async function fetchConversations(params: ConversationsFilters = {}): Promise<ConversationsListResponse> {
  return apiFetch<ConversationsListResponse>(`/conversations${buildQueryString({
    workspaceId: params.workspaceId,
    status: params.status,
    search: params.search,
    tagIds: params.tagIds,
    tagText: params.tagText,
    unreadOnly: params.unreadOnly,
    starredOnly: params.starredOnly,
    unrepliedOnly: params.unrepliedOnly,
    assignment: params.assignment,
    channelTypes: params.channelTypes,
    channelIds: params.channelIds,
    countryCodes: params.countryCodes,
    assigneeWorkspaceMemberIds: params.assigneeWorkspaceMemberIds,
    includeEmpty: params.includeEmpty,
    blockedStatus: params.blockedStatus,
    createdAtFrom: params.createdAtFrom,
    createdAtTo: params.createdAtTo,
    cursor: params.cursor,
    limit: params.limit ?? 25,
  })}`);
}

export async function fetchConversationCount(params: Omit<ConversationsFilters, 'cursor' | 'limit'> = {}): Promise<number> {
  const response = await apiFetch<{ count?: number; total?: number } | number>(`/conversations/count${buildQueryString({
    workspaceId: params.workspaceId,
    status: params.status,
    search: params.search,
    tagIds: params.tagIds,
    tagText: params.tagText,
    unreadOnly: params.unreadOnly,
    starredOnly: params.starredOnly,
    unrepliedOnly: params.unrepliedOnly,
    assignment: params.assignment,
    channelTypes: params.channelTypes,
    channelIds: params.channelIds,
    countryCodes: params.countryCodes,
    assigneeWorkspaceMemberIds: params.assigneeWorkspaceMemberIds,
    includeEmpty: params.includeEmpty,
    blockedStatus: params.blockedStatus,
    createdAtFrom: params.createdAtFrom,
    createdAtTo: params.createdAtTo,
  })}`);
  if (typeof response === 'number') return response;
  return response?.count ?? response?.total ?? 0;
}

export async function fetchConversationUnreadCount(params: Omit<ConversationsFilters, 'cursor' | 'limit' | 'status' | 'unreadOnly' | 'unrepliedOnly' | 'includeEmpty'> = {}): Promise<number> {
  const response = await apiFetch<{ count?: number; unreadCount?: number; total?: number } | number>(`/conversations/unread-count${buildQueryString({
    workspaceId: params.workspaceId,
    search: params.search,
    tagIds: params.tagIds,
    tagText: params.tagText,
    starredOnly: params.starredOnly,
    assignment: params.assignment,
    channelTypes: params.channelTypes,
    channelIds: params.channelIds,
    countryCodes: params.countryCodes,
    assigneeWorkspaceMemberIds: params.assigneeWorkspaceMemberIds,
    blockedStatus: params.blockedStatus,
    createdAtFrom: params.createdAtFrom,
    createdAtTo: params.createdAtTo,
  })}`);
  if (typeof response === 'number') return response;
  return response?.count ?? response?.unreadCount ?? response?.total ?? 0;
}

export async function updateConversationAssignment(conversationId: string, assigneeWorkspaceMemberId: string | null, assigneeAiAgentId?: string | null) {
  return apiFetch<ConversationListItem>(`/conversations/${conversationId}/assignment`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeWorkspaceMemberId, ...(assigneeAiAgentId !== undefined ? { assigneeAiAgentId } : {}) }),
  });
}

export type ConversationAssignmentEventReason =
  | 'MANUAL'
  | 'SELF'
  | 'UNASSIGNED'
  | 'REASSIGNED'
  | 'ROUND_ROBIN'
  | 'DEFAULT_OWNER'
  | 'AI_ASSIGNED'
  | 'AI_HANDOFF'
  | 'AI_HANDOFF_PENDING';

export type ConversationAssignmentMember = {
  workspaceMemberId: string;
  userName: string | null;
  userEmail: string | null;
};

export type ConversationAssignmentEvent = {
  id: string;
  workspaceId: string;
  conversationId: string;
  reason: ConversationAssignmentEventReason;
  note: string | null;
  fromWorkspaceMemberId: string | null;
  fromMember: ConversationAssignmentMember | null;
  toWorkspaceMemberId: string | null;
  toMember: ConversationAssignmentMember | null;
  fromAiAgentId?: string | null;
  fromAiAgent?: { id: string; name: string } | null;
  toAiAgentId?: string | null;
  toAiAgent?: { id: string; name: string } | null;
  actedByWorkspaceMemberId: string | null;
  actedBy: ConversationAssignmentMember | null;
  createdAt: string;
};

export type ConversationAssignmentEventsResponse = {
  items: ConversationAssignmentEvent[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
};

export async function fetchConversationAssignmentEvents(params: {
  conversationId: string;
  cursor?: string;
  limit?: number;
}): Promise<ConversationAssignmentEventsResponse> {
  const limit = params.limit ?? 100;
  const items: ConversationAssignmentEvent[] = [];
  let cursor = params.cursor;
  let pageInfo: ConversationAssignmentEventsResponse['pageInfo'] = { nextCursor: null, hasMore: false };

  while (true) {
    const response = await apiFetch<ConversationAssignmentEventsResponse>(
      `/conversations/${params.conversationId}/assignment-events${buildQueryString({ cursor, limit })}`,
    );
    items.push(...(response.items ?? []));
    pageInfo = response.pageInfo ?? pageInfo;
    if (!pageInfo.hasMore || !pageInfo.nextCursor) break;
    cursor = pageInfo.nextCursor;
  }

  return { items, pageInfo };
}

export type AssigneeFilterOption = {
  workspaceMemberId: string;
  userId: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  roleKey: 'workspace_admin' | 'workspace_manager' | 'workspace_agent';
};

export async function fetchAssigneeOptions(workspaceId?: string, channelId?: string): Promise<AssigneeFilterOption[]> {
  const response = await apiFetch<{ workspaceId: string; items: AssigneeFilterOption[] }>(`/conversations/assignee-filter-options${buildQueryString({ workspaceId, channelId })}`);
  return response.items ?? [];
}

export async function updateConversationStar(conversationId: string, isStarred: boolean) {
  return apiFetch(`/conversations/${conversationId}/star`, { method: 'PATCH', body: JSON.stringify({ isStarred }) });
}

export async function markConversationRead(conversationId: string) {
  return apiFetch<{ unreadCount?: number }>(`/conversations/${conversationId}/read`, { method: 'PATCH' });
}

/** Plain text send used by the notification reply action, where no composer state exists. */
export async function sendConversationTextMessage(conversationId: string, text: string) {
  return apiFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ type: 'TEXT', text, attachmentIds: [] }),
  });
}

export async function markConversationUnread(conversationId: string) {
  return apiFetch<{ unreadCount?: number }>(`/conversations/${conversationId}/unread`, { method: 'PATCH' });
}

export async function updateConversationStatus(conversationId: string, status: 'OPEN' | 'CLOSED') {
  return apiFetch(`/conversations/${conversationId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export async function fetchQuickReplies(params: { workspaceId?: string; search?: string; limit?: number; cursor?: string }) {
  const query = new URLSearchParams();
  if (params.workspaceId) query.set('workspaceId', params.workspaceId);
  if (params.search) query.set('search', params.search);
  query.set('limit', String(params.limit ?? 20));
  if (params.cursor) query.set('cursor', params.cursor);
  return apiFetch<{ items: QuickReplySnippet[]; pageInfo?: { nextCursor?: string | null; hasMore?: boolean } }>(`/quick-replies?${query.toString()}`);
}

export async function fetchWhatsappTemplates(channelId: string) {
  const { fetchWhatsappTemplates: fetchMappedWhatsappTemplates } = await import('./whatsappTemplates');
  return fetchMappedWhatsappTemplates(channelId);
}

export async function sendReaction(conversationId: string, messageId: string, emoji: string, reactionAction: ReactionAction) {
  return apiFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ type: 'REACTION', emoji, reactionAction, replyToMessageId: messageId }),
  });
}

export async function fetchMessagesPage(conversationId: string, cursor?: string, limit = 50) {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  return apiFetch<{ items: Array<Record<string, unknown>>; pageInfo?: { nextCursor?: string | null; hasMore?: boolean } }>(`/conversations/${conversationId}/messages?${query.toString()}`);
}

export type ConversationCallSessionStatus = 'REQUESTED' | 'PERMISSION_REQUESTED' | 'RINGING' | 'CONNECTED' | 'ENDED' | 'MISSED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
export type ConversationCallPermissionStatus = 'NONE' | 'REQUESTED' | 'GRANTED' | 'DENIED' | 'EXPIRED';
export type ConversationCallMember = {
  workspaceMemberId?: string;
  userName: string | null;
  userEmail: string | null;
  avatarUrl?: string | null;
};

export type ConversationCallContact = {
  id: string;
  displayName: string | null;
  primaryPhone: string | null;
  avatarUrl: string | null;
};

export type ConversationCallChannel = {
  channelId: string;
  channelType: string;
  channelName: string;
  displayPhoneNumber: string | null;
};

export type ConversationCallConversation = {
  id: string;
  workspaceId: string;
  status: 'OPEN' | 'ASSIGNED' | 'CLOSED';
  unreadCount: number;
  contact: ConversationCallContact;
  channel: ConversationCallChannel;
  assignee: ConversationCallMember | null;
};

export type ConversationCallSession = {
  id: string;
  workspaceId: string;
  conversationId: string;
  channelAccountId: string;
  initiatedByWorkspaceMemberId: string | null;
  claimedByWorkspaceMemberId: string | null;
  claimedByUserId: string | null;
  claimedAt: string | null;
  initiatedBy: ConversationCallMember | null;
  claimedBy: ConversationCallMember | null;
  direction: 'INBOUND' | 'OUTBOUND';
  provider: string;
  providerCallId: string | null;
  providerSessionId: string | null;
  permissionRequestMessageId: string | null;
  recipientIdentityValue: string;
  recipientDisplayName: string | null;
  status: ConversationCallSessionStatus;
  permissionStatus: ConversationCallPermissionStatus;
  requestedPermissionAt: string | null;
  permissionRespondedAt: string | null;
  startedAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  metadata?: unknown;
  conversation?: ConversationCallConversation;
  createdAt: string;
  updatedAt: string;
};

export type ConversationCallSessionsResponse = {
  items: ConversationCallSession[];
  pageInfo?: { nextCursor?: string | null; hasMore?: boolean };
};

export type ConversationCallSessionFeedSummary = {
  all: number;
  missed: number;
  incoming: number;
  outgoing: number;
};

export async function fetchConversationCallSessions(params: {
  conversationId: string;
  cursor?: string;
  limit?: number;
  status?: ConversationCallSessionStatus;
  direction?: 'INBOUND' | 'OUTBOUND';
}): Promise<ConversationCallSessionsResponse> {
  return apiFetch<ConversationCallSessionsResponse>(`/conversations/${params.conversationId}/calls${buildQueryString({
    cursor: params.cursor,
    limit: params.limit ?? 10,
    status: params.status,
    direction: params.direction,
  })}`);
}

export async function fetchWorkspaceCallSessions(params: {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: ConversationCallSessionStatus | 'ALL';
  direction?: 'INBOUND' | 'OUTBOUND' | 'ALL';
} = {}): Promise<ConversationCallSessionsResponse> {
  return apiFetch<ConversationCallSessionsResponse>(`/calls${buildQueryString({
    cursor: params.cursor,
    limit: params.limit ?? 20,
    search: params.search,
    status: params.status && params.status !== 'ALL' ? params.status : undefined,
    direction: params.direction && params.direction !== 'ALL' ? params.direction : undefined,
  })}`);
}

export async function fetchWorkspaceCallSessionSummary(params: { search?: string } = {}): Promise<ConversationCallSessionFeedSummary> {
  return apiFetch<ConversationCallSessionFeedSummary>(`/calls/summary${buildQueryString({
    search: params.search,
  })}`);
}

export type ConversationCallSignalSession = {
  sdpType: 'offer' | 'answer';
  sdp: string;
};

export async function fetchActiveConversationCallSessions(params: {
  cursor?: string;
  limit?: number;
} = {}): Promise<ConversationCallSessionsResponse> {
  return apiFetch<ConversationCallSessionsResponse>(`/calls/active${buildQueryString({
    cursor: params.cursor,
    limit: params.limit ?? 10,
    liveOnly: true,
  })}`);
}

export function fetchConversationCallSession(params: { conversationId: string; callSessionId: string }): Promise<ConversationCallSession> {
  return apiFetch(`/conversations/${params.conversationId}/calls/${params.callSessionId}`);
}

export async function startConversationCall(params: {
  conversationId: string;
  note?: string | null;
  bizOpaqueCallbackData?: string | null;
  session: ConversationCallSignalSession;
}): Promise<ConversationCallSession> {
  const body: Record<string, unknown> = {
    session: {
      sdpType: params.session.sdpType,
      sdp: params.session.sdp,
    },
  };
  if (typeof params.note === 'string' && params.note.trim().length > 0) {
    body.note = params.note.trim();
  }
  if (typeof params.bizOpaqueCallbackData === 'string' && params.bizOpaqueCallbackData.trim().length > 0) {
    body.bizOpaqueCallbackData = params.bizOpaqueCallbackData.trim();
  }
  return apiFetch(`/conversations/${params.conversationId}/calls`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function answerConversationCall(params: {
  conversationId: string;
  callSessionId: string;
  bizOpaqueCallbackData?: string | null;
  session: ConversationCallSignalSession;
}): Promise<ConversationCallSession> {
  const body: Record<string, unknown> = {
    session: {
      sdpType: params.session.sdpType,
      sdp: params.session.sdp,
    },
  };
  if (typeof params.bizOpaqueCallbackData === 'string' && params.bizOpaqueCallbackData.trim().length > 0) {
    body.bizOpaqueCallbackData = params.bizOpaqueCallbackData.trim();
  }
  return apiFetch(`/conversations/${params.conversationId}/calls/${params.callSessionId}/answer`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function declineConversationCall(params: {
  conversationId: string;
  callSessionId: string;
}): Promise<ConversationCallSession> {
  return apiFetch(`/conversations/${params.conversationId}/calls/${params.callSessionId}/decline`, {
    method: 'POST',
  });
}

export async function endConversationCall(params: {
  conversationId: string;
  callSessionId: string;
}): Promise<ConversationCallSession> {
  return apiFetch(`/conversations/${params.conversationId}/calls/${params.callSessionId}/end`, {
    method: 'POST',
  });
}

export async function sendTemplateMessage(params: {
  conversationId: string;
  templateName: string;
  templateCategory?: string | null;
  languageCode?: string | null;
  templateComponents?: unknown[];
  text?: string | null;
  replyToMessageId?: string | null;
}) {
  return apiFetch(`/conversations/${params.conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'TEMPLATE',
      templateName: params.templateName,
      ...(params.templateCategory ? { templateCategory: params.templateCategory } : {}),
      ...(params.languageCode ? { languageCode: params.languageCode } : {}),
      ...(params.templateComponents ? { templateComponents: params.templateComponents } : {}),
      ...(params.text ? { text: params.text } : {}),
      ...(params.replyToMessageId ? { replyToMessageId: params.replyToMessageId } : {}),
    }),
  });
}
