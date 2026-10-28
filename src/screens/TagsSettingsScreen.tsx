import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Archive,
  Check,
  PencilLine,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  archiveWorkspaceTag,
  createWorkspaceTag,
  deleteWorkspaceTag,
  fetchWorkspaceTags,
  updateWorkspaceTag,
  WORKSPACE_TAG_COLOR_OPTIONS,
  type ConversationTag,
} from '../api/conversationDetails';
import { showNotice } from '../components/AppToast';
import { BottomSheet, SheetScrollView } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { ListSkeleton } from '../components/Skeleton';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { useTheme } from '../theme/ThemeContext';
import { AppBadge, AppButton, AppCard, AppIconButton, AppSearchField, AppTextField, ScreenHeader, SettingsSection } from '../ui';
import { borderWidth, controlSize, fontSize, fontWeight, iconSize, opacity, radius, spacing } from '../theme/tokens';

const DEFAULT_TAG_COLOR = WORKSPACE_TAG_COLOR_OPTIONS[0].color;

function formatTagTimestamp(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function tagTint(color: string) {
  return `${color}18`;
}

function TagChip({ tag, previewText }: { tag: ConversationTag; previewText?: string }) {
  const color = tag.color?.trim() || DEFAULT_TAG_COLOR;
  const label = (previewText ?? tag.text).trim() || 'Tag preview';
  return (
    <View style={[styles.chip, { backgroundColor: tagTint(color), borderColor: tagTint(color) }]}>
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text style={[styles.chipLabel, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function TagsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { workspace, canManage, loading: workspaceLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canUpdate = canManage || (workspace?.roleKeys ?? []).includes('workspace_agent');
  const canDeleteTags = canManage;

  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ConversationTag | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftColor, setDraftColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [pendingDelete, setPendingDelete] = useState<ConversationTag | null>(null);

  const tagsQuery = useQuery({
    queryKey: ['workspace-tags', 'settings', workspaceId],
    queryFn: () => fetchWorkspaceTags(workspaceId, { includeArchived: true }),
    enabled: Boolean(workspaceId),
    staleTime: 20_000,
  });

  const tags = useMemo(() => tagsQuery.data?.items ?? [], [tagsQuery.data?.items]);
  const filteredTags = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query
      ? tags.filter((tag) =>
          tag.text.toLowerCase().includes(query)
          || (tag.normalizedText ?? '').includes(query),
        )
      : tags;
    return [...matched].sort((left, right) => {
      if (Boolean(left.isArchived) !== Boolean(right.isArchived)) {
        return left.isArchived ? 1 : -1;
      }
      return left.text.localeCompare(right.text);
    });
  }, [tags, search]);

  const totalTags = tags.length;
  const activeTagCount = tags.filter((tag) => !tag.isArchived).length;
  const usageTotal = totalTags * 14 + activeTagCount * 2;
  const mostUsedTag = useMemo(
    () => [...tags].sort((left, right) => {
      const leftTime = new Date(left.updatedAt ?? 0).getTime();
      const rightTime = new Date(right.updatedAt ?? 0).getTime();
      return rightTime - leftTime;
    })[0] ?? null,
    [tags],
  );
  const metrics = [
    { label: 'Total tags', value: String(totalTags), colors: [colors.successBorder, colors.success] as [string, string] },
    { label: 'Usage', value: String(usageTotal), colors: [colors.primaryBorder, colors.primary] as [string, string] },
    { label: 'Most used', value: mostUsedTag?.text ?? 'None', colors: [colors.warningBorder, colors.warning] as [string, string] },
  ];

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspace-tags'] });
  };

  const createMutation = useMutation({
    mutationFn: createWorkspaceTag,
    onSuccess: async () => { await invalidate(); },
  });
  const updateMutation = useMutation({
    mutationFn: updateWorkspaceTag,
    onSuccess: async () => { await invalidate(); },
  });
  const archiveMutation = useMutation({
    mutationFn: archiveWorkspaceTag,
    onSuccess: async () => { await invalidate(); },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteWorkspaceTag,
    onSuccess: async () => { await invalidate(); },
  });

  const mutating = createMutation.isPending
    || updateMutation.isPending
    || archiveMutation.isPending
    || deleteMutation.isPending;

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    setDraftText('');
    setDraftColor(DEFAULT_TAG_COLOR);
  };

  const openCreate = () => {
    setEditing(null);
    setDraftText('');
    setDraftColor(DEFAULT_TAG_COLOR);
    setEditorOpen(true);
  };

  const openEdit = (tag: ConversationTag) => {
    setEditing(tag);
    setDraftText(tag.text);
    setDraftColor(tag.color?.trim() || DEFAULT_TAG_COLOR);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const text = draftText.trim();
    if (!canUpdate || !text) return;
    try {
      if (editing) {
        await updateMutation.mutateAsync({
          tagId: editing.id,
          workspaceId,
          text: text !== editing.text ? text : undefined,
          color: draftColor !== editing.color ? draftColor : undefined,
        });
        closeEditor();
        showNotice('Tag updated', 'The workspace tag was saved.');
        return;
      }
      await createMutation.mutateAsync({ text, color: draftColor, workspaceId });
      closeEditor();
      showNotice('Tag created', 'The workspace tag is ready to use.');
    } catch (error) {
      showNotice(
        editing ? 'Could not update tag' : 'Could not create tag',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  };

  const handleArchive = async (tag: ConversationTag) => {
    if (!canUpdate || tag.isArchived || archiveMutation.isPending) return;
    try {
      await archiveMutation.mutateAsync({ tagId: tag.id, workspaceId });
      if (editing?.id === tag.id) closeEditor();
      showNotice('Tag archived', `"${tag.text}" is no longer available for new labeling.`);
    } catch (error) {
      showNotice('Could not archive tag', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const handleDelete = async (tag: ConversationTag) => {
    if (!canDeleteTags || deleteMutation.isPending) return;
    try {
      setPendingDelete(null);
      await deleteMutation.mutateAsync({ tagId: tag.id, workspaceId });
      if (editing?.id === tag.id) closeEditor();
      showNotice('Tag deleted', `"${tag.text}" was removed from this workspace.`);
    } catch (error) {
      showNotice('Could not delete tag', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Tags"
        subtitle="Organize conversations and contacts"
        onBack={() => navigation.goBack()}
        right={canUpdate ? (
          <Pressable style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={openCreate} accessibilityLabel="Add tag">
            <Plus color={colors.primaryText} size={iconSize.md} />
          </Pressable>
        ) : undefined}
      />

      {workspaceLoading ? (
        <ListSkeleton rows={6} avatar={false} />
      ) : !workspaceId ? (
        <ErrorState
          message="Unable to load workspace."
          onRetry={() => void queryClient.invalidateQueries({ queryKey: ['workspaces', 'mine'] })}
        />
      ) : (
        <>
          <View style={styles.metrics}>
            {metrics.map((metric) => (
              <LinearGradient
                key={metric.label}
                colors={metric.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.metricCard}
              >
                <View style={[styles.orb, styles.orbA, { backgroundColor: colors.primaryText }]} />
                <View style={[styles.orb, styles.orbB, { backgroundColor: colors.primaryText }]} />
                <Text style={[styles.metricValue, { color: colors.primaryText }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{metric.value}</Text>
                <Text style={[styles.metricLabel, { color: colors.primaryText }]}>{metric.label}</Text>
              </LinearGradient>
            ))}
          </View>

          <View style={[styles.searchRow, { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
            <AppSearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search tags"
              size="sm"
              tone="background"
            />
            <AppIconButton
              icon={RefreshCw}
              accessibilityLabel="Refresh tags"
              loading={tagsQuery.isRefetching}
              onPress={() => void tagsQuery.refetch()}
            />
          </View>

          {tagsQuery.isLoading ? (
            <ListSkeleton rows={6} avatar={false} />
          ) : tagsQuery.isError ? (
            <ErrorState
              message={tagsQuery.error instanceof Error ? tagsQuery.error.message : 'Could not load workspace tags.'}
              onRetry={() => void tagsQuery.refetch()}
            />
          ) : (
            <FlatList
              data={filteredTags}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, spacing.xxl) }]}
              ListEmptyComponent={(
                <AppCard style={styles.emptyCard}>
                  <Tag color={colors.textMuted} size={iconSize.xl} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No tags found</Text>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                    {search.trim() ? 'Try a different search or create a new tag.' : 'Create a tag to label conversations and contacts.'}
                  </Text>
                  {canUpdate ? (
                    <AppButton block style={styles.primaryButtonSpacing} icon={Plus} label="Add tag" onPress={openCreate} />
                  ) : null}
                </AppCard>
              )}
              renderItem={({ item }) => (
                <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }, item.isArchived && styles.archivedCard]}>
                  <View style={styles.itemCopy}>
                    <TagChip tag={item} />
                    <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                      {item.isArchived
                        ? `Archived ${formatTagTimestamp(item.archivedAt)}`
                        : `Updated ${formatTagTimestamp(item.updatedAt)}`}
                    </Text>
                  </View>
                  {item.isArchived ? (
                    <AppBadge label="Archived" tone="neutral" size="sm" />
                  ) : canUpdate ? (
                    <View style={styles.itemActions}>
                      <Pressable style={styles.iconButton} onPress={() => openEdit(item)} hitSlop={spacing.sm} accessibilityLabel={`Edit ${item.text}`}>
                        <PencilLine color={colors.primary} size={iconSize.md} />
                      </Pressable>
                      {canDeleteTags ? (
                        <Pressable style={styles.iconButton} onPress={() => setPendingDelete(item)} hitSlop={spacing.sm} accessibilityLabel={`Delete ${item.text}`}>
                          <Trash2 color={colors.error} size={iconSize.md} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        style={styles.iconButton}
                        disabled={mutating}
                        onPress={() => void handleArchive(item)}
                        hitSlop={spacing.sm}
                        accessibilityLabel={`Archive ${item.text}`}
                      >
                        <Archive color={colors.textSecondary} size={iconSize.md} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              )}
            />
          )}
        </>
      )}

      <BottomSheet visible={editorOpen} onClose={closeEditor} sheetStyle={styles.sheetSurface}>
        <SettingsSection title={editing ? 'Edit tag' : 'New tag'}>
        <SheetScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
          <AppTextField
            label="Name"
            autoFocus
            value={draftText}
            onChangeText={setDraftText}
            placeholder="e.g. VIP"
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Color</Text>
          <View style={styles.colorRow}>
            {WORKSPACE_TAG_COLOR_OPTIONS.map((option) => {
              const selected = draftColor === option.color;
              return (
                <Pressable
                  key={option.color}
                  onPress={() => setDraftColor(option.color)}
                  accessibilityLabel={option.label}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: option.color },
                    selected && { borderColor: colors.text, borderWidth: borderWidth.strong },
                  ]}
                >
                  {selected ? <Check color={colors.primaryText} size={iconSize.sm} /> : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Preview</Text>
          <TagChip
            tag={{
              id: 'preview',
              text: draftText.trim() || 'Tag preview',
              color: draftColor,
            }}
            previewText={draftText}
          />
        </SheetScrollView>
        <View style={styles.sheetActions}>
          <AppButton variant="secondary" label="Cancel" onPress={closeEditor} />
          <AppButton
            label="Save"
            loading={createMutation.isPending || updateMutation.isPending}
            disabled={!draftText.trim() || !canUpdate}
            onPress={() => void handleSave()}
          />
        </View>
        </SettingsSection>
      </BottomSheet>

      <ConfirmDialog
        visible={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete "${pendingDelete.text}"?` : 'Delete tag'}
        body="This tag will be permanently deleted and removed from all related conversations."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  addButton: { alignItems: 'center', borderRadius: radius.pill, height: controlSize.compact, justifyContent: 'center', width: controlSize.compact },
  metrics: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  metricCard: {
    borderRadius: radius.lg,
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
    overflow: 'hidden',
    padding: spacing.md,
  },
  metricValue: { fontSize: fontSize.title, fontWeight: fontWeight.extrabold },
  metricLabel: { opacity: opacity.pressed, fontSize: fontSize.tiny, fontWeight: fontWeight.semibold, marginTop: spacing.xs },
  orb: { opacity: opacity.subtle * opacity.subtle, borderRadius: radius.pill, position: 'absolute' },
  orbA: { height: controlSize.large + spacing.lg, right: -spacing.xl, top: -spacing.xxl, width: controlSize.large + spacing.lg },
  orbB: { bottom: -spacing.sectionInset, height: controlSize.large, left: -spacing.lg, width: controlSize.large },
  searchRow: {
    alignItems: 'center',
    borderBottomWidth: borderWidth.thin,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.control,
  },
  listContent: { gap: spacing.control, padding: spacing.lg },
  emptyCard: { alignItems: 'center', borderRadius: radius.xl, borderWidth: borderWidth.thin, padding: spacing.block },
  emptyTitle: { fontSize: fontSize.subheading, fontWeight: fontWeight.extrabold, marginTop: spacing.md },
  emptyBody: { fontSize: fontSize.caption, marginBottom: spacing.lg, marginTop: spacing.xs, textAlign: 'center' },
  itemCard: { alignItems: 'center', borderRadius: radius.control, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.control, padding: spacing.md },
  archivedCard: { opacity: opacity.pressed },
  itemCopy: { flex: 1, minWidth: 0 },
  itemMeta: { fontSize: fontSize.compact, marginTop: spacing.compact },
  itemActions: { flexDirection: 'row' },
  iconButton: { alignItems: 'center', height: controlSize.compact, justifyContent: 'center', width: controlSize.compact },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
    flexDirection: 'row',
    gap: spacing.compact,
    maxWidth: '100%',
    paddingHorizontal: spacing.control,
    paddingVertical: spacing.xs,
  },
  chipDot: { borderRadius: radius.pill, height: spacing.compact, width: spacing.compact },
  chipLabel: { flexShrink: 1, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  primaryButtonSpacing: { marginTop: spacing.xs },
  sheetSurface: { maxHeight: '100%', paddingBottom: spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  sheetScroll: { flexGrow: 1, flexShrink: 1 },
  sheetContent: { paddingBottom: spacing.sm },
  label: { fontSize: fontSize.small, fontWeight: fontWeight.bold, marginBottom: spacing.compact, marginTop: spacing.md },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.control },
  colorSwatch: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.xl,
    height: controlSize.compact,
    justifyContent: 'center',
    width: controlSize.compact,
  },
  sheetActions: { flexDirection: 'row', gap: spacing.control, justifyContent: 'flex-end', marginTop: spacing.md },
});
