import { createThemedStyles } from '../theme/createThemedStyles';
import { borderWidth, fontSize, fontWeight, lineHeight, radius, spacing } from '../theme/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Check, ChevronDown, Copy, ExternalLink, Globe, MessageSquare, Minus, Monitor, MousePointerClick, Pencil, Phone, Plus, Save, SquareX, Trash2, Upload, Video } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Toast from 'react-native-toast-message';
import {
  fetchWebchatInstallation,
  fetchWebchatSettings,
  pauseChannel,
  resumeChannel,
  updateWebchatSettings,
  type ChannelDetails,
  type ChannelLifecycle,
  type WebchatFormConfig,
  type WebchatFormField,
  type WebchatFormFieldType,
} from '../api/channels';
import { useTheme } from '../theme/ThemeContext';
import { ChannelLogo } from './ChannelLogo';
import { AppToggle } from './AppToggle';
import { FormSkeleton } from './Skeleton';

const ACCENT_SWATCHES = ['#2563eb', '#43a047', '#67c3e8', '#f58220', '#7136d7', '#1e293b', '#d946a8', '#e5e7eb', '#ef5350'];

const BUTTON_SHAPES = [
  { value: 'DEFAULT', label: 'Default' },
  { value: 'CUSTOM_CORNER', label: 'Custom Corner' },
  { value: 'CUSTOM_BANNER', label: 'Custom Banner' },
] as const;

const POSITIONS = [
  { value: 'BOTTOM_RIGHT', label: 'Bottom right' },
  { value: 'BOTTOM_LEFT', label: 'Bottom left' },
] as const;

const FORM_FIELD_TYPE_LABELS: Record<WebchatFormFieldType, string> = {
  TEXT: 'Text',
  EMAIL: 'Email',
  PHONE: 'Phone',
  PARAGRAPH: 'Paragraph',
  NUMBER: 'Number',
  RATING: 'Rating',
};

const FORM_FIELD_TYPES = Object.keys(FORM_FIELD_TYPE_LABELS) as WebchatFormFieldType[];

const LOGO_MAX_SIZE_BYTES = 200_000;

type AppearanceDraft = {
  welcomeTitle: string;
  welcomeMessage: string;
  description: string;
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
};

const defaultAppearance: AppearanceDraft = {
  welcomeTitle: 'Chat with our team',
  welcomeMessage: 'Hi there! How can we help?',
  description: 'Our support heroes are here to assist you.',
  showDescription: true,
  brandName: 'Zurvis',
  brandLogoUrl: null,
  showAgentGroupAvatar: true,
  chatInitiationText: 'Start Conversation',
  onlineStatusText: 'Typically replies in 5 minutes',
  offlineStatusText: 'We are out of business hours',
  buttonShape: 'CUSTOM_CORNER',
  cornerRadius: 20,
  showEyeCatcher: true,
  showDesktopLabel: true,
  desktopOnlineLabel: 'Chat with us',
  desktopOfflineLabel: 'We are offline',
  accentColor: '#2563eb',
  position: 'BOTTOM_RIGHT',
};

type FeaturesDraft = {
  voiceCall: boolean;
  videoCall: boolean;
  closeFromVisitor: boolean;
  screenSharing: boolean;
  coBrowsing: boolean;
};

type FormsState = {
  preChat: WebchatFormConfig;
  postChat: WebchatFormConfig;
};

function formatSnippet(code: string): string {
  const channelKey = code.match(/data-channel-key="([^"]+)"/)?.[1] ?? '';
  const src = code.match(/src="([^"]+)"/)?.[1] ?? '';
  if (!channelKey || !src) return code.trim();
  return `<script\n  src="${src}"\n  data-channel-key="${channelKey}"\n  async\n></script>`;
}

function formatConfigStatus(value: string | null | undefined) {
  return (value ?? 'UNKNOWN')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function useWebchatSettings(channelId: string) {
  return useQuery({
    queryKey: ['channel-webchat-settings', channelId],
    queryFn: () => fetchWebchatSettings(channelId),
    staleTime: 30000,
  });
}

function useWebchatInstallation(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['channel-webchat-installation', channelId],
    queryFn: () => fetchWebchatInstallation(channelId),
    enabled,
    staleTime: 30000,
  });
}

function useInvalidateWebchat(channelId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['channel-webchat-settings', channelId], refetchType: 'active' });
    queryClient.invalidateQueries({ queryKey: ['channel-details', channelId], refetchType: 'active' });
    queryClient.invalidateQueries({ queryKey: ['channels'], refetchType: 'active' });
  };
}

function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>{children}</View>;
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      {sub ? <Text style={[styles.cardSub, { color: colors.textSecondary }]}>{sub}</Text> : null}
    </View>
  );
}

function FieldEdit({ label, value, onChange, placeholder, multiline = false, maxLength }: { label: string; value: string; onChange: (text: string) => void; placeholder: string; multiline?: boolean; maxLength?: number }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.fieldEdit}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
        {maxLength ? <Text style={[styles.charHint, { color: colors.textMuted }]}>{value.length}/{maxLength}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        maxLength={maxLength}
        style={multiline ? [styles.inputMultiline, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }] : [styles.input, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]}
      />
    </View>
  );
}

function ToggleRow({ label, sub, value, onChange, disabled = false }: { label: string; sub?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        {sub ? <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>{sub}</Text> : null}
      </View>
      <AppToggle value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

function CopyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [copied, setCopied] = useState(false);
  const copyValue = async () => {
    if (!value || value === 'Not available') return;
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <View style={styles.configField}>
      <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.configFieldRow}>
        <View style={[styles.configValueBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
          <Text style={[styles.configValue, mono && styles.configValueMono, { color: colors.text }]} numberOfLines={2}>{value}</Text>
        </View>
        <Pressable onPress={copyValue} style={[styles.copyButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} hitSlop={8}>
          {copied ? <Check color={colors.primary} size={15} /> : <Copy color={colors.textSecondary} size={15} />}
        </Pressable>
      </View>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled = false, pending = false }: { label: string; onPress: () => void; disabled?: boolean; pending?: boolean }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <Pressable style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: disabled ? 0.6 : 1 }]} onPress={onPress} disabled={disabled}>
      {pending ? <ActivityIndicator color="#fff" size="small" /> : <Save color="#fff" size={16} />}
      <Text style={styles.primaryButtonText}>{pending ? 'Saving...' : label}</Text>
    </Pressable>
  );
}

