import type { AiAgent, AiAgentCapability, AiAgentInput, AiAgentIntent, AiAgentTemplate, AiAgentType } from '../api/ai-agents';

export const agentTypeLabel = (type: AiAgentType) => type === 'SALES' ? 'Sales' : type === 'CUSTOMER_SUPPORT' ? 'Customer support' : 'Custom';
export const AGENT_CAPABILITIES: { id: AiAgentCapability; label: string; description: string }[] = [
  { id: 'SERVICE_LOOKUP', label: 'Service and knowledge lookup', description: 'Search services, business facts, FAQs, and policies.' },
  { id: 'PRODUCT_SEARCH', label: 'Product search and stock', description: 'Search verified products, prices, variants, and inventory.' },
  { id: 'ORDER_STATUS', label: 'Order status', description: 'Look up orders for the current conversation.' },
  { id: 'ORDER_CREATION', label: 'Prepare and create orders', description: 'Requires complete details, customer confirmation, and server validation.' },
  { id: 'HUMAN_HANDOFF', label: 'Human handoff', description: 'Assign uncertain or sensitive conversations to a person.' },
];
export const AGENT_INTENTS: { id: AiAgentIntent; label: string }[] = [
  { id: 'SALES', label: 'Sales and product questions' },
  { id: 'CUSTOMER_SUPPORT', label: 'Order support and problems' },
  { id: 'BUSINESS_INFORMATION', label: 'Business information' },
  { id: 'OTHER', label: 'Other questions' },
];
export type AgentForm = AiAgentInput & { apiKey: string };
export function formFromAgent(agent: AiAgent): AgentForm {
  return { name: agent.name, agentType: agent.agentType, goal: agent.goal, tone: agent.tone, language: agent.language,
    instructions: agent.instructions, fallbackReply: agent.fallbackReply, capabilities: [...agent.capabilities], handledIntents: [...agent.handledIntents],
    providerMode: agent.providerMode, model: agent.model, baseUrl: agent.baseUrl, apiKey: '', knowledgeBaseId: agent.knowledgeBase?.id ?? null,
    channelIds: agent.deployments.map((deployment) => deployment.channelId) };
}
export function formFromTemplate(template: AiAgentTemplate): AgentForm {
  return { ...template.defaults, agentType: template.type, capabilities: [...template.defaults.capabilities], handledIntents: [...template.defaults.handledIntents],
    ...(template.type === 'CUSTOM' ? { name: '', goal: '', tone: null, language: null, instructions: null, fallbackReply: null, handledIntents: [] } : {}),
    providerMode: 'PLATFORM', model: null, baseUrl: null, apiKey: '', knowledgeBaseId: null, channelIds: [] };
}
export function agentFormError(form: AgentForm, keyConfigured: boolean) {
  if (!form.name.trim() || !form.goal.trim() || !form.handledIntents.length) return 'Add an agent name, goal, and at least one conversation category.';
  if (form.providerMode === 'CUSTOM') {
    if (!form.model?.trim() || !form.baseUrl?.trim() || (!form.apiKey.trim() && !keyConfigured)) return 'Custom provider mode requires a model, base URL, and API key.';
    try { const url = new URL(form.baseUrl); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); }
    catch { return 'Enter a valid provider base URL.'; }
  }
  return null;
}
export function agentFormInput(form: AgentForm): AiAgentInput {
  return { name: form.name.trim(), agentType: form.agentType, goal: form.goal.trim(), tone: form.tone?.trim() || null,
    language: form.language?.trim() || null, instructions: form.instructions?.trim() || null, fallbackReply: form.fallbackReply?.trim() || null,
    capabilities: form.capabilities, handledIntents: form.handledIntents, providerMode: form.providerMode,
    model: form.providerMode === 'CUSTOM' ? form.model?.trim() || null : null,
    baseUrl: form.providerMode === 'CUSTOM' ? form.baseUrl?.trim() || null : null,
    ...(form.providerMode === 'CUSTOM' && form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    knowledgeBaseId: form.knowledgeBaseId, channelIds: form.channelIds };
}
