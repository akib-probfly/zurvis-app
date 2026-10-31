import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Inbox, MessageSquareText, Percent, RefreshCw, Search, UserCheck, Users, Wifi } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useIsFocused, useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchDashboard } from '../api/dashboard';
import { fetchWorkspaceUsage } from '../api/billing';
import { NotificationBell, NotificationCenter } from '../components/NotificationCenter';
import { DashboardSkeleton } from '../components/Skeleton';
import { ColorfulAvatar } from '../components/ColorfulAvatar';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { workspaceIdFromAccessToken } from '../lib/jwt-workspace';
import { isBillingLocked, pollingWhileUnlocked } from '../lib/billing-lock';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  DashboardNumbersLoadingContext, BillingUsageCard, ChannelMix, compareValues, darkGradient, EMPTY_CHANNEL_MIX,
  formatDateRangeLabel, formatDuration, formatNumber, getTrendSnapshot,
  CarouselSection, LiveChannelStatus, MetricCarousel, MetricStack, mixHex, RangeSegment,
  resolveRange, styles as dashboardStyles, TeamCommandCenter, toUtcIso, UberCard,
  Section,
  type RangePreset,
} from '../components/DashboardComponents';
import { AppButton } from '../ui';
import type { MainTabParamList } from '../navigation/MainTabs';
export function DashboardScreen() {
  const { colors, isDark } = useTheme();
  const { session } = useAuth();
  const navigation = useNavigation<NavigationProp<MainTabParamList>>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const { canManage, workspace } = useWorkspaceAccess();
  const workspaceId = workspace?.id ?? workspaceIdFromAccessToken();
  const { width: windowWidth } = useWindowDimensions();
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const range = useMemo(() => resolveRange(preset), [preset]);
  const query = useMemo(() => ({ from: toUtcIso(range.from), to: toUtcIso(range.to), search: search.trim() || undefined }), [range, search]);
  const dashboard = useQuery({
    queryKey: ['dashboard', query],
    queryFn: () => fetchDashboard(query),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: pollingWhileUnlocked(() => (isFocused ? 30_000 : false)),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: () => !isBillingLocked(),
    placeholderData: keepPreviousData,
  });
  const usage = useQuery({
    queryKey: ['billing-usage', workspaceId],
    queryFn: () => fetchWorkspaceUsage(workspaceId!),
    enabled: canManage && Boolean(workspaceId),
    staleTime: 30_000,
  });

  // Silent refresh when returning to the tab — only if cached data is stale.
  useFocusEffect(
    useCallback(() => {
      if (isBillingLocked()) return;
      void queryClient.refetchQueries({ queryKey: ['dashboard', query], stale: true });
    }, [queryClient, query]),
  );

  const refetchDashboard = dashboard.refetch;

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refetchDashboard();
    } finally {
      setPullRefreshing(false);
    }
  }, [refetchDashboard]);

  const rangeLabel = formatDateRangeLabel(range.from, range.to);

  const summary = dashboard.data?.summary;
  const trends = useMemo(() => dashboard.data?.trends.conversationVolume ?? [], [dashboard.data?.trends.conversationVolume]);
  const snapshot = useMemo(() => getTrendSnapshot(trends), [trends]);
  const mix = dashboard.data?.channelMix ?? EMPTY_CHANNEL_MIX;
  const channelsCount = dashboard.data?.channelHealth?.length ?? mix.length;
  const teamMembers = dashboard.data?.teamCommandCenter?.summary.totalMembers ?? dashboard.data?.agentPerformance?.length ?? 0;

  const metrics = useMemo(() => {
    const totalCmp = compareValues(snapshot.total.previous, snapshot.total.current, true);
    const respCmp = compareValues(snapshot.response.previous, snapshot.response.current, false);
    const rateCmp = compareValues(snapshot.rate.previous, snapshot.rate.current, true);
    return [
      { label: 'Conversations', value: formatNumber(summary?.totalConversations), note: 'vs prior period', color: isDark ? '#d9f99d' : '#3f6212', colors: isDark ? darkGradient(['#ecfccb', '#a3e635']) : ['#ecfccb', '#a3e635'] as [string, string], Icon: MessageSquareText, delta: totalCmp },
      { label: 'Unique contacts', value: formatNumber(summary?.uniqueContactsCreated), note: 'in range', color: isDark ? '#fdba74' : '#9a3412', colors: isDark ? darkGradient(['#ffedd5', '#fb923c']) : ['#ffedd5', '#fb923c'] as [string, string], Icon: Users, delta: null },
      ...(canManage
        ? [{ label: 'Unassigned', value: formatNumber(summary?.unassignedConversations), note: 'needs owner', color: isDark ? '#7dd3fc' : '#075985', colors: isDark ? darkGradient(['#e0f2fe', '#38bdf8']) : ['#e0f2fe', '#38bdf8'] as [string, string], Icon: Inbox, delta: null }]
        : []),
      { label: 'Assigned', value: formatNumber(summary?.assignedConversations), note: 'with agents', color: isDark ? '#86efac' : '#166534', colors: isDark ? darkGradient(['#dcfce7', '#4ade80']) : ['#dcfce7', '#4ade80'] as [string, string], Icon: UserCheck, delta: null },
      { label: 'First response', value: formatDuration(summary?.avgFirstResponseMinutes ?? null), note: 'vs prior period', color: isDark ? '#fca5a5' : '#991b1b', colors: isDark ? darkGradient(['#fee2e2', '#f87171']) : ['#fee2e2', '#f87171'] as [string, string], Icon: Clock3, delta: respCmp },
      { label: 'Resolution rate', value: `${(summary?.resolutionRate ?? 0).toFixed(1)}%`, note: 'vs prior period', color: isDark ? '#6ee7b7' : '#065f46', colors: isDark ? darkGradient(['#d1fae5', '#34d399']) : ['#d1fae5', '#34d399'] as [string, string], Icon: Percent, delta: rateCmp },
    ];
  }, [summary, snapshot, isDark, canManage]);

  const overview = useMemo(() => [
    { label: 'Conversations', value: formatNumber(summary?.totalConversations), note: 'Total in selected range', colors: isDark ? darkGradient(['#1d4ed8', '#60a5fa']) : ['#1d4ed8', '#60a5fa'] as [string, string], Icon: MessageSquareText },
    ...(canManage
      ? [
        { label: 'Channels', value: formatNumber(channelsCount), note: 'Connected in workspace', colors: isDark ? darkGradient(['#0f766e', '#2dd4bf']) : ['#0f766e', '#2dd4bf'] as [string, string], Icon: Wifi },
        { label: 'Team', value: formatNumber(teamMembers), note: 'Agents in command center', colors: isDark ? darkGradient(['#7c3aed', '#c4b5fd']) : ['#7c3aed', '#c4b5fd'] as [string, string], Icon: Users },
      ]
      : []),
  ], [summary?.totalConversations, canManage, channelsCount, teamMembers, isDark]);

  const applySearch = () => setSearch(searchInput.trim());
  const glanceWidth = Math.max(windowWidth - 32, 280);
  const introGradient = useMemo<[string, string, string]>(() => isDark
    ? [mixHex(colors.primary, colors.background, 0.76), mixHex(colors.primary, colors.background, 0.86), colors.background]
    : [mixHex(colors.primary, '#ffffff', 0.9), mixHex(colors.primary, '#ffffff', 0.84), mixHex(colors.primary, '#ffffff', 0.78)], [isDark, colors.primary, colors.background]);

  return (
    <View style={[dashboardStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[dashboardStyles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={colors.primary} />}
      >
        <LinearGradient
          colors={introGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[dashboardStyles.dashboardIntro, { paddingTop: insets.top + 12 }]}
        >
          <View pointerEvents="none" style={dashboardStyles.introPatternLarge} />
          <View pointerEvents="none" style={dashboardStyles.introPatternSmall} />
          <View style={dashboardStyles.dashboardHeaderIdentity}>
            <View style={dashboardStyles.greetingCopy}>
              <Text style={[dashboardStyles.greeting, { color: colors.textSecondary }]}>Hello,</Text>
              <Text style={[dashboardStyles.greetingName, { color: colors.text }]} numberOfLines={1}>{session?.user.name?.trim() || 'Welcome back'}!</Text>
            </View>
            <View style={dashboardStyles.headerActions}>
              <NotificationBell onOpen={() => setNotificationsOpen(true)} />
              <View style={[dashboardStyles.headerAvatar, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                <ColorfulAvatar name={session?.user.name ?? session?.user.email ?? 'You'} size={40} url={session?.user.avatarUrl ?? null} />
              </View>
            </View>
          </View>
          <Text style={[dashboardStyles.heroDate, { color: colors.textMuted }]} numberOfLines={1}>{rangeLabel}</Text>
          <View style={[dashboardStyles.headerSearch, {
            backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.78)',
            borderColor: isDark ? colors.cardBorder : 'rgba(255,255,255,0.9)',
          }]}>
            <Search color={colors.textMuted} size={17} />
            <TextInput
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={applySearch}
              returnKeyType="search"
              placeholder={canManage ? 'Search agents, channels…' : 'Search conversations…'}
              placeholderTextColor={colors.textMuted}
              style={[dashboardStyles.searchInput, { color: colors.text }]}
            />
            {searchInput ? (
              <Pressable onPress={() => { setSearchInput(''); setSearch(''); }} hitSlop={8}>
                <Text style={[dashboardStyles.clearSearch, { color: colors.primary }]}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={dashboardStyles.periodRow}>
            <View style={dashboardStyles.periodCopy}>
              <Text style={[dashboardStyles.periodTitle, { color: colors.text }]}>Period</Text>
              <Text style={[dashboardStyles.periodSubtitle, { color: colors.textMuted }]}>Choose a range</Text>
            </View>
            <RangeSegment value={preset} onChange={setPreset} colors={colors} />
          </View>
        </LinearGradient>

        {dashboard.isLoading && !dashboard.data ? (
          <DashboardSkeleton />
        ) : dashboard.isError ? (
          <View style={[dashboardStyles.errorBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[dashboardStyles.errorTitle, { color: colors.text }]}>Dashboard offline</Text>
            <Text style={[dashboardStyles.errorText, { color: colors.textSecondary }]}>{dashboard.error instanceof Error ? dashboard.error.message : 'Unable to load live metrics.'}</Text>
            <AppButton icon={RefreshCw} label="Try again" onPress={() => { void dashboard.refetch(); }} style={dashboardStyles.retryBtn} />
          </View>
        ) : (
          <DashboardNumbersLoadingContext.Provider value={dashboard.isFetching && dashboard.isPlaceholderData}>
            <CarouselSection title="At a glance" colors={colors}>
              <MetricStack itemCount={overview.length}>
                {overview.map((item) => {
                  const Icon = item.Icon;
                  return (
                    <UberCard
                      key={item.label}
                      width={glanceWidth}
                      colors={item.colors}
                      isDark={isDark}
                      icon={<Icon color={isDark ? colors.text : '#fff'} size={20} strokeWidth={2.2} />}
                      value={item.value}
                      title={item.label}
                      subtitle={item.note}
                    />
                  );
                })}
              </MetricStack>
            </CarouselSection>

            <MetricCarousel title="Key metrics" metrics={metrics} colors={colors} isDark={isDark} />

            {canManage ? <Section title="Current usage" subtitle="Your billing cycle at a glance" colors={colors}>
              <BillingUsageCard
                usage={usage.data}
                loading={usage.isLoading}
                onPress={() => navigation.navigate('Settings', { screen: 'Billing', params: { tab: 'current' } })}
                colors={colors}
              />
            </Section> : null}

            <Section title="Channel mix" colors={colors}>
              <ChannelMix mix={mix} colors={colors} />
            </Section>
            {canManage ? (
              <>
                <TeamCommandCenter data={dashboard.data} colors={colors} isDark={isDark} />
                <LiveChannelStatus data={dashboard.data} colors={colors} />
              </>
            ) : null}

            <Text style={[dashboardStyles.footerNote, { color: colors.textMuted }]}>Scoped to the current workspace. Search and date range update every section.</Text>
          </DashboardNumbersLoadingContext.Provider>
        )}
      </ScrollView>

      <NotificationCenter visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </View>
  );
}
