import { apiFetch, uploadFile } from './client';

export type ChannelType =
  | 'WHATSAPP'
  | 'MESSENGER'
  | 'INSTAGRAM'
  | 'EMAIL'
  | 'WEBCHAT'
  | 'SMS'
  | 'TELEGRAM'
  | 'TIKTOK';

export type ChannelConnectionStatus =
  | 'PENDING'
  | 'CONNECTED'
  | 'NEEDS_ACTION'
  | 'DISCONNECTED'
  | 'ERROR';

export type ChannelAccount = {
  id: string;
  provider: string;
  externalAccountId: string;
  displayName: string | null;
  pageId: string | null;
  pageName: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  lastWebhookError: string | null;
  webhookStatus: ChannelConnectionStatus;
  isEnabled: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
};

export type ChannelLifecycle = {
  isPaused: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  isRemoved: boolean;
  removedAt: string | null;
  removeReason: string | null;
  purgeAt: string | null;
  canProcessEvents: boolean;
};

export type ChannelCapabilities = {
  canStartCalls: boolean;
  callDisabledReason: string | null;
  callSettingStatus: 'PENDING' | 'ENABLED' | 'FAILED' | 'DISABLED' | null;
};

export type WhatsappCallingSetting = {
  id: string;
  status: 'PENDING' | 'ENABLED' | 'FAILED' | 'DISABLED';
  whatsappCallingEnabled: boolean;
  whatsappCallingStatus: 'ENABLED' | 'DISABLED' | null;
  whatsappCallingLastSyncedAt: string | null;
  lastError: string | null;
};

export type Channel = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: ChannelType;
  name: string;
  status: ChannelConnectionStatus;
  createdAt: string;
  updatedAt: string;
  accounts: ChannelAccount[];
  messagesLast24h?: number;
  lifecycle?: ChannelLifecycle | null;
  capabilities?: ChannelCapabilities | null;
  templateCounts?: WhatsappChannelTemplateCounts | null;
  lastWebhookError?: string | null;
  callBusinessCallingSetting?: WhatsappCallingSetting | null;
};

export type WhatsappChannelTemplateCounts = {
  total: number;
  approved: number;
  pending: number;
  failed: number;
  rejected: number;
};

export type WhatsappChannelConfiguration = {
  provider: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessAccountId: string | null;
};

export type MessengerChannelConfiguration = {
  provider: string;
  pageId: string | null;
  pageName: string | null;
  businessAccountId: string | null;
  webhookSubscriptionStatus: ChannelConnectionStatus | null;
  lastWebhookError: string | null;
};

export type TikTokChannelConfiguration = {
  provider: string;
  businessId: string | null;
  accountDisplayName: string | null;
  accountUsername: string | null;
  webhookSubscriptionStatus: ChannelConnectionStatus | null;
  lastWebhookError: string | null;
  lastSyncedAt?: string | null;
  lastSyncStatus?: 'SUCCESS' | 'FAILED' | null;
  lastSyncError?: string | null;
};

export type InstagramChannelConfiguration = {
  provider: string;
  instagramUserId: string | null;
  pageId: string | null;
  pageName: string | null;
  accountUsername: string | null;
  accountDisplayName?: string | null;
  webhookSubscriptionStatus: ChannelConnectionStatus | null;
  lastWebhookError: string | null;
};

export type ChannelDetails = Channel & {
  configuration?: WhatsappChannelConfiguration | MessengerChannelConfiguration | TikTokChannelConfiguration | InstagramChannelConfiguration | null;
  lifecycle: ChannelLifecycle;
  capabilities?: ChannelCapabilities | null;
  templateCounts?: WhatsappChannelTemplateCounts | null;
  lastWebhookError?: string | null;
  businessProfile?: WhatsappBusinessProfile | null;
};

export type ChannelsListSummary = {
  connectedCount: number;
  activeTodayCount: number;
  issuesCount: number;
  messagesLast24h: number;
};

export type ChannelsListResponse = {
  items: Channel[];
  meta?: { page: number; limit: number; total: number; totalPages: number };
  summary?: ChannelsListSummary;
};

export type WhatsappBusinessProfile = {
  messagingProduct: 'whatsapp';
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  websites: string[];
  vertical: string | null;
  profilePictureUrl: string | null;
  profilePictureHandle: string | null;
};

export type WhatsappCatalogProduct = {
  id: string;
  retailerId: string | null;
  name: string | null;
  description: string | null;
  priceMinorUnits: number | null;
  salePriceMinorUnits: number | null;
  currency: string | null;
  availability: string | null;
  imageUrl: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
};

export type WhatsappProductCatalogSummary = {
  id: string;
  name: string | null;
  vertical: string | null;
};

