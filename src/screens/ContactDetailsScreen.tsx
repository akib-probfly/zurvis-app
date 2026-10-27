import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { AlertTriangle, Ban, Copy, Globe, Mail, Phone, Plus, Search, Trash2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addCrmContactNote,
  deleteCrmContacts,
  fetchCrmContact,
  formatPhoneNumberDisplay,
  getContactTitle,
  getCountryLabel,
  resolveContactCountryCode,
  updateCrmContactDetail,
} from '../api/contacts';
import { banCrmContact, createWorkspaceTag, fetchWorkspaceTags, unbanCrmContact } from '../api/conversationDetails';
import { isApiErrorWithStatus } from '../api/client';
import { ChannelLogo } from '../components/ChannelLogo';
import { ChatIcon } from '../components/ChatIcon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ColorfulAvatar } from '../components/ColorfulAvatar';
import { ErrorState } from '../components/ErrorState';
import { FormSkeleton } from '../components/Skeleton';
import type { ContactsStackParamList } from '../navigation/ContactsStack';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { AppButton, AppCard, ScreenHeader } from '../ui';
import { fontSize, fontWeight, radius, spacing } from '../theme/tokens';

const TAG_COLOR_OPTIONS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

type BanAction = 'ban' | 'unban';

function getBanResponseBlockedAt(data: { blockedAt?: string | null } | null | undefined, fallback: string | null) {
  return data && Object.prototype.hasOwnProperty.call(data, 'blockedAt') ? data.blockedAt ?? null : fallback;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ContactDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ContactsStackParamList>>();
  const route = useRoute<RouteProp<ContactsStackParamList, 'ContactDetails'>>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const styles = useContactDetailsStyles(colors);
  const { contactId, contactName } = route.params;
  const [noteDraft, setNoteDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_OPTIONS[0]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('');
  const [banOpen, setBanOpen] = useState(false);
  const [pendingBanAction, setPendingBanAction] = useState<BanAction>('ban');

  const contactQuery = useQuery({
    queryKey: ['crm-contact', contactId],
    queryFn: () => fetchCrmContact(contactId),
    staleTime: 20_000,
  });

  const workspaceTagsQuery = useQuery({
    queryKey: ['workspace-tags', 'contact-details'],
    queryFn: () => fetchWorkspaceTags(),
    staleTime: 60_000,
  });

  const contact = contactQuery.data;
  const title = contact ? getContactTitle(contact) : contactName;
  const phone = formatPhoneNumberDisplay(contact?.primaryPhone);
  const copyPhoneNumber = contact?.primaryPhone ?? phone ?? null;
  const countryCode = contact ? resolveContactCountryCode(contact) : 'BD';
  const countryName = getCountryLabel(countryCode);
  const contactTags = useMemo(() => (contact?.tags ?? []).filter((tag) => !tag.isArchived), [contact?.tags]);
  const workspaceTags = useMemo(
    () => (workspaceTagsQuery.data?.items ?? []).filter((tag) => !tag.isArchived),
    [workspaceTagsQuery.data?.items],
  );

  useEffect(() => {
    if (!contact) return;
    setSelectedTagIds(contactTags.map((tag) => tag.id));
  }, [contact, contactTags]);

  const selectedTags = useMemo(() => {
    const byId = new Map<string, { id: string; text: string; color?: string | null }>();
    for (const tag of workspaceTags) byId.set(tag.id, tag);
    for (const tag of contactTags) byId.set(tag.id, tag);
    return selectedTagIds.map((id) => byId.get(id)).filter((tag): tag is { id: string; text: string; color?: string | null } => Boolean(tag));
  }, [selectedTagIds, workspaceTags, contactTags]);

  const searchableTags = useMemo(() => {
    const query = tagSearch.trim().toLowerCase();
    const available = workspaceTags.filter((tag) => !selectedTagIds.includes(tag.id));
    if (!query) return available;
    return available.filter((tag) => tag.text.toLowerCase().includes(query));
  }, [workspaceTags, selectedTagIds, tagSearch]);

  const canCreateTag = useMemo(() => {
    const query = tagSearch.trim().toLowerCase();
    if (!query) return false;
    return !workspaceTags.some((tag) => tag.text.toLowerCase() === query);
  }, [tagSearch, workspaceTags]);

  const tagsDirty = useMemo(() => {
    const current = contactTags.map((tag) => tag.id).sort().join('|');
    const next = [...selectedTagIds].sort().join('|');
    return current !== next;
  }, [contactTags, selectedTagIds]);

  const conversations = useMemo(
    () => [...(contact?.conversations ?? [])].sort((left, right) => {
      const leftAt = Date.parse(left.lastMessageAt ?? left.createdAt);
      const rightAt = Date.parse(right.lastMessageAt ?? right.createdAt);
      return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
    }),
    [contact?.conversations],
  );
  const notes = useMemo(
    () => [...(contact?.notes ?? [])].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [contact?.notes],
  );
  const contactChannelTypes = useMemo(() => {
    if (contact?.channelTypes?.length) return contact.channelTypes;
    return contact?.channelType ? [contact.channelType] : [];
  }, [contact?.channelTypes, contact?.channelType]);
  const canToggleBan = contactChannelTypes.some((type) => {
    const normalized = type.toLowerCase();
    return normalized === 'whatsapp' || normalized === 'messenger';
  });
  const banConversationId = contact?.latestConversationId ?? conversations[0]?.id ?? null;
  // Ban/unban act on a single conversation, so read the blocked flag from that
  // same conversation first. Falling back to contact-level state caused
  // `unban` 409s ("Conversation is not blocked") when the contact flag was set
  // but the target conversation was not.
  const banTargetConversation = conversations.find((item) => item.id === banConversationId) ?? null;
  const targetBlockedAt = banTargetConversation?.blockedAt ?? null;
  const isBlocked = Boolean(targetBlockedAt);
  const showBlockedBadge = Boolean(contact?.blockedAt ?? targetBlockedAt);

  const updateMutation = useMutation({
    mutationFn: (input: { displayName?: string | null; primaryEmail?: string | null; tagIds?: string[] }) => updateCrmContactDetail(contactId, input),
    onSuccess: async () => {
      setEmailDraft(null);
      setNameDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
    },
    onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not update contact', text2: error.message }),
  });

  const createTagMutation = useMutation({
    mutationFn: async () => {
      const created = await createWorkspaceTag({ text: tagSearch.trim(), color: newTagColor });
      const nextIds = selectedTagIds.includes(created.id) ? selectedTagIds : [...selectedTagIds, created.id];
      await updateCrmContactDetail(contactId, { tagIds: nextIds });
      return { created, nextIds };
    },
    onSuccess: async ({ nextIds }) => {
      setSelectedTagIds(nextIds);
      setTagSearch('');
      await queryClient.invalidateQueries({ queryKey: ['workspace-tags'] });
      await queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
    },
    onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not create tag', text2: error.message }),
  });

  const noteMutation = useMutation({
    mutationFn: () => addCrmContactNote(contactId, noteDraft.trim()),
    onSuccess: async () => {
      setNoteDraft('');
      await queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
    },
    onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not add note', text2: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCrmContacts({
      workspaceId: contact?.workspaceId,
      contactIds: [contactId],
      expectedCount: 1,
    }),
    onSuccess: async () => {
      setDeleteOpen(false);
      setDeleteConfirmValue('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['crm-contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['inbox-unread-count'] }),
        queryClient.invalidateQueries({ queryKey: ['conversation-count'] }),
      ]);
      queryClient.removeQueries({ queryKey: ['crm-contact', contactId] });
      Toast.show({ type: 'success', text1: 'Contact deleted' });
      navigation.goBack();
    },
    onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not delete contact', text2: error.message }),
  });

  const banMutation = useMutation({
    mutationFn: async (action: BanAction) => {
      if (!canToggleBan) throw new Error('Only WhatsApp and Messenger contacts can be banned.');
      if (!banConversationId) throw new Error('No conversation available to ban for this contact.');
      try {
        return action === 'unban' ? await unbanCrmContact(banConversationId) : await banCrmContact(banConversationId);
      } catch (error) {
        if (isApiErrorWithStatus(error, 409)) {
          return null;
        }
        throw error;
      }
    },
    onSuccess: async (data, action) => {
      setBanOpen(false);
      const nextBlockedAt = getBanResponseBlockedAt(
        data,
        action === 'unban' ? null : new Date().toISOString(),
      );
      queryClient.setQueryData(['crm-contact', contactId], (current: any) => {
        if (!current) return current;
        return {
          ...current,
          blockedAt: nextBlockedAt,
          blockedReason: nextBlockedAt ? (current.blockedReason ?? null) : null,
          conversations: (current.conversations ?? []).map((item: any) => (
            item.id === banConversationId
              ? {
                  ...item,
                  blockedAt: nextBlockedAt,
                  blockedReason: nextBlockedAt ? (item.blockedReason ?? null) : null,
                }
              : item
          )),
        };
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] }),
        queryClient.invalidateQueries({ queryKey: ['crm-contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        ...(banConversationId ? [queryClient.invalidateQueries({ queryKey: ['messages', banConversationId] })] : []),
      ]);
      Toast.show({ type: 'success', text1: action === 'unban' ? 'Contact unbanned' : 'Contact banned' });
    },
    onError: (error: Error) => {
      Toast.show({ type: 'error', text1: 'Could not update contact access', text2: error.message });
    },
  });

  const confirmToggleBan = () => {
    if (banMutation.isPending) return;
    if (!canToggleBan) {
      Toast.show({ type: 'info', text1: 'Only WhatsApp and Messenger contacts can be banned.' });
      return;
    }
    if (!banConversationId) {
      Toast.show({ type: 'info', text1: 'No conversation available to ban for this contact.' });
      return;
    }
    setPendingBanAction(isBlocked ? 'unban' : 'ban');
    setBanOpen(true);
  };

  const canConfirmDelete = deleteConfirmValue.trim() === '1' && !deleteMutation.isPending;

  const openConversation = (conversationId: string) => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'Inbox',
        params: {
          screen: 'Conversation',
          params: {
            conversationId,
            contactName: title,
          },
        },
      }),
    );
  };

  const openLatestConversation = () => {
    const latest = conversations[0];
    if (!latest) {
      Toast.show({ type: 'info', text1: 'No conversations', text2: 'This contact does not have any conversations yet.' });
      return;
    }
    openConversation(latest.id);
  };

  const copyPhone = async () => {
    const value = copyPhoneNumber?.trim();
    if (!value) {
      Toast.show({ type: 'info', text1: 'No phone number to copy' });
      return;
    }
    await Clipboard.setStringAsync(value);
    Toast.show({ type: 'copy', text1: 'Phone number copied', position: 'bottom', visibilityTime: 1600 });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={title}
        titleNumberOfLines={1}
        subtitle="Contact details"
        onBack={() => navigation.goBack()}
        right={
          <Pressable style={[styles.messageButton, { backgroundColor: colors.surfaceSecondary }]} onPress={openLatestConversation}>
            <ChatIcon color={colors.primary} size={18} />
          </Pressable>
        }
      />

      {contactQuery.isLoading ? (
        <FormSkeleton fields={6} />
      ) : contactQuery.isError || !contact ? (
        <ErrorState
          message={contactQuery.error instanceof Error ? contactQuery.error.message : 'Unable to load contact.'}
          onRetry={() => contactQuery.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.xxl) }]}>
          <AppCard style={styles.profileCard}>
            <View style={styles.profileTopRow}>
              <View style={[styles.avatar, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}>
                <ColorfulAvatar name={title} size={58} url={contact.avatarUrl} />
                {contact.channelType ? (
                  <View style={[styles.channelBadge, { borderColor: colors.surface }]}>
                    <ChannelLogo type={contact.channelType} box={18} glyph={11} radius={9} />
                  </View>
                ) : null}
              </View>
              <View style={styles.profileIdentity}>
                <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={2}>{title}</Text>
                {contact.channelName ? <Text style={[styles.profileChannel, { color: colors.textSecondary }]}>{contact.channelName}</Text> : null}
                {showBlockedBadge ? (
                  <View style={styles.bannedBadge}>
                    <Ban color={colors.error} size={11} />
                    <Text style={styles.bannedBadgeText}>Banned</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={styles.profileMeta}>
              <View style={[styles.metaChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Phone color={colors.textSecondary} size={14} />
                <Text style={[styles.metaChipText, { color: colors.textSecondary }]}>{phone ?? 'No phone'}</Text>
                {phone ? (
                  <Pressable onPress={copyPhone} accessibilityLabel="Copy phone number" hitSlop={8} style={styles.metaCopyButton}>
                    <Copy color={colors.textMuted} size={13} />
                  </Pressable>
                ) : null}
              </View>
              <View style={[styles.metaChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Mail color={colors.textSecondary} size={14} />
                <Text style={[styles.metaChipText, { color: colors.textSecondary }]}>{contact.primaryEmail?.trim() || 'No email'}</Text>
              </View>
              <View style={[styles.metaChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Globe color={colors.textSecondary} size={14} />
                <Text style={[styles.metaChipText, { color: colors.textSecondary }]}>{countryName}</Text>
              </View>
            </View>
          </AppCard>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile</Text>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Display name</Text>
            <TextInput
              value={nameDraft ?? contact.displayName ?? ''}
              onChangeText={setNameDraft}
              placeholder="Contact name"
              placeholderTextColor={colors.textMuted}
              style={[styles.fieldInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]}
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Email</Text>
            <TextInput
              value={emailDraft ?? contact.primaryEmail ?? ''}
              onChangeText={setEmailDraft}
              placeholder="name@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[styles.fieldInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]}
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Phone</Text>
            <View style={[styles.phoneField, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
              <Text style={[styles.phoneFieldText, { color: phone ? colors.text : colors.textMuted }]} numberOfLines={1}>{phone ?? '-'}</Text>
              {phone ? (
                <Pressable onPress={copyPhone} accessibilityLabel="Copy phone number" hitSlop={8} style={styles.phoneCopyButton}>
                  <Copy color={colors.textMuted} size={14} />
                </Pressable>
              ) : null}
            </View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Country</Text>
            <View style={[styles.countryRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
              <View style={[styles.countryCodeBadge, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                <Text style={[styles.countryCodeText, { color: colors.textSecondary }]}>{countryCode}</Text>
              </View>
              <Text style={[styles.countryNameText, { color: colors.text }]} numberOfLines={1}>{countryName}</Text>
            </View>
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>Last active: {formatDateTime(contact.lastActivityAt)}</Text>
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>Added: {formatDateTime(contact.createdAt)}</Text>
            {(nameDraft != null && nameDraft !== (contact.displayName ?? '')) || (emailDraft != null && emailDraft !== (contact.primaryEmail ?? '')) ? (
              <AppButton
                block
                label="Save changes"
                loading={updateMutation.isPending}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
                onPress={() => updateMutation.mutate({
                  displayName: nameDraft ?? contact.displayName,
                  primaryEmail: emailDraft ?? contact.primaryEmail,
                })}
              />
            ) : null}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Tags</Text>
            {selectedTags.length ? (
              <View style={styles.tagRow}>
                {selectedTags.map((tag) => {
                  const color = tag.color?.trim() || colors.textMuted;
                  return (
                    <Pressable
                      key={tag.id}
                      style={[styles.tagChip, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}
                      onPress={() => setSelectedTagIds((current) => current.filter((id) => id !== tag.id))}
                    >
                      <Text style={[styles.tagChipText, { color }]}>{tag.text}</Text>
                      <X color={color} size={12} />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.emptySection, { color: colors.textMuted }]}>No tags yet. Search or create one below.</Text>
            )}

            <View style={[styles.tagSearch, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Search color={colors.textMuted} size={16} />
              <TextInput
                value={tagSearch}
                onChangeText={setTagSearch}
                placeholder="Search tags to add"
                placeholderTextColor={colors.textMuted}
                style={[styles.tagSearchInput, { color: colors.text }]}
              />
              {tagSearch ? (
                <Pressable onPress={() => setTagSearch('')} hitSlop={8}>
                  <X color={colors.textMuted} size={16} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView style={styles.tagPickerScroll} contentContainerStyle={styles.tagPickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {searchableTags.map((tag) => {
                const color = tag.color?.trim() || colors.textMuted;
                return (
                  <Pressable
                    key={tag.id}
                    style={[styles.tagOption, { borderColor: color, backgroundColor: 'transparent' }]}
                    onPress={() => {
                      setSelectedTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
                      setTagSearch('');
                    }}
                  >
                    <Plus color={color} size={12} />
                    <Text style={[styles.tagOptionText, { color: colors.textSecondary }]} numberOfLines={1}>{tag.text}</Text>
                  </Pressable>
                );
              })}
              {!workspaceTagsQuery.isLoading && !searchableTags.length ? (
                <Text style={[styles.emptySection, { color: colors.textMuted }]}>
                  {tagSearch.trim() ? 'No workspace tags match your search.' : 'No more tags to add.'}
                </Text>
              ) : null}
            </ScrollView>

            {canCreateTag ? (
              <View style={[styles.createTagBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Text style={[styles.createTagLabel, { color: colors.text }]}>Create “{tagSearch.trim()}”</Text>
                <View style={styles.colorRow}>
                  {TAG_COLOR_OPTIONS.map((color) => (
                    <Pressable
                      key={color}
                      onPress={() => setNewTagColor(color)}
                      style={[styles.colorSwatch, { backgroundColor: color }, newTagColor === color && [styles.colorSwatchActive, { borderColor: colors.text }]]}
                    />
                  ))}
                </View>
                <AppButton
                  block
                  icon={Plus}
                  label="Create & assign"
                  loading={createTagMutation.isPending}
                  disabled={createTagMutation.isPending}
                  style={styles.actionButton}
                  onPress={() => createTagMutation.mutate()}
                />
              </View>
            ) : null}

            {tagsDirty ? (
              <AppButton
                block
                label="Save tags"
                loading={updateMutation.isPending}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
                onPress={() => updateMutation.mutate({ tagIds: selectedTagIds })}
              />
            ) : null}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Conversations</Text>
            {conversations.length ? conversations.map((conversation) => (
              <Pressable key={conversation.id} style={[styles.conversationRow, { borderColor: colors.cardBorder }]} onPress={() => openConversation(conversation.id)}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.conversationStatus, { color: colors.primary }]}>{conversation.status}</Text>
                  <Text style={[styles.conversationPreview, { color: colors.textSecondary }]} numberOfLines={1}>
                    {conversation.lastMessagePreview?.trim() || 'No messages yet'}
                  </Text>
                </View>
                <Text style={[styles.conversationTime, { color: colors.textMuted }]}>{formatDateTime(conversation.lastMessageAt ?? conversation.createdAt)}</Text>
              </Pressable>
            )) : (
              <Text style={[styles.emptySection, { color: colors.textMuted }]}>No conversations linked to this contact.</Text>
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notes</Text>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Add a note..."
              placeholderTextColor={colors.textMuted}
              multiline
              style={[styles.noteInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]}
            />
            <AppButton
              block
              label="Add note"
              loading={noteMutation.isPending}
              disabled={!noteDraft.trim() || noteMutation.isPending}
              style={styles.actionButton}
              onPress={() => noteMutation.mutate()}
            />
            {notes.length ? notes.map((note) => (
              <View key={note.id} style={[styles.noteCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Text style={[styles.noteBody, { color: colors.text }]}>{note.body}</Text>
                <Text style={[styles.noteMeta, { color: colors.textMuted }]}>
                  {note.author.userName?.trim() || note.author.userEmail} · {formatDateTime(note.createdAt)}
                </Text>
              </View>
            )) : (
              <Text style={[styles.emptySection, { color: colors.textMuted }]}>No notes yet.</Text>
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Access</Text>
            <Pressable
              onPress={confirmToggleBan}
              disabled={!canToggleBan || !banConversationId || banMutation.isPending}
              accessibilityState={{ disabled: !canToggleBan || !banConversationId || banMutation.isPending }}
              style={[styles.banAction, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }, (!canToggleBan || !banConversationId || banMutation.isPending) && styles.saveDisabled]}
            >
              {banMutation.isPending ? (
                <ActivityIndicator color={isBlocked ? colors.error : colors.textSecondary} />
              ) : (
                <Ban color={isBlocked ? colors.error : colors.textSecondary} size={18} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.banActionTitle, { color: isBlocked ? colors.error : colors.text }]}>
                  {isBlocked ? 'Unban User' : 'Ban User'}
                </Text>
                <Text style={[styles.banActionHint, { color: colors.textMuted }]}>
                  {canToggleBan
                    ? (isBlocked ? 'Allow this contact to message the business again' : 'Stop this contact from messaging the business')
                    : 'Only WhatsApp and Messenger contacts can be banned'}
                </Text>
              </View>
            </Pressable>
          </View>

          <View style={[styles.dangerSection, { backgroundColor: colors.surface, borderColor: colors.error }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Danger zone</Text>
            <Text style={[styles.dangerHint, { color: colors.textSecondary }]}>
              Permanently delete this contact and their conversations, messages, attachments, tags, and stored files.
            </Text>
            <Pressable
              style={styles.deleteButton}
              onPress={() => {
                setDeleteConfirmValue('');
                setDeleteOpen(true);
              }}
            >
              <Trash2 color={colors.primaryText} size={16} />
              <Text style={styles.deleteButtonText}>Delete contact</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      <ConfirmDialog
        visible={banOpen}
        title={pendingBanAction === 'unban' ? 'Unban User' : 'Ban User'}
        body={pendingBanAction === 'unban' ? 'Allow this contact to message the business again?' : 'Stop this contact from messaging the business?'}
        confirmLabel={pendingBanAction === 'unban' ? 'Unban' : 'Ban'}
        destructive={pendingBanAction === 'ban'}
        loading={banMutation.isPending}
        icon={Ban}
        onClose={() => setBanOpen(false)}
        onConfirm={() => banMutation.mutate(pendingBanAction)}
      />

      <Modal visible={deleteOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!deleteMutation.isPending) setDeleteOpen(false); }}>
        <View style={styles.deleteModalOverlay}>
          <View style={[styles.deleteModalCard, { backgroundColor: colors.surface }]}>
            <Pressable
              style={styles.deleteModalClose}
              onPress={() => {
                if (deleteMutation.isPending) return;
                setDeleteOpen(false);
                setDeleteConfirmValue('');
              }}
              hitSlop={8}
            >
              <X color={colors.textMuted} size={20} />
            </Pressable>
            <View style={[styles.deleteModalIcon, { backgroundColor: colors.surfaceSecondary }]}>
              <AlertTriangle color={colors.error} size={28} />
            </View>
            <Text style={[styles.deleteModalTitle, { color: colors.text }]}>Confirm deletion</Text>
            <Text style={[styles.deleteModalBody, { color: colors.textSecondary }]}>
              You are about to delete{' '}
              <Text style={[styles.deleteModalStrong, { color: colors.text }]}>1</Text>
              {' '}contact. Type the number to confirm:
            </Text>
            <TextInput
              value={deleteConfirmValue}
              onChangeText={setDeleteConfirmValue}
              placeholder='Type "1" to confirm'
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              autoFocus
              editable={!deleteMutation.isPending}
              style={[styles.deleteConfirmInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.error, color: colors.text }]}
              onSubmitEditing={() => {
                if (canConfirmDelete) deleteMutation.mutate();
              }}
            />
            <View style={styles.deleteModalActions}>
              <Pressable
                style={[styles.deleteCancelButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}
                disabled={deleteMutation.isPending}
                onPress={() => {
                  setDeleteOpen(false);
                  setDeleteConfirmValue('');
                }}
              >
                <Text style={[styles.deleteCancelText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.deleteConfirmButton, !canConfirmDelete && styles.saveDisabled]}
                disabled={!canConfirmDelete}
                onPress={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function useContactDetailsStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1 },
  messageButton: { alignItems: 'center', borderRadius: radius.xl, height: 36, justifyContent: 'center', width: 36 },
  loader: { marginTop: spacing.xxxl + spacing.xxl + spacing.sm },
  content: { gap: spacing.md, padding: spacing.lg },
  profileCard: { alignItems: 'center', paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md + 2 },
  profileTopRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, width: '100%' },
  avatar: { alignItems: 'center', backgroundColor: 'transparent', borderRadius: 34, borderWidth: 2, height: 68, justifyContent: 'center', position: 'relative', width: 68 },
  avatarImage: { borderRadius: 36, height: 72, width: 72 },
  avatarText: { color: colors.primary, fontSize: fontSize.title, fontWeight: fontWeight.bold },
  channelBadge: { borderRadius: radius.md, borderWidth: 2, bottom: -2, overflow: 'hidden', position: 'absolute', right: -2 },
  profileIdentity: { alignItems: 'flex-start', flex: 1, gap: 2, minWidth: 0 },
  profileName: { fontSize: fontSize.heading, fontWeight: fontWeight.extrabold },
  bannedBadge: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  bannedBadgeText: { color: colors.error, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  profileChannel: { fontSize: fontSize.caption, marginTop: spacing.xs },
  profileMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm - 2, justifyContent: 'flex-start', marginTop: spacing.md - 2, width: '100%' },
  metaChip: { alignItems: 'center', borderRadius: radius.sm + 2, borderWidth: 1, flexDirection: 'row', gap: spacing.xs + 1, minHeight: 32, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  metaChipText: { flexShrink: 1, fontSize: fontSize.small, fontWeight: fontWeight.semibold, maxWidth: 190 },
  metaCopyButton: { alignItems: 'center', height: 22, justifyContent: 'center', width: 22 },
  section: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  sectionTitle: { fontSize: fontSize.body, fontWeight: fontWeight.extrabold, marginBottom: spacing.sm + 2 },
  fieldLabel: { fontSize: fontSize.small, fontWeight: fontWeight.bold, marginBottom: spacing.sm - 2, marginTop: spacing.sm },
  fieldInput: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 3 },
  helperText: { fontSize: fontSize.small, marginTop: spacing.sm },
  phoneField: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 3 },
  phoneFieldText: { flex: 1, fontSize: fontSize.body - 1 },
  phoneCopyButton: { alignItems: 'center', height: 26, justifyContent: 'center', width: 26 },
  countryRow: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm + 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  countryCodeBadge: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  countryCodeText: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  countryNameText: { flex: 1, fontSize: fontSize.body - 1, fontWeight: fontWeight.semibold },
  actionButton: { marginTop: spacing.md },
  saveDisabled: { opacity: 0.55 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm + 2 },
  tagChip: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: spacing.xs + 1, paddingHorizontal: spacing.sm + 2, paddingVertical: 5 },
  tagChipText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  tagSearch: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginTop: spacing.xs, paddingHorizontal: spacing.sm + 2 },
  tagSearchInput: { flex: 1, height: 42, marginLeft: spacing.sm },
  tagPickerScroll: { maxHeight: 220, marginTop: spacing.sm + 2 },
  tagPickerList: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagOption: { alignSelf: 'flex-start', alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', flexGrow: 0, flexShrink: 0, gap: spacing.xs, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2 },
  tagOptionActive: { backgroundColor: colors.primarySoft },
  tagOptionText: { fontSize: fontSize.tiny, fontWeight: fontWeight.medium },
  tagOptionTextActive: { color: colors.primary, fontWeight: fontWeight.bold },
  tagDot: { borderRadius: 5, height: 10, width: 10 },
  createTagBox: { borderRadius: radius.lg, borderWidth: 1, marginTop: spacing.sm + 2, padding: spacing.md },
  createTagLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm + 2 },
  colorSwatch: { borderRadius: radius.md, height: 24, width: 24 },
  colorSwatchActive: { borderWidth: 2 },
  conversationRow: { borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm + 2, marginBottom: spacing.sm, padding: spacing.md },
  conversationStatus: { color: colors.primary, fontSize: fontSize.small, fontWeight: fontWeight.bold, textTransform: 'uppercase' },
  conversationPreview: { fontSize: fontSize.caption, marginTop: spacing.xs / 2 },
  conversationTime: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  emptySection: { fontSize: fontSize.caption },
  banAction: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
  banActionTitle: { fontSize: 14, fontWeight: fontWeight.bold },
  banActionHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  noteInput: { borderRadius: radius.md, borderWidth: 1, minHeight: 84, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, textAlignVertical: 'top' },
  noteCard: { borderRadius: radius.md, borderWidth: 1, marginTop: spacing.sm, padding: spacing.md },
  noteBody: { fontSize: fontSize.caption, lineHeight: fontSize.caption * 1.4 },
  noteMeta: { fontSize: fontSize.small, marginTop: spacing.xs + 2 },
  dangerSection: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  dangerHint: { fontSize: fontSize.caption, lineHeight: fontSize.caption * 1.4, marginBottom: spacing.xs },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
  },
  deleteButtonText: { color: colors.primaryText, fontSize: fontSize.body - 1, fontWeight: fontWeight.bold },
  deleteModalOverlay: {
    alignItems: 'center',
    backgroundColor: `${colors.text}73`,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  deleteModalCard: {
    borderRadius: radius.xxl + spacing.sm,
    maxWidth: 420,
    paddingHorizontal: spacing.xxl - spacing.xs / 2,
    paddingVertical: spacing.xxl,
    width: '100%',
  },
  deleteModalClose: { position: 'absolute', right: 14, top: 14, zIndex: 2 },
  deleteModalIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radius.xxl + spacing.sm,
    height: spacing.xxxl + spacing.xxl,
    justifyContent: 'center',
    width: spacing.xxxl + spacing.xxl,
  },
  deleteModalTitle: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.extrabold,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  deleteModalBody: {
    fontSize: fontSize.body - 1,
    lineHeight: fontSize.body * 1.4,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  deleteModalStrong: { fontWeight: fontWeight.bold },
  deleteConfirmInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    fontSize: fontSize.body,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    textAlign: 'center',
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  deleteCancelButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.md,
  },
  deleteCancelText: { fontSize: fontSize.body - 1, fontWeight: fontWeight.bold },
  deleteConfirmButton: {
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: radius.pill,
    flex: 1,
    paddingVertical: spacing.md,
  },
  });
}
