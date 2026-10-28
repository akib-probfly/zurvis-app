import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, Pencil, Plus, RefreshCw, Trash2, Unlink } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { AppButton, AppChip, AppIconButton, AppSearchField, EmptyState } from '../ui';
import {
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  fetchWhatsappTemplates,
  syncWhatsappTemplates,
  unlinkWhatsappTemplate,
  updateWhatsappTemplate,
  type WhatsappTemplate,
  type WhatsappTemplateCategory,
  type WhatsappTemplateFormValues,
  type WhatsappTemplateStatus,
} from '../api/whatsappTemplates';
import { formatTemplateUpdatedAt, makeDraftTemplate, mapTemplateToForm } from '../lib/whatsapp-template-utils';
import { ConfirmDialog } from './ConfirmDialog';
import { ListSkeleton } from './Skeleton';
import { WhatsappTemplateSheet, type TemplateSheetMode } from './WhatsappTemplateSheet';
import { useTheme } from '../theme/ThemeContext';

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  APPROVED: { bg: '#e8fbf3', fg: '#047857' },
  PENDING: { bg: '#fff7df', fg: '#b45309' },
  PROCESSING: { bg: '#fff7df', fg: '#b45309' },
  FAILED: { bg: '#ffe4e6', fg: '#be123c' },
  REJECTED: { bg: '#ffe4e6', fg: '#be123c' },
  DELETED: { bg: '#f1f5f9', fg: '#64748b' },
  PAUSED: { bg: '#ffedd5', fg: '#c2410c' },
  DRAFT: { bg: '#f1f5f9', fg: '#64748b' },
};

const STATUS_FILTERS: Array<{ id: WhatsappTemplateStatus | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'REJECTED', label: 'Rejected' },
];

const CATEGORY_FILTERS: Array<{ id: WhatsappTemplateCategory | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'Any category' },
  { id: 'MARKETING', label: 'Marketing' },
  { id: 'UTILITY', label: 'Utility' },
  { id: 'AUTHENTICATION', label: 'Auth' },
];

type SheetState =
  | { mode: 'view'; template: WhatsappTemplate }
  | { mode: 'edit'; template: WhatsappTemplate; form: WhatsappTemplateFormValues }
  | { mode: 'create'; form: WhatsappTemplateFormValues }
  | null;

type TemplateCardProps = {
  template: WhatsappTemplate;
  onView: (template: WhatsappTemplate) => void;
  onEdit: (template: WhatsappTemplate) => void;
  onUnlink: (template: WhatsappTemplate) => void;
  onDelete: (template: WhatsappTemplate) => void;
};

const TemplateCard = memo(function TemplateCard({ template, onView, onEdit, onUnlink, onDelete }: TemplateCardProps) {
  const { colors } = useTheme();
  const tone = STATUS_TONE[template.status] ?? STATUS_TONE.DRAFT;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
      <View style={[styles.cardHead, { borderBottomColor: colors.separator }]}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>{template.name}</Text>
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.badgeText, { color: tone.fg }]}>{template.status}</Text>
          </View>
        </View>
        <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
          {template.category} · {template.language} · Updated {formatTemplateUpdatedAt(template.updatedAt)}
        </Text>
      </View>
      <Text style={[styles.cardBody, { color: colors.textSecondary }]} numberOfLines={2}>{template.body || 'No body content'}</Text>
      {template.status === 'REJECTED' && template.rejectionReason ? (
        <Text style={[styles.rejection, { color: colors.error }]} numberOfLines={2}>Rejected: {template.rejectionReason}</Text>
      ) : null}
      <View style={styles.cardActions}>
        <Pressable style={styles.actionButton} onPress={() => onView(template)}>
          <Eye color={colors.primary} size={14} />
          <Text style={[styles.actionText, { color: colors.primary }]}>View</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => onEdit(template)}>
          <Pencil color={colors.primary} size={14} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
        </Pressable>
        {template.source === 'remote' ? (
          <Pressable style={styles.actionButton} onPress={() => onUnlink(template)}>
            <Unlink color={colors.error} size={14} />
            <Text style={[styles.actionText, { color: colors.error }]}>Unlink</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.actionButton} onPress={() => onDelete(template)}>
            <Trash2 color={colors.error} size={14} />
            <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});

