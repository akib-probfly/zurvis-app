import {
  createChannelKnowledgeBase, createKnowledgeEntry, deleteKnowledgeEntry, deleteKnowledgeSource,
  replaceKnowledgeSource, updateKnowledgeBase, updateKnowledgeEntry, uploadKnowledgeBaseFile,
  type KnowledgeBase, type KnowledgeFile,
} from '../api/knowledge-base';

export type AgentKnowledgeDraft = {
  base: KnowledgeBase | null;
  name: string;
  entries: Array<{ id: string; title: string; content: string; existing: boolean; changed: boolean }>;
  files: Array<{ id: string; file: KnowledgeFile; sourceId?: string }>;
  removedEntries: string[];
  removedSources: string[];
};

export function knowledgeDraftFromBase(base: KnowledgeBase | null): AgentKnowledgeDraft {
  return { base, name: base?.name ?? '', entries: (base?.entries ?? []).map((entry) => ({ ...entry, existing: true, changed: false })),
    files: [], removedEntries: [], removedSources: [] };
}

export function knowledgeDraftDirty(draft: AgentKnowledgeDraft) {
  return !draft.base || draft.name.trim() !== draft.base.name || draft.entries.some((entry) => entry.changed)
    || draft.files.length > 0 || draft.removedEntries.length > 0 || draft.removedSources.length > 0;
}

// Report completed operations after each request so retrying a partially failed
// save cannot create the same base, entry, or file twice.
export async function saveAgentKnowledgeDraft(
  original: AgentKnowledgeDraft, workspaceId: string, channelId: string | undefined,
  onProgress: (draft: AgentKnowledgeDraft) => void,
) {
  let draft = original;
  if (!draft.name.trim()) throw new Error('Enter a knowledge base name.');
  if (draft.entries.some((entry) => !entry.title.trim() || !entry.content.trim())) throw new Error('Complete every knowledge entry before saving.');
  const progress = (next: AgentKnowledgeDraft) => { draft = next; onProgress(next); };
  if (!draft.base) {
    if (!channelId) throw new Error('Select a channel before creating a knowledge base.');
    const base = await createChannelKnowledgeBase({ workspaceId, channelId, name: draft.name.trim(), businessType: 'GENERAL', capabilities: [], enabled: true });
    progress({ ...draft, base });
  } else if (draft.name.trim() !== draft.base.name) {
    const base = draft.base;
    await updateKnowledgeBase(base.id, { name: draft.name.trim(), businessType: base.businessType, brandName: base.brandName,
      defaultLanguage: base.defaultLanguage, tone: base.tone, trustedInstructions: base.trustedInstructions,
      fallbackReply: base.fallbackReply, capabilities: base.capabilities, enabled: base.enabled });
    progress({ ...draft, base: { ...base, name: draft.name.trim() } });
  }
  const baseId = draft.base!.id;
  for (const entry of draft.entries.filter((item) => item.changed)) {
    const input = { title: entry.title.trim(), content: entry.content.trim() };
    const saved = entry.existing ? await updateKnowledgeEntry(baseId, entry.id, input) : await createKnowledgeEntry(baseId, input);
    progress({ ...draft, entries: draft.entries.map((item) => item.id === entry.id ? { ...item, id: saved.id, existing: true, changed: false } : item) });
  }
  for (const pending of draft.files) {
    if (pending.sourceId) await replaceKnowledgeSource(baseId, pending.sourceId, pending.file);
    else await uploadKnowledgeBaseFile(baseId, pending.file);
    progress({ ...draft, files: draft.files.filter((item) => item.id !== pending.id) });
  }
  for (const id of draft.removedEntries) {
    await deleteKnowledgeEntry(baseId, id);
    progress({ ...draft, removedEntries: draft.removedEntries.filter((item) => item !== id) });
  }
  for (const id of draft.removedSources) {
    await deleteKnowledgeSource(baseId, id);
    progress({ ...draft, removedSources: draft.removedSources.filter((item) => item !== id) });
  }
  return baseId;
}
