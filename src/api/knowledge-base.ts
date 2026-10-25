import { apiFetch, uploadFile } from "./client";

export type KnowledgeBase = {
  id: string;
  workspaceId: string;
  channelId: string;
  name: string;
  businessType: string;
  brandName: string | null;
  defaultLanguage: string | null;
  tone: string | null;
  trustedInstructions: string | null;
  fallbackReply: string | null;
  capabilities: string[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  _count?: { entries: number; sources: number };
  sources?: KnowledgeSource[];
  entries?: KnowledgeEntry[];
};

export type KnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSource = {
  id: string;
  title: string;
  mimeType: string;
  originalName: string;
  status: string;
  errorMessage: string | null;
  attachmentId: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseInput = {
  workspaceId: string;
  channelId: string;
  name: string;
  businessType: string;
  brandName?: string | null;
  defaultLanguage?: string | null;
  tone?: string | null;
  trustedInstructions?: string | null;
  fallbackReply?: string | null;
  capabilities: string[];
  enabled?: boolean;
};

export type KnowledgeBaseUpdateInput = Omit<
  KnowledgeBaseInput,
  "workspaceId" | "channelId"
>;

export type KnowledgeEntryInput = {
  title: string;
  content: string;
  category?: string | null;
  keywords?: string[];
  language?: string | null;
  priority?: number;
  enabled?: boolean;
};

export type KnowledgeSourceUploadResponse = {
  id: string;
  title: string;
  mimeType: string;
  originalName: string;
  entryCount: number;
  attachment: { id: string; originalName: string | null };
};

export const knowledgeBaseQueryKeys = {
  all: ["knowledge-bases"] as const,
  channel: (workspaceId: string | null, channelId: string | null) =>
    [
      ...knowledgeBaseQueryKeys.all,
      workspaceId ?? "disabled",
      channelId ?? "disabled",
    ] as const,
};

export function fetchChannelKnowledgeBases(
  workspaceId: string,
  channelId: string,
) {
  const params = new URLSearchParams({ workspaceId, channelId });
  return apiFetch<KnowledgeBase[]>(`/knowledge-bases?${params.toString()}`, {
    method: "GET",
  });
}

export function fetchWorkspaceKnowledgeBases(workspaceId: string) {
  const params = new URLSearchParams({ workspaceId });
  return apiFetch<KnowledgeBase[]>(`/knowledge-bases?${params.toString()}`, {
    method: "GET",
  });
}

export function createChannelKnowledgeBase(input: KnowledgeBaseInput) {
  return apiFetch<KnowledgeBase>("/knowledge-bases", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateKnowledgeBase(
  knowledgeBaseId: string,
  input: KnowledgeBaseUpdateInput,
) {
  return apiFetch<KnowledgeBase>(`/knowledge-bases/${knowledgeBaseId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createKnowledgeEntry(
  knowledgeBaseId: string,
  input: KnowledgeEntryInput,
) {
  return apiFetch<KnowledgeEntry>(
    `/knowledge-bases/${knowledgeBaseId}/entries`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updateKnowledgeEntry(
  knowledgeBaseId: string,
  entryId: string,
  input: Partial<KnowledgeEntryInput>,
) {
  return apiFetch<KnowledgeEntry>(
    `/knowledge-bases/${knowledgeBaseId}/entries/${entryId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteKnowledgeEntry(knowledgeBaseId: string, entryId: string) {
  return apiFetch<{ deleted: boolean }>(
    `/knowledge-bases/${knowledgeBaseId}/entries/${entryId}`,
    { method: "DELETE" },
  );
}

export function uploadKnowledgeBaseFile(knowledgeBaseId: string, file: KnowledgeFile) {

  return uploadFile(
    `/knowledge-bases/${knowledgeBaseId}/files`,
    file.uri, file.name, file.mimeType,
  );
}

export function updateKnowledgeSourceTitle(
  knowledgeBaseId: string,
  sourceId: string,
  title: string,
) {
  return apiFetch<KnowledgeSource>(
    `/knowledge-bases/${knowledgeBaseId}/sources/${sourceId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ title }),
    },
  );
}

export function replaceKnowledgeSource(
  knowledgeBaseId: string,
  sourceId: string,
  file: KnowledgeFile,
) {

  return uploadFile(
    `/knowledge-bases/${knowledgeBaseId}/sources/${sourceId}/replace`,
    file.uri, file.name, file.mimeType,
  );
}

export function deleteKnowledgeSource(
  knowledgeBaseId: string,
  sourceId: string,
) {
  return apiFetch<{ deleted: boolean }>(
    `/knowledge-bases/${knowledgeBaseId}/sources/${sourceId}`,
    { method: "DELETE" },
  );
}

export type KnowledgeFile = { uri: string; name: string; mimeType: string };

