import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, usePreventRemove, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { ChevronDown, ChevronUp, Save } from 'lucide-react-native';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { createAiAgent, updateAiAgent } from '../api/ai-agents';
import { fetchChannels } from '../api/channels';
import { fetchWorkspaceKnowledgeBases, knowledgeBaseQueryKeys } from '../api/knowledge-base';
import { useAiAgentAccess, useAiAgentMutation, useAiAgents, useAiAgentTemplates } from '../hooks/useAiAgents';
import { AGENT_CAPABILITIES, AGENT_INTENTS, agentFormError, agentFormInput, formFromAgent, formFromTemplate, type AgentForm } from '../lib/ai-agent-form';
import type { SettingsStackParamList } from '../navigation/SettingsStack';
import { AiAgentChoice } from '../components/AiAgentChoice';
import { AiAgentKnowledgeEditor } from '../components/AiAgentKnowledgeEditor';
import { ChannelLogo } from '../components/ChannelLogo';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { FormSkeleton } from '../components/Skeleton';
import { AppButton, AppCard, AppSegmentedControl, AppText, AppTextField, EmptyState, ScreenHeader } from '../ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/tokens';
import type { ReactNode } from 'react';

export function AiAgentFormScreen() {
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>();
  const route = useRoute<RouteProp<SettingsStackParamList, 'AiAgentForm'>>();
  const access = useAiAgentAccess();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const agents = useAiAgents(access.workspaceId, access.canRead);
  const templates = useAiAgentTemplates(access.canRead && !route.params.agentId);
  const channels = useQuery({ queryKey: ['channels'], queryFn: fetchChannels, enabled: access.canRead });
  const knowledge = useQuery({ queryKey: [...knowledgeBaseQueryKeys.all, access.workspaceId, 'workspace'], queryFn: () => fetchWorkspaceKnowledgeBases(access.workspaceId!), enabled: Boolean(access.workspaceId && access.canRead) });
  const agent = agents.data?.find((item) => item.id === route.params.agentId);
  const template = templates.data?.find((item) => item.type === route.params.templateType);
  const [form, setForm] = useState<AgentForm | null>(null);
  const [initial, setInitial] = useState('');
  const [discard, setDiscard] = useState(false);
  const [leaveAllowed, setLeaveAllowed] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeCreate, setKnowledgeCreate] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const initializedScope = useRef<string | null>(null);
  useEffect(() => {
    if (!access.canRead || !access.workspaceId || initializedScope.current === access.workspaceId) return;
    const next = agent ? formFromAgent(agent) : !route.params.agentId && template ? formFromTemplate(template) : null;
    if (next) { setForm(next); setInitial(JSON.stringify(next)); initializedScope.current = access.workspaceId; }
  }, [access.canRead, access.workspaceId, agent, template, route.params.agentId]);
  const currentScope = initializedScope.current === access.workspaceId;
  const save = useAiAgentMutation(async (value: AgentForm) => {
    if (!access.canUpdate || !currentScope) throw new Error('Workspace access changed. Reopen this agent.');
    const error = agentFormError(value, Boolean(agent?.aiApiKeyConfigured));
    if (error) throw new Error(error);
    const input = agentFormInput(value);
    if (route.params.agentId) {
      const { agentType: _type, ...update } = input;
      void _type;
      return updateAiAgent(route.params.agentId, update);
    }
    return createAiAgent(input);
  });
  const dirty = Boolean(form && JSON.stringify(form) !== initial);
  // Covers the header, Android back button, and iOS swipe-back.
  usePreventRemove((dirty || save.isPending) && !leaveAllowed, () => { if (!save.isPending) setDiscard(true); });
  useEffect(() => { if (leaveAllowed) navigation.goBack(); }, [leaveAllowed, navigation]);
  const setField = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => setForm((previous) => previous ? { ...previous, [key]: value } : null);
  const editable = access.canUpdate && currentScope && !save.isPending;
  const selectedKnowledge = knowledge.data?.find((base) => base.id === form?.knowledgeBaseId);
  const availableChannels = (channels.data?.items ?? []).filter((channel) => channel.workspaceId === access.workspaceId && channel.status === 'CONNECTED' && channel.type !== 'EMAIL');
  const visibleChannels = availableChannels.filter((channel) => `${channel.name} ${channel.type}`.toLowerCase().includes(channelSearch.toLowerCase()));
  const submit = () => {
    if (!form || !editable) return;
    save.mutate(form, { onSuccess: () => {
      setInitial(JSON.stringify(form));
      Toast.show({ type: 'success', text1: 'Agent draft saved', text2: 'Activate it from AI Agents when you are ready.' });
      setLeaveAllowed(true);
    }, onError: (error) => Toast.show({ type: 'error', text1: 'Could not save agent', text2: error.message }) });
  };
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <ScreenHeader title={route.params.agentId ? 'Edit AI agent' : 'Create AI agent'} onBack={() => navigation.goBack()} />
    {access.loading ? <FormSkeleton /> : access.error ? <ErrorState message="Could not load workspace access." onRetry={() => access.refetch()} /> : !access.canRead ? <EmptyState title="Access unavailable" message="You need workspace settings access to view this agent." />
      : agents.isPending || (!route.params.agentId && templates.isPending) ? <FormSkeleton />
      : agents.isError || (!route.params.agentId && templates.isError) ? <ErrorState message="Could not load agent details." onRetry={() => { void agents.refetch(); void templates.refetch(); }} />
        : !form || !currentScope ? <EmptyState title="Agent unavailable" message="This agent or template is no longer available in the current workspace." />
          : <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
              <AppText tone="secondary">Save as a draft first. Activation starts AI analysis; automatic replies remain separately controlled in channel settings.</AppText>
              <AgentSection title="Agent details" initiallyOpen>
                <AppTextField label="Name" required value={form.name} onChangeText={(value) => setField('name', value)} editable={editable} />
                <AppTextField label="Goal" required multiline value={form.goal} onChangeText={(value) => setField('goal', value)} editable={editable} />
                <AppTextField label="Tone" value={form.tone ?? ''} onChangeText={(value) => setField('tone', value || null)} editable={editable} />
                <AppTextField label="Language" value={form.language ?? ''} onChangeText={(value) => setField('language', value || null)} editable={editable} />
                <AppTextField label="Instructions" multiline value={form.instructions ?? ''} onChangeText={(value) => setField('instructions', value || null)} editable={editable} />
                <AppTextField label="Fallback response" multiline value={form.fallbackReply ?? ''} onChangeText={(value) => setField('fallbackReply', value || null)} editable={editable} />
              </AgentSection>
              <AgentSection title="Conversation categories" summary={`${form.handledIntents.length} selected`}>
                {AGENT_INTENTS.map((item) => <AiAgentChoice key={item.id} label={item.label} selected={form.handledIntents.includes(item.id)} disabled={!editable}
                  onPress={() => setField('handledIntents', form.handledIntents.includes(item.id) ? form.handledIntents.filter((id) => id !== item.id) : [...form.handledIntents, item.id])} />)}
              </AgentSection>
              <AgentSection title="Capabilities" summary={`${form.capabilities.length} selected`}>
                {AGENT_CAPABILITIES.map((item) => <AiAgentChoice key={item.id} label={item.label} description={item.description} selected={form.capabilities.includes(item.id)} disabled={!editable}
                  onPress={() => setField('capabilities', form.capabilities.includes(item.id) ? form.capabilities.filter((id) => id !== item.id) : [...form.capabilities, item.id])} />)}
              </AgentSection>
              <AgentSection title="Deploy to channels" summary={`${form.channelIds.length} selected`}>
                <AppText variant="small" tone="secondary">Each channel can be assigned to one agent at a time.</AppText>
                <AppTextField placeholder="Search connected channels" value={channelSearch} onChangeText={setChannelSearch} />
                {channels.isPending ? <AppText tone="secondary">Loading channels...</AppText> : channels.isError ? <ErrorState message="Could not load channels." onRetry={() => channels.refetch()} /> : null}
                {visibleChannels.map((channel) => {
                  const owner = agents.data?.find((item) => item.id !== route.params.agentId && item.deployments.some((deployment) => deployment.channelId === channel.id));
                  return <AiAgentChoice key={channel.id} label={channel.name} description={owner ? `Assigned to ${owner.name}` : channel.type} leading={<ChannelLogo type={channel.type} box={28} glyph={16} radius={8} />}
                    selected={form.channelIds.includes(channel.id)} disabled={!editable || Boolean(owner)}
                    onPress={() => setField('channelIds', form.channelIds.includes(channel.id) ? form.channelIds.filter((id) => id !== channel.id) : [...form.channelIds, channel.id])} />;
                })}
                {!channels.isPending && !channels.isError && !visibleChannels.length ? <AppText tone="secondary">No matching connected channels.</AppText> : null}
                {form.channelIds.filter((id) => !availableChannels.some((channel) => channel.id === id)).map((id) => <AiAgentChoice key={id} label={agent?.deployments.find((deployment) => deployment.channelId === id)?.channel.name ?? 'Unavailable channel'} description="Not currently connected" selected disabled={!editable} onPress={() => setField('channelIds', form.channelIds.filter((current) => current !== id))} />)}
              </AgentSection>
              <AgentSection title="Knowledge base" summary={selectedKnowledge?.name ?? agent?.knowledgeBase?.name ?? 'None'}>
                {knowledge.isPending ? <AppText tone="secondary">Loading knowledge bases...</AppText> : knowledge.isError ? <ErrorState message="Could not load knowledge bases." onRetry={() => knowledge.refetch()} /> : <>
                  <AiAgentChoice label="No knowledge base" selected={!form.knowledgeBaseId} disabled={!editable} onPress={() => setField('knowledgeBaseId', null)} />
                  {(knowledge.data ?? []).map((base) => <AiAgentChoice key={base.id} label={base.name} description={`${base._count?.entries ?? base.entries?.length ?? 0} entries · ${base._count?.sources ?? base.sources?.length ?? 0} files`} selected={form.knowledgeBaseId === base.id} disabled={!editable} onPress={() => setField('knowledgeBaseId', base.id)} />)}
                </>}
                {selectedKnowledge ? <AppButton label={access.canUpdate ? 'Manage knowledge' : 'View knowledge'} variant="secondary" disabled={save.isPending} onPress={() => { setKnowledgeCreate(false); setKnowledgeOpen(true); }} /> : null}
                <AppButton label="Create knowledge base" variant="secondary" disabled={!editable || !form.channelIds.length} onPress={() => { setKnowledgeCreate(true); setKnowledgeOpen(true); }} />
                {!form.channelIds.length ? <AppText variant="small" tone="secondary">Select a channel before creating a knowledge base.</AppText> : null}
              </AgentSection>
              <AgentSection title="AI provider" summary={form.providerMode === 'CUSTOM' ? 'Custom' : 'Platform'}>
                <AppSegmentedControl options={[{ value: 'PLATFORM', label: 'Platform' }, { value: 'CUSTOM', label: 'Custom' }]} value={form.providerMode} onChange={(value) => { if (editable) setField('providerMode', value); }} />
                {form.providerMode === 'CUSTOM' ? <>
                  <AppTextField label="Model" required value={form.model ?? ''} editable={editable} onChangeText={(value) => setField('model', value || null)} autoCapitalize="none" />
                  <AppTextField label="Base URL" required value={form.baseUrl ?? ''} editable={editable} onChangeText={(value) => setField('baseUrl', value || null)} autoCapitalize="none" keyboardType="url" />
                  <AppTextField label="API key" value={form.apiKey} editable={editable} onChangeText={(value) => setField('apiKey', value)} secureTextEntry autoCapitalize="none" autoComplete="off" helpText={agent?.aiApiKeyConfigured ? 'A key is configured. Leave blank to keep it.' : 'Enter your provider API key.'} />
                </> : <AppText variant="small" tone="secondary">Use the workspace platform AI provider.</AppText>}
              </AgentSection>
              {access.canUpdate ? <AppButton label="Save draft" icon={Save} loading={save.isPending} disabled={!editable} block onPress={submit} /> : null}
            </ScrollView>
            {knowledgeOpen ? <AiAgentKnowledgeEditor visible base={knowledgeCreate ? null : selectedKnowledge ?? null} workspaceId={access.workspaceId!} channelId={form.channelIds[0]} canUpdate={editable}
              onClose={() => setKnowledgeOpen(false)} onCreated={(base) => { setField('knowledgeBaseId', base.id); setKnowledgeCreate(false); }} />
              : null}
          </KeyboardAvoidingView>}
    <ConfirmDialog visible={discard} title="Discard changes?" body="Your unsaved agent changes will be lost." confirmLabel="Discard" destructive onClose={() => setDiscard(false)} onConfirm={() => { setDiscard(false); setLeaveAllowed(true); }} />
  </View>;
}

function AgentSection({ title, summary, initiallyOpen = false, children }: { title: string; summary?: string; initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const { colors } = useTheme();
  return <AppCard style={styles.section}>
    <Pressable style={styles.sectionHeader} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={styles.copy}><AppText variant="section">{title}</AppText>{summary ? <AppText variant="small" tone="secondary">{summary}</AppText> : null}</View>
      {open ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
    </Pressable>
    {open ? <View style={styles.fields}>{children}</View> : null}
  </AppCard>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, content: { padding: spacing.lg, gap: spacing.md }, section: { gap: spacing.md }, sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm }, copy: { flex: 1 }, fields: { gap: spacing.md } });
