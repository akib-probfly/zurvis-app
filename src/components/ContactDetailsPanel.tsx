import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Ban, Check, ChevronDown, ChevronUp, Copy, File, FileText, Film, Music, Pencil, Plus, RotateCcw, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiUrl, isApiErrorWithStatus } from '../api/client';
import { attachConversationTag, banCrmContact, createConversationNote, createConversationTag, deleteConversationNote, detachConversationTag, fetchConversationAttachments, fetchConversationNotes, fetchConversationTags, fetchWorkspaceTags, unbanCrmContact, updateConversationNote, updateCrmContact, type ConversationAttachment, type ConversationTag } from '../api/conversationDetails';
import { AuthenticatedImage } from './AuthenticatedImage';
import { BottomSheet, SheetScrollView } from './BottomSheet';
import { ConfirmDialog } from './ConfirmDialog';
import { ColorfulAvatar } from './ColorfulAvatar';
import { toastConfig } from './AppToast';
import { MediaViewer, type MediaGalleryItem } from './MediaViewer';
import { PanelSkeleton } from './Skeleton';
import { VideoPlayerModal } from './VideoPlayer';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/tokens';
import Toast from 'react-native-toast-message';

export function formatPhoneNumberDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('+') ? trimmed.slice(1).trimStart() : trimmed;
}

