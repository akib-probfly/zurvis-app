import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Camera, Check, ChevronDown, Copy, ExternalLink, Link2, MessageSquare, Phone, RefreshCw, RotateCcw, Save, Unlink2, UserRound } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ThemeColors } from '../theme/colors';
import {
  fetchChannelDetails,
  fetchWhatsappBusinessProfile,
  pauseChannel,
  removeChannel,
  reconnectTikTokChannel,
  restoreChannel,
  resumeChannel,
  syncTikTokChannel,
  syncWhatsappBusinessProfile,
  updateWhatsappBusinessProfile,
  uploadWhatsappBusinessProfilePhoto,
  type ChannelDetails,
  type InstagramChannelConfiguration,
  type TikTokChannelConfiguration,
} from '../api/channels';
import { ChannelLogo } from '../components/ChannelLogo';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormSkeleton } from '../components/Skeleton';
import { QuickAutomationTab } from '../components/QuickAutomationTab';
import { TroubleshootTab } from '../components/TroubleshootTab';
import {
  WebchatAppearanceSection,
  WebchatConfigurationSection,
  WebchatFeaturesSection,
  WebchatFormsSection,
  WebchatSnippetSection,
} from '../components/WebchatChannelTab';
import { WhatsappCallingTab } from '../components/WhatsappCallingTab';
import { WhatsappTemplatesTab } from '../components/WhatsappTemplatesTab';
import { WhatsappProductCatalogTab } from '../components/WhatsappProductCatalogTab';
import type { ChannelsStackParamList } from '../navigation/ChannelsStack';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import { AppBadge, AppCard, AppTextField, badgePalette, type BadgeTone } from '../ui';
import { apiUrl } from '../api/client';

const STATUS_TONE: Record<string, BadgeTone> = {
  CONNECTED: 'success',
  PENDING: 'warning',
  NEEDS_ACTION: 'danger',
  ERROR: 'danger',
  DISCONNECTED: 'neutral',
};