function ChipSelect<T extends string>({ options, value, onChange }: { options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, { borderColor: active ? colors.primary : colors.cardBorder, backgroundColor: active ? colors.surfaceSecondary : colors.surface }]}
          >
            <Text style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }, active && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function WebchatConfigurationSection({ channel, lifecycle }: { channel: ChannelDetails; lifecycle: ChannelLifecycle }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const channelId = channel.id;
  const invalidate = useInvalidateWebchat(channelId);
  const settingsQuery = useWebchatSettings(channelId);
  const installationQuery = useWebchatInstallation(channelId, true);
  const settings = settingsQuery.data;
  const installation = installationQuery.data;
  const [widgetName, setWidgetName] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!settings || loaded) return;
    setWidgetName(settings.name);
    setLoaded(true);
  }, [loaded, settings]);

  const save = useMutation({
    mutationFn: () => updateWebchatSettings(channelId, { name: widgetName.trim() }),
    onSuccess: (next) => {
      invalidate();
      Toast.show({ type: 'success', text1: 'Web Chat settings saved' });
      setWidgetName(next.name);
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not save Web Chat settings', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });

  const widgetId = installation?.widgetId ?? `WGT-${channel.id.slice(0, 8).toUpperCase()}`;
  const directChatUrl = installation?.directChatUrl ?? (installation?.domain ? `https://${installation.domain}` : '');
  const isLive = !lifecycle.isPaused && !lifecycle.isRemoved;

  if (settingsQuery.isLoading) return <FormSkeleton fields={5} />;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.heroRow}>
          <ChannelLogo type="WEBCHAT" box={52} glyph={26} radius={18} />
          <View style={styles.heroCopy}>
            <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={1}>{channel.name}</Text>
            <Text style={[styles.heroSub, { color: colors.textSecondary }]}>Web Chat channel configuration</Text>
            <View style={styles.badges}>
              <View style={[styles.badge, { backgroundColor: isLive ? '#e8fbf3' : '#fff7df' }]}>
                <Text style={[styles.badgeText, { color: isLive ? '#047857' : '#b45309' }]}>{formatConfigStatus(channel.status)}</Text>
              </View>
              {lifecycle.isPaused ? <View style={[styles.badge, { backgroundColor: '#fff7df' }]}><Text style={[styles.badgeText, { color: '#b45309' }]}>Paused</Text></View> : null}
              {lifecycle.isRemoved ? <View style={[styles.badge, { backgroundColor: '#ffe4e6' }]}><Text style={[styles.badgeText, { color: '#be123c' }]}>Removed</Text></View> : null}
            </View>
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle title="Channel configuration" sub="Manage widget information and settings." />
        <FieldEdit label="Widget name" value={widgetName} onChange={setWidgetName} placeholder="Website chat widget" maxLength={80} />
        <View style={styles.fieldEdit}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Website domain or subdomain</Text>
          <View style={[styles.readonlyBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.readonlyText, { color: colors.text }]}>{settings?.domain ?? installation?.domain ?? ''}</Text>
          </View>
        </View>
        <CopyField label="Widget ID" value={widgetId} mono />
        <CopyField label="Chat preview link" value={directChatUrl || 'Not available'} />
        {directChatUrl ? (
          <Pressable style={[styles.outlineButton, { borderColor: colors.cardBorder }]} onPress={() => Linking.openURL(directChatUrl).catch(() => Toast.show({ type: 'error', text1: 'Could not open browser' }))}>
            <ExternalLink color={colors.primary} size={15} />
            <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Open chat preview</Text>
          </Pressable>
        ) : null}
        <View style={{ marginTop: spacing.inset }}>
          <PrimaryButton label="Save configuration" onPress={() => save.mutate()} disabled={!widgetName.trim() || save.isPending} pending={save.isPending} />
        </View>
      </Card>
    </ScrollView>
  );
}