export type WhatsappProductCatalogResponse = {
  channelId: string;
  workspaceId: string;
  wabaId: string;
  provider: 'META';
  status: 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
  catalogs: WhatsappProductCatalogSummary[];
  activeCatalog: WhatsappProductCatalogSummary | null;
  products: WhatsappCatalogProduct[];
  nextCursor: string | null;
  lastFetchedAt: string | null;
  error: { category: string; message: string; retryable: boolean } | null;
};

export type WhatsappProductCatalogConnectResponse = {
  connected: true;
  catalog: WhatsappProductCatalogSummary;
  response: WhatsappProductCatalogResponse;
  error: WhatsappProductCatalogResponse['error'];
};

export type WhatsappBusinessProfileUpdateInput = {
  about?: string | null;
  address?: string | null;
  description?: string | null;
  email?: string | null;
  websites?: string[] | null;
  vertical?: string | null;
  profilePictureHandle?: string | null;
};

export type WebchatFormFieldType =
  | 'TEXT'
  | 'EMAIL'
  | 'PHONE'
  | 'PARAGRAPH'
  | 'NUMBER'
  | 'RATING';

export type WebchatFormField = {
  id: string;
  label: string;
  type: WebchatFormFieldType;
  required: boolean;
  enabled: boolean;
  locked?: boolean;
};

export type WebchatFormConfig = {
  name: string;
  enabled: boolean;
  fields: WebchatFormField[];
};

export type WebchatSettings = {
  name: string;
  welcomeTitle: string;
  welcomeMessage: string | null;
  description: string | null;
  showDescription: boolean;
  brandName: string;
  brandLogoUrl: string | null;
  showAgentGroupAvatar: boolean;
  chatInitiationText: string;
  onlineStatusText: string;
  offlineStatusText: string;
  buttonShape: 'DEFAULT' | 'CUSTOM_CORNER' | 'CUSTOM_BANNER';
  cornerRadius: number;
  showEyeCatcher: boolean;
  showDesktopLabel: boolean;
  desktopOnlineLabel: string;
  desktopOfflineLabel: string;
  accentColor: string;
  position: 'BOTTOM_RIGHT' | 'BOTTOM_LEFT';
  voiceCall: boolean;
  videoCall: boolean;
  closeFromVisitor: boolean;
  screenSharing: boolean;
  coBrowsing: boolean;
  preChatForm: WebchatFormConfig;
  postChatForm: WebchatFormConfig;
  domain: string;
};

export type WebchatSettingsUpdateInput = Partial<Omit<WebchatSettings, 'domain'>>;

export type WebchatInstallation = {
  channelId: string;
  channelKey: string;
  scriptUrl: string;
  domain: string;
  widgetId: string;
  directChatUrl: string;
  code: string;
};

export function fetchWebchatSettings(channelId: string) {
  return apiFetch<WebchatSettings>(`/channels/${channelId}/webchat/settings`);
}

export function updateWebchatSettings(channelId: string, values: WebchatSettingsUpdateInput) {
  return apiFetch<WebchatSettings>(`/channels/${channelId}/webchat/settings`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  });
}

export function fetchWebchatInstallation(channelId: string) {
  return apiFetch<WebchatInstallation>(`/channels/${channelId}/webchat/installation`);
}

