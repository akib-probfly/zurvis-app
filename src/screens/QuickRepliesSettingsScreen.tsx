import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Check,
  ChevronDown,
  MessageSquareText,
  Paperclip,
  PencilLine,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { fontSize, fontWeight, inputHeight, radius, spacing } from '../theme/tokens';
import { AppButton, AppSearchField, ScreenHeader } from '../ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  createQuickReply,
  deleteQuickReply,
  deleteWorkspaceFile,
  fetchQuickRepliesList,
  formatQuickReplyChannelScope,
  channelScopeFromAccountTypes,
  getUnsupportedQuickReplyVariables,
  isQuickReplyImageAttachment,
  quickReplyAttachmentPreviewUrl,
  renderQuickReplyPreview,
  updateQuickReply,
  uploadQuickReplyAttachment,
  type QuickReplyAttachment,
  type QuickReplySnippet,
} from '../api/quickReplies';
import { fetchChannels, type ChannelType } from '../api/channels';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { fetchMyWorkspaces } from '../api/workspaces';
import { ErrorState } from '../components/ErrorState';
import { BottomSheet, SheetFlatList, SheetScrollView } from '../components/BottomSheet';
import { FormSkeleton, ListSkeleton } from '../components/Skeleton';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { ChannelLogo } from '../components/ChannelLogo';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 100;

type ChannelAccountOption = {
  id: string;
  label: string;
  description: string;
  type: ChannelType;
};

type FormState = {
  title: string;
  body: string;
  attachments: QuickReplyAttachment[];
  channelAccountIds: string[];
};

function emptyForm(): FormState {
  return { title: '', body: '', attachments: [], channelAccountIds: [] };
}

function selectedAccountIds(snippet: QuickReplySnippet, accounts: ChannelAccountOption[]) {
  const savedIds = (snippet.channelAccountIds ?? []).filter(Boolean);
  if (savedIds.length > 0) {
    if (accounts.length === 0) return savedIds;
    return savedIds.filter((id) => accounts.some((account) => account.id === id));
  }

  const scope = (snippet.channelScope ?? 'ALL').toUpperCase();
  if (!scope || scope === 'ALL') return [];
  return accounts.filter((account) => account.type === scope).map((account) => account.id);
}

function toForm(snippet: QuickReplySnippet | null, accounts: ChannelAccountOption[]): FormState {
  if (!snippet) return emptyForm();
  return {
    title: snippet.title ?? '',
    body: snippet.body ?? '',
    attachments: snippet.attachments ?? [],
    channelAccountIds: selectedAccountIds(snippet, accounts),
  };
}

