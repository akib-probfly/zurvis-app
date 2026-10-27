import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { FileText, PencilLine, Plus, Trash2, Upload } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { AppBadge, AppButton, AppCard, AppChip, AppText, AppTextField } from '../ui';
import { KNOWLEDGE_ENTRY_STARTERS } from '../lib/knowledge-entry-starters';
import { knowledgeDraftDirty, type AgentKnowledgeDraft } from '../lib/ai-agent-knowledge-draft';
import { BottomSheet, SheetScrollView } from './BottomSheet';
import { ConfirmDialog } from './ConfirmDialog';
import { spacing } from '../theme/tokens';

type Props = { visible: boolean; draft: AgentKnowledgeDraft; canUpdate: boolean; onClose: () => void; onDone: (draft: AgentKnowledgeDraft) => void };
export function AiAgentKnowledgeEditor({ visible, draft: initial, canUpdate, onClose, onDone }: Props) {
  const [draft, setDraft] = useState(initial);
  const [entry, setEntry] = useState<{ id?: string; title: string; content: string }>({ title: '', content: '' });
  const [picking, setPicking] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; kind: 'entry' | 'source' } | null>(null);
  const hasUnfinishedEntry = Boolean(entry.title.trim() || entry.content.trim());
  const requestClose = () => {
    if (picking) return;
    if (canUpdate && (hasUnfinishedEntry || JSON.stringify(draft) !== JSON.stringify(initial))) setDiscard(true);
    else onClose();
  };
  const saveEntry = () => {
    if (!canUpdate || picking) return;
    if (!entry.title.trim() || !entry.content.trim()) { Toast.show({ type: 'error', text1: 'Add a title and content.' }); return; }
    const value = { id: entry.id ?? `new-${Date.now()}`, title: entry.title.trim(), content: entry.content.trim(),
      existing: draft.entries.find((item) => item.id === entry.id)?.existing ?? false, changed: true };
    setDraft((current) => ({ ...current, entries: entry.id ? current.entries.map((item) => item.id === entry.id ? value : item) : [...current.entries, value] }));
    setEntry({ title: '', content: '' });
  };
  const pickFile = async (sourceId?: string) => {
    if (!canUpdate || picking) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!/\.(pdf|txt|md)$/i.test(file.name)) { Toast.show({ type: 'error', text1: 'Choose a PDF, TXT, or Markdown file.' }); return; }
      const pending = { id: `file-${Date.now()}`, sourceId, file: { uri: file.uri, name: file.name, mimeType: file.mimeType ?? (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'text/plain') } };
      setDraft((current) => ({ ...current, files: [...current.files.filter((item) => !sourceId || item.sourceId !== sourceId), pending] }));
    } catch (error) { Toast.show({ type: 'error', text1: 'Could not choose file', text2: error instanceof Error ? error.message : undefined }); }
    finally { setPicking(false); }
  };
  const done = () => {
    if (hasUnfinishedEntry) { Toast.show({ type: 'info', text1: 'Add the current entry or cancel its edit first.' }); return; }
    if (!draft.name.trim()) { Toast.show({ type: 'info', text1: 'Enter a knowledge base name.' }); return; }
    if (canUpdate && knowledgeDraftDirty(draft)) onDone(draft);
    else onClose();
  };
  return <>
    <BottomSheet visible={visible} onClose={requestClose}>
      <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <AppText variant="section">{draft.base ? 'Manage knowledge' : 'Create knowledge base'}</AppText>
        <AppText variant="small" tone="secondary">Changes, uploads, and indexing apply when you save the agent draft. Shared knowledge changes affect every agent using this base.</AppText>
        <AppTextField label="Knowledge base name" required value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} editable={canUpdate && !picking} />
        <AppText variant="section">Files</AppText>
        <AppText variant="small" tone="secondary">PDF, TXT, and Markdown files.</AppText>
        {(draft.base?.sources ?? []).filter((source) => !draft.removedSources.includes(source.id)).map((source) => <AppCard key={source.id} style={styles.card}>
          <View style={styles.row}><FileText size={18} /><View style={styles.copy}><AppText variant="bodyStrong">{source.title || source.originalName}</AppText><AppText variant="small" tone="secondary">{draft.files.find((item) => item.sourceId === source.id)?.file.name ?? source.originalName}</AppText></View><AppBadge label={draft.files.some((item) => item.sourceId === source.id) ? 'Replacement pending' : source.status} tone={source.errorMessage ? 'danger' : 'neutral'} /></View>
          {source.errorMessage ? <AppText tone="error">{source.errorMessage}</AppText> : null}
          {canUpdate ? <View style={styles.row}><AppButton label="Replace" icon={Upload} variant="secondary" size="sm" disabled={picking} onPress={() => { void pickFile(source.id); }} /><AppButton label="Delete" icon={Trash2} variant="ghost" size="sm" disabled={picking} onPress={() => setPendingDelete({ id: source.id, kind: 'source' })} /></View> : null}
        </AppCard>)}
        {draft.files.filter((file) => !file.sourceId).map((pending) => <AppCard key={pending.id} style={styles.card}><AppText>{pending.file.name}</AppText><AppBadge label="Upload pending" tone="neutral" /><AppButton label="Remove" variant="ghost" size="sm" disabled={!canUpdate || picking} onPress={() => setDraft((current) => ({ ...current, files: current.files.filter((item) => item.id !== pending.id) }))} /></AppCard>)}
        {canUpdate ? <AppButton label="Add file" icon={Upload} variant="secondary" disabled={picking} onPress={() => { void pickFile(); }} /> : null}
        <AppText variant="section">Knowledge entries</AppText>
        {draft.entries.map((item) => <AppCard key={item.id} style={styles.card}>
          <AppText variant="bodyStrong">{item.title}</AppText><AppText tone="secondary" numberOfLines={4}>{item.content}</AppText>
          {item.changed ? <AppBadge label="Pending save" tone="neutral" /> : null}
          {canUpdate ? <View style={styles.row}><AppButton label="Edit" icon={PencilLine} variant="secondary" size="sm" disabled={picking} onPress={() => setEntry({ id: item.id, title: item.title, content: item.content })} /><AppButton label="Delete" icon={Trash2} variant="ghost" size="sm" disabled={picking} onPress={() => setPendingDelete({ id: item.id, kind: 'entry' })} /></View> : null}
        </AppCard>)}
        {canUpdate ? <>
          <AppText variant="bodyStrong">{entry.id ? 'Edit entry' : 'Add custom knowledge'}</AppText>
          {!entry.id ? <View style={styles.row}>{KNOWLEDGE_ENTRY_STARTERS.map((starter) => <AppChip key={starter.id} label={starter.title} disabled={picking} onPress={() => setEntry({ title: starter.title, content: starter.content })} />)}</View> : null}
          <AppTextField label="Title" required value={entry.title} editable={!picking} onChangeText={(title) => setEntry((previous) => ({ ...previous, title }))} />
          <AppTextField label="Content" required multiline value={entry.content} editable={!picking} onChangeText={(content) => setEntry((previous) => ({ ...previous, content }))} />
          <View style={styles.row}><AppButton label={entry.id ? 'Apply entry edit' : 'Add entry'} icon={Plus} disabled={picking} onPress={saveEntry} />{hasUnfinishedEntry || entry.id ? <AppButton label="Cancel edit" variant="ghost" disabled={picking} onPress={() => setEntry({ title: '', content: '' })} /> : null}</View>
        </> : null}
        <AppButton label={canUpdate ? 'Keep changes' : 'Done'} variant="secondary" disabled={picking} onPress={done} />
      </SheetScrollView>
    </BottomSheet>
    <ConfirmDialog visible={discard} title="Discard knowledge edits?" body="Changes made in this editor will be discarded. Your agent draft will be kept." confirmLabel="Discard" destructive onClose={() => setDiscard(false)} onConfirm={onClose} />
    <ConfirmDialog visible={Boolean(pendingDelete)} title={`Remove ${pendingDelete?.kind === 'source' ? 'file' : 'entry'}?`} body="This change applies when you save the agent draft." confirmLabel="Remove" destructive onClose={() => setPendingDelete(null)} onConfirm={() => {
      if (!pendingDelete) return;
      const target = pendingDelete;
      setDraft((current) => target.kind === 'source' ? { ...current, removedSources: [...current.removedSources, target.id], files: current.files.filter((file) => file.sourceId !== target.id) }
        : { ...current, entries: current.entries.filter((item) => item.id !== target.id), removedEntries: current.entries.find((item) => item.id === target.id)?.existing ? [...current.removedEntries, target.id] : current.removedEntries });
      if (entry.id === target.id) setEntry({ title: '', content: '' });
      setPendingDelete(null);
    }} />
  </>;
}
const styles = StyleSheet.create({ content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }, card: { gap: spacing.sm }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }, copy: { flex: 1, minWidth: 0 } });