export function WhatsappTemplatesTab({ channelId, channelName }: { channelId: string; channelName: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ['whatsapp-templates', channelId],
    queryFn: () => fetchWhatsappTemplates(channelId),
    staleTime: 30000,
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<WhatsappTemplateStatus | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<WhatsappTemplateCategory | 'ALL'>('ALL');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [pendingTemplate, setPendingTemplate] = useState<{ type: 'delete' | 'unlink'; template: WhatsappTemplate } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', channelId] });
    queryClient.invalidateQueries({ queryKey: ['channel-details', channelId] });
  };

  const sync = useMutation({
    mutationFn: () => syncWhatsappTemplates(channelId),
    onSuccess: (result) => {
      invalidate();
      Toast.show({ type: 'success', text1: 'Templates synced', text2: `Synced ${result.fetchedCount} templates from Meta (${result.approvedCount} approved, ${result.rejectedCount} rejected).` });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Sync failed', text2: error instanceof Error ? error.message : undefined }),
  });

  const del = useMutation({
    mutationFn: ({ templateId }: { templateId: string }) => deleteWhatsappTemplate(channelId, templateId),
    onSuccess: () => {
      setPendingTemplate(null);
      invalidate();
      Toast.show({ type: 'success', text1: 'Template deleted', text2: 'The template was deleted.' });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Delete failed', text2: error instanceof Error ? error.message : undefined }),
  });

  const unlink = useMutation({
    mutationFn: ({ templateId }: { templateId: string }) => unlinkWhatsappTemplate(channelId, templateId),
    onSuccess: () => {
      setPendingTemplate(null);
      invalidate();
      Toast.show({ type: 'success', text1: 'Template unlinked', text2: 'The template was unlinked from this workspace.' });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Unlink failed', text2: error instanceof Error ? error.message : undefined }),
  });

  const save = useMutation({
    mutationFn: (form: WhatsappTemplateFormValues) => {
      if (sheet?.mode === 'edit') return updateWhatsappTemplate(channelId, sheet.template.id, form);
      return createWhatsappTemplate(channelId, form);
    },
    onSuccess: (_data, _vars, _ctx) => {
      const wasCreate = sheet?.mode === 'create';
      invalidate();
      setSheet(null);
      Toast.show({
        type: 'success',
        text1: wasCreate ? 'Template submitted' : 'Template updated',
        text2: wasCreate ? 'Your template was submitted to WhatsApp for review.' : 'Your template changes were submitted.',
      });
    },
    onError: (error) => Toast.show({ type: 'error', text1: 'Save failed', text2: error instanceof Error ? error.message : undefined }),
  });

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (templates.data?.items ?? []).filter((template) => {
      if (statusFilter !== 'ALL') {
        const normalized = template.status === 'PROCESSING' ? 'PENDING' : template.status;
        if (statusFilter === 'PENDING') {
          if (normalized !== 'PENDING' && template.status !== 'PROCESSING') return false;
        } else if (template.status !== statusFilter) {
          return false;
        }
      }
      if (categoryFilter !== 'ALL' && template.category !== categoryFilter) return false;
      if (!query) return true;
      return (
        template.name.toLowerCase().includes(query)
        || template.body.toLowerCase().includes(query)
        || (template.header?.content ?? '').toLowerCase().includes(query)
      );
    });
  }, [templates.data?.items, search, statusFilter, categoryFilter]);

  const confirmDelete = useCallback((template: WhatsappTemplate) => setPendingTemplate({ type: 'delete', template }), []);
  const confirmUnlink = useCallback((template: WhatsappTemplate) => setPendingTemplate({ type: 'unlink', template }), []);
  const openView = useCallback((template: WhatsappTemplate) => setSheet({ mode: 'view', template }), []);
  const openEdit = useCallback(
    (template: WhatsappTemplate) => setSheet({ mode: 'edit', template, form: mapTemplateToForm(template) }),
    [],
  );

  const keyExtractor = useCallback((template: WhatsappTemplate) => template.id, []);
  const renderTemplate = useCallback(
    ({ item }: { item: WhatsappTemplate }) => (
      <TemplateCard
        template={item}
        onView={openView}
        onEdit={openEdit}
        onUnlink={confirmUnlink}
        onDelete={confirmDelete}
      />
    ),
    [openView, openEdit, confirmUnlink, confirmDelete],
  );

  const sheetMode: TemplateSheetMode = sheet?.mode ?? 'view';

  const filtersActive = search.trim().length > 0 || statusFilter !== 'ALL' || categoryFilter !== 'ALL';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.controls, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
        <View style={styles.toolbar}>
          <AppSearchField value={search} onChangeText={setSearch} placeholder="Search templates…" size="sm" tone="background" />
          <AppIconButton
            icon={RefreshCw}
            accessibilityLabel="Sync templates"
            loading={sync.isPending}
            onPress={() => sync.mutate()}
          />
          <AppButton
            label="New"
            icon={Plus}
            accessibilityLabel="New template"
            onPress={() => setSheet({ mode: 'create', form: makeDraftTemplate() })}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {STATUS_FILTERS.map((filter) => (
            <AppChip
              key={`status-${filter.id}`}
              label={filter.label}
              selected={statusFilter === filter.id}
              onPress={() => setStatusFilter(filter.id)}
            />
          ))}
          <View style={[styles.chipDivider, { backgroundColor: colors.cardBorder }]} />
          {CATEGORY_FILTERS.map((filter) => (
            <AppChip
              key={`category-${filter.id}`}
              label={filter.label}
              selected={categoryFilter === filter.id}
              onPress={() => setCategoryFilter(filter.id)}
            />
          ))}
          {filtersActive ? (
            <AppChip
              label="Reset"
              tone="danger"
              onPress={() => {
                setSearch('');
                setStatusFilter('ALL');
                setCategoryFilter('ALL');
              }}
            />
          ) : null}
        </ScrollView>
      </View>

      {templates.isLoading ? (
        <ListSkeleton rows={6} avatar={false} />
      ) : templates.isError ? (
        <EmptyState
          title="Could not load templates"
          message={templates.error instanceof Error ? templates.error.message : 'Please try again.'}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates found"
          message={
            search || statusFilter !== 'ALL' || categoryFilter !== 'ALL'
              ? 'Try adjusting filters or search.'
              : 'Create a template or sync with Meta to pull existing ones.'
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderTemplate}
          style={styles.listFill}
          contentContainerStyle={styles.list}
          removeClippedSubviews
        />
      )}

      <WhatsappTemplateSheet
        channelName={channelName}
        visible={Boolean(sheet)}
        mode={sheetMode}
        template={sheet && sheet.mode !== 'create' ? sheet.template : null}
        initialForm={sheet?.mode === 'create' || sheet?.mode === 'edit' ? sheet.form : null}
        isSaving={save.isPending}
        onClose={() => setSheet(null)}
        onEdit={() => {
          if (sheet?.mode === 'view') {
            setSheet({ mode: 'edit', template: sheet.template, form: mapTemplateToForm(sheet.template) });
          }
        }}
        onSave={(form) => save.mutate(form)}
      />
      <ConfirmDialog
        visible={pendingTemplate?.type === 'delete'}
        title="Delete template?"
        body={pendingTemplate ? `"${pendingTemplate.template.name}" will be deleted from Meta and this workspace.` : ''}
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onClose={() => setPendingTemplate(null)}
        onConfirm={() => pendingTemplate && del.mutate({ templateId: pendingTemplate.template.id })}
      />
      <ConfirmDialog
        visible={pendingTemplate?.type === 'unlink'}
        title="Unlink template?"
        body={pendingTemplate ? `"${pendingTemplate.template.name}" will be removed from this workspace but kept in Meta.` : ''}
        confirmLabel="Unlink"
        destructive
        loading={unlink.isPending}
        onClose={() => setPendingTemplate(null)}
        onConfirm={() => pendingTemplate && unlink.mutate({ templateId: pendingTemplate.template.id })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#f4f7fb', flex: 1 },
  controls: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  toolbar: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  chipRow: { alignItems: 'center', gap: 6, paddingRight: 8 },
  chipDivider: { borderRadius: 1, height: 16, marginHorizontal: 2, width: 1 },
  listFill: { flex: 1 },
  list: { gap: 12, padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderColor: '#d8e6fb', borderRadius: 18, borderWidth: 1, padding: 14 },
  cardHead: { borderBottomColor: '#e8eef7', borderBottomWidth: 1, paddingBottom: 10 },
  cardTitleWrap: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  cardName: { color: '#0f172a', flexShrink: 1, fontSize: 15, fontWeight: '700' },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  cardMeta: { color: '#64748b', fontSize: 12, marginTop: 4 },
  cardBody: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 10 },
  rejection: { color: '#be123c', fontSize: 12, marginTop: 6 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionButton: { alignItems: 'center', flexDirection: 'row', gap: 5, paddingRight: 10, paddingVertical: 6 },
  actionText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
});
