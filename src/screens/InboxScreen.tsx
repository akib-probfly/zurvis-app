import { infiniteQueryOptions, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Ban, Check, CheckCircle2, CircleSlash, CircleX, Filter, Image as ImageIcon, Inbox, Mail, Mic, Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Search, Star, Video, X } from 'lucide-react-native';
import { Animated, Easing, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { ChatIcon } from '../components/ChatIcon';
import { AppToggle } from '../components/AppToggle';
import { BottomSheet, SheetScrollView } from '../components/BottomSheet';
import { ColorfulAvatar } from '../components/ColorfulAvatar';
import { ErrorState } from '../components/ErrorState';
import { ChannelLogo } from '../components/ChannelLogo';
import { ChannelTypeFilterList } from '../components/ChannelTypeFilterList';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { InboxCallsPane } from '../components/InboxCallsPane';
import { ListSkeleton, PanelSkeleton } from '../components/Skeleton';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { fetchConversations, fetchConversationCount, fetchConversationMessages, fetchConversationUnreadCount, fetchAssigneeOptions, type ConversationCallSession, type ConversationListItem } from '../api/inbox';
import { fetchWorkspaceTags } from '../api/conversationDetails';
import { countryDialCodeQueryKey, fetchCountryDialCodes } from '../api/countryDialCodes';
import { apiFetch } from '../api/client';
import { type Channel } from '../api/channels';
import { groupChannelsByType } from '../lib/channel-filter-groups';
import {
  getCallPreviewChipConfig,
  getConversationLastInteractionPresentation,
  isAudioPreview,
  isImagePreview,
  isVideoPreview,
  isVoiceNotePreview,
} from '../lib/conversation-last-interaction';
import { isConversationCustomerWindowExpired } from '../lib/inbox-utils';
import { getCountryFlag } from '../lib/countryFromPhone';
import { applyUnreadOverrideToPage } from '../lib/unread-count-override';
import { isBillingLocked, pollingWhileUnlocked } from '../lib/billing-lock';
import { getRealtimeConnectionStatus, subscribeRealtimeConnectionStatus } from '../api/realtime';
import { useTheme } from '../theme/ThemeContext';
import { AppBadge } from '../ui';
import { chipSize, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type SidebarTab = 'chats' | 'calls';
type Tab = 'all' | 'unread' | 'closed';

// Matches the backend conversation search validation and trigram index minimum.
const CONVERSATION_SEARCH_MIN_LENGTH = 3;

function inboxConversationOptions(filters: Parameters<typeof fetchConversations>[0]) {
  return infiniteQueryOptions({
    queryKey: ['conversations', filters],
    queryFn: async ({ pageParam }) => {
      const result = await fetchConversations({ ...filters, limit: 25, cursor: pageParam });
      return { ...result, items: applyUnreadOverrideToPage(result.items) };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pageInfo?.hasMore ? (lastPage.pageInfo.nextCursor ?? undefined) : undefined,
    staleTime: 15_000,
  });
}
type FilterLayer = 'channels' | 'tags' | 'countries' | 'users' | 'more';
type AssignmentFilter = 'any' | 'assigned' | 'unassigned';
type BanStatusFilter = 'all' | 'blocked' | 'unblocked';

const FILTER_LAYERS: Array<{ id: FilterLayer; label: string }> = [
  { id: 'channels', label: 'Channels' },
  { id: 'tags', label: 'Tags' },
  { id: 'countries', label: 'Countries' },
  { id: 'users', label: 'Users' },
  { id: 'more', label: 'More' },
];

const ASSIGNEE_ROLE_LABELS: Record<string, string> = {
  workspace_admin: 'Admin',
  workspace_manager: 'Manager',
  workspace_agent: 'Agent',
};

export function InboxScreen() {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');
  const [tab, setTab] = useState<Tab>('all');
  const [selectedTab, setSelectedTab] = useState<Tab>('all');
  const [tabPending, startTabTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [unrepliedOnly, setUnrepliedOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterLayer, setFilterLayer] = useState<FilterLayer>('channels');
  const [assignment, setAssignment] = useState<AssignmentFilter>('any');
  const [blockedStatus, setBlockedStatus] = useState<BanStatusFilter>('all');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [expandedPlatformKeys, setExpandedPlatformKeys] = useState<string[]>([]);
  const [createdAtFrom, setCreatedAtFrom] = useState<string | null>(null);
  const [createdAtTo, setCreatedAtTo] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [countrySearchInput, setCountrySearchInput] = useState('');
  const [tagTextInput, setTagTextInput] = useState('');
  const [debouncedTagText, setDebouncedTagText] = useState('');
  const [userSearchInput, setUserSearchInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const includeEmpty = Boolean(
    debouncedSearch.trim()
    || selectedTagIds.length
    || debouncedTagText.trim()
    || channelIds.length
    || countryCodes.length
    || assigneeIds.length
    || assignment !== 'any'
    || blockedStatus !== 'all'
    || starredOnly
    || unrepliedOnly
    || Boolean(createdAtFrom || createdAtTo),
  );

  const filters = useMemo(() => ({
    status: tab === 'closed' ? 'CLOSED' as const : undefined,
    unreadOnly: tab === 'unread' ? true : undefined,
    unrepliedOnly: unrepliedOnly || undefined,
    starredOnly: starredOnly || undefined,
    assignment: assignment === 'any' ? undefined : assignment,
    channelIds: channelIds.length ? channelIds : undefined,
    countryCodes: countryCodes.length ? countryCodes : undefined,
    assigneeWorkspaceMemberIds: assigneeIds.length ? assigneeIds : undefined,
    tagIds: selectedTagIds.length ? selectedTagIds : undefined,
    tagText: debouncedTagText.trim() || undefined,
    search: debouncedSearch.trim() || undefined,
    includeEmpty: includeEmpty || undefined,
    blockedStatus: blockedStatus === 'all' ? undefined : blockedStatus,
    createdAtFrom: createdAtFrom ?? undefined,
    createdAtTo: createdAtTo ?? undefined,
  }), [tab, unrepliedOnly, starredOnly, debouncedSearch, assignment, channelIds, countryCodes, assigneeIds, selectedTagIds, debouncedTagText, includeEmpty, blockedStatus, createdAtFrom, createdAtTo]);

  const advancedFilterParams = useMemo(() => ({
    search: debouncedSearch.trim() || undefined,
    tagIds: selectedTagIds.length ? selectedTagIds : undefined,
    tagText: debouncedTagText.trim() || undefined,
    channelIds: channelIds.length ? channelIds : undefined,
    countryCodes: countryCodes.length ? countryCodes : undefined,
    assigneeWorkspaceMemberIds: assigneeIds.length ? assigneeIds : undefined,
    assignment: assignment === 'any' ? undefined : assignment,
    starredOnly: starredOnly || undefined,
    blockedStatus: blockedStatus === 'all' ? undefined : blockedStatus,
    createdAtFrom: createdAtFrom ?? undefined,
    createdAtTo: createdAtTo ?? undefined,
  }), [debouncedSearch, selectedTagIds, debouncedTagText, channelIds, countryCodes, assigneeIds, assignment, starredOnly, blockedStatus, createdAtFrom, createdAtTo]);

  const assigneesQuery = useQuery({
    queryKey: ['assignee-filter-options'],
    queryFn: () => fetchAssigneeOptions(),
    enabled: filterOpen,
    staleTime: 60_000,
  });
  const assigneeOptions = useMemo(() => assigneesQuery.data ?? [], [assigneesQuery.data]);
  const visibleAssigneeOptions = useMemo(() => {
    const query = userSearchInput.trim().toLowerCase();
    const matches = (member: (typeof assigneeOptions)[number]) => {
      if (!query) return true;
      return `${member.name ?? ''} ${member.email}`.toLowerCase().includes(query);
    };
    // Selected members stay pinned on top (same as the tags tab), then the rest.
    const selected = assigneeOptions.filter((member) => assigneeIds.includes(member.workspaceMemberId) && matches(member));
    const rest = assigneeOptions.filter((member) => !assigneeIds.includes(member.workspaceMemberId) && matches(member));
    return [...selected, ...rest];
  }, [assigneeOptions, userSearchInput, assigneeIds]);

  const tagsQuery = useQuery({
    queryKey: ['workspace-tags'],
    queryFn: () => fetchWorkspaceTags(),
    enabled: filterOpen,
    staleTime: 60_000,
  });
  const countriesQuery = useQuery({
    queryKey: countryDialCodeQueryKey,
    queryFn: fetchCountryDialCodes,
    enabled: filterOpen,
    staleTime: 24 * 60 * 60 * 1_000,
  });
  const channelsQuery = useQuery({
    queryKey: ['channels', 'inbox-filter'],
    queryFn: () => apiFetch<{ items: Channel[] }>('/channels?page=1&limit=100&sortBy=createdAt&sortOrder=desc'),
    enabled: filterOpen,
    staleTime: 60_000,
  });
  const channelFilterGroups = useMemo(
    () => groupChannelsByType(channelsQuery.data?.items ?? []),
    [channelsQuery.data?.items],
  );
  const workspaceTags = useMemo(() => tagsQuery.data?.items ?? [], [tagsQuery.data?.items]);
  const visibleCountries = useMemo(() => {
    const query = countrySearchInput.trim().toLowerCase();
    const countries = countriesQuery.data ?? [];
    const selected = countries.filter((country) => countryCodes.includes(country.isoCode));
    const remaining = countries.filter((country) => {
      if (countryCodes.includes(country.isoCode)) return false;
      if (!query) return true;
      const dialQuery = query.replace(/\D/g, '');
      return country.name.toLowerCase().includes(query)
        || country.isoCode.toLowerCase().includes(query)
        || Boolean(dialQuery && country.dialCode.includes(dialQuery));
    });
    return [...selected, ...remaining];
  }, [countriesQuery.data, countryCodes, countrySearchInput]);
  const visibleTagOptions = useMemo(() => {
    const query = tagTextInput.trim().toLowerCase();
    const active = workspaceTags.filter((tag) => selectedTagIds.includes(tag.id));
    const rest = workspaceTags.filter((tag) => {
      if (selectedTagIds.includes(tag.id)) return false;
      if (!query) return true;
      return tag.text.toLowerCase().includes(query);
    });
    return [...active, ...rest];
  }, [workspaceTags, selectedTagIds, tagTextInput]);

  const hasTagFilters = selectedTagIds.length > 0 || debouncedTagText.trim().length > 0;
  const hasAdvancedFilters = hasTagFilters
    || channelIds.length > 0
    || countryCodes.length > 0
    || assigneeIds.length > 0
    || assignment !== 'any'
    || starredOnly
    || blockedStatus !== 'all'
    || Boolean(createdAtFrom || createdAtTo);
  const canClearFilters = hasAdvancedFilters || unrepliedOnly;

  const resetFilters = () => {
    setAssignment('any');
    setChannelIds([]);
    setCountryCodes([]);
    setCountrySearchInput('');
    setExpandedPlatformKeys([]);
    setCreatedAtFrom(null);
    setCreatedAtTo(null);
    setAssigneeIds([]);
    setSelectedTagIds([]);
    setTagTextInput('');
    setDebouncedTagText('');
    setUserSearchInput('');
    setStarredOnly(false);
    setUnrepliedOnly(false);
    setBlockedStatus('all');
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      setDebouncedSearch(trimmed.length >= CONVERSATION_SEARCH_MIN_LENGTH ? trimmed : '');
    }, 500);
  };

  const onTagTextChange = (value: string) => {
    setTagTextInput(value);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTagText(tagTextInput.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [tagTextInput]);

  const realtimeStatus = useSyncExternalStore(subscribeRealtimeConnectionStatus, getRealtimeConnectionStatus);
  // Realtime should drive updates; keep a slow poll even when "connected" because mobile
  // sockets can go zombie (no disconnect event) and then stop delivering events.
  const inboxPollMs = realtimeStatus === 'connected' ? 60_000 : 20_000;

  const conversations = useInfiniteQuery({
    ...inboxConversationOptions(filters),
    placeholderData: () => {
      if (!filters.unreadOnly && filters.status !== 'CLOSED') return undefined;
      const allOptions = inboxConversationOptions({ ...filters, status: undefined, unreadOnly: undefined });
      const cached = queryClient.getQueryData(allOptions.queryKey);
      if (!cached) return undefined;
      const matching = cached.pages.flatMap((page) => applyUnreadOverrideToPage(page.items))
        .filter((item) => filters.unreadOnly ? item.unreadCount > 0 : item.status === 'CLOSED');
      // A partial All cache cannot establish that a filtered tab is empty.
      if (!matching.length) return undefined;
      return { pages: [{ items: matching, pageInfo: { hasMore: false, nextCursor: null } }], pageParams: [undefined] };
    },
    enabled: sidebarTab === 'chats',
    refetchInterval: pollingWhileUnlocked(inboxPollMs),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isFocused || sidebarTab !== 'chats' || !conversations.isSuccess || conversations.isPlaceholderData || isBillingLocked()) return;
    // Warm only missing tab caches; never copy rows across filters or reload paginated caches.
    for (const nextTab of ['all', 'unread', 'closed'] as const) {
      if (nextTab === tab) continue;
      const options = inboxConversationOptions({
        ...filters,
        status: nextTab === 'closed' ? 'CLOSED' : undefined,
        unreadOnly: nextTab === 'unread' ? true : undefined,
      });
      if (queryClient.getQueryData(options.queryKey) === undefined) {
        void queryClient.prefetchInfiniteQuery({ ...options, pages: 1 });
      }
    }
  }, [isFocused, sidebarTab, conversations.isSuccess, conversations.isPlaceholderData, tab, filters, queryClient]);

  const unreadCount = useQuery({
    queryKey: ['inbox-unread-count', advancedFilterParams],
    queryFn: () => fetchConversationUnreadCount(advancedFilterParams),
    staleTime: 15_000,
    refetchInterval: pollingWhileUnlocked(inboxPollMs),
    refetchOnWindowFocus: false,
  });

  const closedCount = useQuery({
    queryKey: ['conversation-count', { ...filters, status: 'CLOSED' as const }],
    queryFn: () => fetchConversationCount({ ...filters, status: 'CLOSED' }),
    enabled: sidebarTab === 'chats' && tab === 'closed',
    staleTime: 15_000,
    refetchInterval: pollingWhileUnlocked(inboxPollMs),
    refetchOnWindowFocus: false,
  });

  const openCallConversation = useCallback((session: ConversationCallSession) => {
    const contactName = session.conversation?.contact.displayName
      ?? session.recipientDisplayName
      ?? session.conversation?.contact.primaryPhone
      ?? session.recipientIdentityValue
      ?? 'Unknown contact';
    navigation.navigate('Conversation', {
      conversationId: session.conversationId,
      contactName,
      workspaceId: session.conversation?.workspaceId ?? session.workspaceId,
      channelId: session.conversation?.channel.channelId,
      channelType: session.conversation?.channel.channelType,
    });
  }, [navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['conversation-count'] });
      await queryClient.invalidateQueries({ queryKey: ['inbox-unread-count'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const items = useMemo(() => {
    const visibleItems: ConversationListItem[] = [];
    for (const page of conversations.data?.pages ?? []) {
      for (const item of page.items) {
        if (filters.unreadOnly && item.unreadCount <= 0) continue;
        visibleItems.push(item);
      }
    }
    return visibleItems;
  }, [conversations.data, filters.unreadOnly]);
  const unreadConversationCountFromList = useMemo(
    () => items.reduce((count, item) => count + (item.unreadCount > 0 ? 1 : 0), 0),
    [items],
  );
  const apiUnreadConversationCount = typeof unreadCount.data === 'number'
    ? unreadCount.data
    : Math.max(0, Number((unreadCount.data as { count?: number } | undefined)?.count ?? 0) || 0);
  // Badge can lag behind optimistic row unread; never show less than what's visible in the list.
  const chatsUnreadCount = Math.max(apiUnreadConversationCount, unreadConversationCountFromList);
  const keyExtractor = useCallback((item: ConversationListItem) => item.id, []);
  const renderConversationRow = useCallback(
    ({ item }: { item: ConversationListItem }) => (
      <ConversationRow conversation={item} navigation={navigation} queryClient={queryClient} />
    ),
    [navigation, queryClient],
  );

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, flex: 1 }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
        <View style={styles.headerTitleLine}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
        </View>
        <View style={styles.sidebarTabs}>
          <Pressable style={styles.sidebarTab} onPress={() => setSidebarTab('chats')}>
            <ChatIcon color={sidebarTab === 'chats' ? colors.primary : colors.textMuted} size={15} />
            <Text style={[styles.sidebarTabText, { color: sidebarTab === 'chats' ? colors.primary : colors.textMuted }]}>Chats</Text>
            {chatsUnreadCount > 0 ? (
              <Text style={[styles.sidebarTabCount, { backgroundColor: colors.primary, color: colors.primaryText }]}>
                {chatsUnreadCount > 99 ? '99+' : chatsUnreadCount}
              </Text>
            ) : null}
            {sidebarTab === 'chats' ? <View style={[styles.sidebarTabUnderline, { backgroundColor: colors.primary }]} /> : null}
          </Pressable>
          <Pressable style={styles.sidebarTab} onPress={() => setSidebarTab('calls')}>
            <Phone color={sidebarTab === 'calls' ? colors.primary : colors.textMuted} size={15} />
            <Text style={[styles.sidebarTabText, { color: sidebarTab === 'calls' ? colors.primary : colors.textMuted }]}>Calls</Text>
            {sidebarTab === 'calls' ? <View style={[styles.sidebarTabUnderline, { backgroundColor: colors.primary }]} /> : null}
          </Pressable>
        </View>
      </View>

      {sidebarTab === 'calls' ? (
        <InboxCallsPane onOpenConversation={openCallConversation} />
      ) : (
        <>
          <View style={[styles.searchRow, { borderBottomColor: colors.separator }]}>
            <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.inputBorder }]}>
              <Search color={colors.textMuted} size={16} />
              <TextInput value={search} onChangeText={onSearchChange} placeholder="Search (min. 3 characters)" placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text }]} />
              {search ? <Pressable onPress={() => { if (searchTimer.current) clearTimeout(searchTimer.current); setSearch(''); setDebouncedSearch(''); }}><Text style={[styles.clearSearch, { color: colors.textMuted }]}>✕</Text></Pressable> : null}
            </View>
            <Pressable style={[styles.filterButton, { borderColor: hasAdvancedFilters ? colors.primary : colors.cardBorder }]} onPress={() => setFilterOpen(true)}>
              <Filter color={hasAdvancedFilters ? colors.primary : colors.textSecondary} size={15} />
              {hasAdvancedFilters ? <View style={[styles.filterActiveDot, { backgroundColor: colors.primary }]} /> : null}
            </Pressable>
          </View>

          <View style={[styles.filtersRow, { borderBottomColor: colors.separator }]}>
            <View style={[styles.filters, { backgroundColor: colors.surfaceSecondary }]}>
              {(['all', 'unread', 'closed'] as Tab[]).map((key) => {
                const active = selectedTab === key;
                return (
                  <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.filterPill, active && styles.filterPillActive, active && { backgroundColor: colors.surface }]} onPress={() => {
                    setSelectedTab(key);
                    startTabTransition(() => setTab(key));
                  }}>
                    <Text style={[styles.filterText, { color: active ? colors.text : colors.textSecondary }]}>
                      {key === 'all' ? 'All' : key === 'unread' ? 'Unread' : 'Closed'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={[styles.unrepliedToggle, { borderColor: colors.cardBorder }, unrepliedOnly && styles.unrepliedToggleActive, unrepliedOnly && { backgroundColor: colors.surfaceSecondary, borderColor: colors.primary }]}
              onPress={() => setUnrepliedOnly((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: unrepliedOnly }}
              accessibilityLabel="Unreplied only"
            >
              <AppToggle value={unrepliedOnly} variant="sidebar" />
              <Text style={[styles.unrepliedLabel, { color: unrepliedOnly ? colors.primary : colors.textSecondary }]}>Unreplied</Text>
            </Pressable>
          </View>

          {tab === 'closed' ? (
            <View style={styles.closedCountRow}>
              <Text style={[styles.closedCountLabel, { color: colors.textMuted }]}>Closed chats</Text>
              <Text accessibilityLiveRegion="polite" style={[styles.closedCountValue, { color: colors.textSecondary }]}>
                {closedCount.data !== undefined ? new Intl.NumberFormat().format(closedCount.data) : closedCount.isError ? 'Unavailable' : 'Loading…'}
              </Text>
            </View>
          ) : null}

          {tabPending || conversations.isPlaceholderData || conversations.isLoading ? <ListSkeleton rows={8} />
          : conversations.isError ? <ErrorState message="Unable to load conversations." onRetry={() => conversations.refetch()} />
          : (
            <FlatList
              style={styles.listFill}
              data={items}
              keyExtractor={keyExtractor}
              renderItem={renderConversationRow}
              ListEmptyComponent={(
                <View style={styles.empty}>
                  <Inbox color={colors.textMuted} size={44} />
                  <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>No conversations</Text>
                  <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                    {canClearFilters || debouncedSearch.trim()
                      ? 'No conversations match the current filters.'
                      : 'New conversations will appear here in real time.'}
                  </Text>
                  {canClearFilters || debouncedSearch.trim() ? (
                    <Pressable
                      style={[styles.emptyClearButton, { backgroundColor: colors.surfaceSecondary }]}
                      onPress={() => {
                        resetFilters();
                        setSearch('');
                        setDebouncedSearch('');
                      }}
                    >
                      <Text style={[styles.emptyClearButtonText, { color: colors.primary }]}>Clear filters</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              // Start fetching with two viewport lengths left to scroll.
              onEndReachedThreshold={2}
              onEndReached={() => { if (!tabPending && !conversations.isPlaceholderData && conversations.hasNextPage && !conversations.isFetchingNextPage) void conversations.fetchNextPage(); }}
              contentContainerStyle={styles.list}
              removeClippedSubviews={false}
              initialNumToRender={12}
              windowSize={8}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
            />
          )}
        </>
      )}

      <BottomSheet visible={filterOpen && sidebarTab === 'chats'} onClose={() => setFilterOpen(false)} sheetStyle={styles.filterSheetSurface}>
          <View style={styles.filterSheetHeader}>
              <Text style={[styles.filterSheetTitle, { color: colors.text }]}>Filters</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.filterLayerTabs, { backgroundColor: colors.surfaceSecondary }]} contentContainerStyle={styles.filterLayerTabsContent}>
              {FILTER_LAYERS.map((layer) => {
                const active = filterLayer === layer.id;
                return (
                  <Pressable key={layer.id} style={[styles.filterLayerTab, active && styles.filterLayerTabActive, active && { backgroundColor: colors.surface }]} onPress={() => setFilterLayer(layer.id)}>
                    <Text style={[styles.filterLayerTabText, { color: active ? colors.text : colors.textSecondary }]}>{layer.label}</Text>
                    {layer.id === 'countries' && countryCodes.length ? <Text style={[styles.filterLayerCount, { backgroundColor: active ? `${colors.primary}18` : colors.surfaceSecondary, color: active ? colors.primary : colors.textSecondary }]}>{countryCodes.length}</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <SheetScrollView style={styles.filterLayerBody} contentContainerStyle={styles.filterLayerContent} keyboardShouldPersistTaps="handled">
              {filterLayer === 'channels' ? (
                <ChannelTypeFilterList
                  groups={channelFilterGroups}
                  selectedIds={channelIds}
                  onChange={setChannelIds}
                  expandedKeys={expandedPlatformKeys}
                  onExpandedKeysChange={setExpandedPlatformKeys}
                  searchable
                  loading={channelsQuery.isLoading}
                />
              ) : null}

              {filterLayer === 'tags' ? (
                <>
                  <View style={[styles.inlineSearch, { backgroundColor: colors.surface, borderColor: colors.inputBorder }]}>
                    <Search color={colors.textMuted} size={16} />
                    <TextInput
                      value={tagTextInput}
                      onChangeText={onTagTextChange}
                      placeholder="Search tags..."
                      placeholderTextColor={colors.textMuted}
                      style={[styles.inlineSearchInput, { color: colors.text }]}
                    />
                  </View>
                  <Text style={[styles.selectedCount, { color: colors.textSecondary }]}>{selectedTagIds.length} selected</Text>
                  {tagsQuery.isLoading ? <PanelSkeleton rows={4} /> : (
                    <View style={styles.tagCloud}>
                      {visibleTagOptions.map((tag) => {
                        const active = selectedTagIds.includes(tag.id);
                        const tagColor = tag.color?.trim() || colors.textMuted;
                        return (
                          <Pressable
                            key={tag.id}
                            style={[
                              styles.tagPill,
                              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                              active && [styles.tagPillActive, { borderColor: colors.primary, backgroundColor: `${colors.primary}12` }],
                            ]}
                            onPress={() => setSelectedTagIds((current) => active ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                          >
                            <View style={[styles.tagPillDot, { backgroundColor: tagColor }]} />
                            <Text style={[styles.tagPillText, { color: active ? colors.primary : colors.textSecondary }, active && styles.tagPillTextActive]} numberOfLines={1}>{tag.text}</Text>
                            {active ? <Check color={colors.primary} size={12} strokeWidth={3} /> : null}
                          </Pressable>
                        );
                      })}
                      {!visibleTagOptions.length ? <Text style={[styles.emptyFilterHint, { color: colors.textMuted }]}>No tags match the current search</Text> : null}
                    </View>
                  )}
                </>
              ) : null}

              {filterLayer === 'countries' ? (
                <>
                  {countryCodes.length ? (
                    <View style={styles.countryChipList}>
                      {countryCodes.map((isoCode) => {
                        const country = countriesQuery.data?.find((item) => item.isoCode === isoCode);
                        return (
                          <Pressable
                            key={isoCode}
                            style={[styles.countryChip, { backgroundColor: colors.surface, borderColor: colors.primary }]}
                            onPress={() => setCountryCodes((current) => current.filter((code) => code !== isoCode))}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${country?.name ?? isoCode} country filter`}
                          >
                            <Text style={styles.countryFlag}>{country ? getCountryFlag(country.isoCode) : '🌐'}</Text>
                            <Text style={[styles.countryChipText, { color: colors.primary }]}>{country ? `${country.name} (+${country.dialCode})` : isoCode}</Text>
                            <X color={colors.textMuted} size={13} />
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  <View style={[styles.inlineSearch, { backgroundColor: colors.surface, borderColor: colors.inputBorder }]}>
                    <Search color={colors.textMuted} size={16} />
                    <TextInput
                      value={countrySearchInput}
                      onChangeText={setCountrySearchInput}
                      placeholder="Search countries..."
                      placeholderTextColor={colors.textMuted}
                      style={[styles.inlineSearchInput, { color: colors.text }]}
                    />
                  </View>
                  <Text style={[styles.selectedCount, { color: colors.textSecondary }]}>{countryCodes.length} selected</Text>
                  {countriesQuery.isLoading ? <PanelSkeleton rows={4} /> : countriesQuery.isError ? (
                    <Text style={[styles.emptyFilterHint, { color: colors.textMuted }]}>Could not load countries. Try again later.</Text>
                  ) : <View style={styles.optionList}>
                    {visibleCountries.map((country) => {
                      const active = countryCodes.includes(country.isoCode);
                      return (
                        <Pressable
                          key={country.isoCode}
                          style={[
                            styles.countryOption,
                            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                            active && [styles.countryOptionActive, { borderColor: colors.primary, backgroundColor: `${colors.primary}12` }],
                          ]}
                          onPress={() => setCountryCodes((current) => active ? current.filter((code) => code !== country.isoCode) : [...current, country.isoCode])}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: active }}
                        >
                          <Text style={styles.countryFlag}>{getCountryFlag(country.isoCode)}</Text>
                          <View style={styles.countryOptionCopy}>
                            <Text style={[styles.countryOptionName, { color: active ? colors.primary : colors.text }]} numberOfLines={1}>{country.name}</Text>
                            <Text style={[styles.countryOptionDialCode, { color: colors.textMuted }]}>+{country.dialCode}</Text>
                          </View>
                          <View style={[styles.userCheck, { borderColor: active ? colors.primary : colors.cardBorder, backgroundColor: active ? colors.primary : 'transparent' }]}>
                            {active ? <Check color={colors.primaryText} size={14} strokeWidth={3} /> : null}
                          </View>
                        </Pressable>
                      );
                    })}
                    {!visibleCountries.length ? <Text style={[styles.emptyFilterHint, { color: colors.textMuted }]}>No countries match the search</Text> : null}
                  </View>}
                </>
              ) : null}

              {filterLayer === 'users' ? (
                <>
                  <View style={[styles.inlineSearch, { backgroundColor: colors.surface, borderColor: colors.inputBorder }]}>
                    <Search color={colors.textMuted} size={16} />
                    <TextInput
                      value={userSearchInput}
                      onChangeText={setUserSearchInput}
                      placeholder="Search assignees..."
                      placeholderTextColor={colors.textMuted}
                      style={[styles.inlineSearchInput, { color: colors.text }]}
                    />
                  </View>
                  <Text style={[styles.selectedCount, { color: colors.textSecondary }]}>{assigneeIds.length} selected</Text>
                  {assigneesQuery.isLoading ? <PanelSkeleton rows={4} /> : assigneesQuery.isError ? (
                    <Text style={[styles.emptyFilterHint, { color: colors.textMuted }]}>Could not load assignee options.</Text>
                  ) : (
                    <View style={styles.optionList}>
                      {visibleAssigneeOptions.map((member) => {
                        const active = assigneeIds.includes(member.workspaceMemberId);
                        const displayName = member.name?.trim() || member.email;
                        return (
                          <Pressable
                            key={member.workspaceMemberId}
                            style={[
                              styles.userRow,
                              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                              active && [styles.userRowActive, { borderColor: colors.primary, backgroundColor: `${colors.primary}12` }],
                            ]}
                            onPress={() => setAssigneeIds((current) => active ? current.filter((id) => id !== member.workspaceMemberId) : [...current, member.workspaceMemberId])}
                          >
                            <ColorfulAvatar name={displayName} size={38} url={member.avatarUrl} />
                            <View style={styles.userCopy}>
                              <View style={styles.userNameRow}>
                                <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
                                <View style={[styles.roleChip, { backgroundColor: colors.surfaceSecondary }]}>
                                  <Text style={[styles.roleChipText, { color: active ? colors.primary : colors.textSecondary }]}>{ASSIGNEE_ROLE_LABELS[member.roleKey] ?? 'Agent'}</Text>
                                </View>
                              </View>
                              <Text style={[styles.userEmail, { color: colors.textMuted }]} numberOfLines={1}>{member.email}</Text>
                            </View>
                            <View style={[styles.userCheck, { borderColor: active ? colors.primary : colors.cardBorder, backgroundColor: active ? colors.primary : 'transparent' }]}>
                              {active ? <Check color={colors.primaryText} size={14} strokeWidth={3} /> : null}
                            </View>
                          </Pressable>
                        );
                      })}
                      {!visibleAssigneeOptions.length ? <Text style={[styles.emptyFilterHint, { color: colors.textMuted }]}>No assignee options match the current search</Text> : null}
                    </View>
                  )}
                </>
              ) : null}

              {filterLayer === 'more' ? (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Conversation created date</Text>
                  <View style={styles.dateFilterWrap}>
                    <DateRangeFilter
                      value={{ from: createdAtFrom, to: createdAtTo }}
                      onChange={(range) => {
                        setCreatedAtFrom(range.from);
                        setCreatedAtTo(range.to);
                      }}
                    />
                  </View>

                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Ban status</Text>
                  <View style={styles.banRow}>
                    {([
                      { id: 'all' as const, label: 'All', Icon: CircleSlash },
                      { id: 'blocked' as const, label: 'Banned', Icon: Ban },
                      { id: 'unblocked' as const, label: 'Unbanned', Icon: CheckCircle2 },
                    ]).map((option) => {
                      const active = blockedStatus === option.id;
                      const Icon = option.Icon;
                      return (
                        <Pressable
                          key={option.id}
                          style={[
                            styles.banOption,
                            { borderColor: colors.cardBorder, backgroundColor: colors.surface },
                            active && { borderColor: colors.primary, backgroundColor: `${colors.primary}14` },
                          ]}
                          onPress={() => setBlockedStatus(option.id)}
                        >
                          <Icon color={active ? colors.primary : colors.textSecondary} size={14} />
                          <Text style={[styles.banOptionText, { color: active ? colors.primary : colors.textSecondary }]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Assignment</Text>
                  <View style={[styles.assignmentSegment, { backgroundColor: colors.surfaceSecondary }]}>
                    {([['any', 'Any'], ['assigned', 'Assigned'], ['unassigned', 'Unassigned']] as const).map(([value, label]) => (
                      <Pressable key={value} style={[styles.assignmentOption, assignment === value && styles.assignmentOptionActive, assignment === value && { backgroundColor: colors.surface }]} onPress={() => setAssignment(value)}>
                        <Text style={[styles.assignmentOptionText, { color: assignment === value ? colors.text : colors.textSecondary }]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable
                    style={[styles.switchRow, { borderColor: colors.cardBorder }]}
                    onPress={() => setStarredOnly((value) => !value)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: starredOnly }}
                    accessibilityLabel="Starred only"
                  >
                    <View style={styles.switchRowCopy}>
                      <Star color={colors.amber} size={16} fill={starredOnly ? colors.amber : 'none'} />
                      <Text style={[styles.switchRowLabel, { color: colors.textSecondary }]}>Starred only</Text>
                    </View>
                    <AppToggle value={starredOnly} tone="amber" />
                  </Pressable>

                  <Pressable
                    style={[styles.switchRow, { borderColor: colors.cardBorder }]}
                    onPress={() => setUnrepliedOnly((value) => !value)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: unrepliedOnly }}
                    accessibilityLabel="Unreplied only"
                  >
                    <View style={styles.switchRowCopy}>
                      <Mail color={colors.primary} size={16} />
                      <Text style={[styles.switchRowLabel, { color: colors.textSecondary }]}>Unreplied only</Text>
                    </View>
                    <AppToggle value={unrepliedOnly} tone="blue" />
                  </Pressable>
                </>
              ) : null}
            </SheetScrollView>

            <Pressable style={[styles.filterReset, !canClearFilters && styles.filterResetDisabled]} onPress={resetFilters} disabled={!canClearFilters}>
              <Text style={[styles.filterResetText, { color: canClearFilters ? colors.error : colors.textMuted }]}>Clear all</Text>
            </Pressable>
            <Pressable style={[styles.filterApply, { backgroundColor: colors.primary }]} onPress={() => setFilterOpen(false)}>
              <Text style={[styles.filterApplyText, { color: colors.primaryText }]}>Apply filters</Text>
            </Pressable>
        </BottomSheet>
    </View>
  );
}

function WindowPulseDot({ expired }: { expired: boolean }) {
  const { colors } = useTheme();
  const color = expired ? colors.error : colors.success;
  const ringColor = expired ? colors.dangerBorder : colors.successSoft;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={styles.windowDotWrap}>
      <Animated.View style={[styles.windowDotRing, { backgroundColor: ringColor, opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
      <View style={[styles.windowDot, { backgroundColor: color, shadowColor: color }]} />
    </View>
  );
}

function AssigneeBadge({ assignee }: { assignee: ConversationListItem['assignee'] }) {
  if (!assignee) return null;
  const label = (assignee.userName?.trim() || assignee.userEmail?.trim() || 'Agent');
  return (
    <View style={styles.assigneeBadge}>
      <ColorfulAvatar name={label} size={20} url={assignee.avatarUrl} />
    </View>
  );
}

function hexWithAlpha(color: string | null | undefined, alphaHex: string, fallback: string) {
  const value = (color ?? fallback).trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return `${value}${alphaHex}`;
  if (/^#([0-9a-fA-F]{3})$/.test(value)) {
    const [r, g, b] = value.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  return fallback;
}

function ConversationTagChips({ tags, maxVisible = 2 }: { tags?: ConversationListItem['tags']; maxVisible?: number }) {
  const { colors } = useTheme();
  const resolved = (tags ?? []).filter((tag) => tag && !tag.isArchived && tag.text?.trim());
  if (!resolved.length) return null;
  const visible = resolved.slice(0, maxVisible);
  const hiddenCount = resolved.length - visible.length;

  return (
    <View style={styles.tagRow}>
      {visible.map((tag) => {
        const color = tag.color?.trim() || colors.textSecondary;
        return (
          <View
            key={tag.id}
            style={[styles.tagChip, { backgroundColor: hexWithAlpha(color, '18', colors.surfaceSecondary), borderColor: hexWithAlpha(color, '33', colors.cardBorder) }]}
          >
            <View style={[styles.tagChipDot, { backgroundColor: color }]} />
            <Text style={[styles.tagChipText, { color }]} numberOfLines={1}>{tag.text}</Text>
          </View>
        );
      })}
      {hiddenCount > 0 ? (
        <View style={[styles.tagMoreChip, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
          <Text style={[styles.tagMoreText, { color: colors.textSecondary }]}>+{hiddenCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

function InteractionDirectionIndicator({ direction }: { direction: 'INBOUND' | 'OUTBOUND' | null }) {
  const { colors } = useTheme();
  if (!direction) return null;
  const inbound = direction === 'INBOUND';
  return inbound
    ? <ArrowDownLeft color={colors.amber} size={14} strokeWidth={3} />
    : <ArrowUpRight color={colors.primary} size={14} strokeWidth={3} />;
}

function ConversationPreviewContent({
  conversation,
}: {
  conversation: ConversationListItem;
}) {
  const { colors } = useTheme();
  const presentation = getConversationLastInteractionPresentation(conversation);
  const preview = presentation?.preview ?? 'No messages yet';
  const messageType = (presentation?.message?.type ?? '').toUpperCase();
  const callChip = presentation?.kind === 'call' ? getCallPreviewChipConfig(preview) : null;
  const showImage = messageType === 'IMAGE' || isImagePreview(preview);
  const showVideo = messageType === 'VIDEO' || isVideoPreview(preview);
  const showVoice = messageType === 'VOICE' || isVoiceNotePreview(preview);
  const showAudio = messageType === 'AUDIO' || isAudioPreview(preview);

  if (callChip) {
    const Icon =
      callChip.tone === 'missed' ? PhoneMissed
        : callChip.tone === 'declined' ? PhoneOff
          : callChip.tone === 'incoming' ? PhoneIncoming
            : PhoneCall;
    return (
      <View style={[styles.callPreviewChip, { backgroundColor: callChip.backgroundColor }]}>
        <Icon color={callChip.textColor} size={12} />
        <Text style={[styles.callPreviewChipText, { color: callChip.textColor }]} numberOfLines={1}>{callChip.label}</Text>
      </View>
    );
  }

  if (showImage) {
    return (
      <View style={styles.mediaPreview}>
        <ImageIcon color={colors.textSecondary} size={14} />
        <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>Photo</Text>
      </View>
    );
  }
  if (showVideo) {
    return (
      <View style={styles.mediaPreview}>
        <Video color={colors.textSecondary} size={14} />
        <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>Video</Text>
      </View>
    );
  }
  if (showVoice) {
    return (
      <View style={styles.mediaPreview}>
        <Mic color={colors.textSecondary} size={14} />
        <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>Voice note</Text>
      </View>
    );
  }
  if (showAudio) {
    return (
      <View style={styles.mediaPreview}>
        <Mic color={colors.textSecondary} size={14} />
        <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>Audio</Text>
      </View>
    );
  }

  return <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>{preview}</Text>;
}

const ConversationRow = memo(function ConversationRow({ conversation, navigation, queryClient }: { conversation: ConversationListItem; navigation: any; queryClient: ReturnType<typeof useQueryClient> }) {
  const { colors } = useTheme();
  const presentation = getConversationLastInteractionPresentation(conversation);
  const direction = presentation?.direction ?? null;
  const previewTimestamp = presentation?.timestamp ?? conversation.lastMessageAt;
  const hasUnread = conversation.unreadCount > 0;
  const isWhatsAppCustomerWindow = conversation.channel?.channelType === 'WHATSAPP' && conversation.messaging?.policyType === 'CUSTOMER_WINDOW';
  const showWindowDot = isWhatsAppCustomerWindow && conversation.messaging?.windowState !== 'NOT_APPLICABLE';
  const windowExpired = isConversationCustomerWindowExpired(conversation);
  const isBlocked = Boolean(conversation.blockedAt ?? conversation.contact.blockedAt);
  const onPress = useCallback(() => {
    // Start loading the thread before the transition finishes so its first
    // render can use the warm React Query cache instead of waiting on the API.
    void queryClient.fetchQuery({
      queryKey: ['messages', conversation.id],
      queryFn: () => fetchConversationMessages(conversation.id).then((page) => ({
        ...page,
        items: page.items.map((message) => {
          const attachments = message.attachments ?? [];
          return { ...message, attachments };
        }),
      })),
      staleTime: 60_000,
    });
    navigation.navigate('Conversation', {
      conversationId: conversation.id,
      contactName: conversation.contact.displayName ?? 'Unknown contact',
      workspaceId: conversation.workspaceId,
      channelId: conversation.channel?.channelId,
      channelType: conversation.channel?.channelType,
    });
  }, [navigation, conversation, queryClient]);
  return (
    <Pressable onPress={onPress} style={[styles.rowPressable, { backgroundColor: colors.surface }]}>
      <View style={[styles.row, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
        <View style={[styles.avatar, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}>
          <ColorfulAvatar
            name={conversation.contact.displayName ?? 'Unknown contact'}
            size={44}
            url={conversation.contact.avatarUrl}
          />
          {conversation.channel?.channelType ? <View style={[styles.channelBadgeWrap, { borderColor: colors.surface }]}><ChannelLogo type={conversation.channel.channelType} box={20} glyph={12} radius={10} /></View> : null}
        </View>
        <View style={styles.copy}>
          <View style={styles.nameLine}>
            <Text style={[styles.name, { color: colors.text }, hasUnread && styles.nameUnread]} numberOfLines={1}>{conversation.contact.displayName ?? 'Unknown contact'}</Text>
            {isBlocked ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder }]} accessibilityLabel="Banned customer">
                <Ban color={colors.error} size={10} />
              </View>
            ) : null}
            {conversation.status === 'CLOSED' ? (
              <View style={styles.closedBadge} accessibilityLabel="Closed conversation">
                <CircleX color={colors.textMuted} size={16} strokeWidth={1.8} />
              </View>
            ) : null}
            {showWindowDot ? <WindowPulseDot expired={windowExpired} /> : null}
          </View>
          <Text style={[styles.channel, { color: colors.textMuted }]} numberOfLines={1}>{conversation.channel?.channelName ?? ''}</Text>
          <View style={styles.previewRow}>
            <InteractionDirectionIndicator direction={direction} />
            <View style={styles.previewContent}>
              <ConversationPreviewContent conversation={conversation} />
            </View>
          </View>
          <ConversationTagChips tags={conversation.tags} />
        </View>
        <View style={styles.side}>
          <Text style={[styles.time, { color: hasUnread ? colors.primary : colors.textMuted }, hasUnread && styles.timeUnread]}>{formatTime(previewTimestamp)}</Text>
          <View style={styles.sideMiddle}>
            {hasUnread ? (
              <AppBadge tone="primary" label={conversation.unreadCount > 9 ? '9+' : String(conversation.unreadCount)} style={styles.unreadBadge} />
            ) : null}
          </View>
          <AssigneeBadge assignee={conversation.assignee} />
        </View>
      </View>
    </Pressable>
  );
});

function formatTime(value: string | null) {
  if (!value) return '';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: spacing.lg },
  listFill: { flex: 1, minHeight: 0 },
  header: {
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 0,
    paddingHorizontal: spacing.md + 2,
  },
  headerTitleLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm - 2, paddingBottom: spacing.md - 2 },
  headerTitle: { fontSize: fontSize.heading, fontWeight: fontWeight.extrabold },
  sidebarTabs: { flexDirection: 'row', gap: spacing.md },
  sidebarTab: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.md - 2, paddingTop: 2, position: 'relative' },
  sidebarTabText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  sidebarTabTextActive: {},
  sidebarTabCount: { borderRadius: radius.pill, fontSize: fontSize.tiny, fontWeight: fontWeight.bold, minWidth: 18, overflow: 'hidden', paddingHorizontal: spacing.xs + 1, paddingVertical: 1, textAlign: 'center' },
  sidebarTabUnderline: { borderRadius: radius.pill, bottom: 0, height: 2, left: 0, position: 'absolute', right: 0 },
  searchRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  search: { alignItems: 'center', borderRadius: radius.xl, borderWidth: 1, flex: 1, flexDirection: 'row', minWidth: 0, paddingHorizontal: spacing.md },
  input: { flex: 1, height: 36, marginLeft: spacing.sm - 2, paddingVertical: 0 },
  clearSearch: { fontSize: fontSize.body, padding: spacing.xs },
  filtersRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  filters: { borderRadius: radius.xl, flex: 1, flexDirection: 'row', minWidth: 0, padding: 3 },
  filterPill: { alignItems: 'center', borderRadius: radius.lg, flex: 1, justifyContent: 'center', paddingVertical: spacing.xs + 2 },
  filterPillActive: { elevation: 1, shadowOpacity: 0.06, shadowRadius: 4 },
  filterText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  filterTextActive: { fontWeight: fontWeight.bold },
  closedCountRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  closedCountLabel: { fontSize: fontSize.small, fontWeight: fontWeight.medium },
  closedCountValue: { flexShrink: 1, fontSize: fontSize.small, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  unrepliedToggle: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', flexShrink: 0, gap: spacing.xs + 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  unrepliedToggleActive: {},
  unrepliedLabel: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  unrepliedLabelActive: {},
  filterButton: { alignItems: 'center', borderRadius: radius.xl, borderWidth: 1, height: 36, justifyContent: 'center', position: 'relative', width: 36 },
  filterButtonActive: {},
  filterActiveDot: { borderRadius: radius.sm / 2, height: spacing.sm, position: 'absolute', right: -2, top: -2, width: spacing.sm },
  filterOverlay: { flex: 1, justifyContent: 'flex-end' },
  filterSheetSurface: { paddingBottom: 20, paddingHorizontal: 20, paddingTop: 8 },
  filterSheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  filterSheetTitle: { fontSize: fontSize.heading, fontWeight: fontWeight.extrabold },
  filterLayerTabs: { borderRadius: radius.lg, flexGrow: 0, marginBottom: spacing.md, padding: spacing.xs },
  filterLayerTabsContent: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  filterLayerTab: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 4, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  filterLayerTabActive: { elevation: 1, shadowOpacity: 0.06, shadowRadius: 4 },
  filterLayerTabText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  filterLayerTabTextActive: { fontWeight: fontWeight.bold },
  filterLayerCount: { borderRadius: 8, fontSize: 10, fontWeight: '700', marginLeft: 3, overflow: 'hidden', paddingHorizontal: 4, paddingVertical: 1 },
  filterLayerBody: { maxHeight: 400 },
  filterLayerContent: { paddingBottom: 8 },
  inlineSearch: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.sm, paddingHorizontal: spacing.sm },
  inlineSearchInput: { flex: 1, height: 40, marginLeft: spacing.sm },
  selectedCount: { fontSize: fontSize.small, marginBottom: spacing.sm },
  countryFilterHint: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  countryChipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  countryChip: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 5, maxWidth: '100%', paddingHorizontal: 9, paddingVertical: 6 },
  countryChipText: { flexShrink: 1, fontSize: 11, fontWeight: '600' },
  countryFlag: { fontSize: 16 },
  countryOption: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingVertical: 9 },
  countryOptionActive: { borderWidth: 1.5 },
  countryOptionCopy: { flex: 1, minWidth: 0 },
  countryOptionName: { fontSize: 13, fontWeight: '600' },
  countryOptionDialCode: { fontSize: 11, marginTop: 1 },
  optionList: { gap: 6 },
  optionRow: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingVertical: 10 },
  optionRowActive: {},
  optionRowText: { flex: 1, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  optionRowTextActive: { fontWeight: fontWeight.bold },
  tagDot: { borderRadius: 5, height: 10, width: 10 },
  tagSwatch: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  tagSwatchDot: { borderRadius: 7, height: 14, width: 14 },
  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: spacing.sm - 2, maxWidth: '100%', ...chipSize.compact },
  tagPillActive: { borderWidth: 1.5 },
  tagPillDot: { borderRadius: 4, height: 8, width: 8 },
  tagPillText: { flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.medium },
  tagPillTextActive: { fontWeight: '700' },
  userRow: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm + 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm + 1 },
  userRowActive: { borderWidth: 1.5 },
  userCopy: { flex: 1, minWidth: 0 },
  userNameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  userName: { flex: 1, fontSize: fontSize.body, fontWeight: fontWeight.bold, minWidth: 0 },
  userEmail: { fontSize: fontSize.small, marginTop: 2 },
  roleChip: { borderRadius: radius.pill, flexShrink: 0, paddingHorizontal: spacing.xs + 3, paddingVertical: 2 },
  roleChipText: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold },
  userCheck: { alignItems: 'center', borderRadius: 5, borderWidth: 1.5, height: 22, justifyContent: 'center', width: 22 },
  emptyFilterHint: { fontSize: fontSize.caption, paddingVertical: spacing.md },
  sectionLabel: { fontSize: fontSize.small, fontWeight: fontWeight.bold, letterSpacing: 0.4, marginBottom: spacing.sm, marginTop: spacing.xs, textTransform: 'uppercase' },
  dateFilterWrap: { marginBottom: 8 },
  assignmentSegment: { borderRadius: radius.xxl, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.xs },
  assignmentOption: { alignItems: 'center', borderRadius: 16, flex: 1, paddingVertical: 8 },
  assignmentOptionActive: { elevation: 1, shadowOpacity: 0.06, shadowRadius: 4 },
  assignmentOptionText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  banRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  banOption: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm + 1 },
  banOptionText: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  assignmentOptionTextActive: { fontWeight: fontWeight.bold },
  switchRow: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  switchRowCopy: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  switchRowLabel: { fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  filterReset: { alignItems: 'center', marginTop: 14, paddingVertical: 6 },
  filterResetDisabled: { opacity: 0.45 },
  filterResetText: { fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  filterResetTextDisabled: {},
  filterApply: { alignItems: 'center', borderRadius: radius.md, marginTop: spacing.sm, paddingVertical: spacing.md + 2 },
  filterApplyText: { color: 'transparent', fontSize: fontSize.body, fontWeight: fontWeight.bold },
  emptyClearButton: { borderRadius: radius.md, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  emptyClearButtonText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  rowPressable: {},
  row: { borderBottomWidth: 1, flexDirection: 'row', overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  avatar: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 2, height: 54, justifyContent: 'center', overflow: 'visible', position: 'relative', width: 54 },
  avatarImage: { borderRadius: 24, height: 48, width: 48 },
  avatarText: { fontSize: fontSize.heading, fontWeight: fontWeight.bold },
  channelBadgeWrap: { alignItems: 'center', borderRadius: radius.md, borderWidth: 2, bottom: -2, height: 20, justifyContent: 'center', overflow: 'hidden', position: 'absolute', right: -2, width: 20 },
  copy: { flex: 1, marginLeft: 12, minWidth: 0 },
  nameLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  name: { flexShrink: 1, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  nameUnread: { fontWeight: '800' },
  statusBadge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  closedBadge: {
    alignItems: 'center',
    flexShrink: 0,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  windowDotWrap: { alignItems: 'center', height: 12, justifyContent: 'center', width: 12 },
  windowDotRing: { borderRadius: 6, height: 12, position: 'absolute', width: 12 },
  windowDot: { borderRadius: 4, elevation: 3, height: 8, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 5, width: 8 },
  unreadBadge: { height: 18, minWidth: 18, paddingHorizontal: 4, paddingVertical: 0 },
  time: { fontSize: fontSize.tiny },
  timeUnread: { fontWeight: fontWeight.bold },
  channel: { fontSize: fontSize.tiny, marginTop: 2, textTransform: 'capitalize' },
  previewRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 6, minWidth: 0 },
  previewContent: { flex: 1, minWidth: 0 },
  preview: { fontSize: fontSize.caption },
  mediaPreview: { alignItems: 'center', flexDirection: 'row', gap: 5, minWidth: 0 },
  callPreviewChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  callPreviewChipText: { flexShrink: 1, fontSize: 11, fontWeight: '600' },
  tagRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginTop: 6, overflow: 'hidden' },
  tagChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 5,
    maxWidth: '70%',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagChipDot: { borderRadius: 3, height: 6, width: 6 },
  tagChipText: { flexShrink: 1, fontSize: 11, fontWeight: '600' },
  tagMoreChip: {
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagMoreText: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  side: { alignItems: 'flex-end', alignSelf: 'stretch', justifyContent: 'space-between', marginLeft: 12, minWidth: 44 },
  sideMiddle: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', minHeight: 20 },
  assigneeBadge: { alignItems: 'center', borderRadius: radius.md, borderWidth: 2, flexShrink: 0, height: 20, justifyContent: 'center', marginTop: 4, overflow: 'hidden', width: 20 },
  assigneeImage: { height: 20, width: 20 },
  assigneeInitials: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: fontSize.body, fontWeight: fontWeight.bold, marginTop: spacing.md },
  emptyBody: { fontSize: fontSize.caption, marginTop: spacing.xs, textAlign: 'center' },
  loader: { marginTop: 40 },
});