export function formatUsernameDisplay(username: string | null | undefined): string | null {
  if (!username) return null;
  const trimmed = username.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function formatAttachmentSize(sizeBytes: number | null | undefined): string | null {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const TAG_COLOR_OPTIONS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

type PanelProps = {
  visible: boolean;
  onClose: () => void;
  conversation: {
    id: string;
    workspaceId?: string;
    status?: string;
    blockedAt?: string | null;
    blockedReason?: string | null;
    contact: { id: string; displayName: string | null; avatarUrl: string | null; primaryPhone?: string | null; primaryEmail?: string | null; blockedAt?: string | null; blockedReason?: string | null };
    channel: { channelId?: string; channelType: string; channelName: string; displayPhoneNumber: string | null };
  };
  isUpdatingStatus?: boolean;
  onToggleStatus: () => void;
};

type BanAction = 'ban' | 'unban';

function getBanResponseBlockedAt(data: { blockedAt?: string | null } | null | undefined, fallback: string | null) {
  return data && Object.prototype.hasOwnProperty.call(data, 'blockedAt') ? data.blockedAt ?? null : fallback;
}

export function ContactDetailsPanel({ visible, onClose, conversation, isUpdatingStatus = false, onToggleStatus }: PanelProps) {
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const [customerOpen, setCustomerOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [attachmentFilter, setAttachmentFilter] = useState<'MEDIA' | 'DOCUMENTS'>('MEDIA');
  const [tagInput, setTagInput] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [gallery, setGallery] = useState<MediaGalleryItem[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(TAG_COLOR_OPTIONS[0]);
  const [optimisticBlockedAt, setOptimisticBlockedAt] = useState<string | null | undefined>(undefined);
  const [banOpen, setBanOpen] = useState(false);
  const [pendingBanAction, setPendingBanAction] = useState<BanAction>('ban');
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);

  // Only fetch sidebar data when the panel is open (matches web: notes/files load on expand).
  const conversationTagsQuery = useQuery({
    queryKey: ['conversation-tags', conversation.id],
    queryFn: () => fetchConversationTags(conversation.id),
    enabled: visible,
    staleTime: 30000,
  });
  const workspaceTagsQuery = useQuery({
    queryKey: ['workspace-tags', conversation.workspaceId],
    queryFn: () => fetchWorkspaceTags(conversation.workspaceId),
    enabled: visible && Boolean(conversation.workspaceId),
    staleTime: 60000,
  });
  const notesQuery = useQuery({
    queryKey: ['conversation-notes', conversation.id],
    queryFn: () => fetchConversationNotes({ conversationId: conversation.id, limit: 50 }),
    enabled: visible,
    staleTime: 15000,
  });
  const attachmentsQuery = useQuery({
    queryKey: ['conversation-attachments', conversation.id],
    queryFn: () => fetchConversationAttachments({ conversationId: conversation.id, limit: 50 }),
    enabled: visible && filesOpen,
    staleTime: 15000,
  });

  const conversationTags = useMemo(() => (conversationTagsQuery.data?.items ?? []).filter((tag) => !tag.isArchived), [conversationTagsQuery.data?.items]);
  const conversationTagIds = useMemo(() => new Set(conversationTags.map((tag) => tag.id)), [conversationTags]);
  const workspaceTags = useMemo(() => [...(workspaceTagsQuery.data?.items ?? [])].sort((a, b) => a.text.localeCompare(b.text)), [workspaceTagsQuery.data?.items]);
  const suggestedTags = useMemo(() => {
    const search = tagInput.trim().toLowerCase();
    return workspaceTags.filter((tag) => !conversationTagIds.has(tag.id) && tag.text.toLowerCase().includes(search));
  }, [workspaceTags, conversationTagIds, tagInput]);
  const mediaAttachments = useMemo(() => (attachmentsQuery.data?.items ?? []).filter((a) => ['IMAGE', 'VIDEO', 'STICKER'].includes(a.mediaType?.toUpperCase?.() ?? '')), [attachmentsQuery.data?.items]);
  const documentAttachments = useMemo(() => (attachmentsQuery.data?.items ?? []).filter((a) => !['IMAGE', 'VIDEO', 'STICKER'].includes(a.mediaType?.toUpperCase?.() ?? '')), [attachmentsQuery.data?.items]);
  const mediaGallery = useMemo(() => mediaAttachments.filter((attachment) => {
    const mediaType = (attachment.mediaType ?? '').toUpperCase();
    return mediaType === 'IMAGE' || mediaType === 'STICKER' || (attachment.mimeType ?? '').toLowerCase().startsWith('image/');
  }).map((attachment) => {
    const raw = attachment.downloadUrl || attachment.previewUrl || attachment.thumbnailUrl;
    const preferred = typeof raw === 'string' ? raw.replace(/\/preview\/?(?:\?.*)?$/i, '/download') : raw;
    const src = apiUrl(preferred ?? null);
    return src ? { attachId: attachment.id, src, mediaType: attachment.mediaType ?? 'IMAGE' } : null;
  }).filter((item): item is MediaGalleryItem => Boolean(item)), [mediaAttachments]);

  const displayPhone = conversation.contact.primaryPhone ?? null;
  const displayPhoneNumber = formatPhoneNumberDisplay(displayPhone) ?? formatPhoneNumberDisplay(conversation.channel.displayPhoneNumber);
  const copyPhoneNumber = displayPhone ?? conversation.channel.displayPhoneNumber ?? displayPhoneNumber ?? null;
  const displayEmail = conversation.contact.primaryEmail ?? null;
  const canEditPhone = conversation.channel.channelType !== 'WHATSAPP';
  const channelType = (conversation.channel.channelType ?? '').toUpperCase();
  const canToggleBan = channelType === 'WHATSAPP' || channelType === 'MESSENGER';
  const serverBlockedAt = conversation.blockedAt ?? null;
  const isBlocked = (optimisticBlockedAt !== undefined ? optimisticBlockedAt : serverBlockedAt) != null;
  const contactTitle = conversation.contact.displayName?.trim() || formatPhoneNumberDisplay(displayPhone) || formatPhoneNumberDisplay(conversation.channel.displayPhoneNumber) || conversation.channel.channelName || 'Contact';

  const notes = useMemo(() => [...(notesQuery.data?.items ?? [])].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()), [notesQuery.data?.items]);

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['conversation-tags', conversation.id] });
    void queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversation.id] });
    void queryClient.invalidateQueries({ queryKey: ['conversation-attachments', conversation.id] });
  }, [conversation.id, queryClient]);

  const phoneMutation = useMutation({
    mutationFn: (primaryPhone: string) => updateCrmContact(conversation.contact.id, { primaryPhone }),
    onSuccess: () => { setEditingPhone(false); setPhoneDraft(''); invalidateAll(); },
    onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not update phone', text2: error.message }),
  });
  const emailMutation = useMutation({
    mutationFn: (primaryEmail: string) => updateCrmContact(conversation.contact.id, { primaryEmail }),
    onSuccess: () => { setEditingEmail(false); setEmailDraft(''); invalidateAll(); },
    onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not update email', text2: error.message }),
  });

  const attachMutation = useMutation({ mutationFn: (tagId: string) => attachConversationTag(conversation.id, tagId), onSuccess: invalidateAll });
  const detachMutation = useMutation({ mutationFn: (tagId: string) => detachConversationTag(conversation.id, tagId), onSuccess: invalidateAll });
  const createTagMutation = useMutation({ mutationFn: () => createConversationTag(conversation.id, { text: tagInput.trim(), color: selectedColor }), onSuccess: () => { setTagInput(''); invalidateAll(); }, onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not create tag', text2: error.message }) });

  const createNoteMutation = useMutation({ mutationFn: (content: string) => createConversationNote(conversation.id, content), onSuccess: () => { setNoteDraft(''); void queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversation.id] }); }, onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not add note', text2: error.message }) });
  const updateNoteMutation = useMutation({ mutationFn: ({ noteId, content }: { noteId: string; content: string }) => updateConversationNote(conversation.id, noteId, content), onSuccess: () => { setEditingNoteId(null); setEditingNoteDraft(''); void queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversation.id] }); }, onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not update note', text2: error.message }) });
  const deleteNoteMutation = useMutation({ mutationFn: (noteId: string) => deleteConversationNote(conversation.id, noteId), onSuccess: () => { setPendingDeleteNoteId(null); void queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversation.id] }); }, onError: (error: Error) => Toast.show({ type: 'error', text1: 'Could not delete note', text2: error.message }) });

  const patchBlockedState = useCallback((blockedAt: string | null) => {
    queryClient.setQueryData(['messages', conversation.id], (current: any) => {
      if (!current?.conversation) return current;
      return {
        ...current,
        conversation: {
          ...current.conversation,
          blockedAt,
          blockedReason: blockedAt ? (current.conversation.blockedReason ?? null) : null,
          contact: {
            ...(current.conversation.contact ?? {}),
            blockedAt,
            blockedReason: blockedAt ? (current.conversation.contact?.blockedReason ?? null) : null,
          },
        },
      };
    });
    queryClient.setQueriesData({ queryKey: ['conversations'] }, (current: any) => {
      if (!current?.pages) return current;
      return {
        ...current,
        pages: current.pages.map((page: any) => ({
          ...page,
          items: (page.items ?? []).map((item: any) => (
            item.id !== conversation.id
              ? item
              : {
                  ...item,
                  blockedAt,
                  blockedReason: blockedAt ? (item.blockedReason ?? null) : null,
                  contact: {
                    ...(item.contact ?? {}),
                    blockedAt,
                    blockedReason: blockedAt ? (item.contact?.blockedReason ?? null) : null,
                  },
                }
          )),
        })),
      };
    });
  }, [conversation.id, queryClient]);

  const banMutation = useMutation({
    mutationFn: async (action: BanAction) => {
      if (!canToggleBan) throw new Error('Only WhatsApp and Messenger customers can be banned.');
      try {
        return action === 'unban' ? await unbanCrmContact(conversation.id) : await banCrmContact(conversation.id);
      } catch (error) {
        if (isApiErrorWithStatus(error, 409)) {
          return null;
        }
        throw error;
      }
    },
    onMutate: (action) => {
      const previous = serverBlockedAt;
      const nextBlockedAt = action === 'unban' ? null : new Date().toISOString();
      setOptimisticBlockedAt(nextBlockedAt);
      patchBlockedState(nextBlockedAt);
      return { previous };
    },
    onSuccess: (data, action, context) => {
      setBanOpen(false);
      const fallbackBlockedAt = data
        ? action === 'unban' ? null : new Date().toISOString()
        : action === 'unban' ? null : (context?.previous ?? new Date().toISOString());
      const nextBlockedAt = getBanResponseBlockedAt(data, fallbackBlockedAt);
      setOptimisticBlockedAt(nextBlockedAt);
      patchBlockedState(nextBlockedAt);
      Toast.show({ type: 'success', text1: nextBlockedAt ? 'Customer banned' : 'Customer unbanned' });
      void queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      if (conversation.contact.id) {
        void queryClient.invalidateQueries({ queryKey: ['crm-contact', conversation.contact.id] });
      }
    },
    onError: (error: Error, _vars, context) => {
      setOptimisticBlockedAt(context?.previous ?? null);
      patchBlockedState(context?.previous ?? null);
      Toast.show({ type: 'error', text1: 'Could not update customer access', text2: error.message || 'Please try again.' });
    },
  });

  const confirmToggleBan = () => {
    if (!canToggleBan || banMutation.isPending) {
      if (!canToggleBan) {
        Toast.show({ type: 'info', text1: 'Only WhatsApp and Messenger customers can be blocked' });
      }
      return;
    }
    setPendingBanAction(isBlocked ? 'unban' : 'ban');
    setBanOpen(true);
  };

  const handleAttach = (tag: ConversationTag) => { if (!conversationTagIds.has(tag.id)) attachMutation.mutate(tag.id); };
  const handleDetach = (tagId: string) => { if (conversationTagIds.has(tagId)) detachMutation.mutate(tagId); };

  const copyPhone = async () => {
    const value = copyPhoneNumber?.trim();
    if (!value) {
      Toast.show({ type: 'info', text1: 'No phone number to copy' });
      return;
    }
    await Clipboard.setStringAsync(value);
    Toast.show({ type: 'copy', text1: 'Phone number copied', position: 'bottom', visibilityTime: 1600 });
  };

  const savePhone = () => { const trimmed = phoneDraft.trim(); if (!trimmed) { setEditingPhone(false); return; } phoneMutation.mutate(trimmed); };
  const saveEmail = () => { const trimmed = emailDraft.trim(); if (!trimmed) { setEditingEmail(false); return; } emailMutation.mutate(trimmed); };

  const saveNote = () => { const content = noteDraft.trim(); if (!content) return; createNoteMutation.mutate(content); };
  const saveEditingNote = () => { if (!editingNoteId) return; const content = editingNoteDraft.trim(); if (!content) return; updateNoteMutation.mutate({ noteId: editingNoteId, content }); };

  const openMedia = (attachment: ConversationAttachment) => {
    const mediaType = (attachment.mediaType ?? '').toUpperCase();
    const mime = (attachment.mimeType ?? '').toLowerCase();
    if (mediaType === 'VIDEO' || mime.startsWith('video/')) {
      setVideoUrl(apiUrl(attachment.downloadUrl ?? attachment.previewUrl ?? null));
      return;
    }
    const index = mediaGallery.findIndex((media) => media.attachId === attachment.id);
    if (index < 0) return;
    setGallery(mediaGallery);
    setGalleryIndex(index);
  };

  const resetState = () => {
    setCustomerOpen(true); setTagsOpen(true); setNotesOpen(true); setFilesOpen(false);
    setTagInput(''); setNoteDraft(''); setEditingNoteId(null); setEditingPhone(false); setEditingEmail(false); setGallery([]); setGalleryIndex(0); setVideoUrl(null);
    setOptimisticBlockedAt(undefined);
    setBanOpen(false);
    setPendingDeleteNoteId(null);
  };
  useEffect(() => { if (visible) resetState(); }, [visible]);

  return (
    <>
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={{ height: '92%' }}>
        <View style={styles.panelBody}>
        <View style={[styles.drawerHeader, { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
          <Text style={[styles.drawerTitle, { color: colors.text }]}>Contact details</Text>
        </View>
        <KeyboardAvoidingView style={styles.panelScroll} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SheetScrollView style={styles.panelScroll} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <Pressable
              onPress={confirmToggleBan}
              disabled={!canToggleBan || banMutation.isPending}
              accessibilityState={{ disabled: !canToggleBan || banMutation.isPending }}
              style={[styles.banAction, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }, (!canToggleBan || banMutation.isPending) && styles.disabled]}
            >
              <Ban color={isBlocked ? colors.error : colors.textSecondary} size={18} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.banActionTitle, { color: isBlocked ? colors.error : colors.text }]}>
                  {isBlocked ? 'Unban customer' : 'Ban customer'}
                </Text>
                <Text style={[styles.banActionHint, { color: colors.textMuted }]}>
                  {canToggleBan
                    ? (isBlocked ? 'Allow this customer to message again' : 'Stop this customer from messaging the business')
                    : 'Only WhatsApp and Messenger customers can be blocked'}
                </Text>
              </View>
            </Pressable>
            <View style={[styles.chatSummaryPill, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={[styles.sparkWrap, { backgroundColor: colors.surfaceSecondary }]}><Sparkles color="#5a83f6" size={15} /></View>
              <Text style={[styles.chatSummaryTitle, { color: colors.text }]}>Chat Summary</Text>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Customer Information</Text>
                <Pressable onPress={() => setCustomerOpen((v) => !v)} hitSlop={8} style={[styles.collapseBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>{customerOpen ? <ChevronUp color={colors.textSecondary} size={16} /> : <ChevronDown color={colors.textSecondary} size={16} />}</Pressable>
              </View>
              {customerOpen ? (
                <View style={[styles.customerBox, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}>
                  <View style={styles.customerTop}>
                    <View style={[styles.customerAvatarWrap, { backgroundColor: colors.surface, borderColor: colors.primaryBorder }]}>
                      <ColorfulAvatar
                        name={contactTitle}
                        size={58}
                        url={conversation.contact.avatarUrl ? (apiUrl(conversation.contact.avatarUrl) ?? conversation.contact.avatarUrl) : null}
                      />
                    </View>
                    <View style={styles.customerIdentity}>
                      <Text style={[styles.customerName, { color: colors.text }]} numberOfLines={1}>{contactTitle}</Text>
                      <Text style={[styles.customerMeta, { color: colors.textSecondary }]} numberOfLines={1}>{conversation.channel.channelName}</Text>
                    </View>
                  </View>
                  <View style={[styles.infoRows, { borderTopColor: colors.separator }]}>
                    <View style={styles.infoRow}>
                      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Phone</Text>
                      {editingPhone ? (
                        <View style={styles.editFieldWrap}>
                          <TextInput value={phoneDraft} onChangeText={setPhoneDraft} autoFocus style={[styles.editInput, { backgroundColor: colors.surface, borderColor: colors.cardBorder, color: colors.text }]} placeholder="Write phone and press done" placeholderTextColor={colors.textMuted} onSubmitEditing={savePhone} />
                          <Pressable onPress={savePhone} hitSlop={6} style={styles.editConfirm}><Check color={colors.primary} size={14} /></Pressable>
                        </View>
                      ) : (
                        <View style={styles.infoValueWrap}>
                          <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>{displayPhoneNumber ?? 'Not available'}</Text>
                          {displayPhoneNumber ? (
                            <Pressable onPress={copyPhone} accessibilityLabel="Copy phone number" hitSlop={8} style={styles.iconBtn}><Copy color={colors.textMuted} size={13} /></Pressable>
                          ) : null}
                          {canEditPhone ? (
                            <Pressable onPress={() => { setPhoneDraft(displayPhone ?? ''); setEditingPhone(true); }} hitSlop={8} style={styles.editBtn}><Pencil color={colors.textMuted} size={13} /></Pressable>
                          ) : null}
                        </View>
                      )}
                    </View>
                    {phoneMutation.isError ? <Text style={[styles.errorText, { color: colors.error }]}>{phoneMutation.error instanceof Error ? phoneMutation.error.message : 'Could not update phone'}</Text> : null}
                    <View style={styles.infoRow}>
                      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Email</Text>
                      {editingEmail ? (
                        <View style={styles.editFieldWrap}>
                          <TextInput value={emailDraft} onChangeText={setEmailDraft} autoFocus keyboardType="email-address" style={[styles.editInput, { backgroundColor: colors.surface, borderColor: colors.cardBorder, color: colors.text }]} placeholder="Write email and press done" placeholderTextColor={colors.textMuted} onSubmitEditing={saveEmail} />
                          <Pressable onPress={saveEmail} hitSlop={6} style={styles.editConfirm}><Check color={colors.primary} size={14} /></Pressable>
                        </View>
                      ) : (
                        <View style={styles.infoValueWrap}>
                          <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>{displayEmail ?? 'Not available'}</Text>
                          <Pressable onPress={() => { setEmailDraft(displayEmail ?? ''); setEditingEmail(true); }} hitSlop={8} style={styles.editBtn}><Pencil color={colors.textMuted} size={13} /></Pressable>
                        </View>
                      )}
                    </View>
                    {emailMutation.isError ? <Text style={[styles.errorText, { color: colors.error }]}>{emailMutation.error instanceof Error ? emailMutation.error.message : 'Could not update email'}</Text> : null}
                  </View>
                </View>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Tags</Text>
                <Pressable onPress={() => setTagsOpen((v) => !v)} hitSlop={8} style={[styles.collapseBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>{tagsOpen ? <ChevronUp color={colors.textSecondary} size={16} /> : <ChevronDown color={colors.textSecondary} size={16} />}</Pressable>
              </View>
              {tagsOpen ? (
                <View style={styles.tagsBody}>
                  {conversationTags.length > 0 ? (
                    <View style={styles.chipRow}>
                      {conversationTags.map((tag) => (
                        <Pressable key={tag.id} onPress={() => handleDetach(tag.id)} style={[styles.chip, { backgroundColor: tag.color ?? '#e8eef7' }]}>
                          <Text style={styles.chipText}>{tag.text}</Text>
                          <Text style={styles.chipRemove}>×</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.emptyText, { color: colors.textMuted }]}>No tags attached yet.</Text>
                  )}
                  <View style={styles.tagSearchWrap}>
                    <TextInput value={tagInput} onChangeText={setTagInput} style={[styles.tagSearchInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]} placeholder="Search or create a tag..." placeholderTextColor={colors.textMuted} />
                    <View style={styles.colorRow}>
                      {TAG_COLOR_OPTIONS.map((color) => (
                        <Pressable key={color} onPress={() => setSelectedColor(color)} style={[styles.colorDot, { backgroundColor: color }, selectedColor === color && [styles.colorDotActive, { borderColor: colors.text }]]} />
                      ))}
                    </View>
                  </View>
                  <ScrollView style={styles.suggestedTagsScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={styles.suggestedTags}>
                    {suggestedTags.map((tag) => (
                      <Pressable key={tag.id} onPress={() => handleAttach(tag)} style={[styles.suggestChip, { borderColor: tag.color ?? colors.cardBorder }]}>
                        <Plus color={tag.color ?? colors.textSecondary} size={12} />
                        <Text style={[styles.suggestChipText, { color: colors.textSecondary }]}>{tag.text}</Text>
                      </Pressable>
                    ))}
                    {tagInput.trim() && !workspaceTagsQuery.isLoading && !suggestedTags.length ? (
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>No available tags match your search.</Text>
                    ) : null}
                  </ScrollView>
                  {tagInput.trim().length > 0 && !workspaceTags.some((tag) => tag.text.toLowerCase() === tagInput.trim().toLowerCase()) ? (
                    <Pressable onPress={() => createTagMutation.mutate()} style={[styles.createTagBtn, { backgroundColor: colors.primary }]}>
                      {createTagMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.createTagText}>Create tag "{tagInput.trim()}"</Text>}
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Notes</Text>
                <Pressable onPress={() => setNotesOpen((v) => !v)} hitSlop={8} style={[styles.collapseBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>{notesOpen ? <ChevronUp color={colors.textSecondary} size={16} /> : <ChevronDown color={colors.textSecondary} size={16} />}</Pressable>
              </View>
              {notesOpen ? (
                <View style={styles.notesBody}>
                  {notesQuery.isLoading ? <PanelSkeleton rows={3} /> : notes.length > 0 ? (
                    notes.map((note) => (
                      <View key={note.id} style={[styles.noteItem, { borderBottomColor: colors.separator }]}>
                        {editingNoteId === note.id ? (
                          <>
                            <TextInput value={editingNoteDraft} onChangeText={setEditingNoteDraft} style={[styles.noteEditInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }, { minHeight: 64 }]} multiline autoFocus />
                            <View style={styles.noteActions}>
                              <Pressable onPress={saveEditingNote} hitSlop={6} style={styles.noteActionBtn}><Text style={[styles.noteActionSave, { color: colors.primary }]}>Save</Text></Pressable>
                              <Pressable onPress={() => { setEditingNoteId(null); setEditingNoteDraft(''); }} hitSlop={6} style={styles.noteActionBtn}><Text style={[styles.noteActionCancel, { color: colors.textMuted }]}>Cancel</Text></Pressable>
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={[styles.noteText, { color: colors.text }]}>{note.content}</Text>
                            <View style={styles.noteMetaRow}>
                              <Text style={[styles.noteMeta, { color: colors.textMuted }]}>{note.author?.userName ?? note.author?.userEmail ?? 'Unknown'}</Text>
                              <View style={styles.noteMetaActions}>
                                <Pressable onPress={() => { setEditingNoteId(note.id); setEditingNoteDraft(note.content); }} hitSlop={8}><Pencil color={colors.textMuted} size={13} /></Pressable>
                                <Pressable onPress={() => setPendingDeleteNoteId(note.id)} hitSlop={8}><Text style={[styles.noteDelete, { color: colors.error }]}>×</Text></Pressable>
                              </View>
                            </View>
                          </>
                        )}
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.emptyText, { color: colors.textMuted }]}>No notes yet.</Text>
                  )}
                  <View style={styles.noteComposer}>
                    <TextInput value={noteDraft} onChangeText={setNoteDraft} style={[styles.noteInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]} placeholder="Add a note..." placeholderTextColor={colors.textMuted} multiline />
                    <Pressable onPress={saveNote} disabled={createNoteMutation.isPending || !noteDraft.trim()} style={[styles.noteAddBtn, { backgroundColor: colors.primary }, (!noteDraft.trim() || createNoteMutation.isPending) && styles.noteAddBtnDisabled]}>
                      {createNoteMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.noteAddText}>Add</Text>}
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Files</Text>
                <Pressable onPress={() => setFilesOpen((v) => !v)} hitSlop={8} style={[styles.collapseBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>{filesOpen ? <ChevronUp color={colors.textSecondary} size={16} /> : <ChevronDown color={colors.textSecondary} size={16} />}</Pressable>
              </View>
              {filesOpen ? (
                <View style={styles.filesBody}>
                  <View style={[styles.filterTabs, { backgroundColor: colors.surfaceSecondary }]}>
                    <Pressable onPress={() => setAttachmentFilter('MEDIA')} style={[styles.filterTab, attachmentFilter === 'MEDIA' && [styles.filterTabActive, { backgroundColor: colors.surface }]]}><Text style={[styles.filterTabText, { color: colors.textSecondary }, attachmentFilter === 'MEDIA' && [styles.filterTabTextActive, { color: colors.text }]]}>Media ({mediaAttachments.length})</Text></Pressable>
                    <Pressable onPress={() => setAttachmentFilter('DOCUMENTS')} style={[styles.filterTab, attachmentFilter === 'DOCUMENTS' && [styles.filterTabActive, { backgroundColor: colors.surface }]]}><Text style={[styles.filterTabText, { color: colors.textSecondary }, attachmentFilter === 'DOCUMENTS' && [styles.filterTabTextActive, { color: colors.text }]]}>Documents ({documentAttachments.length})</Text></Pressable>
                  </View>
                  {attachmentsQuery.isLoading ? <PanelSkeleton rows={3} /> : attachmentFilter === 'MEDIA' ? (
                    mediaAttachments.length > 0 ? (
                      <View style={styles.mediaGrid}>
                        {mediaAttachments.map((attachment) => {
                          const src = apiUrl(attachment.previewUrl ?? attachment.thumbnailUrl ?? attachment.downloadUrl ?? null);
                          return (
                            <Pressable key={attachment.id} onPress={() => openMedia(attachment)} style={styles.mediaTile}>
                              {src ? <AuthenticatedImage url={src} resizeMode="cover" style={styles.mediaThumb} adaptive /> : <View style={[styles.mediaThumb, styles.mediaThumbEmpty, { backgroundColor: colors.surfaceSecondary }]}><Text style={[styles.mediaThumbEmptyText, { color: colors.textMuted }]}>{attachment.mediaType?.[0] ?? '?'}</Text></View>}
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : <Text style={[styles.emptyText, { color: colors.textMuted }]}>No media has been shared in this conversation yet.</Text>
                  ) : documentAttachments.length > 0 ? (
                    documentAttachments.map((attachment) => {
                      const mime = (attachment.mimeType ?? '').toLowerCase();
                      const isAudio = mime.startsWith('audio/') || attachment.mediaType === 'AUDIO' || attachment.mediaType === 'VOICE';
                      const isVideo = attachment.mediaType === 'VIDEO' || mime.startsWith('video/');
                      const isPdf = mime === 'application/pdf' || attachment.originalName?.toLowerCase().endsWith('.pdf');
                      const Icon = isVideo ? Film : isAudio ? Music : isPdf ? FileText : File;
                      return (
                        <View key={attachment.id} style={[styles.docRow, { borderColor: colors.cardBorder }]}>
                          <View style={[styles.docIcon, { backgroundColor: colors.surfaceSecondary }, isPdf && styles.docIconPdf]}>
                            <Icon color={colors.textSecondary} size={16} />
                          </View>
                          <View style={styles.docInfo}>
                            <Text style={[styles.docName, { color: colors.text }]} numberOfLines={1}>{attachment.originalName ?? 'Attachment'}</Text>
                            <Text style={[styles.docMeta, { color: colors.textMuted }]}>{formatAttachmentSize(attachment.sizeBytes) ?? 'Unknown size'}</Text>
                          </View>
                        </View>
                      );
                    })
                  ) : <Text style={[styles.emptyText, { color: colors.textMuted }]}>No documents have been shared in this conversation yet.</Text>}
                </View>
              ) : null}
            </View>
          </SheetScrollView>
        </KeyboardAvoidingView>
        <View style={[styles.statusBar, { backgroundColor: colors.surface, borderTopColor: colors.cardBorder }]}>
          <Pressable onPress={onToggleStatus} disabled={isUpdatingStatus} style={[styles.statusBtn, conversation.status === 'CLOSED' ? [styles.statusBtnClosed, { backgroundColor: colors.surface }] : styles.statusBtnOpen]}>
            {isUpdatingStatus ? <ActivityIndicator color={conversation.status === 'CLOSED' ? colors.primary : '#10b981'} size="small" /> : conversation.status === 'CLOSED' ? <RotateCcw color={colors.primary} size={17} /> : <Check color="#10b981" size={17} />}
            <Text style={[styles.statusBtnText, conversation.status === 'CLOSED' ? [styles.statusBtnTextClosed, { color: colors.primary }] : styles.statusBtnTextOpen]}>{conversation.status === 'CLOSED' ? 'Reopen conversation' : 'Mark as closed'}</Text>
          </Pressable>
        </View>
        </View>
        <Toast config={toastConfig} position="bottom" bottomOffset={28} visibilityTime={1600} />
      </BottomSheet>
      <ConfirmDialog
        visible={banOpen}
        title={pendingBanAction === 'unban' ? 'Unban User' : 'Ban User'}
        body={pendingBanAction === 'unban' ? 'Allow this customer to message again?' : 'Stop this customer from messaging the business?'}
        confirmLabel={pendingBanAction === 'unban' ? 'Unban' : 'Ban'}
        destructive={pendingBanAction === 'ban'}
        loading={banMutation.isPending}
        icon={Ban}
        onClose={() => setBanOpen(false)}
        onConfirm={() => banMutation.mutate(pendingBanAction)}
      />
      <ConfirmDialog
        visible={Boolean(pendingDeleteNoteId)}
        title="Delete note"
        body="Are you sure you want to delete this note?"
        confirmLabel="Delete"
        destructive
        loading={deleteNoteMutation.isPending}
        onClose={() => setPendingDeleteNoteId(null)}
        onConfirm={() => pendingDeleteNoteId && deleteNoteMutation.mutate(pendingDeleteNoteId)}
      />
      <MediaViewer images={gallery} index={galleryIndex} onClose={() => setGallery([])} onIndex={setGalleryIndex} />
      <VideoPlayerModal url={videoUrl} visible={Boolean(videoUrl)} onClose={() => setVideoUrl(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  panelBody: { flex: 1, minHeight: 0 },
  panelScroll: { flex: 1, minHeight: 0 },
  drawerHeader: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: '#e5e7eb', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 16 },
  drawerTitle: { color: '#17233a', fontSize: 17, fontWeight: '700', flex: 1 },
  drawerClose: { alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 18, height: 34, justifyContent: 'center', width: 34 },
  banAction: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 14, paddingHorizontal: 14, paddingVertical: 12 },
  banActionTitle: { fontSize: 14, fontWeight: '700' },
  banActionHint: { fontSize: 12, marginTop: 2 },
  disabled: { opacity: 0.45 },
  chatSummaryPill: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#c9def8', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 14, paddingHorizontal: 14, paddingVertical: 11 },
  sparkWrap: { alignItems: 'center', backgroundColor: '#eef5ff', borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  chatSummaryTitle: { color: '#0d1b2a', flex: 1, fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderColor: '#dfe9f8', borderRadius: 18, borderWidth: 1, marginHorizontal: 16, marginTop: 12, padding: 16 },
  cardHeaderRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { color: '#0f172a', fontSize: 14, fontWeight: '800' },
  collapseBtn: { alignItems: 'center', backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderRadius: 16, borderWidth: 1, height: 32, justifyContent: 'center', width: 32 },
  customerBox: { borderRadius: 18, borderWidth: 1, marginTop: 12, padding: 14 },
  customerTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  customerAvatarWrap: { alignItems: 'center', borderRadius: 26, borderWidth: 2, height: 52, justifyContent: 'center', width: 52 },
  customerAvatar: { borderRadius: 26, height: 52, width: 52 },
  customerAvatarFallback: { alignItems: 'center', backgroundColor: '#2563eb', justifyContent: 'center' },
  customerAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  customerIdentity: { flex: 1, minWidth: 0 },
  customerName: { color: '#0f172a', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  customerMeta: { color: '#64748b', fontSize: 12, fontWeight: '600', marginTop: 3 },
  infoRows: { borderTopColor: '#eef2f7', borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  infoRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, minHeight: 28 },
  infoLabel: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  infoValueWrap: { alignItems: 'center', flexDirection: 'row', gap: 6, maxWidth: '68%' },
  infoValue: { color: '#0f172a', flexShrink: 1, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  iconBtn: { alignItems: 'center', height: 26, justifyContent: 'center', width: 26 },
  editBtn: { alignItems: 'center', height: 26, justifyContent: 'center', width: 26 },
  editFieldWrap: { alignItems: 'center', flexDirection: 'row', gap: 6, maxWidth: '70%' },
  editInput: { backgroundColor: '#fff', borderColor: '#c9def8', borderRadius: 10, borderWidth: 1, color: '#0f172a', flex: 1, fontSize: 12, fontWeight: '600', height: 34, paddingHorizontal: 10 },
  editConfirm: { alignItems: 'center', height: 26, justifyContent: 'center', width: 26 },
  errorText: { color: '#e11d48', fontSize: 11, marginBottom: 6, textAlign: 'right' },
  tagsBody: { marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chipRemove: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
  emptyText: { color: '#94a3b8', fontSize: 12, paddingVertical: 6 },
  tagSearchWrap: { marginTop: 12 },
  tagSearchInput: { backgroundColor: '#f6f9ff', borderColor: '#dbe4f1', borderRadius: 12, borderWidth: 1, color: '#0f172a', fontSize: 13, height: 40, paddingHorizontal: 12 },
  colorRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  colorDot: { borderRadius: 10, height: 22, width: 22 },
  colorDotActive: { borderColor: '#0f172a', borderWidth: 2 },
  suggestedTagsScroll: { maxHeight: 220, marginTop: 12 },
  suggestedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  suggestChip: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  suggestChipText: { color: '#334155', fontSize: 12, fontWeight: '600' },
  createTagBtn: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 12, height: 40, justifyContent: 'center', marginTop: 12 },
  createTagText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  notesBody: { marginTop: 12 },
  noteItem: { borderBottomColor: '#eef2f7', borderBottomWidth: 1, paddingVertical: 10 },
  noteText: { color: '#0f172a', fontSize: 13, lineHeight: 19 },
  noteMetaRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  noteMeta: { color: '#94a3b8', fontSize: 11 },
  noteMetaActions: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  noteDelete: { color: '#e11d48', fontSize: 17, fontWeight: '700' },
  noteEditInput: { backgroundColor: '#f6f9ff', borderColor: '#dbe4f1', borderRadius: 12, borderWidth: 1, color: '#0f172a', fontSize: 13, padding: 10, textAlignVertical: 'top' },
  noteActions: { flexDirection: 'row', gap: 14, marginTop: 8 },
  noteActionBtn: { paddingVertical: 4 },
  noteActionSave: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  noteActionCancel: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  noteComposer: { flexDirection: 'row', gap: 8, marginTop: 12 },
  noteInput: { backgroundColor: '#f6f9ff', borderColor: '#dbe4f1', borderRadius: 12, borderWidth: 1, color: '#0f172a', flex: 1, fontSize: 13, maxHeight: 90, minHeight: 40, paddingHorizontal: 12, paddingVertical: 9 },
  noteAddBtn: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 12, justifyContent: 'center', paddingHorizontal: 16 },
  noteAddBtnDisabled: { opacity: 0.5 },
  noteAddText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  filesBody: { marginTop: 12 },
  filterTabs: { backgroundColor: '#eaf4ff', borderRadius: 18, flexDirection: 'row', gap: 4, padding: 4 },
  filterTab: { alignItems: 'center', borderRadius: 14, flex: 1, paddingVertical: 8 },
  filterTabActive: { backgroundColor: '#fff' },
  filterTabText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  filterTabTextActive: { color: '#334155' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  mediaTile: { aspectRatio: 1, borderRadius: 12, overflow: 'hidden', width: '31.5%' },
  mediaThumb: { height: '100%', width: '100%' },
  mediaThumbEmpty: { alignItems: 'center', backgroundColor: '#e8eef7', justifyContent: 'center' },
  mediaThumbEmptyText: { color: '#94a3b8', fontSize: 18, fontWeight: '700' },
  docRow: { alignItems: 'center', borderRadius: 16, borderColor: '#e4ebf5', borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 10, padding: 10 },
  docIcon: { alignItems: 'center', backgroundColor: '#eef2f7', borderRadius: 12, height: 38, justifyContent: 'center', width: 38 },
  docIconPdf: { backgroundColor: '#fde8e8' },
  docInfo: { flex: 1, minWidth: 0 },
  docName: { color: '#0f172a', fontSize: 12, fontWeight: '700' },
  docMeta: { color: '#94a3b8', fontSize: 10, letterSpacing: 0.4, marginTop: 2, textTransform: 'uppercase' },
  statusBar: { backgroundColor: '#fff', borderTopColor: '#e2e8f0', borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  statusBtn: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 8, height: 48, justifyContent: 'center' },
  statusBtnOpen: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' },
  statusBtnClosed: { backgroundColor: '#fff', borderColor: '#b9ccff' },
  statusBtnText: { fontSize: 15, fontWeight: '700' },
  statusBtnTextOpen: { color: '#10b981' },
  statusBtnTextClosed: { color: '#2563eb' },
  banModalOverlay: { alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.45)', flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  banModalCard: { backgroundColor: '#fff', borderRadius: 28, maxWidth: 420, paddingHorizontal: 22, paddingVertical: 24, width: '100%' },
  banModalClose: { position: 'absolute', right: 14, top: 14, zIndex: 2 },
  banModalIcon: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#fff1f2', borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  banModalTitle: { fontSize: 22, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  banModalBody: { fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  banModalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  banCancelButton: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flex: 1, paddingVertical: 12 },
  banCancelText: { fontSize: 14, fontWeight: '700' },
  banConfirmButton: { alignItems: 'center', borderRadius: 999, flex: 1, paddingVertical: 12 },
  banConfirmText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
