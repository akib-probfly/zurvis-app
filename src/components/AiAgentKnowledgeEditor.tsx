import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { FileText, PencilLine, Plus, Trash2, Upload } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { createChannelKnowledgeBase, createKnowledgeEntry, deleteKnowledgeEntry, deleteKnowledgeSource, knowledgeBaseQueryKeys, replaceKnowledgeSource, updateKnowledgeBase, updateKnowledgeEntry, uploadKnowledgeBaseFile, type KnowledgeBase, type KnowledgeEntry } from '../api/knowledge-base';
import { AppBadge, AppButton, AppCard, AppChip, AppText, AppTextField } from '../ui';
import { KNOWLEDGE_ENTRY_STARTERS } from '../lib/knowledge-entry-starters';
import { BottomSheet, SheetScrollView } from './BottomSheet';
import { ConfirmDialog } from './ConfirmDialog';
import { spacing } from '../theme/tokens';

type Props = { visible: boolean; base: KnowledgeBase | null; workspaceId: string; channelId?: string; canUpdate: boolean; onClose: () => void; onCreated: (base: KnowledgeBase) => void };
export function AiAgentKnowledgeEditor({ visible, base, workspaceId, channelId, canUpdate, onClose, onCreated }: Props) {
  const client = useQueryClient();
  const [created, setCreated] = useState<KnowledgeBase | null>(null);
  const current = base ?? created;
  const [name, setName] = useState(base?.name ?? '');
  const [entry, setEntry] = useState<{ id?: string; title: string; content: string }>({ title: '', content: '' });
  const [pendingDelete, setPendingDelete] = useState<{ id: string; kind: 'entry' | 'source' } | null>(null);
  const [picking, setPicking] = useState(false);
  const [discard, setDiscard] = useState(false);
  const operation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => {
      if (!canUpdate) throw new Error('You do not have permission to update this knowledge base.');
      return task();
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: knowledgeBaseQueryKeys.all }); },
    onError: (error) => Toast.show({ type: 'error', text1: 'Could not update knowledge', text2: error.message }),
  });
  const busy = operation.isPending || picking;
  const requestClose = () => {
    if (busy) return;
    if (canUpdate && (entry.title.trim() || entry.content.trim() || name.trim() !== (current?.name ?? '').trim())) setDiscard(true);
    else onClose();
  };
  const saveName = () => {
    if (!name.trim() || busy || !canUpdate) return;
    operation.mutate(async () => {
      if (!current) {
        if (!channelId) throw new Error('Select a channel before creating a knowledge base.');
        const next = await createChannelKnowledgeBase({ workspaceId, channelId, name: name.trim(), businessType: 'GENERAL', capabilities: [], enabled: true });
        setCreated(next); onCreated(next);
      } else {
        await updateKnowledgeBase(current.id, { name: name.trim(), businessType: current.businessType, brandName: current.brandName, defaultLanguage: current.defaultLanguage,
          tone: current.tone, trustedInstructions: current.trustedInstructions, fallbackReply: current.fallbackReply, capabilities: current.capabilities, enabled: current.enabled });
      }
    });
  };
  const saveEntry = () => {
    if (!current || busy || !canUpdate) return;
    if (!entry.title.trim() || !entry.content.trim()) { Toast.show({ type: 'error', text1: 'Add a title and content.' }); return; }
    const input = { title: entry.title.trim(), content: entry.content.trim() };
    operation.mutate(() => entry.id ? updateKnowledgeEntry(current.id, entry.id, input) : createKnowledgeEntry(current.id, input), {
      onSuccess: () => setEntry({ title: '', content: '' }),
    });
  };
  const pickFile = async (sourceId?: string) => {
    if (!current || busy || !canUpdate) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!/\.(pdf|txt|md)$/i.test(file.name)) { Toast.show({ type: 'error', text1: 'Choose a PDF, TXT, or Markdown file.' }); return; }
      const input = { uri: file.uri, name: file.name, mimeType: file.mimeType ?? (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'text/plain') };
      operation.mutate(() => sourceId ? replaceKnowledgeSource(current.id, sourceId, input) : uploadKnowledgeBaseFile(current.id, input));
    } catch (error) { Toast.show({ type: 'error', text1: 'Could not choose file', text2: error instanceof Error ? error.message : undefined }); }
    finally { setPicking(false); }
  };
  const editEntry = (value: KnowledgeEntry) => setEntry({ id: value.id, title: value.title, content: value.content });
  return <>
    <BottomSheet visible={visible} onClose={requestClose}>
      <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <AppText variant="section">{current ? 'Manage knowledge' : 'Create knowledge base'}</AppText>
        <AppText variant="small" tone="secondary">Knowledge changes are saved here and apply to every agent using this base.</AppText>
        <AppTextField label="Knowledge base name" required value={name} onChangeText={setName} editable={canUpdate && !busy} />
        {canUpdate ? <AppButton label={current ? 'Save name' : 'Create knowledge base'} loading={operation.isPending} disabled={busy || !name.trim()} onPress={saveName} /> : null}
        {current ? <>
          <AppText variant="section">Files</AppText>
          <AppText variant="small" tone="secondary">PDF, TXT, and Markdown files.</AppText>
          {(current.sources ?? []).map((source) => <AppCard key={source.id} style={styles.card}>
            <View style={styles.row}><FileText size={18} /><View style={styles.copy}><AppText variant="bodyStrong">{source.title || source.originalName}</AppText><AppText variant="small" tone="secondary">{source.originalName}</AppText></View>
              <AppBadge label={source.status} tone={source.errorMessage ? 'danger' : 'neutral'} />
            </View>
            {source.errorMessage ? <AppText tone="error">{source.errorMessage}</AppText> : null}
            {canUpdate ? <View style={styles.row}><AppButton label="Replace" icon={Upload} variant="secondary" size="sm" disabled={busy} onPress={() => { void pickFile(source.id); }} /><AppButton label="Delete" icon={Trash2} variant="ghost" size="sm" disabled={busy} onPress={() => setPendingDelete({ id: source.id, kind: 'source' })} /></View> : null}
          </AppCard>)}
          {canUpdate ? <AppButton label="Upload file" icon={Upload} variant="secondary" disabled={busy} onPress={() => { void pickFile(); }} /> : null}
          <AppText variant="section">Knowledge entries</AppText>
          {(current.entries ?? []).map((item) => <AppCard key={item.id} style={styles.card}>
            <AppText variant="bodyStrong">{item.title}</AppText><AppText tone="secondary" numberOfLines={4}>{item.content}</AppText>
            {canUpdate ? <View style={styles.row}><AppButton label="Edit" icon={PencilLine} variant="secondary" size="sm" disabled={busy} onPress={() => editEntry(item)} /><AppButton label="Delete" icon={Trash2} variant="ghost" size="sm" disabled={busy} onPress={() => setPendingDelete({ id: item.id, kind: 'entry' })} /></View> : null}
          </AppCard>)}
          {canUpdate ? <>
            <AppText variant="bodyStrong">{entry.id ? 'Edit entry' : 'Add custom knowledge'}</AppText>
            {!entry.id ? <>
              <AppText variant="small" tone="secondary">Choose a starting point, then replace sample details with your business information.</AppText>
              <View style={styles.row}>{KNOWLEDGE_ENTRY_STARTERS.map((starter) => <AppChip key={starter.id} label={starter.title} disabled={busy} onPress={() => setEntry({ title: starter.title, content: starter.content })} />)}</View>
            </> : null}
            <AppTextField label="Title" required value={entry.title} editable={!busy} onChangeText={(title) => setEntry((previous) => ({ ...previous, title }))} />
            <AppTextField label="Content" required multiline value={entry.content} editable={!busy} onChangeText={(content) => setEntry((previous) => ({ ...previous, content }))} />
            <View style={styles.row}><AppButton label={entry.id ? 'Save entry' : 'Add entry'} icon={Plus} disabled={busy} onPress={saveEntry} />{entry.id ? <AppButton label="Cancel edit" variant="ghost" disabled={busy} onPress={() => setEntry({ title: '', content: '' })} /> : null}</View>
          </> : null}
        </> : null}
        <AppButton label="Done" variant="secondary" disabled={busy} onPress={requestClose} />
      </SheetScrollView>
    </BottomSheet>
    <ConfirmDialog visible={discard} title="Discard unsaved knowledge?" body="Your unsaved name or entry changes will be lost. Changes already saved will be kept." confirmLabel="Discard" destructive onClose={() => setDiscard(false)} onConfirm={onClose} />
    <ConfirmDialog visible={Boolean(pendingDelete)} title={`Delete ${pendingDelete?.kind === 'source' ? 'file' : 'entry'}?`} body="This removes knowledge from every agent using this base." confirmLabel="Delete" destructive loading={operation.isPending} onClose={() => { if (!busy) setPendingDelete(null); }}
      onConfirm={() => { if (!current || !pendingDelete || busy) return; const target = pendingDelete; operation.mutate(() => target.kind === 'entry' ? deleteKnowledgeEntry(current.id, target.id) : deleteKnowledgeSource(current.id, target.id), { onSuccess: () => { if (entry.id === target.id) setEntry({ title: '', content: '' }); setPendingDelete(null); } }); }} />
  </>;
}
const styles = StyleSheet.create({ content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }, card: { gap: spacing.sm }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }, copy: { flex: 1, minWidth: 0 } });