export function fetchInboxChannelOptions(workspaceId: string) {
  return apiFetch<{ items: Array<{ id: string; name: string; type: ChannelType; displayPhoneNumber: string | null }> }>(
    `/channels/inbox-filter-options?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export function fetchChannels() {
  return apiFetch<ChannelsListResponse>(
    '/channels?page=1&limit=100&sortBy=createdAt&sortOrder=desc',
  );
}

export function fetchChannelsPage({ page = 1, limit = 100 }: { page?: number; limit?: number } = {}) {
  return apiFetch<ChannelsListResponse>(
    `/channels?page=${page}&limit=${limit}&sortBy=createdAt&sortOrder=desc`,
  );
}

export function fetchChannelDetails(channelId: string) {
  return apiFetch<ChannelDetails>(`/channels/${channelId}`);
}

export function fetchWhatsappProductCatalog(channelId: string, catalogId?: string, after?: string, limit = 25) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (catalogId) params.set('catalogId', catalogId);
  if (after) params.set('after', after);
  return apiFetch<WhatsappProductCatalogResponse>(`/channels/${channelId}/whatsapp/catalog?${params.toString()}`);
}

export function connectWhatsappProductCatalog(channelId: string, catalogId: string) {
  return apiFetch<WhatsappProductCatalogConnectResponse>(`/channels/${channelId}/whatsapp/catalog/connect`, {
    method: 'POST',
    body: JSON.stringify({ catalogId }),
  });
}

export function fetchWhatsappBusinessProfile(channelId: string) {
  return apiFetch<WhatsappBusinessProfile | null>(
    `/channels/${channelId}/whatsapp/business-profile`,
  );
}

export function updateWhatsappBusinessProfile(
  channelId: string,
  values: WhatsappBusinessProfileUpdateInput,
) {
  return apiFetch<WhatsappBusinessProfile | null>(
    `/channels/${channelId}/whatsapp/business-profile`,
    {
      method: 'POST',
      body: JSON.stringify(values),
    },
  );
}

export function syncWhatsappBusinessProfile(channelId: string) {
  return apiFetch<WhatsappBusinessProfile | null>(
    `/channels/${channelId}/whatsapp/business-profile/sync`,
    { method: 'POST' },
  );
}

export function uploadWhatsappBusinessProfilePhoto(
  channelId: string,
  uri: string,
  name: string,
  mimeType: string,
) {
  return uploadFile(
    `/channels/${channelId}/whatsapp/business-profile/profile-picture`,
    uri,
    name,
    mimeType,
  ) as unknown as Promise<{ profilePictureHandle: string }>;
}

export function pauseChannel(channelId: string) {
  return apiFetch<ChannelDetails>(`/channels/${channelId}/pause`, {
    method: 'PATCH',
  });
}

export function resumeChannel(channelId: string) {
  return apiFetch<ChannelDetails>(`/channels/${channelId}/resume`, {
    method: 'PATCH',
  });
}

export function restoreChannel(channelId: string) {
  return apiFetch<ChannelDetails>(`/channels/${channelId}/restore`, {
    method: 'PATCH',
  });
}

export function removeChannel(channelId: string, retentionHours = 1) {
  return apiFetch<ChannelDetails>(
    `/channels/${channelId}?retentionHours=${retentionHours}`,
    { method: 'DELETE' },
  );
}

export type TikTokConnectLaunch = {
  provider: 'tiktok_business_messaging';
  channelType: 'TIKTOK';
  workspaceId: string;
  launchUrl: string;
  state: string;
};

export type TikTokSyncResponse = {
  ok: true;
  channelId: string;
  conversations: number;
  messages: number;
  queuedMessages: number;
  skippedMessages: number;
  syncedAt: string;
};

export function reconnectTikTokChannel(channelId: string) {
  return apiFetch<TikTokConnectLaunch>(`/channels/${channelId}/reconnect`, {
    method: 'POST',
  });
}

export function syncTikTokChannel(channelId: string) {
  return apiFetch<TikTokSyncResponse>('/webhooks/tiktok/sync', {
    method: 'POST',
    body: JSON.stringify({ channelId }),
  });
}

export type ChannelQuickAutomationDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type ChannelQuickAutomationBusinessHour = { enabled: boolean; from: string; to: string };
export type ChannelQuickAutomationBusinessHours = Record<ChannelQuickAutomationDay, ChannelQuickAutomationBusinessHour>;

export type ChannelQuickAutomationSettings = {
  channelId: string;
  workspaceId: string;
  channelType: ChannelType;
  hasStoredSettings: boolean;
  welcomeEnabled: boolean;
  welcomeMessage: string | null;
  welcomeAttachments: unknown[];
  welcomeSendFrequency: 'LIFETIME' | 'TWENTY_FOUR_HOURS' | 'EVERY_TIME';
  offHourEnabled: boolean;
  offHourMessage: string | null;
  offHourAttachments: unknown[];
  timezone: string;
  businessHours: ChannelQuickAutomationBusinessHours;
  channelSpecific: unknown | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ChannelQuickAutomationSettingsUpdateInput = {
  welcomeEnabled: boolean;
  welcomeMessage: string | null;
  welcomeAttachments: unknown[];
  welcomeSendFrequency: 'LIFETIME' | 'TWENTY_FOUR_HOURS' | 'EVERY_TIME';
  offHourEnabled: boolean;
  offHourMessage: string | null;
  offHourAttachments: unknown[];
  businessHours: ChannelQuickAutomationBusinessHours;
  channelSpecific?: unknown | null;
};

export function fetchChannelQuickAutomationSettings(channelId: string) {
  return apiFetch<ChannelQuickAutomationSettings>(`/channels/${channelId}/automation-settings`);
}

export function updateChannelQuickAutomationSettings(channelId: string, values: ChannelQuickAutomationSettingsUpdateInput) {
  return apiFetch<ChannelQuickAutomationSettings>(`/channels/${channelId}/automation-settings`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  });
}

export type WhatsappCallingUpdateResponse = {
  success: true;
  calling: {
    enabled: boolean;
    status: 'ENABLED' | 'DISABLED' | null;
    callIconVisibility: string | null;
    callbackPermissionStatus: string | null;
    lastSyncedAt: string | null;
    syncStatus: 'SUCCESS' | 'FAILED';
    syncError: string | null;
  };
};

export function updateWhatsappChannelCalling(channelId: string, enabled: boolean) {
  return apiFetch<WhatsappCallingUpdateResponse>(`/channels/whatsapp/${channelId}/calling-settings`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function syncWhatsappChannelCallingSettings(channelId: string) {
  return apiFetch<WhatsappCallingUpdateResponse>(`/calls/whatsapp/channels/${channelId}/calling-settings/sync`, {
    method: 'POST',
  });
}