function AppearancePreview({ appearance }: { appearance: AppearanceDraft }) {
  const { colors: styleColors } = useTheme();
  const styles = createStyles(styleColors);
  const radius = appearance.buttonShape === 'DEFAULT' ? 999 : appearance.cornerRadius;
  const banner = appearance.buttonShape === 'CUSTOM_BANNER';
  const avatarPalette = ['#0f172a', '#94a3b8', '#64748b', '#334155', '#cbd5e1'];
  const avatarInitials = ['AS', 'RN', 'MK', 'HT', 'ZA'];
  return (
    <View style={styles.previewCard}>
      <Text style={styles.previewEyebrow}>Live preview</Text>
      <View style={[styles.previewBody, { backgroundColor: appearance.accentColor }]}>
        <View style={styles.previewBrandRow}>
          <View style={styles.previewBrandMark}>
            {appearance.brandLogoUrl ? (
              <Image source={{ uri: appearance.brandLogoUrl }} style={styles.previewLogo} contentFit="cover" cachePolicy="memory-disk" allowDownscaling />
            ) : (
              <Globe color="#fff" size={14} />
            )}
          </View>
          <Text style={styles.previewBrandName}>{appearance.brandName || 'Zurvis'}</Text>
        </View>
        <View style={styles.previewWelcome}>
          <Text style={styles.previewWelcomeTitle}>{appearance.welcomeTitle || 'Chat with our team'}</Text>
          {appearance.showDescription && appearance.description ? (
            <Text style={styles.previewWelcomeSub}>{appearance.description}</Text>
          ) : null}
          {appearance.showAgentGroupAvatar ? (
            <View style={styles.previewAvatarRow}>
              {avatarPalette.map((color, index) => (
                <View key={color} style={[styles.previewAvatar, { backgroundColor: color, marginLeft: index === 0 ? 0 : -8 }]}>
                  <Text style={styles.previewAvatarText}>{avatarInitials[index]}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.previewStartRow}>
            <View style={[styles.previewStartIcon, { backgroundColor: appearance.accentColor }]}>
              <MessageSquare color="#fff" size={16} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.previewStartTitle} numberOfLines={1}>{appearance.chatInitiationText || 'Start Conversation'}</Text>
              <Text style={styles.previewStartSub} numberOfLines={1}>{appearance.onlineStatusText || 'Typically replies in 5 minutes'}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.previewPowered}>Powered by Zurvis</Text>
      </View>
      <View style={[styles.previewLauncherRow, appearance.position === 'BOTTOM_LEFT' && { justifyContent: 'flex-start' }]}>
        {appearance.showDesktopLabel ? (
          <View style={styles.previewDesktopLabel}>
            <Text style={styles.previewDesktopLabelText}>{appearance.desktopOnlineLabel || 'Chat with us'}</Text>
          </View>
        ) : null}
        <View style={[styles.previewLauncher, banner && styles.previewLauncherBanner, { backgroundColor: appearance.accentColor, borderRadius: radius }]}>
          {banner ? <Text style={styles.previewLauncherBannerText}>Open chat</Text> : <MessageSquare color="#fff" size={18} />}
        </View>
        {appearance.showEyeCatcher ? <View style={styles.previewEyeCatcher} /> : null}
      </View>
    </View>
  );
}

export function WebchatAppearanceSection({ channel, lifecycle }: { channel: ChannelDetails; lifecycle: ChannelLifecycle }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const channelId = channel.id;
  const invalidate = useInvalidateWebchat(channelId);
  const settingsQuery = useWebchatSettings(channelId);
  const settings = settingsQuery.data;
  const [appearance, setAppearance] = useState<AppearanceDraft>(defaultAppearance);
  const [customColor, setCustomColor] = useState('');
  const [loaded, setLoaded] = useState(false);
  const isLive = !lifecycle.isPaused && !lifecycle.isRemoved;

  useEffect(() => {
    if (!settings || loaded) return;
    setAppearance({
      welcomeTitle: settings.welcomeTitle,
      welcomeMessage: settings.welcomeMessage ?? '',
      description: settings.description ?? '',
      showDescription: settings.showDescription,
      brandName: settings.brandName,
      brandLogoUrl: settings.brandLogoUrl,
      showAgentGroupAvatar: settings.showAgentGroupAvatar,
      chatInitiationText: settings.chatInitiationText,
      onlineStatusText: settings.onlineStatusText,
      offlineStatusText: settings.offlineStatusText,
      buttonShape: settings.buttonShape,
      cornerRadius: settings.cornerRadius,
      showEyeCatcher: settings.showEyeCatcher,
      showDesktopLabel: settings.showDesktopLabel,
      desktopOnlineLabel: settings.desktopOnlineLabel,
      desktopOfflineLabel: settings.desktopOfflineLabel,
      accentColor: settings.accentColor,
      position: settings.position,
    });
    setLoaded(true);
  }, [loaded, settings]);

  const set = (patch: Partial<AppearanceDraft>) => setAppearance((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      updateWebchatSettings(channelId, {
        ...appearance,
        welcomeTitle: appearance.welcomeTitle.trim(),
        welcomeMessage: appearance.welcomeMessage.trim() || null,
        description: appearance.description.trim() || null,
      }),
    onSuccess: () => {
      invalidate();
      Toast.show({ type: 'success', text1: 'Web Chat settings saved' });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not save Web Chat settings', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });

  const toggleLive = useMutation({
    mutationFn: () => (isLive ? pauseChannel(channelId) : resumeChannel(channelId)),
    onSuccess: () => {
      invalidate();
      Toast.show({ type: 'success', text1: isLive ? 'Web Chat channel paused' : 'Web Chat channel resumed' });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not update Web Chat channel', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });

  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > LOGO_MAX_SIZE_BYTES) {
      Toast.show({ type: 'error', text1: 'Logo must be smaller than 200 KB' });
      return;
    }
    if (!asset.base64) {
      Toast.show({ type: 'error', text1: 'Could not read logo file', text2: 'Please try another image.' });
      return;
    }
    const mimeType = asset.mimeType ?? 'image/png';
    set({ brandLogoUrl: `data:${mimeType};base64,${asset.base64}` });
  };

  if (settingsQuery.isLoading) return <FormSkeleton fields={6} />;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.availabilityRow}>
          <View style={styles.toggleCopy}>
            <Text style={[styles.cardTitle, { color: colors.text, fontSize: fontSize.section }]}>Widget availability</Text>
            <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>{isLive ? 'Live on site' : 'Hidden from site'}</Text>
          </View>
          <AppToggle value={isLive} onValueChange={() => toggleLive.mutate()} disabled={toggleLive.isPending || lifecycle.isRemoved} accessibilityLabel={isLive ? 'Pause widget' : 'Resume widget'} />
        </View>
      </Card>

      <Card>
        <SectionTitle title="Widget Home" sub="Shape the welcome screen visitors see before they start a conversation." />
        <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>Theme color</Text>
        <View style={styles.swatchRow}>
          {ACCENT_SWATCHES.map((color) => {
            const active = appearance.accentColor.toLowerCase() === color;
            return (
              <Pressable key={color} onPress={() => set({ accentColor: color })} style={[styles.swatch, { backgroundColor: color }, active && styles.swatchActive]} accessibilityLabel={`Choose ${color}`}>
                {active ? <Check color="#fff" size={14} /> : null}
              </Pressable>
            );
          })}
        </View>
        <FieldEdit label="Custom hex color" value={customColor} onChange={(text) => { setCustomColor(text); if (/^#[0-9a-fA-F]{6}$/.test(text)) set({ accentColor: text }); }} placeholder="#2563eb" maxLength={7} />
        <FieldEdit label="Welcome message" value={appearance.welcomeTitle} onChange={(text) => set({ welcomeTitle: text })} placeholder="Chat with our team" multiline maxLength={100} />
        <ToggleRow label="Show widget description" value={appearance.showDescription} onChange={(showDescription) => set({ showDescription })} />
        {appearance.showDescription ? (
          <FieldEdit label="Description" value={appearance.description} onChange={(text) => set({ description: text })} placeholder="Our support heroes are here to assist you." multiline maxLength={500} />
        ) : null}
        <FieldEdit label="Brand name" value={appearance.brandName} onChange={(text) => set({ brandName: text })} placeholder="Zurvis" maxLength={30} />
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Brand logo</Text>
        <Pressable style={[styles.uploadRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]} onPress={pickLogo}>
          <Upload color={colors.primary} size={15} />
          <Text style={[styles.uploadRowText, { color: colors.primary }]}>{appearance.brandLogoUrl ? 'Replace brand logo' : 'Upload PNG, JPG, GIF or WebP (max 200 KB)'}</Text>
        </Pressable>
        <ToggleRow label="Agent group avatar" sub="Show stacked agent avatars on the welcome screen" value={appearance.showAgentGroupAvatar} onChange={(showAgentGroupAvatar) => set({ showAgentGroupAvatar })} />
        <FieldEdit label="Chat initiation text" value={appearance.chatInitiationText} onChange={(text) => set({ chatInitiationText: text })} placeholder="Start Conversation" maxLength={50} />
        <FieldEdit label="Online status" value={appearance.onlineStatusText} onChange={(text) => set({ onlineStatusText: text })} placeholder="Typically replies in 5 minutes" maxLength={65} />
        <FieldEdit label="Offline status" value={appearance.offlineStatusText} onChange={(text) => set({ offlineStatusText: text })} placeholder="We are out of business hours" maxLength={65} />
      </Card>

      <Card>
        <SectionTitle title="Chat Button Style" sub="Control how the launcher appears on your website." />
        <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>Button shape</Text>
        <ChipSelect options={BUTTON_SHAPES} value={appearance.buttonShape} onChange={(buttonShape) => set({ buttonShape })} />
        <View style={styles.stepperRow}>
          <View style={styles.toggleCopy}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>Corner radius</Text>
            <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>{appearance.buttonShape === 'DEFAULT' ? 'Fixed for the default shape' : `${appearance.cornerRadius}px`}</Text>
          </View>
          <View style={styles.stepper}>
            <Pressable style={[styles.stepperButton, { borderColor: colors.cardBorder }]} disabled={appearance.buttonShape === 'DEFAULT'} onPress={() => set({ cornerRadius: Math.max(0, appearance.cornerRadius - 2) })}>
              <Minus color={colors.textSecondary} size={15} />
            </Pressable>
            <Pressable style={[styles.stepperButton, { borderColor: colors.cardBorder }]} disabled={appearance.buttonShape === 'DEFAULT'} onPress={() => set({ cornerRadius: Math.min(28, appearance.cornerRadius + 2) })}>
              <Plus color={colors.textSecondary} size={15} />
            </Pressable>
          </View>
        </View>
        <ToggleRow label="Eye catcher" sub="Show the red notification dot on the launcher" value={appearance.showEyeCatcher} onChange={(showEyeCatcher) => set({ showEyeCatcher })} />
        <ToggleRow label="Desktop label" sub="Show a text label next to the launcher on desktop" value={appearance.showDesktopLabel} onChange={(showDesktopLabel) => set({ showDesktopLabel })} />
        {appearance.showDesktopLabel ? (
          <>
            <FieldEdit label="Online label" value={appearance.desktopOnlineLabel} onChange={(text) => set({ desktopOnlineLabel: text })} placeholder="Chat with us" maxLength={50} />
            <FieldEdit label="Offline label" value={appearance.desktopOfflineLabel} onChange={(text) => set({ desktopOfflineLabel: text })} placeholder="We are offline" maxLength={50} />
          </>
        ) : null}
        <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>Launcher position</Text>
        <ChipSelect options={POSITIONS} value={appearance.position} onChange={(position) => set({ position })} />
      </Card>

      <AppearancePreview appearance={appearance} />

      <PrimaryButton label="Save appearance" onPress={() => save.mutate()} disabled={!appearance.welcomeTitle.trim() || !appearance.brandName.trim() || save.isPending} pending={save.isPending} />
      <View style={{ height: 8 }} />
    </ScrollView>
  );
}

const FEATURE_DEFS = [
  { key: 'voiceCall', label: 'Voice call', icon: 'phone', comingSoon: false },
  { key: 'videoCall', label: 'Video call', icon: 'video', comingSoon: true },
  { key: 'closeFromVisitor', label: 'Close chat from visitor end', icon: 'close', comingSoon: false },
  { key: 'screenSharing', label: 'Screen sharing', icon: 'monitor', comingSoon: true },
  { key: 'coBrowsing', label: 'Co browsing', icon: 'cobrowse', comingSoon: true },
] as const;

type FeatureKey = (typeof FEATURE_DEFS)[number]['key'];

function FeatureIcon({ icon, color }: { icon: string; color: string }) {
  if (icon === 'phone') return <Phone color={color} size={16} />;
  if (icon === 'video') return <Video color={color} size={16} />;
  if (icon === 'monitor') return <Monitor color={color} size={16} />;
  if (icon === 'cobrowse') return <MousePointerClick color={color} size={16} />;
  return <SquareX color={color} size={16} />;
}

export function WebchatFeaturesSection({ channelId }: { channelId: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const invalidate = useInvalidateWebchat(channelId);
  const settingsQuery = useWebchatSettings(channelId);
  const [features, setFeatures] = useState<FeaturesDraft>({ voiceCall: false, videoCall: false, closeFromVisitor: false, screenSharing: false, coBrowsing: false });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings || loaded) return;
    setFeatures({ voiceCall: settings.voiceCall, videoCall: settings.videoCall, closeFromVisitor: settings.closeFromVisitor, screenSharing: settings.screenSharing, coBrowsing: settings.coBrowsing });
    setLoaded(true);
  }, [loaded, settingsQuery.data]);

  const featureMutation = useMutation({
    mutationFn: (next: FeaturesDraft) => updateWebchatSettings(channelId, next),
    onSuccess: (nextSettings) => {
      invalidate();
      setFeatures({ voiceCall: nextSettings.voiceCall, videoCall: nextSettings.videoCall, closeFromVisitor: nextSettings.closeFromVisitor, screenSharing: nextSettings.screenSharing, coBrowsing: nextSettings.coBrowsing });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not update widget feature', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });

  const updateFeature = (key: FeatureKey, value: boolean) => {
    const next = { ...features, [key]: value };
    setFeatures(next);
    featureMutation.mutate(next);
  };

  if (settingsQuery.isLoading) return <FormSkeleton fields={5} />;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Card>
        <SectionTitle title="Key Features" sub="Choose which capabilities visitors get inside the chat widget." />
        <View style={styles.featureList}>
          {FEATURE_DEFS.map((def) => (
            <View key={def.key} style={[styles.featureCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
              <View style={styles.featureCopy}>
                <View style={[styles.featureIcon, { backgroundColor: colors.surface }]}>
                  <FeatureIcon icon={def.icon} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.featureLabel, { color: colors.text }]}>{def.label}</Text>
                  {def.comingSoon ? <Text style={[styles.comingSoon, { color: colors.primary }]}>Coming soon</Text> : null}
                </View>
              </View>
              <AppToggle value={features[def.key]} onValueChange={(value) => updateFeature(def.key, value)} disabled={def.comingSoon || featureMutation.isPending} accessibilityLabel={def.label} />
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

function hydrateForm(form: WebchatFormConfig): WebchatFormConfig {
  return { ...form, fields: form.fields.map((field) => ({ ...field, enabled: field.enabled ?? true })) };
}

export function WebchatFormsSection({ channelId }: { channelId: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const invalidate = useInvalidateWebchat(channelId);
  const settingsQuery = useWebchatSettings(channelId);
  const [forms, setForms] = useState<FormsState | null>(null);
  const [editingForm, setEditingForm] = useState<'preChat' | 'postChat' | null>(null);
  const [typePickerField, setTypePickerField] = useState<string | null>(null);

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings || forms) return;
    if (settings.preChatForm?.fields && settings.postChatForm?.fields) {
      setForms({ preChat: hydrateForm(settings.preChatForm), postChat: hydrateForm(settings.postChatForm) });
    }
  }, [forms, settingsQuery.data]);

  const formsMutation = useMutation({
    mutationFn: (next: FormsState) => updateWebchatSettings(channelId, { preChatForm: next.preChat, postChatForm: next.postChat }),
    onSuccess: (nextSettings) => {
      invalidate();
      if (nextSettings.preChatForm?.fields && nextSettings.postChatForm?.fields) {
        setForms({ preChat: hydrateForm(nextSettings.preChatForm), postChat: hydrateForm(nextSettings.postChatForm) });
      }
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not save chat forms', text2: error instanceof Error ? error.message : 'Please try again.' }),
  });

  const toggleForm = (kind: 'preChat' | 'postChat', enabled: boolean) => {
    if (!forms) return;
    const next = { ...forms, [kind]: { ...forms[kind], enabled } };
    setForms(next);
    formsMutation.mutate(next);
  };

  const updateField = (fieldId: string, patch: Partial<WebchatFormField>) => {
    if (!forms || !editingForm) return;
    setForms({ ...forms, [editingForm]: { ...forms[editingForm], fields: forms[editingForm].fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)) } });
  };

  const addField = () => {
    if (!forms || !editingForm) return;
    const id = `custom-${Date.now()}`;
    setForms({ ...forms, [editingForm]: { ...forms[editingForm], fields: [...forms[editingForm].fields, { id, label: 'New field', type: 'TEXT', required: false, enabled: true }] } });
  };

  const removeField = (fieldId: string) => {
    if (!forms || !editingForm) return;
    setForms({ ...forms, [editingForm]: { ...forms[editingForm], fields: forms[editingForm].fields.filter((field) => field.id !== fieldId) } });
  };

  const finishEditing = () => {
    if (forms) formsMutation.mutate(forms);
    setEditingForm(null);
  };

  if (settingsQuery.isLoading || !forms) return <FormSkeleton fields={4} />;

  if (editingForm) {
    const form = forms[editingForm];
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.editorHead}>
          <Pressable onPress={finishEditing} style={styles.backLink} hitSlop={8}>
            <Text style={[styles.backLinkText, { color: colors.primary }]}>Back to forms</Text>
          </Pressable>
          <Pressable style={[styles.doneButton, { backgroundColor: colors.primary }]} onPress={finishEditing} disabled={formsMutation.isPending}>
            {formsMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Check color="#fff" size={15} />}
            <Text style={styles.doneButtonText}>Done editing</Text>
          </Pressable>
        </View>

        <Card>
          <SectionTitle title="Form details" sub="Set the form name and choose where it appears in the chat journey." />
          <FieldEdit label="Form name" value={form.name} onChange={(name) => setForms({ ...forms, [editingForm]: { ...form, name } })} placeholder={editingForm === 'preChat' ? 'Pre chat form' : 'Post chat survey'} maxLength={60} />
        </Card>

        <Card>
          <SectionTitle title="Fields" sub="Required fields stay protected. Add custom fields when you need more visitor context." />
          {form.fields.map((field) => (
            <View key={field.id} style={[styles.formFieldCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
              <View style={styles.formFieldRow}>
                <TextInput
                  value={field.label}
                  onChangeText={(label) => updateField(field.id, { label })}
                  maxLength={80}
                  editable={!field.locked}
                  placeholder="Field label"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.formFieldLabelInput, { color: colors.text, borderColor: colors.cardBorder }]}
                />
                <Pressable
                  style={[styles.formFieldTypeButton, { borderColor: colors.cardBorder }]}
                  disabled={field.locked}
                  onPress={() => setTypePickerField(field.id)}
                >
                  <Text style={[styles.formFieldTypeText, { color: colors.text }]}>{FORM_FIELD_TYPE_LABELS[field.type]}</Text>
                  <ChevronDown color={colors.textSecondary} size={14} />
                </Pressable>
              </View>
              <View style={styles.formFieldToggles}>
                <View style={styles.formFieldToggle}>
                  <Text style={[styles.formFieldToggleLabel, { color: colors.textSecondary }]}>Visible</Text>
                  <AppToggle value={field.enabled} onValueChange={(enabled) => updateField(field.id, { enabled })} disabled={field.id === 'name' || field.id === 'email'} accessibilityLabel={`Show ${field.label}`} />
                </View>
                <View style={styles.formFieldToggle}>
                  <Text style={[styles.formFieldToggleLabel, { color: colors.textSecondary }]}>Required</Text>
                  <AppToggle value={field.required} onValueChange={(required) => updateField(field.id, { required })} disabled={field.locked || field.id === 'phone'} accessibilityLabel={`Set ${field.label} required`} />
                </View>
                <Pressable onPress={() => removeField(field.id)} disabled={field.locked} hitSlop={8} style={field.locked ? { opacity: 0.35 } : undefined} accessibilityLabel={`Remove ${field.label}`}>
                  <Trash2 color={colors.error} size={17} />
                </Pressable>
              </View>
              {field.locked ? <Text style={[styles.lockedHint, { color: colors.textMuted }]}>{field.id === 'phone' ? 'Optional field. Use the toggle to show or hide it.' : 'Default field and cannot be removed.'}</Text> : null}
            </View>
          ))}
          <Pressable style={[styles.addFieldButton, { borderColor: colors.cardBorder }]} onPress={addField}>
            <Plus color={colors.primary} size={15} />
            <Text style={[styles.addFieldText, { color: colors.primary }]}>Add field</Text>
          </Pressable>
        </Card>

        <Card>
          <Text style={[styles.previewEyebrow, { color: colors.textMuted }]}>Preview</Text>
          <Text style={[styles.formPreviewName, { color: colors.text }]}>{form.name || (editingForm === 'preChat' ? 'Pre chat form' : 'Post chat survey')}</Text>
          {form.fields.filter((field) => field.enabled).map((field) => (
            <View key={field.id} style={styles.formPreviewField}>
              <Text style={[styles.formPreviewLabel, { color: colors.textSecondary }]}>{field.label}{field.required ? <Text style={{ color: colors.error }}> *</Text> : null}</Text>
              {field.type === 'PARAGRAPH' ? (
                <View style={[styles.formPreviewBox, { borderColor: colors.cardBorder, minHeight: 56 }]} />
              ) : field.type === 'RATING' ? (
                <Text style={styles.formPreviewStars}>★★★★★</Text>
              ) : (
                <View style={[styles.formPreviewBox, { borderColor: colors.cardBorder }]} />
              )}
            </View>
          ))}
          <View style={[styles.formPreviewSubmit, { backgroundColor: colors.primary }]}>
            <Text style={styles.formPreviewSubmitText}>{editingForm === 'preChat' ? 'Start conversation' : 'Submit feedback'}</Text>
          </View>
        </Card>

        <Modal visible={typePickerField !== null} transparent animationType="fade" onRequestClose={() => setTypePickerField(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTypePickerField(null)}>
            <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Field type</Text>
              {FORM_FIELD_TYPES.map((type) => (
                <Pressable key={type} style={styles.modalRow} onPress={() => { if (typePickerField) updateField(typePickerField, { type }); setTypePickerField(null); }}>
                  <Text style={[styles.modalRowText, { color: colors.text }]}>{FORM_FIELD_TYPE_LABELS[type]}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      </ScrollView>
    );
  }

  const cards = [
    { kind: 'preChat' as const, eyebrow: 'Before chat', description: 'Collect visitor details before the first message.' },
    { kind: 'postChat' as const, eyebrow: 'After chat', description: 'Capture feedback when a conversation is complete.' },
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Card>
        <SectionTitle title="Live chat forms" sub="Choose what visitors see before and after a web chat. Ticket forms are not available for this channel." />
        {cards.map(({ kind, eyebrow, description }) => {
          const form = forms[kind];
          const visibleCount = form.fields.filter((field) => field.enabled).length;
          return (
            <View key={kind} style={[styles.formCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
              <View style={styles.formCardHead}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.formCardEyebrow, { color: colors.textMuted }]}>{eyebrow}</Text>
                  <Text style={[styles.formCardName, { color: colors.text }]}>{form.name}</Text>
                </View>
                <AppToggle value={form.enabled} onValueChange={(enabled) => toggleForm(kind, enabled)} accessibilityLabel={`Enable ${form.name}`} />
              </View>
              <Text style={[styles.formCardDesc, { color: colors.textSecondary }]}>{description}</Text>
              <View style={styles.formCardFoot}>
                <Text style={[styles.formCardCount, { color: colors.textSecondary }]}>{visibleCount} visible fields</Text>
                <Pressable style={[styles.editFormButton, { borderColor: colors.cardBorder }]} onPress={() => setEditingForm(kind)}>
                  <Pencil color={colors.primary} size={13} />
                  <Text style={[styles.editFormText, { color: colors.primary }]}>Edit form</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}

export function WebchatSnippetSection({ channelId }: { channelId: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [copied, setCopied] = useState(false);
  const installationQuery = useWebchatInstallation(channelId, true);
  const snippet = installationQuery.data?.code ? formatSnippet(installationQuery.data.code) : '';

  const copySnippet = async () => {
    if (!snippet) return;
    await Clipboard.setStringAsync(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    Toast.show({ type: 'success', text1: 'Snippet copied', text2: 'Paste it into your website HTML to install the widget.' });
  };

  if (installationQuery.isLoading) return <FormSkeleton fields={3} />;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Card>
        <SectionTitle title="Code Snippet" sub="Paste this snippet into your website HTML to install the chat widget." />
        <View style={[styles.snippetBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
          <Text style={[styles.snippetText, { color: colors.text }]} selectable>{snippet || 'Loading installation code…'}</Text>
        </View>
        <Pressable style={[styles.primaryButton, { backgroundColor: colors.primary, marginTop: spacing.inset, opacity: snippet ? 1 : 0.6 }]} onPress={copySnippet} disabled={!snippet}>
          {copied ? <Check color="#fff" size={16} /> : <Copy color="#fff" size={16} />}
          <Text style={styles.primaryButtonText}>{copied ? 'Copied' : 'Copy snippet'}</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const createStyles = createThemedStyles((colors) => StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  card: { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.xxl, borderWidth: borderWidth.thin, marginBottom: spacing.lg, padding: spacing.lg },
  cardTitle: { color: colors.text, fontSize: fontSize.subheading, fontWeight: fontWeight.bold },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.caption, lineHeight: lineHeight.control, marginTop: spacing.xs },
  heroRow: { alignItems: 'center', flexDirection: 'row' },
  heroCopy: { flex: 1, marginLeft: spacing.inset, minWidth: 0 },
  heroName: { color: colors.text, fontSize: fontSize.lead, fontWeight: fontWeight.extrabold },
  heroSub: { color: colors.textSecondary, fontSize: fontSize.small, lineHeight: lineHeight.compact, marginTop: spacing.xxs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, marginTop: spacing.compact },
  badge: { borderRadius: radius.inset, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeText: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold, textTransform: 'uppercase' },
  fieldEdit: { marginTop: spacing.inset },
  fieldLabel: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  fieldLabelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  charHint: { color: colors.textSecondary, fontSize: fontSize.compact },
  input: { backgroundColor: colors.background, borderColor: colors.inputBorder, borderRadius: radius.lg, borderWidth: borderWidth.thin, color: colors.text, fontSize: fontSize.section, height: 46, marginTop: spacing.compact, paddingHorizontal: spacing.inset },
  inputMultiline: { backgroundColor: colors.background, borderColor: colors.inputBorder, borderRadius: radius.lg, borderWidth: borderWidth.thin, color: colors.text, fontSize: fontSize.section, marginTop: spacing.compact, minHeight: 72, paddingHorizontal: spacing.inset, paddingVertical: spacing.control, textAlignVertical: 'top' },
  readonlyBox: { backgroundColor: colors.background, borderColor: colors.cardBorder, borderRadius: radius.lg, borderWidth: borderWidth.thin, marginTop: spacing.compact, minHeight: 46, justifyContent: 'center', paddingHorizontal: spacing.inset, paddingVertical: spacing.control },
  readonlyText: { color: colors.text, fontSize: fontSize.section },
  configField: { gap: spacing.compact, marginTop: spacing.inset },
  configLabel: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  configFieldRow: { alignItems: 'stretch', flexDirection: 'row', gap: spacing.sm },
  configValueBox: { backgroundColor: colors.background, borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: borderWidth.thin, flex: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  configValue: { color: colors.text, fontSize: fontSize.caption, fontWeight: fontWeight.semibold, lineHeight: lineHeight.caption },
  configValueMono: { fontFamily: 'monospace', fontSize: fontSize.small },
  copyButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.md, borderWidth: borderWidth.thin, height: 42, justifyContent: 'center', width: 42 },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.lg, flexDirection: 'row', gap: spacing.compact, justifyContent: 'center', paddingVertical: spacing.md },
  primaryButtonText: { color: colors.primaryText, flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.bold, textAlign: 'center' },
  outlineButton: { alignItems: 'center', borderColor: colors.cardBorder, borderRadius: radius.lg, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.compact, justifyContent: 'center', marginTop: spacing.md, paddingVertical: spacing.md },
  outlineButtonText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  groupLabel: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.bold, marginTop: spacing.roomy },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.inset },
  toggleCopy: { flex: 1, minWidth: 0 },
  toggleLabel: { color: colors.text, fontSize: fontSize.section, fontWeight: fontWeight.semibold },
  toggleSub: { color: colors.textSecondary, fontSize: fontSize.small, lineHeight: lineHeight.compact, marginTop: spacing.xxs },
  availabilityRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.control, marginTop: spacing.control },
  swatch: { alignItems: 'center', borderRadius: radius.xxl, height: 40, justifyContent: 'center', width: 40 },
  swatchActive: { borderColor: '#fff', borderWidth: borderWidth.strong },
  uploadRow: { alignItems: 'center', borderColor: colors.cardBorder, borderRadius: radius.lg, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.compact, paddingHorizontal: spacing.inset, paddingVertical: spacing.md + spacing.hairline },
  uploadRowText: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { borderRadius: radius.pill, borderWidth: borderWidth.thin, paddingHorizontal: spacing.inset, paddingVertical: spacing.sm + spacing.hairline },
  chipText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  chipTextActive: { fontWeight: fontWeight.extrabold },
  stepperRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.inset },
  stepper: { flexDirection: 'row', gap: spacing.sm },
  stepperButton: { alignItems: 'center', borderRadius: radius.md, borderWidth: borderWidth.thin, height: 38, justifyContent: 'center', width: 44 },
  previewCard: { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.xxl, borderWidth: borderWidth.thin, marginBottom: spacing.lg, padding: spacing.inset },
  previewEyebrow: { color: colors.textSecondary, fontSize: fontSize.tiny, fontWeight: fontWeight.bold, letterSpacing: 1.5, marginBottom: spacing.control, textTransform: 'uppercase' },
  previewBody: { borderRadius: radius.xl, minHeight: 420, overflow: 'hidden', padding: spacing.lg },
  previewBrandRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  previewBrandMark: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.control, height: 32, justifyContent: 'center', overflow: 'hidden', width: 32 },
  previewLogo: { height: 32, width: 32 },
  previewBrandName: { color: colors.primaryText, fontSize: fontSize.section, fontWeight: fontWeight.bold },
  previewWelcome: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.3)', borderRadius: radius.control, borderWidth: borderWidth.thin, marginTop: spacing.xxl, padding: spacing.inset },
  previewWelcomeTitle: { color: colors.primaryText, fontSize: fontSize.heading, fontWeight: fontWeight.extrabold, lineHeight: lineHeight.spacious },
  previewWelcomeSub: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.small, lineHeight: lineHeight.compact, marginTop: spacing.compact },
  previewAvatarRow: { flexDirection: 'row', marginTop: spacing.md },
  previewAvatar: { alignItems: 'center', borderColor: 'rgba(255,255,255,0.5)', borderRadius: radius.lg, borderWidth: borderWidth.strong, height: 28, justifyContent: 'center', width: 28 },
  previewAvatarText: { color: colors.primaryText, fontSize: fontSize.micro, fontWeight: fontWeight.extrabold },
  previewStartRow: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, flexDirection: 'row', gap: spacing.control, marginTop: 120, padding: spacing.control },
  previewStartIcon: { alignItems: 'center', borderRadius: radius.xxl, height: 40, justifyContent: 'center', width: 40 },
  previewStartTitle: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  previewStartSub: { color: colors.textSecondary, fontSize: fontSize.tiny, marginTop: spacing.xxs },
  previewPowered: { color: 'rgba(255,255,255,0.65)', fontSize: fontSize.tiny, marginTop: spacing.inset, textAlign: 'center' },
  previewLauncherRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', marginTop: spacing.md },
  previewDesktopLabel: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.compact },
  previewDesktopLabelText: { color: colors.textSecondary, fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  previewLauncher: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  previewLauncherBanner: { width: 112 },
  previewLauncherBannerText: { color: colors.primaryText, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  previewEyeCatcher: { backgroundColor: colors.error, borderColor: '#fff', borderRadius: radius.compact, borderWidth: borderWidth.strong, height: 12, marginLeft: -16, marginTop: -32, width: 12 },
  featureList: { gap: spacing.control, marginTop: spacing.inset },
  featureCard: { alignItems: 'center', borderRadius: radius.lg, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.control, justifyContent: 'space-between', padding: spacing.md },
  featureCopy: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.control, minWidth: 0 },
  featureIcon: { alignItems: 'center', borderRadius: radius.inset, height: 36, justifyContent: 'center', width: 36 },
  featureLabel: { fontSize: fontSize.section, fontWeight: fontWeight.semibold },
  comingSoon: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold, marginTop: spacing.xxs, textTransform: 'uppercase' },
  editorHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  backLink: { paddingVertical: spacing.sm },
  backLinkText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  doneButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.md, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.inset, paddingVertical: spacing.control },
  doneButtonText: { color: colors.primaryText, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  formFieldCard: { borderRadius: radius.lg, borderWidth: borderWidth.thin, marginTop: spacing.control, padding: spacing.md },
  formFieldRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  formFieldLabelInput: { borderBottomWidth: borderWidth.thin, flex: 1, fontSize: fontSize.section, fontWeight: fontWeight.semibold, minWidth: 0, paddingVertical: spacing.compact },
  formFieldTypeButton: { alignItems: 'center', borderRadius: radius.inset, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.control, paddingVertical: spacing.sm },
  formFieldTypeText: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  formFieldToggles: { alignItems: 'center', flexDirection: 'row', gap: spacing.inset, marginTop: spacing.control },
  formFieldToggle: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  formFieldToggleLabel: { fontSize: fontSize.small },
  lockedHint: { color: colors.textMuted, fontSize: fontSize.compact, marginTop: spacing.sm },
  addFieldButton: { alignItems: 'center', borderRadius: radius.lg, borderStyle: 'dashed', borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.compact, justifyContent: 'center', marginTop: spacing.control, paddingVertical: spacing.md },
  addFieldText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  formPreviewName: { fontSize: fontSize.body, fontWeight: fontWeight.extrabold, marginTop: spacing.xs },
  formPreviewField: { marginTop: spacing.md },
  formPreviewLabel: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  formPreviewBox: { borderRadius: radius.inset, borderWidth: borderWidth.thin, height: 40, marginTop: spacing.compact },
  formPreviewStars: { color: colors.warning, fontSize: fontSize.sectionTitle, letterSpacing: 2, marginTop: spacing.compact },
  formPreviewSubmit: { alignItems: 'center', borderRadius: radius.md, marginTop: spacing.inset, paddingVertical: spacing.md },
  formPreviewSubmitText: { color: colors.primaryText, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  formCard: { borderRadius: radius.lg, borderWidth: borderWidth.thin, marginTop: spacing.md, padding: spacing.inset },
  formCardHead: { alignItems: 'center', flexDirection: 'row', gap: spacing.control },
  formCardEyebrow: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold, textTransform: 'uppercase' },
  formCardName: { fontSize: fontSize.body, fontWeight: fontWeight.extrabold, marginTop: spacing.xxs },
  formCardDesc: { fontSize: fontSize.small, lineHeight: lineHeight.caption, marginTop: spacing.sm },
  formCardFoot: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  formCardCount: { fontSize: fontSize.small },
  editFormButton: { alignItems: 'center', borderRadius: radius.inset, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.xs + spacing.hairline, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  editFormText: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  modalBackdrop: { backgroundColor: 'rgba(15,23,42,0.45)', flex: 1, justifyContent: 'center', padding: spacing.xxl },
  modalSheet: { backgroundColor: colors.surface, borderRadius: radius.panel, padding: spacing.roomy },
  modalTitle: { color: colors.text, fontSize: fontSize.subheading, fontWeight: fontWeight.bold, marginBottom: spacing.sm },
  modalRow: { paddingVertical: spacing.md },
  modalRowText: { fontSize: fontSize.section },
  snippetBox: { borderRadius: radius.md, borderWidth: borderWidth.thin, marginTop: spacing.md, maxHeight: 260, padding: spacing.md },
  snippetText: { fontFamily: 'monospace', fontSize: fontSize.small, lineHeight: lineHeight.control },
}));