const WHATSAPP_BUSINESS_VERTICAL_OPTIONS = [
  { value: 'ALCOHOL', label: 'Alcoholic Beverages' },
  { value: 'APPAREL', label: 'Clothing and Apparel' },
  { value: 'AUTO', label: 'Automotive' },
  { value: 'BEAUTY', label: 'Beauty, Spa and Salon' },
  { value: 'EDU', label: 'Education' },
  { value: 'ENTERTAIN', label: 'Entertainment' },
  { value: 'EVENT_PLAN', label: 'Event Planning and Service' },
  { value: 'FINANCE', label: 'Finance and Banking' },
  { value: 'GOVT', label: 'Public Service' },
  { value: 'GROCERY', label: 'Food and Grocery' },
  { value: 'HEALTH', label: 'Medical and Health' },
  { value: 'HOTEL', label: 'Hotel and Lodging' },
  { value: 'NONPROFIT', label: 'Non-profit' },
  { value: 'ONLINE_GAMBLING', label: 'Online Gambling & Gaming' },
  { value: 'OTC_DRUGS', label: 'Over-the-Counter Drugs' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PHYSICAL_GAMBLING', label: 'Non-Online Gambling & Gaming' },
  { value: 'PROF_SERVICES', label: 'Professional Services' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'RETAIL', label: 'Shopping and Retail' },
  { value: 'TRAVEL', label: 'Travel and Transportation' },
];

const PROFILE_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

function formatDateLabel(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatConfigStatus(value: string | null | undefined) {
  return (value ?? 'UNKNOWN')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function whatsappChatLink(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, '') ?? '';
  return digits ? `https://wa.me/${digits}` : null;
}

function messengerPageLink(pageId: string | null | undefined) {
  return pageId ? `https://facebook.com/${pageId}` : 'Not linked';
}

function messengerChatLink(pageId: string | null | undefined) {
  return pageId ? `https://m.me/${pageId}` : null;
}

function tiktokProfileLink(username: string | null | undefined) {
  const handle = username?.trim().replace(/^@/, '') ?? '';
  return handle ? `https://www.tiktok.com/@${handle}` : 'Not linked';
}

function tiktokUsername(username: string | null | undefined) {
  const value = username?.trim();
  if (!value) return 'Not available';
  return value.startsWith('@') ? value : `@${value}`;
}

export function ChannelDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ChannelsStackParamList, 'ChannelDetails'>>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const channelId = route.params.channelId;
  const [tab, setTab] = useState<string>('overview');
  const [channelConfirm, setChannelConfirm] = useState<'remove' | 'pause' | 'resume' | null>(null);
  const styles = useChannelDetailsStyles(colors);

  const details = useQuery({
    queryKey: ['channel-details', channelId],
    queryFn: () => fetchChannelDetails(channelId),
    staleTime: 30000,
  });
  const profile = useQuery({
    queryKey: ['channel-profile', channelId],
    queryFn: () => fetchWhatsappBusinessProfile(channelId),
    enabled: details.data?.type === 'WHATSAPP',
    staleTime: 30000,
  });

  const channel: ChannelDetails | undefined = details.data;
  const lifecycle = channel?.lifecycle ?? {
    isPaused: false,
    pausedAt: null,
    pauseReason: null,
    isRemoved: false,
    removedAt: null,
    removeReason: null,
    purgeAt: null,
    canProcessEvents: channel?.status === 'CONNECTED',
  };
  const primaryAccount = channel?.accounts?.[0] ?? null;
  const profileData = profile.data ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['channel-details', channelId], refetchType: 'active' });
    queryClient.invalidateQueries({ queryKey: ['channels'], refetchType: 'active' });
  };

  const pause = useMutation({ mutationFn: () => pauseChannel(channelId), onSuccess: () => { setChannelConfirm(null); Toast.show({ type: 'success', text1: 'Channel paused', text2: 'App-side event handling is now turned off.' }); invalidate(); } });
  const resume = useMutation({ mutationFn: () => resumeChannel(channelId), onSuccess: () => { setChannelConfirm(null); Toast.show({ type: 'success', text1: 'Channel resumed', text2: 'Event handling has been re-enabled.' }); invalidate(); } });
  const remove = useMutation({
    mutationFn: () => removeChannel(channelId),
    onSuccess: () => { setChannelConfirm(null); Toast.show({ type: 'success', text1: 'Removal scheduled', text2: 'This channel will be permanently deleted in about 1 hour unless you restore it.' }); invalidate(); },
  });
  const restore = useMutation({ mutationFn: () => restoreChannel(channelId), onSuccess: () => { Toast.show({ type: 'success', text1: 'Channel restored', text2: 'The pending deletion has been canceled.' }); invalidate(); } });
  const syncTikTok = useMutation({
    mutationFn: () => syncTikTokChannel(channelId),
    onSuccess: (result) => {
      invalidate();
      Toast.show({
        type: 'success',
        text1: 'TikTok sync queued',
        text2: `${result.messages} message${result.messages === 1 ? '' : 's'} processed.`,
      });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not sync TikTok', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });
  const reconnectTikTok = useMutation({
    mutationFn: () => reconnectTikTokChannel(channelId),
    onSuccess: (launch) => {
      if (!launch.launchUrl) {
        Toast.show({ type: 'info', text1: 'Reconnect link unavailable', text2: 'Please reconnect this channel from the web workspace.' });
        return;
      }
      Linking.openURL(launch.launchUrl).catch(() => Toast.show({ type: 'error', text1: 'Could not open browser' }));
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not reconnect TikTok', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });
  const sync = useMutation({
    mutationFn: () => syncWhatsappBusinessProfile(channelId),
    onSuccess: () => { profile.refetch(); Toast.show({ type: 'success', text1: 'Profile synced', text2: 'The business profile was refreshed from WhatsApp.' }); },
  });

  const [draft, setDraft] = useState({ about: '', address: '', description: '', email: '', websites: '', vertical: '' });
  const [loaded, setLoaded] = useState(false);
  const [profilePhotoPreviewUri, setProfilePhotoPreviewUri] = useState<string | null>(null);
  const [profilePhotoAsset, setProfilePhotoAsset] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  useEffect(() => {
    if (!profileData || loaded) return;
    setDraft({
      about: profileData.about ?? '',
      address: profileData.address ?? '',
      description: profileData.description ?? '',
      email: profileData.email ?? '',
      websites: (profileData.websites ?? []).join('\n'),
      vertical: WHATSAPP_BUSINESS_VERTICAL_OPTIONS.some((option) => option.value === profileData.vertical) ? profileData.vertical ?? '' : profileData.vertical ? 'OTHER' : '',
    });
    setLoaded(true);
  }, [loaded, profileData]);
  const save = useMutation({
    mutationFn: async () => {
      let profilePictureHandle: string | undefined;
      if (profilePhotoAsset) {
        const upload = await uploadWhatsappBusinessProfilePhoto(channelId, profilePhotoAsset.uri, profilePhotoAsset.name, profilePhotoAsset.mimeType);
        profilePictureHandle = upload.profilePictureHandle;
      }

      return updateWhatsappBusinessProfile(channelId, {
        about: draft.about.trim() ? draft.about.trim() : null,
        address: draft.address.trim() ? draft.address.trim() : null,
        description: draft.description.trim() ? draft.description.trim() : null,
        email: draft.email.trim() ? draft.email.trim() : null,
        vertical: draft.vertical.trim() ? draft.vertical.trim() : null,
        websites: draft.websites.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
        ...(profilePictureHandle ? { profilePictureHandle } : {}),
      });
    },
    onSuccess: () => { setProfilePhotoAsset(null); setProfilePhotoPreviewUri(null); profile.refetch(); Toast.show({ type: 'success', text1: 'Profile saved', text2: 'Your WhatsApp business profile was updated.' }); },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not save profile', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });

  const pickProfilePhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > PROFILE_IMAGE_MAX_SIZE_BYTES) {
      Toast.show({ type: 'error', text1: 'Image too large', text2: 'Profile image must be 5 MB or smaller.' });
      return;
    }
    const uri = asset.uri;
    const mimeType = asset.mimeType ?? (uri.toLowerCase().endsWith('.png') ? 'image/png' : uri.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    setProfilePhotoAsset({ uri, name: asset.fileName ?? 'whatsapp-profile.jpg', mimeType });
    setProfilePhotoPreviewUri(uri);
  }, []);

  const [verticalPicker, setVerticalPicker] = useState(false);
  const isBusy = pause.isPending || resume.isPending || remove.isPending || restore.isPending || sync.isPending || save.isPending || syncTikTok.isPending || reconnectTikTok.isPending;
  const statusTone = STATUS_TONE[channel?.status ?? 'PENDING'] ?? STATUS_TONE.PENDING;

  const confirmRemove = () => setChannelConfirm('remove');
  const confirmPauseOrResume = (action: 'pause' | 'resume') => setChannelConfirm(action);

  if (details.isLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <HeaderBar insets={insets} onBack={() => navigation.goBack()} />
        <FormSkeleton fields={6} />
      </View>
    );
  }
  if (details.isError || !channel) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <HeaderBar insets={insets} onBack={() => navigation.goBack()} />
        <View style={{ alignItems: 'center', padding: 32, marginTop: 40 }}>
          <Text style={[styles.msgTitle, { color: colors.text }]}>Could not load channel</Text>
          <Text style={[styles.msgText, { color: colors.textSecondary }]}>{details.error instanceof Error ? details.error.message : 'Please try again or return to the list.'}</Text>
          <Pressable style={[styles.primaryButton, { alignSelf: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.primary }]} onPress={() => details.refetch()}><RefreshCw color={colors.primaryText} size={14} /><Text style={[styles.primaryButtonText, { fontSize: fontSize.caption }]}>Retry</Text></Pressable>
        </View>
      </View>
    );
  }

  const isMessenger = channel.type === 'MESSENGER';
  const isWhatsapp = channel.type === 'WHATSAPP';
  const isTikTok = channel.type === 'TIKTOK';
  const isInstagram = channel.type === 'INSTAGRAM';
  const isWebchat = channel.type === 'WEBCHAT';
  const tabs = isWebchat
    ? [{ key: 'overview', label: 'Configuration' }, { key: 'appearance', label: 'Appearance' }, { key: 'features', label: 'Widget Features' }, { key: 'forms', label: 'Forms' }, { key: 'snippet', label: 'Code Snippet' }, { key: 'automation', label: 'Quick Automation' }, { key: 'access', label: 'Troubleshoot' }]
    : isMessenger || isTikTok || isInstagram
    ? [{ key: 'overview', label: 'Configuration' }, { key: 'automation', label: 'Quick Automation' }, { key: 'access', label: 'Troubleshoot' }]
    : isWhatsapp
      ? [{ key: 'overview', label: 'Configuration' }, { key: 'templates', label: 'Templates' }, { key: 'catalog', label: 'Product catalog' }, { key: 'business', label: 'Profile' }, { key: 'calling', label: 'Calls' }, { key: 'automation', label: 'Quick Automation' }, { key: 'access', label: 'Troubleshoot' }]
      : [{ key: 'overview', label: 'Configuration' }, { key: 'access', label: 'Troubleshoot' }];

  const renderOverview = () => {
    if (isMessenger) {
      const config = channel.configuration as { pageId?: string | null; pageName?: string | null; businessAccountId?: string | null; webhookSubscriptionStatus?: string | null; lastWebhookError?: string | null } | null;
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <ChannelConfigurationHero
            channel={channel}
            subtitle="Messenger channel configuration"
            statusTone={statusTone}
            lifecycle={lifecycle}
            colors={colors}
            onRestore={() => restore.mutate()}
          />

          <AppCard style={styles.cardSpacing}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Channel configuration</Text>
            <Text style={[styles.cardSub, { color: colors.textSecondary }]}>Manage channel information and settings.</Text>
            <View style={styles.statusGrid}>
              <StatusTile icon="message" title="Messenger" value={formatConfigStatus(channel.status)} tone={lifecycle.canProcessEvents ? 'success' : 'neutral'} />
              <StatusTile icon={config?.webhookSubscriptionStatus === 'CONNECTED' ? 'link' : 'unlink'} title="Webhook" value={formatConfigStatus(config?.webhookSubscriptionStatus)} tone={config?.webhookSubscriptionStatus === 'CONNECTED' ? 'success' : 'warning'} />
            </View>
            <View style={styles.configFields}>
              <ConfigField label="Chat link" value={messengerChatLink(config?.pageId) ?? 'Not linked'} copy openUrl={messengerChatLink(config?.pageId)} />
              <ConfigField label="Page link" value={messengerPageLink(config?.pageId)} copy openUrl={config?.pageId ? messengerPageLink(config.pageId) : null} />
              <ConfigField label="Channel name" value={channel.name} />
              <ConfigField label="Page name" value={config?.pageName ?? 'Not linked'} />
              <ConfigField label="Provider" value="Meta Messenger" />
              <ConfigField label="Page ID" value={config?.pageId ?? 'Not linked'} copy mono />
              <ConfigField label="Account ID" value={config?.businessAccountId ?? primaryAccount?.externalAccountId ?? 'Not linked'} copy mono />
              <ConfigField label="Connected" value={formatDateLabel(primaryAccount?.connectedAt ?? channel.createdAt)} />
              <ConfigField label="Webhook error" value={config?.lastWebhookError ?? 'No webhook failures recorded'} />
            </View>
          </AppCard>
        </ScrollView>
      );
    }

    if (isTikTok) {
      const config = (channel.configuration ?? null) as TikTokChannelConfiguration | null;
      const accountLabel = config?.accountDisplayName?.trim() || config?.accountUsername?.trim() || channel.name;
      const webhookStatus = config?.webhookSubscriptionStatus ?? primaryAccount?.webhookStatus ?? channel.status;
      const username = tiktokUsername(config?.accountUsername);
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <ChannelConfigurationHero
            channel={channel}
            subtitle="TikTok Business Messaging"
            title={accountLabel}
            statusTone={statusTone}
            lifecycle={lifecycle}
            colors={colors}
            onRestore={() => restore.mutate()}
          />

          <AppCard style={styles.cardSpacing}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Channel configuration</Text>
            <Text style={[styles.cardSub, { color: colors.textSecondary }]}>View the connected TikTok account and webhook details.</Text>
            <View style={styles.statusGrid}>
              <StatusTile icon="message" title="Account" value={accountLabel} />
              <StatusTile icon="message" title="Inbox status" value={formatConfigStatus(channel.status)} tone={channel.status === 'CONNECTED' ? 'success' : 'warning'} />
              <StatusTile icon={webhookStatus === 'CONNECTED' ? 'link' : 'unlink'} title="Webhook" value={formatConfigStatus(webhookStatus)} tone={webhookStatus === 'CONNECTED' ? 'success' : 'warning'} />
            </View>
            <View style={styles.configFields}>
              <ConfigField label="Profile link" value={tiktokProfileLink(config?.accountUsername)} copy />
              <ConfigField label="Account name" value={accountLabel} />
              <ConfigField label="Username" value={username} copy />
              <ConfigField label="Business ID" value={config?.businessId ?? primaryAccount?.externalAccountId ?? 'Not available'} copy mono />
              <ConfigField label="Connected at" value={formatDateLabel(primaryAccount?.connectedAt ?? channel.createdAt)} />
            </View>
          </AppCard>
        </ScrollView>
      );
    }

    if (isInstagram) {
      const config = (channel.configuration ?? null) as InstagramChannelConfiguration | null;
      const accountLabel = config?.accountDisplayName?.trim() || config?.accountUsername?.trim() || channel.name;
      const webhookStatus = config?.webhookSubscriptionStatus ?? primaryAccount?.webhookStatus ?? channel.status;
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <ChannelConfigurationHero
            channel={channel}
            subtitle="Instagram channel"
            title={accountLabel}
            statusTone={statusTone}
            lifecycle={lifecycle}
            colors={colors}
            onRestore={() => restore.mutate()}
          />

          <AppCard style={styles.cardSpacing}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Channel configuration</Text>
            <Text style={[styles.cardSub, { color: colors.textSecondary }]}>View the connected Instagram account and webhook details.</Text>
            <View style={styles.statusGrid}>
              <StatusTile icon="message" title="Account" value={accountLabel} />
              <StatusTile icon="message" title="Inbox status" value={formatConfigStatus(channel.status)} tone={channel.status === 'CONNECTED' ? 'success' : 'warning'} />
              <StatusTile icon={webhookStatus === 'CONNECTED' ? 'link' : 'unlink'} title="Webhook" value={formatConfigStatus(webhookStatus)} tone={webhookStatus === 'CONNECTED' ? 'success' : 'warning'} />
            </View>
            <View style={styles.configFields}>
              <ConfigField label="Account name" value={accountLabel} />
              <ConfigField label="Instagram user ID" value={config?.instagramUserId ?? primaryAccount?.externalAccountId ?? 'Not available'} copy mono />
              <ConfigField label="Connected at" value={formatDateLabel(primaryAccount?.connectedAt ?? channel.createdAt)} />
            </View>
          </AppCard>
        </ScrollView>
      );
    }

    const config = channel.configuration as { displayPhoneNumber?: string | null; phoneNumberId?: string | null } | null;
    const templateCounts = channel.templateCounts;
    const callingSetting = channel.callBusinessCallingSetting;
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <ChannelConfigurationHero
          channel={channel}
          subtitle="WhatsApp channel configuration"
          statusTone={statusTone}
          lifecycle={lifecycle}
          colors={colors}
          onRestore={() => restore.mutate()}
        />

        <AppCard style={styles.cardSpacing}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Channel configuration</Text>
          <Text style={[styles.cardSub, { color: colors.textSecondary }]}>Manage channel information and settings.</Text>
          <View style={styles.statusGridInline}>
            <StatusTile compact icon="phone" title="Business calling" value={callingSetting?.status === 'ENABLED' ? 'Enabled' : 'Disabled'} tone={callingSetting?.status === 'ENABLED' ? 'success' : 'neutral'} />
            <StatusTile compact icon="message" title="MM Lite" value={templateCounts ? 'Yes' : 'No'} tone={templateCounts ? 'success' : 'neutral'} />
            <StatusTile compact icon={primaryAccount?.webhookStatus === 'CONNECTED' ? 'link' : 'unlink'} title="Webhook" value={formatConfigStatus(primaryAccount?.webhookStatus)} tone={primaryAccount?.webhookStatus === 'CONNECTED' ? 'success' : 'warning'} />
          </View>
          <View style={styles.configFields}>
            <ConfigField label="Chat link" value={whatsappChatLink(config?.displayPhoneNumber ?? primaryAccount?.displayPhoneNumber) ?? 'Not linked'} copy openUrl={whatsappChatLink(config?.displayPhoneNumber ?? primaryAccount?.displayPhoneNumber)} />
            <ConfigField label="Channel name" value={channel.name} />
            <ConfigField label="WhatsApp phone number" value={config?.displayPhoneNumber ?? primaryAccount?.displayPhoneNumber ?? 'Not linked'} />
            <ConfigField label="WABA ID" value={primaryAccount?.wabaId ?? 'Not linked'} copy mono />
            <ConfigField label="Phone number ID" value={config?.phoneNumberId ?? primaryAccount?.phoneNumberId ?? 'Not linked'} copy mono />
          </View>
        </AppCard>
      </ScrollView>
    );
  };

  const renderBusiness = () => {
    const profileStatusLabel = profileData ? 'Synced' : profile.isLoading ? 'Loading' : 'Not synced';
    const displayProfilePhotoUrl = profilePhotoPreviewUri ?? apiUrl(profileData?.profilePictureUrl ?? null);
    const categoryLabel = WHATSAPP_BUSINESS_VERTICAL_OPTIONS.find((option) => option.value === draft.vertical)?.label ?? 'Select category';

    return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AppCard style={styles.cardSpacing}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>WhatsApp Business profile</Text>
          <Pressable style={[styles.syncButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]} onPress={() => sync.mutate()} disabled={isBusy}>
            {sync.isPending ? <ActivityIndicator color={colors.primary} size="small" /> : <RefreshCw color={colors.primary} size={15} />}
            <Text style={[styles.syncText, { color: colors.primary }]}>Sync</Text>
          </Pressable>
        </View>
        <Text style={[styles.cardSub, { color: colors.textSecondary }]}>The public profile of your WhatsApp Business API account.</Text>

        <View style={[styles.profilePreview, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
          <View style={[styles.profilePhoto, { backgroundColor: colors.surface }]}>
            {displayProfilePhotoUrl ? (
              <Image source={{ uri: displayProfilePhotoUrl }} style={styles.profilePhotoImage} contentFit="cover" cachePolicy="memory-disk" allowDownscaling />
            ) : (
              <UserRound color={colors.textSecondary} size={26} />
            )}
          </View>
          <View style={styles.profilePreviewCopy}>
            <Text style={[styles.profilePreviewName, { color: colors.text }]} numberOfLines={1}>{channel.name}</Text>
            <Text style={[styles.profilePreviewMeta, { color: colors.textSecondary }]} numberOfLines={2}>
              {profileStatusLabel} business{primaryAccount?.displayPhoneNumber ? ` - ${primaryAccount.displayPhoneNumber}` : ''}
            </Text>
          </View>
          <Pressable style={[styles.uploadButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={pickProfilePhoto} disabled={isBusy}>
            <Camera color={colors.primary} size={14} />
            <Text style={[styles.uploadButtonText, { color: colors.primary }]}>Upload photo</Text>
          </Pressable>
        </View>

        <FieldEdit label="About" value={draft.about} onChange={(text) => setDraft({ ...draft, about: text })} placeholder="What your business is about" />
        <FieldEdit label="Email" value={draft.email} onChange={(text) => setDraft({ ...draft, email: text })} placeholder="business@email.com" keyboardType="email-address" />
        <FieldEdit label="Address" value={draft.address} onChange={(text) => setDraft({ ...draft, address: text })} placeholder="Add address" />
        <FieldEdit label="Website" value={draft.websites} onChange={(text) => setDraft({ ...draft, websites: text })} placeholder="https:// (one per line)" />
        <FieldEdit label="Description" value={draft.description} onChange={(text) => setDraft({ ...draft, description: text })} placeholder="Add description" multiline />
        <Text style={[styles.charHint, { color: colors.textSecondary }]}>Up to 256 characters</Text>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
        <Pressable style={[styles.select, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]} onPress={() => setVerticalPicker(true)}>
          <Text style={draft.vertical ? [styles.selectText, { color: colors.text }] : [styles.selectPlaceholder, { color: colors.textMuted }]}>{categoryLabel}</Text>
          <ChevronDown color={colors.textSecondary} size={18} />
        </Pressable>

        <Pressable style={[styles.primaryButton, { marginTop: 18, backgroundColor: colors.primary }]} onPress={() => save.mutate()} disabled={isBusy}>
          {save.isPending ? <ActivityIndicator color={colors.primaryText} size="small" /> : <Save color={colors.primaryText} size={16} />}
          <Text style={styles.primaryButtonText}>{save.isPending ? 'Saving...' : 'Save profile'}</Text>
        </Pressable>
      </AppCard>
    </ScrollView>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <HeaderBar
        insets={insets}
        onBack={() => navigation.goBack()}
        onRefresh={() => details.refetch()}
        refreshing={details.isFetching && !details.isLoading}
      />

      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContent}>
          {tabs.map((item) => (
            <TabButton key={item.key} label={item.label} active={tab === item.key} onPress={() => setTab(item.key)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.tabContent}>
        {tab === 'overview' ? (isWebchat ? <WebchatConfigurationSection channel={channel} lifecycle={lifecycle} /> : renderOverview()) : null}
        {tab === 'appearance' && isWebchat ? <WebchatAppearanceSection channel={channel} lifecycle={lifecycle} /> : null}
        {tab === 'features' && isWebchat ? <WebchatFeaturesSection channelId={channelId} /> : null}
        {tab === 'forms' && isWebchat ? <WebchatFormsSection channelId={channelId} /> : null}
        {tab === 'snippet' && isWebchat ? <WebchatSnippetSection channelId={channelId} /> : null}
        {tab === 'business' ? renderBusiness() : null}
        {tab === 'templates' ? <WhatsappTemplatesTab channelId={channelId} channelName={channel.name} /> : null}
        {tab === 'catalog' && isWhatsapp ? <WhatsappProductCatalogTab channelId={channelId} /> : null}
        {tab === 'calling' ? <WhatsappCallingTab channelId={channelId} callingSetting={channel.callBusinessCallingSetting} callDisabledReason={channel.capabilities?.callDisabledReason} /> : null}
        {tab === 'automation' ? <QuickAutomationTab channelId={channelId} channelType={channel.type} /> : null}
        {tab === 'access' ? (
          <TroubleshootTab
            channel={channel}
            lifecycle={lifecycle}
            primaryAccount={primaryAccount}
            onRestore={() => restore.mutate()}
            onRemove={confirmRemove}
            onPauseResume={() => confirmPauseOrResume(lifecycle.isPaused ? 'resume' : 'pause')}
            onSyncMessages={isTikTok ? () => syncTikTok.mutate() : undefined}
            onReconnect={isTikTok ? () => reconnectTikTok.mutate() : undefined}
            onGoToOverview={() => setTab('overview')}
            isBusy={isBusy}
            syncPending={syncTikTok.isPending}
            reconnectPending={reconnectTikTok.isPending}
          />
        ) : null}
      </View>

      <ConfirmDialog
        visible={channelConfirm === 'remove'}
        title="Remove this channel?"
        body="This will schedule the channel for permanent deletion in about 1 hour. You can restore it before then."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onClose={() => setChannelConfirm(null)}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        visible={channelConfirm === 'pause' || channelConfirm === 'resume'}
        title={channelConfirm === 'pause' ? 'Pause this channel?' : 'Resume this channel?'}
        body={channelConfirm === 'pause' ? 'Pausing stops app-side event handling while keeping the records intact.' : 'Resuming re-enables app-side event handling.'}
        confirmLabel={channelConfirm === 'pause' ? 'Pause' : 'Resume'}
        loading={pause.isPending || resume.isPending}
        onClose={() => setChannelConfirm(null)}
        onConfirm={() => (channelConfirm === 'pause' ? pause.mutate() : resume.mutate())}
      />

      <Modal visible={verticalPicker} transparent animationType="fade" onRequestClose={() => setVerticalPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVerticalPicker(false)}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select category</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {WHATSAPP_BUSINESS_VERTICAL_OPTIONS.map((option) => (
                <Pressable key={option.value} style={styles.modalRow} onPress={() => { setDraft({ ...draft, vertical: option.value }); setVerticalPicker(false); }}>
                  <Text style={draft.vertical === option.value ? [styles.modalRowActive, { color: colors.primary }] : [styles.modalRowText, { color: colors.textSecondary }]}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function HeaderBar({
  insets,
  onBack,
  onRefresh,
  refreshing = false,
}: {
  insets: { top: number };
  onBack: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  const { colors } = useTheme();
  const styles = useChannelDetailsStyles(colors);

  useEffect(() => {
    if (!refreshing) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
      <Pressable onPress={onBack} hitSlop={10}><ArrowLeft color={colors.textSecondary} size={23} /></Pressable>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Channel details</Text>
      <Pressable onPress={onRefresh} hitSlop={10} disabled={refreshing} style={refreshing ? { opacity: 0.7 } : undefined}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <RefreshCw color={colors.textSecondary} size={20} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useChannelDetailsStyles(colors);
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive, active && { backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[styles.tabText, active && styles.tabTextActive, { color: active ? colors.primary : colors.textSecondary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function ChannelConfigurationHero({
  channel,
  subtitle,
  title,
  statusTone,
  lifecycle,
  colors,
  onRestore,
}: {
  channel: ChannelDetails;
  subtitle: string;
  title?: string;
  statusTone: BadgeTone;
  lifecycle: ChannelDetails['lifecycle'];
  colors: ReturnType<typeof useTheme>['colors'];
  onRestore: () => void;
}) {
  const styles = useChannelDetailsStyles(colors);
  return (
    <>
      <View style={[styles.configurationHero, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
        <ChannelLogo type={channel.type} box={52} glyph={26} radius={18} />
        <View style={styles.titleCopy}>
          <Text style={[styles.channelName, { color: colors.text }]}>{title ?? channel.name}</Text>
          <Text style={[styles.heroSub, { color: colors.textSecondary }]}>{subtitle}</Text>
          <View style={styles.badges}>
            <AppBadge size="sm" tone={statusTone} label={formatConfigStatus(channel.status)} />
            {lifecycle.isPaused ? <AppBadge size="sm" tone="warning" label="Paused" /> : null}
            {lifecycle.isRemoved ? <AppBadge size="sm" tone="danger" label="Removed" /> : null}
          </View>
        </View>
      </View>

      {lifecycle.isRemoved ? (
        <View style={[styles.dangerCard, { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder }]}>
          <Text style={[styles.dangerTitle, { color: colors.error }]}>Removal scheduled</Text>
          <Text style={[styles.dangerText, { color: colors.textSecondary }]}>This channel is pending permanent deletion. {lifecycle.removeReason ? `Reason: ${lifecycle.removeReason}` : ''}</Text>
          <Pressable style={[styles.primaryButton, { marginTop: 12, backgroundColor: colors.primary }]} onPress={onRestore}>
            <RotateCcw color={colors.primaryText} size={15} />
            <Text style={styles.primaryButtonText}>Restore channel</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function StatusTile({ icon, title, value, tone = 'neutral', compact = false }: { icon: 'phone' | 'message' | 'link' | 'unlink'; title: string; value: string; tone?: BadgeTone; compact?: boolean }) {
  const { colors } = useTheme();
  const styles = useChannelDetailsStyles(colors);
  const Icon = icon === 'phone' ? Phone : icon === 'message' ? MessageSquare : icon === 'link' ? Link2 : Unlink2;
  const palette = badgePalette(colors, tone);
  const toneColor = palette.fg;
  const toneBg = palette.bg;

  return (
    <View style={[styles.statusTile, compact && styles.statusTileCompact, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
      <View style={[styles.statusTileIcon, compact && styles.statusTileIconCompact, { backgroundColor: toneBg }]}>
        <Icon color={toneColor} size={17} />
      </View>
      <View style={compact ? styles.statusTileCopyCompact : undefined}>
        <Text style={[styles.statusTileTitle, compact && styles.statusTileTitleCompact, { color: colors.textSecondary }]} numberOfLines={compact ? 2 : 1}>{title}</Text>
        <Text style={[styles.statusTileValue, compact && styles.statusTileValueCompact, { color: colors.text }]} numberOfLines={compact ? 2 : 1}>{value}</Text>
      </View>
    </View>
  );
}

function ConfigCopyButton({ value }: { value: string }) {
  const { colors } = useTheme();
  const styles = useChannelDetailsStyles(colors);
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Pressable onPress={copyValue} style={[styles.configCopyButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} hitSlop={8}>
      {copied ? <Check color={colors.primary} size={15} /> : <Copy color={colors.textSecondary} size={15} />}
    </Pressable>
  );
}

function ConfigField({ label, value, copy = false, mono = false, openUrl }: { label: string; value: string; copy?: boolean; mono?: boolean; openUrl?: string | null }) {
  const { colors } = useTheme();
  const styles = useChannelDetailsStyles(colors);
  const canCopy = copy && !['Not linked', 'Not available', 'None', 'No webhook failures recorded'].includes(value);

  return (
    <View style={styles.configField}>
      <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.configFieldRow}>
        {openUrl ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${label}`} onPress={() => Linking.openURL(openUrl).catch(() => Toast.show({ type: 'error', text1: 'Could not open link' }))} style={[styles.configValueBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.configValue, mono && styles.configValueMono, { color: colors.primary, textDecorationLine: 'underline' }]} numberOfLines={2}>{value}</Text>
          </Pressable>
        ) : (
          <View style={[styles.configValueBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.configValue, mono && styles.configValueMono, { color: colors.text }]} numberOfLines={2}>{value}</Text>
          </View>
        )}
        {canCopy ? <ConfigCopyButton value={value} /> : null}
        {openUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`Open ${label}`} onPress={() => Linking.openURL(openUrl).catch(() => Toast.show({ type: 'error', text1: 'Could not open link' }))} style={[styles.configCopyButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} hitSlop={8}><ExternalLink color={colors.primary} size={15} /></Pressable> : null}
      </View>
    </View>
  );
}

function FieldEdit({ label, value, onChange, placeholder, multiline = false, keyboardType }: { label: string; value: string; onChange: (text: string) => void; placeholder: string; multiline?: boolean; keyboardType?: 'email-address' }) {
  const { colors } = useTheme();
  const styles = useChannelDetailsStyles(colors);
  return (
    <AppTextField
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      keyboardType={keyboardType ?? 'default'}
      style={styles.fieldEdit}
    />
  );
}

function useChannelDetailsStyles(colors: ThemeColors) {
  return useMemo(() => StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.separator, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  headerTitle: { color: colors.text, fontSize: fontSize.subheading, fontWeight: fontWeight.bold },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tabBar: { backgroundColor: colors.surface, borderBottomColor: colors.separator, borderBottomWidth: 1, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
  tabBarContent: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  tabContent: { flex: 1 },
  tab: { alignItems: 'center', borderRadius: radius.md, flexShrink: 0, justifyContent: 'center', paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 1 },
  tabActive: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textSecondary, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  tabTextActive: { color: colors.primary, fontWeight: fontWeight.bold },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl + spacing.sm },
  configurationHero: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row', padding: spacing.md + 2 },
  titleCopy: { flex: 1, marginLeft: spacing.md + 2 },
  channelName: { color: colors.text, fontSize: fontSize.heading + 1, fontWeight: fontWeight.extrabold },
  heroSub: { color: colors.textSecondary, fontSize: fontSize.small, lineHeight: 17, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  cardSpacing: { marginTop: spacing.lg },
  cardHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: fontSize.subheading, fontWeight: fontWeight.bold },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.caption, lineHeight: 19, marginTop: spacing.xs },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  statusGridInline: { alignItems: 'stretch', flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginTop: 14 },
  statusTile: { backgroundColor: colors.primarySoft, borderColor: colors.cardBorder, borderRadius: radius.lg, borderWidth: 1, flexGrow: 1, minWidth: '30%', padding: spacing.md },
  statusTileCompact: { alignItems: 'flex-start', flex: 1, flexDirection: 'column', gap: 5, minWidth: 0, padding: 9 },
  statusTileIcon: { alignItems: 'center', borderRadius: 10, height: 32, justifyContent: 'center', marginBottom: 10, width: 32 },
  statusTileIconCompact: { height: 25, marginBottom: 0, width: 25 },
  statusTileCopyCompact: { alignSelf: 'stretch', minWidth: 0 },
  statusTileTitle: { color: colors.textSecondary, fontSize: fontSize.tiny + 1, fontWeight: fontWeight.bold },
  statusTileTitleCompact: { fontSize: fontSize.tiny, lineHeight: 13 },
  statusTileValue: { color: colors.text, fontSize: fontSize.caption, fontWeight: fontWeight.extrabold, marginTop: 3 },
  statusTileValueCompact: { fontSize: fontSize.small - 1, lineHeight: 14, marginTop: 1 },
  configFields: { gap: spacing.md, marginTop: spacing.lg },
  configField: { gap: spacing.xs + 2 },
  configLabel: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  configFieldRow: { alignItems: 'stretch', flexDirection: 'row', gap: spacing.sm },
  configValueBox: { backgroundColor: colors.primarySoft, borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  configValue: { color: colors.text, fontSize: fontSize.caption, fontWeight: fontWeight.semibold, lineHeight: 18 },
  configValueMono: { fontFamily: 'monospace', fontSize: fontSize.small },
  configCopyButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  fieldLabel: { color: colors.textSecondary, fontSize: fontSize.small, marginTop: spacing.md },
  dangerCard: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing.lg, padding: spacing.md },
  dangerTitle: { color: colors.error, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  dangerText: { color: colors.error, fontSize: fontSize.caption, lineHeight: 19, marginTop: spacing.xs },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.lg, flexDirection: 'row', gap: spacing.xs + 2, justifyContent: 'center', paddingVertical: spacing.md },
  primaryButtonText: { color: colors.primaryText, flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.bold, textAlign: 'center' },
  outlineButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.primaryBorder, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.xs + 2, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  outlineButtonText: { color: colors.primary, flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.bold, textAlign: 'center' },
  mb: { marginBottom: 10 },
  syncButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3 },
  syncText: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  profilePreview: { alignItems: 'center', backgroundColor: colors.primarySoft, borderColor: colors.cardBorder, borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md },
  profilePhoto: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.xl, height: 58, justifyContent: 'center', overflow: 'hidden', width: 58 },
  profilePhotoImage: { height: 58, width: 58 },
  profilePreviewCopy: { flex: 1, minWidth: 0 },
  profilePreviewName: { color: colors.text, fontSize: fontSize.subheading, fontWeight: fontWeight.extrabold },
  profilePreviewMeta: { color: colors.textSecondary, fontSize: fontSize.small, lineHeight: 17, marginTop: 3 },
  uploadButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', flexShrink: 0, gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  uploadButtonText: { color: colors.primary, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  fieldEdit: { marginTop: 14 },
  charHint: { color: colors.textSecondary, fontSize: fontSize.tiny, marginTop: 6 },
  select: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.primaryBorder, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, height: 46, justifyContent: 'space-between', paddingHorizontal: spacing.md, marginTop: 6 },
  selectText: { color: colors.text, flex: 1, fontSize: fontSize.caption },
  selectPlaceholder: { color: colors.textMuted, flex: 1, fontSize: fontSize.caption },
  modalBackdrop: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xxl },
  modalSheet: { backgroundColor: colors.surface, borderRadius: radius.xxl, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: fontSize.subheading, fontWeight: fontWeight.bold, marginBottom: spacing.sm },
  modalRow: { paddingVertical: spacing.md },
  modalRowText: { color: colors.textSecondary, fontSize: fontSize.caption },
  modalRowActive: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  msgTitle: { color: colors.text, fontSize: fontSize.heading, fontWeight: fontWeight.bold },
  msgText: { color: colors.textSecondary, fontSize: fontSize.caption, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  }), [colors]);
}