export function QuickRepliesSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const styles = useQuickRepliesStyles(colors);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<QuickReplySnippet | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [uploading, setUploading] = useState(false);
  const [newAttachmentIds, setNewAttachmentIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<QuickReplySnippet | null>(null);
  const [channelSearch, setChannelSearch] = useState('');
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);

  const { canManage } = useWorkspaceAccess();
  const workspacesQuery = useQuery({
    queryKey: ['workspaces', 'mine'],
    queryFn: fetchMyWorkspaces,
    staleTime: 30_000,
  });
  const workspaceId = workspacesQuery.data?.items?.[0]?.id;

  const channelsQuery = useQuery({
    queryKey: ['channels'],
    queryFn: fetchChannels,
    enabled: canManage,
    staleTime: 60_000,
  });

  const channelAccountOptions = useMemo<ChannelAccountOption[]>(
    () => (canManage ? channelsQuery.data?.items ?? [] : []).flatMap((channel) =>
      (channel.accounts ?? []).map((account) => ({
        id: account.id,
        label: account.displayName || account.pageName || account.displayPhoneNumber || channel.name,
        description: `${channel.name} · ${channel.type}`,
        type: channel.type,
      })),
    ),
    [canManage, channelsQuery.data?.items],
  );

  const selectedChannelAccounts = useMemo(
    () => channelAccountOptions.filter((account) => form.channelAccountIds.includes(account.id)),
    [channelAccountOptions, form.channelAccountIds],
  );

  const visibleChannelAccounts = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channelAccountOptions;
    return channelAccountOptions.filter((account) =>
      `${account.label} ${account.description}`.toLowerCase().includes(query),
    );
  }, [channelAccountOptions, channelSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const listQuery = useQuery({
    queryKey: ['quick-replies', 'settings', workspaceId, debouncedSearch],
    queryFn: () => fetchQuickRepliesList({ workspaceId, search: debouncedSearch || undefined, limit: 100 }),
    enabled: Boolean(workspaceId),
    staleTime: 20_000,
  });

  const items = listQuery.data?.items ?? [];
  const unsupportedVars = useMemo(() => getUnsupportedQuickReplyVariables(form.body), [form.body]);
  const previewText = useMemo(() => renderQuickReplyPreview(form.body), [form.body]);
  const savingDisabled = uploading || !form.title.trim() || !form.body.trim();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] }),
      queryClient.invalidateQueries({ queryKey: ['quick-replies', 'settings'] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: createQuickReply,
    onSuccess: async () => { await invalidate(); },
  });
  const updateMutation = useMutation({
    mutationFn: updateQuickReply,
    onSuccess: async () => { await invalidate(); },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteQuickReply(id, workspaceId!),
    onSuccess: async () => { await invalidate(); },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setChannelSearch('');
    setChannelPickerOpen(false);
    setNewAttachmentIds([]);
    setEditorOpen(true);
  };

  const openEdit = (snippet: QuickReplySnippet) => {
    setEditing(snippet);
    setForm(toForm(snippet, channelAccountOptions));
    setChannelSearch('');
    setChannelPickerOpen(false);
    setNewAttachmentIds([]);
    setEditorOpen(true);
  };

  useEffect(() => {
    if (!editorOpen || !editing || channelAccountOptions.length === 0) return;
    setForm((current) => {
      if (current.channelAccountIds.length > 0) return current;
      const nextIds = selectedAccountIds(editing, channelAccountOptions);
      if (nextIds.length === 0) return current;
      return { ...current, channelAccountIds: nextIds };
    });
  }, [channelAccountOptions, editing, editorOpen]);

  const cleanupNewAttachments = async (ids: string[]) => {
    await Promise.all(ids.map((id) => deleteWorkspaceFile(id).catch(() => undefined)));
  };

  const closeEditor = () => {
    const pending = newAttachmentIds;
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setNewAttachmentIds([]);
    setChannelSearch('');
    setChannelPickerOpen(false);
    if (pending.length) void cleanupNewAttachments(pending);
  };

  useEffect(() => () => {
    if (newAttachmentIds.length) void cleanupNewAttachments(newAttachmentIds);
  }, []);

  const pickAttachments = async (source: 'image' | 'document') => {
    if (!workspaceId) return;
    const remaining = Math.max(0, MAX_ATTACHMENTS - form.attachments.length);
    if (remaining === 0) {
      Toast.show({ type: 'info', text1: 'Attachment limit', text2: `Quick replies can include up to ${MAX_ATTACHMENTS} attachments.` });
      return;
    }

    let files: Array<{ uri: string; name: string; mimeType: string; size?: number | null }> = [];
    if (source === 'image') {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.85,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (result.canceled) return;
      files = result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName ?? `attachment-${index + 1}`,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        size: asset.fileSize ?? null,
      }));
    } else {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      files = result.assets.slice(0, remaining).map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? null,
      }));
    }

    const uploadable = files.filter((file) => (file.size ?? 0) <= MAX_ATTACHMENT_BYTES || file.size == null);
    const oversized = files.length - uploadable.length;
    if (oversized > 0) {
      Toast.show({ type: 'info', text1: 'Some files are too large', text2: 'Quick reply attachments must be 5 MB or smaller.' });
    }
    if (uploadable.length === 0) return;

    setUploading(true);
    try {
      for (const file of uploadable) {
        const uploaded = await uploadQuickReplyAttachment(workspaceId, file.uri, file.name, file.mimeType);
        const nextAttachment: QuickReplyAttachment = {
          ...uploaded,
          originalName: uploaded.originalName ?? file.name,
          mimeType: uploaded.mimeType ?? file.mimeType,
          localUri: file.uri,
        };
        setNewAttachmentIds((current) => [...current, uploaded.id]);
        setForm((current) => ({
          ...current,
          attachments: [...current.attachments.filter((item) => item.id !== uploaded.id), nextAttachment],
        }));
      }
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Upload failed', text2: error instanceof Error ? error.message : 'Could not upload attachment.' });
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setForm((current) => ({
      ...current,
      attachments: current.attachments.filter((item) => item.id !== attachmentId),
    }));
    if (newAttachmentIds.includes(attachmentId)) {
      setNewAttachmentIds((current) => current.filter((id) => id !== attachmentId));
      void deleteWorkspaceFile(attachmentId).catch(() => undefined);
    }
  };

  const handleSave = async () => {
    if (!workspaceId) return;
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) {
      Toast.show({ type: 'info', text1: 'Missing fields', text2: 'Title and message are required.' });
      return;
    }
    if (unsupportedVars.length > 0) {
      Toast.show({
        type: 'info',
        text1: 'Unsupported variable',
        text2: `${unsupportedVars.join(', ')} ${unsupportedVars.length > 1 ? 'are' : 'is'} not supported. Supported: {{name}}.`,
      });
      return;
    }
    if (uploading) {
      Toast.show({ type: 'info', text1: 'Still uploading', text2: 'Wait for attachments to finish uploading.' });
      return;
    }

    try {
      const attachmentIds = form.attachments.map((item) => item.id);
      const selectedTypes = channelAccountOptions
        .filter((account) => form.channelAccountIds.includes(account.id))
        .map((account) => account.type);
      const channelScope = canManage
        ? channelScopeFromAccountTypes(selectedTypes)
        : channelScopeFromAccountTypes([editing?.channelScope]);
      if (editing) {
        await updateMutation.mutateAsync({
          quickReplyId: editing.id,
          workspaceId,
          title,
          body,
          isActive: true,
          attachmentIds,
          channelScope,
          channelAccountIds: form.channelAccountIds,
        });
      } else {
        await createMutation.mutateAsync({
          workspaceId,
          title,
          body,
          isActive: true,
          attachmentIds,
          channelScope,
          channelAccountIds: form.channelAccountIds,
        });
      }
      setNewAttachmentIds([]);
      setEditorOpen(false);
      setEditing(null);
      setForm(emptyForm());
      Toast.show({ type: 'success', text1: editing ? 'Quick reply updated' : 'Quick reply created' });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: editing ? 'Could not update quick reply' : 'Could not create quick reply',
        text2: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const confirmDelete = (snippet: QuickReplySnippet) => setPendingDelete(snippet);

  const insertNameVariable = () => {
    setForm((current) => ({
      ...current,
      body: current.body ? `${current.body}{{name}}` : '{{name}}',
    }));
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Quick Replies"
        onBack={() => navigation.goBack()}
        right={
          <Pressable style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={openCreate}>
            <Plus color={colors.primaryText} size={18} />
          </Pressable>
        }
      />

      {workspacesQuery.isLoading ? (
        <FormSkeleton fields={4} />
      ) : workspacesQuery.isError || !workspaceId ? (
        <ErrorState
          message={workspacesQuery.error instanceof Error ? workspacesQuery.error.message : 'Unable to load workspace.'}
          onRetry={() => workspacesQuery.refetch()}
        />
      ) : (
        <>
          <View style={[styles.searchRow, { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
            <AppSearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or message"
              size="sm"
              tone="background"
            />
          </View>

          {listQuery.isLoading ? (
            <ListSkeleton rows={6} avatar={false} />
          ) : listQuery.isError ? (
            <ErrorState
              message={listQuery.error instanceof Error ? listQuery.error.message : 'Unable to load quick replies.'}
              onRetry={() => listQuery.refetch()}
            />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
              ListEmptyComponent={(
                <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                  <MessageSquareText color={colors.textMuted} size={28} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No quick replies yet</Text>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>Create a snippet to reuse across conversations.</Text>
                  <AppButton block style={styles.primaryButtonSpacing} icon={Plus} label="Add quick reply" onPress={openCreate} />
                </View>
              )}
              renderItem={({ item }) => (
                <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                  <View style={styles.itemIcon}>
                    <MessageSquareText color={colors.primary} size={18} />
                  </View>
                  <View style={styles.itemCopy}>
                    <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[styles.itemBody, { color: colors.textSecondary }]} numberOfLines={2}>{item.body}</Text>
                    <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                      {formatQuickReplyChannelScope(item.channelScope)}
                      {(item.attachments?.length ?? 0) > 0 ? ` · ${item.attachments.length} attachment${item.attachments.length === 1 ? '' : 's'}` : ''}
                    </Text>
                  </View>
                  <Pressable style={styles.iconButton} onPress={() => openEdit(item)} hitSlop={8}>
                    <PencilLine color={colors.primary} size={18} />
                  </Pressable>
                  <Pressable style={styles.iconButton} onPress={() => confirmDelete(item)} hitSlop={8}>
                    <Trash2 color={colors.error} size={18} />
                  </Pressable>
                </View>
              )}
            />
          )}
        </>
      )}

      <BottomSheet visible={editorOpen} onClose={closeEditor} sheetStyle={styles.sheetSurface}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{editing ? 'Edit quick reply' : 'Create quick reply'}</Text>
            </View>

            <SheetScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
            >
              <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
              <TextInput
                value={form.title}
                onChangeText={(title) => setForm((current) => ({ ...current, title }))}
                placeholder="Greeting"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.cardBorder, color: colors.text }]}
              />

              {canManage ? (
                <>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Channels</Text>
                  <Text style={[styles.helpText, { color: colors.textMuted }]}>
                    Leave empty to make this quick reply available globally. Select one or more channel accounts to target it.
                  </Text>
                  <Pressable
                    onPress={() => setChannelPickerOpen(true)}
                    disabled={channelsQuery.isLoading || channelAccountOptions.length === 0}
                    style={[styles.select, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                  >
                    <Text
                      style={[
                        styles.selectText,
                        { color: form.channelAccountIds.length ? colors.text : colors.textMuted },
                      ]}
                      numberOfLines={1}
                    >
                      {channelsQuery.isLoading
                        ? 'Loading channel accounts...'
                        : channelsQuery.isError
                          ? 'Could not load channels'
                          : channelAccountOptions.length === 0
                            ? 'No connected channel accounts found'
                            : form.channelAccountIds.length === 0
                              ? 'Select channel accounts'
                              : `${form.channelAccountIds.length} channel account${form.channelAccountIds.length === 1 ? '' : 's'} selected`}
                    </Text>
                    <ChevronDown color={colors.textMuted} size={18} />
                  </Pressable>
                  {selectedChannelAccounts.length > 0 ? (
                    <View style={styles.chipWrap}>
                      {selectedChannelAccounts.map((account) => (
                        <Pressable
                          key={account.id}
                          onPress={() => setForm((current) => ({
                            ...current,
                            channelAccountIds: current.channelAccountIds.filter((id) => id !== account.id),
                          }))}
                          style={[styles.selectedChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}
                        >
                          <ChannelLogo type={account.type} box={20} glyph={12} radius={6} />
                          <Text style={[styles.selectedChipText, { color: colors.text }]} numberOfLines={1}>{account.label}</Text>
                          <X color={colors.textMuted} size={12} />
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.channelStatus, { color: colors.primary }]}>Global quick reply</Text>
                  )}

                </>
              ) : (
                <Text style={[styles.helpText, { color: colors.textMuted }]}>
                  {editing ? 'The existing channel scope will be kept.' : 'This quick reply will be available globally.'}
                </Text>
              )}

              <View style={styles.labelRow}>
                <Text style={[styles.labelInline, { color: colors.textSecondary }]}>Message</Text>
                <Pressable style={styles.variableChip} onPress={insertNameVariable}>
                  <Plus color={colors.primary} size={12} />
                  <Text style={[styles.variableChipText, { color: colors.primary }]}>{'{{name}}'}</Text>
                </Pressable>
              </View>
              <TextInput
                value={form.body}
                onChangeText={(body) => setForm((current) => ({ ...current, body }))}
                placeholder="Hi {{name}}, thanks for reaching out..."
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.textArea, { backgroundColor: colors.background, borderColor: colors.cardBorder, color: colors.text }]}
                multiline
                textAlignVertical="top"
              />
              {unsupportedVars.length > 0 ? (
                <Text style={styles.errorText}>Unsupported: {unsupportedVars.join(', ')}. Only {'{{name}}'} is supported.</Text>
              ) : null}

              <Text style={[styles.label, { color: colors.textSecondary }]}>Attachments</Text>
              <View style={styles.attachActions}>
                <Pressable style={styles.secondaryButton} onPress={() => void pickAttachments('image')} disabled={uploading}>
                  <Paperclip color={colors.primary} size={16} />
                  <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Photos</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void pickAttachments('document')} disabled={uploading}>
                  <Paperclip color={colors.primary} size={16} />
                  <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Files</Text>
                </Pressable>
              </View>
              {uploading ? <ActivityIndicator color={colors.primary} style={styles.uploadIndicator} /> : null}
              {form.attachments.map((attachment) => {
                const previewUrl = quickReplyAttachmentPreviewUrl(attachment);
                const showImage = Boolean(previewUrl) && isQuickReplyImageAttachment(attachment);
                return (
                  <View key={attachment.id} style={[styles.attachmentRow, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
                    {showImage ? (
                      <AuthenticatedImage url={previewUrl} style={styles.attachmentThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.attachmentThumb, styles.attachmentThumbFallback, { backgroundColor: colors.surfaceSecondary }]}>
                        <Paperclip color={colors.textMuted} size={14} />
                      </View>
                    )}
                    <Text style={[styles.attachmentName, { color: colors.textSecondary }]} numberOfLines={1}>
                      {attachment.originalName || attachment.id}
                    </Text>
                    <Pressable onPress={() => removeAttachment(attachment.id)} hitSlop={8}>
                      <X color={colors.error} size={16} />
                    </Pressable>
                  </View>
                );
              })}

              <Text style={[styles.label, { color: colors.textSecondary }]}>Preview</Text>
              <View style={[styles.previewStage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                {(() => {
                  const imageAttachments = form.attachments.filter(isQuickReplyImageAttachment);
                  const fileAttachments = form.attachments.filter((attachment) => !isQuickReplyImageAttachment(attachment));
                  const hasBody = previewText.trim().length > 0;
                  return (
                    <View style={[styles.previewBubble, { backgroundColor: colors.primary }]}>
                      {imageAttachments.length === 1 ? (() => {
                        const previewUrl = quickReplyAttachmentPreviewUrl(imageAttachments[0]);
                        if (!previewUrl) return null;
                        return <AuthenticatedImage url={previewUrl} style={styles.previewImage} resizeMode="cover" />;
                      })() : imageAttachments.length > 1 ? (
                        <View style={styles.previewImageGrid}>
                          {imageAttachments.map((attachment) => {
                            const previewUrl = quickReplyAttachmentPreviewUrl(attachment);
                            if (!previewUrl) return null;
                            return <AuthenticatedImage key={attachment.id} url={previewUrl} style={styles.previewImageCell} resizeMode="cover" adaptive />;
                          })}
                        </View>
                      ) : null}
                      {hasBody ? (
                        <Text style={styles.previewText}>{previewText}</Text>
                      ) : imageAttachments.length === 0 && fileAttachments.length === 0 ? (
                        <Text style={styles.previewPlaceholder}>Your message will look like this…</Text>
                      ) : null}
                      {fileAttachments.map((attachment) => (
                        <View key={attachment.id} style={styles.previewFileRow}>
                          <Paperclip color={colors.primaryText} size={15} />
                          <Text style={styles.previewFileName} numberOfLines={1}>{attachment.originalName || attachment.id}</Text>
                        </View>
                      ))}
                      <View style={styles.previewMeta}>
                        <Text style={styles.previewMetaText}>Sent</Text>
                        <Check color={colors.primaryText} size={13} />
                        <Text style={styles.previewMetaText}>{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                      </View>
                    </View>
                  );
                })()}
              </View>
            </SheetScrollView>

            <AppButton
              block
              style={styles.primaryButtonSpacing}
              label={editing ? 'Save changes' : 'Create quick reply'}
              loading={createMutation.isPending || updateMutation.isPending}
              disabled={savingDisabled}
              onPress={() => void handleSave()}
            />
        </BottomSheet>
      <BottomSheet
        visible={channelPickerOpen}
        onClose={() => setChannelPickerOpen(false)}
        sheetStyle={styles.sheetSurface}
      >
        <Text style={[styles.sheetTitle, { color: colors.text }]}>Select channel accounts</Text>
        <TextInput
          value={channelSearch}
          onChangeText={setChannelSearch}
          placeholder="Search channel accounts"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.channelSearchInput, { backgroundColor: colors.background, borderColor: colors.cardBorder, color: colors.text }]}
        />
        <SheetFlatList
          data={visibleChannelAccounts}
          keyExtractor={(item) => item.id}
          style={styles.channelList}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <Text style={[styles.helpText, styles.channelEmptyText, { color: colors.textMuted }]}>
              {channelAccountOptions.length === 0 ? 'No connected channel accounts found' : 'No matching channel accounts'}
            </Text>
          )}
          renderItem={({ item }) => {
            const selected = form.channelAccountIds.includes(item.id);
            return (
              <Pressable
                onPress={() => setForm((current) => ({
                  ...current,
                  channelAccountIds: selected
                    ? current.channelAccountIds.filter((id) => id !== item.id)
                    : [...current.channelAccountIds, item.id],
                }))}
                style={[styles.channelRow, { backgroundColor: selected ? colors.surfaceSecondary : colors.background, borderColor: selected ? colors.primary : colors.cardBorder }]}
              >
                <ChannelLogo type={item.type} box={32} glyph={18} radius={10} />
                <View style={styles.channelCopy}>
                  <Text style={[styles.channelLabel, { color: colors.text }]} numberOfLines={1}>{item.label}</Text>
                  <Text style={[styles.channelMeta, { color: colors.textMuted }]} numberOfLines={1}>{item.description}</Text>
                </View>
                {selected ? <Check color={colors.primary} size={16} /> : null}
              </Pressable>
            );
          }}
        />
        <AppButton
          block
          style={styles.primaryButtonSpacing}
          label="Done"
          onPress={() => setChannelPickerOpen(false)}
        />
      </BottomSheet>
      <ConfirmDialog
        visible={Boolean(pendingDelete)}
        title="Delete quick reply"
        body={pendingDelete ? `Delete “${pendingDelete.title}”? This cannot be undone.` : ''}
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          void deleteMutation.mutateAsync({ id: pendingDelete.id }).then(
            () => setPendingDelete(null),
            (error: Error) => Toast.show({ type: 'error', text1: 'Could not delete', text2: error.message }),
          );
        }}
      />
    </View>
  );
}

function useQuickRepliesStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1 },
  addButton: { alignItems: 'center', borderRadius: radius.pill, height: 36, justifyContent: 'center', width: 36 },
  loader: { marginTop: 60 },
  searchRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  listContent: { gap: spacing.sm, padding: spacing.lg },
  emptyCard: { alignItems: 'center', borderRadius: radius.xl, borderWidth: 1, padding: spacing.xxxl },
  emptyTitle: { fontSize: fontSize.body, fontWeight: fontWeight.extrabold, marginTop: spacing.md },
  emptyBody: { fontSize: fontSize.caption, marginBottom: spacing.lg, marginTop: spacing.xs, textAlign: 'center' },
  itemCard: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  itemIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.md, height: 40, justifyContent: 'center', width: 40 },
  itemCopy: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: fontSize.body, fontWeight: fontWeight.bold },
  itemBody: { fontSize: fontSize.small, marginTop: spacing.xs / 2 },
  itemMeta: { fontSize: fontSize.tiny, marginTop: spacing.xs },
  iconButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  primaryButtonSpacing: { marginTop: spacing.md },
  disabled: { opacity: 0.55 },
  sheetOverlay: { backgroundColor: `${colors.text}73`, flex: 1, justifyContent: 'flex-end' },
  sheetSurface: { maxHeight: '100%', paddingBottom: spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { fontSize: fontSize.heading, fontWeight: fontWeight.extrabold },
  sheetScroll: { flexGrow: 1, flexShrink: 1 },
  sheetContent: { paddingBottom: spacing.sm },
  label: { fontSize: fontSize.small, fontWeight: fontWeight.bold, marginBottom: spacing.sm, marginTop: spacing.md },
  labelInline: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, marginTop: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, minHeight: inputHeight, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  textArea: { minHeight: 110 },
  variableChip: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.pill, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  variableChipText: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  helpText: { fontSize: fontSize.small, lineHeight: fontSize.small * 1.5, marginBottom: spacing.sm },
  select: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: inputHeight, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  selectText: { flex: 1, fontSize: fontSize.small, marginRight: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  selectedChip: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, maxWidth: '100%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  selectedChipText: { flexShrink: 1, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  channelList: { flexGrow: 0, marginTop: spacing.sm, maxHeight: 360 },
  channelRow: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  channelCopy: { flex: 1, minWidth: 0 },
  channelLabel: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  channelMeta: { fontSize: fontSize.tiny, marginTop: spacing.xs / 2 },
  channelStatus: { fontSize: fontSize.small, fontWeight: fontWeight.bold, marginTop: spacing.sm },
  errorText: { color: colors.error, fontSize: fontSize.small, marginTop: spacing.xs },
  attachActions: { flexDirection: 'row', gap: spacing.sm },
  secondaryButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.md, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  secondaryButtonText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  attachmentRow: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  attachmentThumb: { borderRadius: radius.sm, height: 44, marginRight: spacing.sm, width: 44 },
  attachmentThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  attachmentName: { flex: 1, fontSize: fontSize.caption, marginRight: spacing.sm },
  previewStage: { borderRadius: radius.xl, borderWidth: 1, marginBottom: spacing.xs, padding: spacing.md },
  previewBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.sm, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, elevation: 1, maxWidth: '85%', overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, shadowColor: colors.text, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10 },
  previewText: { color: colors.primaryText, fontSize: fontSize.body },
  previewPlaceholder: { color: colors.primaryText, fontSize: fontSize.caption, fontStyle: 'italic', opacity: 0.82 },
  previewImage: { borderRadius: radius.md, height: 180, marginBottom: spacing.sm, width: '100%' },
  previewImageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  previewImageCell: { borderRadius: radius.sm, height: 76, width: 76 },
  previewFileRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  previewFileName: { color: colors.primaryText, flex: 1, fontSize: fontSize.caption, fontWeight: fontWeight.semibold, opacity: 0.82 },
  previewMeta: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'flex-end', marginTop: spacing.xs },
  previewMetaText: { color: colors.primaryText, fontSize: fontSize.tiny, opacity: 0.82 },
  uploadIndicator: { marginTop: spacing.sm },
  channelSearchInput: { marginTop: spacing.md },
  channelEmptyText: { marginTop: spacing.lg },
  });
}
