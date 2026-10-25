import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Search, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { fetchWorkspaceCallSessionSummary, fetchWorkspaceCallSessions, type ConversationCallSession } from '../api/inbox';
import { ErrorState } from './ErrorState';
import { CallFeedItem } from './CallFeedItem';
import { ListSkeleton } from './Skeleton';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, fontWeight, radius, spacing } from '../theme/tokens';

export type CallFeedFilter = 'all' | 'missed' | 'incoming' | 'outgoing';

const CALL_FILTERS: Array<{ id: CallFeedFilter; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All', icon: Phone },
  { id: 'missed', label: 'Missed', icon: PhoneMissed },
  { id: 'incoming', label: 'Incoming', icon: PhoneIncoming },
  { id: 'outgoing', label: 'Outgoing', icon: PhoneOutgoing },
];

type Props = {
  onOpenConversation: (session: ConversationCallSession) => void;
};

export function InboxCallsPane({ onOpenConversation }: Props) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [callFilter, setCallFilter] = useState<CallFeedFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(value), 250);
  };

  const clearSearch = () => {
    setSearch('');
    setDebouncedSearch('');
  };

  const searchTerm = debouncedSearch.trim() || undefined;
  const status = callFilter === 'missed' ? 'MISSED' as const : 'ALL' as const;
  const direction = callFilter === 'incoming'
    ? 'INBOUND' as const
    : callFilter === 'outgoing'
      ? 'OUTBOUND' as const
      : 'ALL' as const;

  const sessionsQuery = useInfiniteQuery({
    queryKey: ['workspace-calls', { search: searchTerm, status, direction }],
    queryFn: async ({ pageParam }) => fetchWorkspaceCallSessions({
      search: searchTerm,
      status,
      direction,
      limit: 20,
      cursor: pageParam,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pageInfo?.hasMore ? (lastPage.pageInfo.nextCursor ?? undefined) : undefined,
    staleTime: 10_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['workspace-calls-summary', { search: searchTerm }],
    queryFn: () => fetchWorkspaceCallSessionSummary({ search: searchTerm }),
    staleTime: 10_000,
  });

  const sessions = useMemo(
    () => (sessionsQuery.data?.pages ?? []).flatMap((page) => page.items),
    [sessionsQuery.data],
  );
  const summary = summaryQuery.data ?? null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace-calls'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace-calls-summary'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  return (
    <View style={[styles.pane, { backgroundColor: colors.background }]}>
      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.inputBorder }]}>
        <Search color={colors.textSecondary} size={18} />
        <TextInput
          value={search}
          onChangeText={onSearchChange}
          placeholder="Search calls..."
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text }]}
        />
        {debouncedSearch ? (
          <Pressable onPress={clearSearch}>
            <Text style={[styles.clearSearch, { color: colors.textMuted }]}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filters}>
        {CALL_FILTERS.map((filter) => {
          const active = callFilter === filter.id;
          const count = summary ? summary[filter.id] : null;
          const Icon = filter.icon;
          const foreground = active ? colors.primaryText : colors.textSecondary;
          return (
            <Pressable
              key={filter.id}
              style={({ pressed }) => [styles.filterChip, {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.cardBorder,
                opacity: pressed ? 0.75 : 1,
              }]}
              onPress={() => setCallFilter(filter.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${filter.label} calls${count !== null ? `, ${count}` : ''}`}
            >
              <Icon color={foreground} size={12} />
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.filterChipText, { color: foreground }]}>{filter.label}</Text>
              {count !== null ? <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.filterCount, { color: foreground }]}>{count}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      {sessionsQuery.isLoading ? <ListSkeleton rows={6} />
        : sessionsQuery.isError ? <ErrorState message="Unable to load calls." onRetry={() => sessionsQuery.refetch()} />
          : (
            <FlashList
              data={sessions}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <CallFeedItem session={item} onPress={() => onOpenConversation(item)} />
              )}
              ListEmptyComponent={(
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
                    <Clock3 color={colors.textMuted} size={22} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    {searchTerm
                      ? 'No matching calls'
                      : callFilter === 'missed'
                        ? 'No missed calls'
                        : callFilter === 'incoming'
                          ? 'No incoming calls'
                          : callFilter === 'outgoing'
                            ? 'No outgoing calls'
                            : 'No calls yet'}
                  </Text>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                    {searchTerm
                      ? 'Try a different name or phone number.'
                      : 'Call activity for this workspace will show up here.'}
                  </Text>
                  {searchTerm ? (
                    <Pressable style={[styles.clearButton, { backgroundColor: colors.primary }]} onPress={clearSearch}>
                      <Text style={[styles.clearButtonText, { color: colors.primaryText }]}>Clear search</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              onEndReachedThreshold={2}
              onEndReached={() => {
                if (sessionsQuery.hasNextPage && !sessionsQuery.isFetchingNextPage) {
                  void sessionsQuery.fetchNextPage();
                }
              }}
              contentContainerStyle={styles.list}
              style={styles.listFill}
            />
          )}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  search: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#e2e8f0', borderRadius: 25, borderWidth: 1, flexDirection: 'row', margin: 12, paddingHorizontal: 14 },
  input: { color: '#17233a', flex: 1, height: 42, marginLeft: 8 },
  clearSearch: { color: '#94a3b8', fontSize: 14, padding: 4 },
  filters: { flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: spacing.md },
  filterChip: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, justifyContent: 'center', flexDirection: 'row', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  filterChipText: { flexShrink: 1, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  filterCount: { flexShrink: 1, fontSize: fontSize.tiny, fontWeight: fontWeight.medium, opacity: 0.8 },
  list: { paddingBottom: 16 },
  listFill: { flex: 1 },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 60 },
  emptyIcon: { alignItems: 'center', backgroundColor: '#eceff3', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  emptyTitle: { color: '#0f172a', fontSize: 15, fontWeight: '700', marginTop: 14 },
  emptyBody: { color: '#7d94b8', fontSize: 13, marginTop: 4, textAlign: 'center' },
  clearButton: { backgroundColor: '#2563eb', borderRadius: 999, marginTop: 14, paddingHorizontal: 16, paddingVertical: 10 },
  clearButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  loader: { marginTop: 40 },
});
