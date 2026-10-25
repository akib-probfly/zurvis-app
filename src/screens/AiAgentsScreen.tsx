import { useState } from 'react';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Bot, Pause, PencilLine, Play, Plus } from 'lucide-react-native';
import { FlatList, StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { activateAiAgent, pauseAiAgent, type AiAgent } from '../api/ai-agents';
import { useAiAgentAccess, useAiAgentMutation, useAiAgents, useAiAgentTemplates } from '../hooks/useAiAgents';
import { agentTypeLabel } from '../lib/ai-agent-form';
import type { SettingsStackParamList } from '../navigation/SettingsStack';
import { AppBadge, AppButton, AppCard, AppChip, AppSearchField, AppText, EmptyState, ScreenHeader } from '../ui';
import { ErrorState } from '../components/ErrorState';
import { ListSkeleton } from '../components/Skeleton';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/tokens';

export function AiAgentsScreen() {
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>();
  const { colors } = useTheme();
  const access = useAiAgentAccess();
  const [catalog, setCatalog] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const agents = useAiAgents(access.workspaceId, access.canRead);
  const templates = useAiAgentTemplates(access.canRead && catalog);
  const toggle = useAiAgentMutation((agent: AiAgent) => agent.status === 'ACTIVE' ? pauseAiAgent(agent.id) : activateAiAgent(agent.id));
  const query = catalog ? templates : agents;
  const items = (agents.data ?? []).filter((agent) => `${agent.name} ${agent.goal} ${agentTypeLabel(agent.agentType)} ${agent.status}`.toLowerCase().includes(search.toLowerCase()));
  const catalogItems = (templates.data ?? []).filter((template) => (category === 'All' || agentTypeLabel(template.type) === category) && `${template.title} ${template.description}`.toLowerCase().includes(search.toLowerCase()));
  const changeStatus = (agent: AiAgent) => {
    if (!access.canUpdate || toggle.isPending) return;
    toggle.mutate(agent, {
      onSuccess: () => Toast.show({ type: 'success', text1: agent.status === 'ACTIVE' ? 'Agent paused' : 'Agent activated' }),
      onError: (error) => Toast.show({ type: 'error', text1: 'Could not change agent status', text2: error.message }),
    });
  };
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <ScreenHeader title={catalog ? 'Agent catalog' : 'AI Agents'} onBack={() => catalog ? (setCatalog(false), setSearch('')) : navigation.goBack()}
      right={!catalog && access.canUpdate ? <AppButton label="Add agent" icon={Plus} size="sm" onPress={() => { setSearch(''); setCatalog(true); }} /> : undefined} />
    {access.loading ? <ListSkeleton rows={4} /> : access.error ? <ErrorState message="Could not load workspace access." onRetry={() => access.refetch()} /> : !access.canRead ? <EmptyState icon={Bot} title="Access unavailable" message="You need workspace settings access to view AI agents." /> : <>
      <View style={styles.controls}>
        {!catalog ? <AppText variant="small" tone="secondary">{agents.data?.length ?? 0} agents · {agents.data?.filter((agent) => agent.status === 'ACTIVE').length ?? 0} active</AppText> : null}
        <AppSearchField fill={false} value={search} onChangeText={setSearch} placeholder={catalog ? 'Search agent templates' : 'Search agents'} />
        {catalog ? <View style={styles.row}>{['All', 'Sales', 'Customer support', 'Custom'].map((label) => <AppChip key={label} label={label} selected={category === label} onPress={() => setCategory(label)} />)}</View> : null}
      </View>
      {query.isPending ? <ListSkeleton rows={4} /> : query.isError ? <ErrorState message="Could not load AI agents." onRetry={() => query.refetch()} /> : catalog ? <FlatList
        data={catalogItems} keyExtractor={(item) => item.type} contentContainerStyle={styles.content}
        ListEmptyComponent={<EmptyState title="No matching templates" message="Try another search or category." />}
        renderItem={({ item }) => <AppCard style={styles.card}><Bot size={24} color={colors.primary} /><AppText variant="section">{item.title}</AppText><AppText tone="secondary">{item.description}</AppText>
          <AppButton label={item.type === 'CUSTOM' ? 'Create custom agent' : 'Use template'} disabled={!access.canUpdate} onPress={() => navigation.navigate('AiAgentForm', { templateType: item.type })} />
        </AppCard>} /> : <FlatList data={items} keyExtractor={(item) => item.id} contentContainerStyle={styles.content}
          refreshing={agents.isRefetching} onRefresh={() => { void agents.refetch(); }}
          ListEmptyComponent={<EmptyState icon={Bot} title={search ? 'No matching agents' : 'No agents yet'} message={search ? 'Try another name or category.' : 'Choose a Sales or Support template, or create a custom agent.'}
            action={!search && access.canUpdate ? <AppButton label="Browse catalog" onPress={() => setCatalog(true)} /> : undefined} />}
          renderItem={({ item }) => <AppCard style={styles.card}>
            <View style={styles.heading}><Bot size={22} color={colors.primary} /><View style={styles.copy}><AppText variant="section">{item.name}</AppText><AppText variant="small" tone="secondary">{agentTypeLabel(item.agentType)}</AppText></View>
              <AppBadge label={item.status === 'ACTIVE' ? 'Active' : item.status === 'PAUSED' ? 'Paused' : 'Draft'} tone={item.status === 'ACTIVE' ? 'success' : item.status === 'PAUSED' ? 'warning' : 'neutral'} />
            </View>
            <AppText numberOfLines={3} tone="secondary">{item.goal}</AppText>
            <AppText variant="small" tone="secondary">{item.deployments.filter((deployment) => deployment.enabled).length} channels · {item.knowledgeBase?.name ?? 'No knowledge base'}</AppText>
            <View style={styles.row}><AppButton label={access.canUpdate ? 'Edit' : 'View'} icon={PencilLine} variant="secondary" onPress={() => navigation.navigate('AiAgentForm', { agentId: item.id })} />
              {access.canUpdate ? <AppButton label={item.status === 'ACTIVE' ? 'Pause' : 'Activate'} icon={item.status === 'ACTIVE' ? Pause : Play} loading={toggle.isPending && toggle.variables?.id === item.id} disabled={toggle.isPending} onPress={() => changeStatus(item)} /> : null}
            </View>
          </AppCard>} />}
    </>}
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, controls: { padding: spacing.md, gap: spacing.sm }, content: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.md }, card: { gap: spacing.md }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, heading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm }, copy: { flex: 1, minWidth: 0 } });
