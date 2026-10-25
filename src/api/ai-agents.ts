import { apiFetch } from "./client";

export type AiAgentType = "SALES" | "CUSTOMER_SUPPORT" | "CUSTOM";
export type AiAgentCapability =
  | "SERVICE_LOOKUP"
  | "PRODUCT_SEARCH"
  | "ORDER_STATUS"
  | "ORDER_CREATION"
  | "HUMAN_HANDOFF";
export type AiAgentIntent =
  | "SALES"
  | "CUSTOMER_SUPPORT"
  | "BUSINESS_INFORMATION"
  | "OTHER";

export type AiAgent = {
  id: string;
  workspaceId: string;
  name: string;
  agentType: AiAgentType;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  goal: string;
  tone: string | null;
  language: string | null;
  instructions: string | null;
  fallbackReply: string | null;
  capabilities: AiAgentCapability[];
  handledIntents: AiAgentIntent[];
  providerMode: "PLATFORM" | "CUSTOM";
  model: string | null;
  baseUrl: string | null;
  aiApiKeyConfigured: boolean;
  knowledgeBase: { id: string; name: string; enabled: boolean; _count?: { entries: number; sources: number } } | null;
  deployments: Array<{ channelId: string; enabled: boolean; channel: { id: string; name: string; type: string } }>;
  configVersion: number;
  updatedAt: string;
};

export type AiAgentTemplate = {
  type: AiAgentType;
  title: string;
  description: string;
  defaults: {
    name: string;
    goal: string;
    tone: string | null;
    language: string | null;
    instructions: string | null;
    fallbackReply: string | null;
    capabilities: AiAgentCapability[];
    handledIntents: AiAgentIntent[];
  };
};

export type AiAgentInput = {
  name: string;
  agentType: AiAgentType;
  goal: string;
  tone: string | null;
  language: string | null;
  instructions: string | null;
  fallbackReply: string | null;
  capabilities: AiAgentCapability[];
  handledIntents: AiAgentIntent[];
  providerMode: "PLATFORM" | "CUSTOM";
  model: string | null;
  baseUrl: string | null;
  apiKey?: string;
  knowledgeBaseId: string | null;
  channelIds: string[];
};

export type AiAgentUpdateInput = Omit<Partial<AiAgentInput>, "agentType">;

export const aiAgentQueryKeys = {
  all: ["ai-agents"] as const,
  list: (workspaceId: string | null) => ["ai-agents", workspaceId ?? "disabled"] as const,
  templates: ["ai-agent-templates"] as const,
};

export function fetchAiAgents() {
  return apiFetch<AiAgent[]>("/ai/agents", { method: "GET" });
}

export function fetchAiAgentTemplates() {
  return apiFetch<AiAgentTemplate[]>("/ai/agents/templates", { method: "GET" });
}

export function createAiAgent(input: AiAgentInput) {
  return apiFetch<AiAgent>("/ai/agents", { method: "POST", body: JSON.stringify(input) });
}

export function updateAiAgent(id: string, input: AiAgentUpdateInput) {
  return apiFetch<AiAgent>(`/ai/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function activateAiAgent(id: string) {
  return apiFetch<AiAgent>(`/ai/agents/${id}/activate`, { method: "POST" });
}

export function pauseAiAgent(id: string) {
  return apiFetch<AiAgent>(`/ai/agents/${id}/pause`, { method: "POST" });
}

