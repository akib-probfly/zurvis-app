import { createThemedStyles } from '../theme/createThemedStyles';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ban, Check, ChevronDown, CheckCircle2, CheckSquare, CircleSlash, ContactRound, Download, EllipsisVertical, Filter, Import, Mail, Phone, Plus, Search, Trash2, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { showNotice } from '../components/AppToast';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { type Channel } from '../api/channels';
import {
  createCrmContact,
  deleteCrmContacts,
  exportCrmContacts,
  fetchCrmExport,
  fetchCrmContacts,
  fetchCrmContact,
  fetchCrmExports,
  formatPhoneNumberDisplay,
  getContactTitle,
  importCrmContacts,
  type CrmExportJob,
  type CrmContactListItem,
} from '../api/contacts';
import { fetchAssigneeOptions } from '../api/inbox';
import { fetchWorkspaceTags } from '../api/conversationDetails';
import { countryDialCodeQueryKey, fetchCountryDialCodes } from '../api/countryDialCodes';
import { AppToggle } from '../components/AppToggle';
import { BottomSheet, SheetScrollView } from '../components/BottomSheet';
import { ChannelTypeFilterList } from '../components/ChannelTypeFilterList';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { InlineSkeleton, ListSkeleton } from '../components/Skeleton';
import { ChannelLogo } from '../components/ChannelLogo';
import { ChatIcon } from '../components/ChatIcon';
import { ColorfulAvatar } from '../components/ColorfulAvatar';
import { ErrorState } from '../components/ErrorState';
import { NotificationBell, NotificationCenter } from '../components/NotificationCenter';
import { useTheme } from '../theme/ThemeContext';
import { borderWidth, chipSize, controlSize, iconSize, fontSize, fontWeight, letterSpacing, lineHeight, radius, spacing } from '../theme/tokens';
import { groupChannelsByType } from '../lib/channel-filter-groups';
import { getCountryFlag } from '../lib/countryFromPhone';
import type { ContactsStackParamList } from '../navigation/ContactsStack';
import { AppSearchField, EmptyState } from '../ui';

type FilterLayer = 'channels' | 'labels' | 'countries' | 'users' | 'more';
type AssignmentFilter = 'all' | 'assigned' | 'unassigned';
type BlockedStatusFilter = 'all' | 'blocked' | 'unblocked';

type WhatsappAccountOption = {
  accountId: string;
  channelName: string;
  displayPhoneNumber: string | null;
  channelType: string;
};

const FILTER_LAYERS: Array<{ id: FilterLayer; label: string }> = [
  { id: 'channels', label: 'Channels' },
  { id: 'labels', label: 'Labels' },
  { id: 'countries', label: 'Countries' },
  { id: 'users', label: 'Users' },
  { id: 'more', label: 'More' },
];
const DISMISSED_EXPORT_STORAGE_KEY = 'contacts.dismissedExportId';

function formatRelativeActivity(value: string | null) {
  if (!value) return 'No activity';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'No activity';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function hexWithAlpha(color: string | null | undefined, alphaHex = '18') {
  const value = (color ?? '#64748b').trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return `${value}${alphaHex}`;
  if (/^#([0-9a-fA-F]{3})$/.test(value)) {
    const [r, g, b] = value.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  return '#e2e8f0';
}

export function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ContactsStackParamList>>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filterLayer, setFilterLayer] = useState<FilterLayer>('channels');
  const [assignment, setAssignment] = useState<AssignmentFilter>('all');
  const [blockedStatus, setBlockedStatus] = useState<BlockedStatusFilter>('all');
  const [recentlyActive, setRecentlyActive] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState(false);
  const [conversationCreatedAtFrom, setConversationCreatedAtFrom] = useState<string | null>(null);
  const [conversationCreatedAtTo, setConversationCreatedAtTo] = useState<string | null>(null);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [expandedPlatformKeys, setExpandedPlatformKeys] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addChannelAccountId, setAddChannelAccountId] = useState<string | null>(null);
  const [addTags, setAddTags] = useState<Array<{ text: string; color?: string | null }>>([]);
  const [addChannelSearch, setAddChannelSearch] = useState('');
  const [addChannelPickerOpen, setAddChannelPickerOpen] = useState(false);
  const [addTagSearch, setAddTagSearch] = useState('');
  const [dismissedExportId, setDismissedExportId] = useState<string | null>(null);
  const [sessionExportIds, setSessionExportIds] = useState<string[]>([]);
  const [trackedExportIds, setTrackedExportIds] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(DISMISSED_EXPORT_STORAGE_KEY)
      .then((stored) => {
        if (active) setDismissedExportId(stored);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const dismissExportDownload = useCallback((jobId: string) => {
    setDismissedExportId(jobId);
    void AsyncStorage.setItem(DISMISSED_EXPORT_STORAGE_KEY, jobId).catch(() => {});
  }, []);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(value), 400);
  };

  const filters = useMemo(() => ({
    search: debouncedSearch.trim() || undefined,
    channelIds: channelIds.length ? channelIds : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    countryCodes: countryCodes.length ? countryCodes : undefined,
    ownerWorkspaceMemberIds: ownerId ? [ownerId] : undefined,
    assigned: assignment === 'assigned' ? true : undefined,
    unassigned: assignment === 'unassigned' ? true : undefined,
    blockedStatus: blockedStatus === 'all' ? undefined : blockedStatus,
    recentlyActive: recentlyActive || undefined,
    recentlyAdded: recentlyAdded || undefined,
    conversationCreatedAtFrom: conversationCreatedAtFrom ?? undefined,
    conversationCreatedAtTo: conversationCreatedAtTo ?? undefined,
  }), [debouncedSearch, channelIds, tagIds, countryCodes, ownerId, assignment, blockedStatus, recentlyActive, recentlyAdded, conversationCreatedAtFrom, conversationCreatedAtTo]);

  const hasAdvancedFilters = channelIds.length > 0
    || tagIds.length > 0
    || countryCodes.length > 0
    || ownerId != null
    || assignment !== 'all'
    || blockedStatus !== 'all'
    || recentlyActive
    || recentlyAdded
    || Boolean(conversationCreatedAtFrom || conversationCreatedAtTo);

  const contactsQuery = useInfiniteQuery({
    queryKey: ['crm-contacts', filters],
    queryFn: ({ pageParam }) => fetchCrmContacts({ ...filters, limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.pageInfo?.hasMore ? (lastPage.pageInfo.nextCursor ?? undefined) : undefined),
    staleTime: 20_000,
  });

  const channelsQuery = useQuery({
    queryKey: ['channels', 'contacts-filter'],
    queryFn: () => apiFetch<{ items: Channel[] }>('/channels?page=1&limit=100&sortBy=createdAt&sortOrder=desc'),
    enabled: filterOpen || addOpen,
    staleTime: 60_000,
  });

  const assigneesQuery = useQuery({
    queryKey: ['assignee-filter-options', 'contacts'],
    queryFn: () => fetchAssigneeOptions(),
    enabled: filterOpen,
    staleTime: 60_000,
  });

  const tagsQuery = useQuery({
    queryKey: ['workspace-tags', 'contacts'],
    queryFn: () => fetchWorkspaceTags(),
    enabled: filterOpen || addOpen,
    staleTime: 60_000,
  });

  const countriesQuery = useQuery({
    queryKey: countryDialCodeQueryKey,
    queryFn: fetchCountryDialCodes,
    enabled: filterOpen,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const visibleCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
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
  }, [countriesQuery.data, countryCodes, countrySearch]);

  const shouldLoadExports = actionsOpen || sessionExportIds.length > 0 || trackedExportIds.length > 0;

  const exportsQuery = useQuery({
    queryKey: ['crm-exports'],
    queryFn: () => fetchCrmExports(),
    enabled: shouldLoadExports,
    refetchInterval: (query) => {
      const watchedIds = new Set([...sessionExportIds, ...trackedExportIds]);
      if (!watchedIds.size) return false;
      const jobs = (query.state.data as { items?: CrmExportJob[] } | undefined)?.items ?? [];
      return jobs.some((job) => watchedIds.has(job.id) && (job.status === 'PENDING' || job.status === 'PROCESSING'))
        ? 2000
        : false;
    },
    staleTime: shouldLoadExports ? 0 : 30_000,
  });

  const items = useMemo(() => (contactsQuery.data?.pages ?? []).flatMap((page) => page.items), [contactsQuery.data]);
  const renderContactRow = useCallback(
    ({ item }: { item: CrmContactListItem }) => <ContactRow contact={item} navigation={navigation} />,
    [navigation],
  );
  const totalCount = contactsQuery.data?.pages?.[0]?.totalCount ?? items.length;
  const channelOptions = useMemo(() => channelsQuery.data?.items ?? [], [channelsQuery.data?.items]);
  const channelFilterGroups = useMemo(() => groupChannelsByType(channelOptions), [channelOptions]);
  const whatsappAccountOptions = useMemo(() => {
    const options: WhatsappAccountOption[] = [];
    for (const channel of channelOptions) {
      if (channel.type !== 'WHATSAPP') continue;
      const account = channel.accounts.find((item) => item.isEnabled) ?? channel.accounts[0];
      if (!account?.id) continue;
      options.push({
        accountId: account.id,
        channelName: channel.name || 'WhatsApp',
        displayPhoneNumber: account.displayPhoneNumber ?? account.externalAccountId ?? null,
        channelType: channel.type,
      });
    }
    return options;
  }, [channelOptions]);

  const visibleAddChannels = useMemo(() => {
    const query = addChannelSearch.trim().toLowerCase();
    const filtered = !query
      ? whatsappAccountOptions
      : whatsappAccountOptions.filter((option) => (
        `${option.channelName} ${option.displayPhoneNumber ?? ''}`.toLowerCase().includes(query)
      ));
    return filtered.slice(0, 5);
  }, [whatsappAccountOptions, addChannelSearch]);

  const existingAddTags = useMemo(
    () => (tagsQuery.data?.items ?? [])
      .filter((tag) => !tag.isArchived)
      .slice()
      .sort((left, right) => left.text.localeCompare(right.text)),
    [tagsQuery.data?.items],
  );

  const visibleAddTags = useMemo(() => {
    const query = addTagSearch.trim().toLowerCase();
    const options = [...existingAddTags, ...addTags
      .filter((tag) => !existingAddTags.some((existing) => existing.text.toLowerCase() === tag.text.toLowerCase()))
      .map((tag) => ({ ...tag, id: tag.text }))];
    return query ? options.filter((tag) => tag.text.toLowerCase().includes(query)) : options;
  }, [existingAddTags, addTags, addTagSearch]);

  const canCreateAddTag = useMemo(() => {
    const query = addTagSearch.trim();
    if (!query) return false;
    const normalized = query.toLowerCase();
    return !existingAddTags.some((tag) => tag.text.toLowerCase() === normalized)
      && !addTags.some((tag) => tag.text.toLowerCase() === normalized);
  }, [addTagSearch, existingAddTags, addTags]);

  const resolvedAddChannelIds = useMemo(
    () => addChannelAccountId ? [addChannelAccountId] : [],
    [addChannelAccountId],
  );

  const selectedAddChannel = whatsappAccountOptions.find((option) => option.accountId === resolvedAddChannelIds[0]);

  useEffect(() => {
    if (!addOpen) {
      setAddChannelPickerOpen(false);
      setAddChannelSearch('');
    }
  }, [addOpen]);

  const assigneeOptions = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    const options = assigneesQuery.data ?? [];
    if (!query) return options;
    return options.filter((member) => `${member.name ?? ''} ${member.email}`.toLowerCase().includes(query));
  }, [assigneesQuery.data, userSearch]);
  const tagOptions = useMemo(() => {
    const query = tagSearch.trim().toLowerCase();
    const tags = tagsQuery.data?.items ?? [];
    const selected = tags.filter((tag) => tagIds.includes(tag.id));
    const rest = tags.filter((tag) => !tagIds.includes(tag.id) && (!query || tag.text.toLowerCase().includes(query)));
    return [...selected, ...rest];
  }, [tagsQuery.data?.items, tagSearch, tagIds]);

  const resetFilters = () => {
    setAssignment('all');
    setBlockedStatus('all');
    setRecentlyActive(false);
    setRecentlyAdded(false);
    setConversationCreatedAtFrom(null);
    setConversationCreatedAtTo(null);
    setChannelIds([]);
    setExpandedPlatformKeys([]);
    setTagIds([]);
    setCountryCodes([]);
    setCountrySearch('');
    setOwnerId(null);
    setUserSearch('');
    setTagSearch('');
  };

  const resetAddForm = () => {
    setAddName('');
    setAddPhone('');
    setAddEmail('');
    setAddChannelAccountId(null);
    setAddTags([]);
    setAddChannelSearch('');
    setAddTagSearch('');
  };

  const createMutation = useMutation({
    mutationFn: () => createCrmContact({
      displayName: addName.trim(),
      primaryPhone: addPhone.trim(),
      phoneNumber: addPhone.trim(),
      primaryEmail: addEmail.trim() || null,
      source: 'manual-create',
      tags: addTags.map((tag) => tag.text),
      channels: resolvedAddChannelIds,
    }),
    onSuccess: async (contact) => {
      setAddOpen(false);
      resetAddForm();
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      navigation.navigate('ContactDetails', {
        contactId: contact.id,
        contactName: getContactTitle(contact),
      });
    },
    onError: (error: Error) => showNotice('Could not create contact', error.message),
  });

  const importMutation = useMutation({
    mutationFn: (csvText: string) => importCrmContacts({ csvText, duplicateStrategy: 'merge' }),
    onSuccess: async (job) => {
      setActionsOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      showNotice(
        job.status === 'COMPLETED' ? 'Import completed' : 'Import started',
        job.totalRows > 0 ? `${job.totalRows} contact row${job.totalRows === 1 ? '' : 's'} submitted.` : 'Your CSV is being processed.',
      );
    },
    onError: (error: Error) => showNotice('Could not import contacts', error.message),
  });

  const exportMutation = useMutation({
    mutationFn: (mode: 'all' | 'filtered') => exportCrmContacts({
      mode,
      filters: mode === 'filtered' ? filters : undefined,
      includeNotes: false,
    }),
    onSuccess: (job) => {
      setActionsOpen(false);
      setSessionExportIds((current) => current.includes(job.id) ? current : [job.id, ...current]);
      queryClient.invalidateQueries({ queryKey: ['crm-exports'] });
      showNotice(
        job.status === 'READY' ? 'Export ready' : 'Export queued',
        job.status === 'READY' && job.csvContent ? `${job.fileName} is ready.` : 'We will notify you when the CSV is ready.',
      );
    },
    onError: (error: Error) => showNotice('Could not export contacts', error.message),
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => deleteCrmContacts({ all: true, expectedCount: totalCount }),
    onSuccess: async (result) => {
      setActionsOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      const count = result.queuedCount ?? result.deletedCount;
      showNotice('Deletion started', `${count} contact${count === 1 ? '' : 's'} queued for deletion.`);
    },
    onError: (error: Error) => showNotice('Could not delete contacts', error.message),
  });

  const downloadExportMutation = useMutation({
    mutationFn: async (job: CrmExportJob) => {
      const exportDetail = job.csvContent ? job : await fetchCrmExport(job.id);
      if (!exportDetail.csvContent) throw new Error('CSV is not ready yet.');
      const safeFileName = (exportDetail.fileName || `contacts-export-${job.id}.csv`).replace(/[\\/:*?"<>|]/g, '-');
      const targetUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safeFileName}`;
      await FileSystem.writeAsStringAsync(targetUri, exportDetail.csvContent);
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }
      await Sharing.shareAsync(targetUri, {
        dialogTitle: 'Save contact export',
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
      });
      return { fileName: safeFileName };
    },
    onSuccess: ({ fileName }) => {
      showNotice('CSV ready', `${fileName} opened in the save/share sheet.`);
    },
    onError: (error: Error) => showNotice('Could not download CSV', error.message),
  });

  const pickImportFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'],
      });
      if (result.canceled || !result.assets.length) return;
      const asset = result.assets[0];
      const csvText = await FileSystem.readAsStringAsync(asset.uri);
      if (!csvText.trim()) {
        showNotice('Import file is empty');
        return;
      }
      importMutation.mutate(csvText);
    } catch (error) {
      showNotice('Could not read import file', error instanceof Error ? error.message : undefined);
    }
  };

  const confirmDeleteAll = () => {
    if (totalCount === 0) {
      showNotice('No contacts to delete');
      return;
    }
    Alert.alert(
      'Delete all contacts?',
      `This will delete ${totalCount.toLocaleString()} contact${totalCount === 1 ? '' : 's'} from this workspace.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete all', style: 'destructive', onPress: () => deleteAllMutation.mutate() },
      ],
    );
  };

  const actionBusy = importMutation.isPending || exportMutation.isPending || deleteAllMutation.isPending;
  const activeExportJob = useMemo(() => {
    const liveJob = (exportsQuery.data?.items ?? []).find((job) => job.status === 'PENDING' || job.status === 'PROCESSING');
    if (liveJob) {
      return liveJob;
    }
    const mutationJob = exportMutation.data;
    if (!mutationJob || !sessionExportIds.includes(mutationJob.id)) return null;
    if ((exportsQuery.data?.items ?? []).some((job) => job.id === mutationJob.id)) return null;
    return mutationJob.status === 'PENDING' || mutationJob.status === 'PROCESSING' ? mutationJob : null;
  }, [exportMutation.data, exportsQuery.data?.items, sessionExportIds]);
  useEffect(() => {
    const activeIds = (exportsQuery.data?.items ?? [])
      .filter((job) => job.status === 'PENDING' || job.status === 'PROCESSING')
      .map((job) => job.id);
    if (!activeIds.length) return;
    setTrackedExportIds((current) => {
      const next = [...current];
      for (const id of activeIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next.length === current.length ? current : next;
    });
  }, [exportsQuery.data?.items]);
  const latestReadyExportJob = useMemo(
    () => {
      const visibleReadyIds = new Set([...sessionExportIds, ...trackedExportIds]);
      const latestLiveJob = (exportsQuery.data?.items ?? []).find((job) => visibleReadyIds.has(job.id) && job.status === 'READY') ?? null;
      const mutationJob = exportMutation.data;
      const latestMutationJob = mutationJob?.status === 'READY' && sessionExportIds.includes(mutationJob.id) ? mutationJob : null;
      const latest = latestLiveJob ?? latestMutationJob;
      return latest?.id === dismissedExportId ? null : latest;
    },
    [dismissedExportId, exportMutation.data, exportsQuery.data?.items, sessionExportIds, trackedExportIds],
  );

  const onRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
  }, [queryClient]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topbar, { paddingTop: insets.top + 10, backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
        <View style={styles.topbarCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Contacts</Text>
        </View>
        <View style={styles.topbarActions}>
          <Pressable style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={() => setAddOpen(true)} hitSlop={8}>
            <Plus color="#fff" size={18} />
          </Pressable>
          <Pressable style={[styles.iconButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]} onPress={() => setActionsOpen(true)} hitSlop={8}>
            <EllipsisVertical color={colors.textSecondary} size={18} />
          </Pressable>
          <NotificationBell onOpen={() => setNotificationsOpen(true)} />
        </View>
      </View>

      <View style={styles.searchRow}>
        <AppSearchField
          value={search}
          onChangeText={onSearchChange}
          onClear={() => setDebouncedSearch('')}
          placeholder="Search by name, email, or phone..."
        />
        <Pressable style={[styles.filterButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }, hasAdvancedFilters && [styles.filterButtonActive, { borderColor: colors.primary }]]} onPress={() => setFilterOpen(true)}>
          <Filter color={hasAdvancedFilters ? colors.primary : colors.textSecondary} size={16} />
          {hasAdvancedFilters ? <View style={[styles.filterDot, { backgroundColor: colors.primary }]} /> : null}
        </Pressable>
      </View>

      <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
        {contactsQuery.isLoading ? 'Loading contacts...' : `${totalCount.toLocaleString()} contacts`}
      </Text>

      <ContactsExportProgressCard job={activeExportJob} />
      {!activeExportJob ? (
        <ContactsExportDownloads
          job={latestReadyExportJob}
          downloadingId={downloadExportMutation.isPending ? downloadExportMutation.variables?.id ?? null : null}
          onDismiss={dismissExportDownload}
          onDownload={(job) => downloadExportMutation.mutate(job)}
        />
      ) : null}

      {contactsQuery.isError ? (
        <ErrorState
          message={contactsQuery.error instanceof Error ? contactsQuery.error.message : 'Unable to load contacts.'}
          onRetry={() => contactsQuery.refetch()}
        />
      ) : contactsQuery.isLoading ? (
        <ListSkeleton rows={8} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          style={styles.listFill}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={contactsQuery.isRefetching && !contactsQuery.isFetchingNextPage} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (contactsQuery.hasNextPage && !contactsQuery.isFetchingNextPage) {
              void contactsQuery.fetchNextPage();
            }
          }}
          ListEmptyComponent={(
            <EmptyState
              icon={ContactRound}
              iconSize={44}
              title="No contacts found"
              message={
                hasAdvancedFilters || debouncedSearch.trim()
                  ? 'Try adjusting your search or filters.'
                  : 'Add a contact to start building your CRM list.'
              }
              action={
                hasAdvancedFilters || debouncedSearch.trim() ? (
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
                ) : (
                  <Pressable style={[styles.emptyClearButton, { backgroundColor: colors.surfaceSecondary }]} onPress={() => setAddOpen(true)}>
                    <Text style={[styles.emptyClearButtonText, { color: colors.primary }]}>Add contact</Text>
                  </Pressable>
                )
              }
            />
          )}
          ListFooterComponent={contactsQuery.isFetchingNextPage ? <View style={{ alignItems: 'center', marginVertical: spacing.lg }}><InlineSkeleton width={140} height={14} /></View> : undefined}
          renderItem={renderContactRow}
          extraData={navigation}
        />
      )}

      <BottomSheet visible={filterOpen} onClose={() => setFilterOpen(false)} sheetStyle={styles.sheetSurface}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Filters</Text>
            </View>
            <View style={[styles.layerTabs, { backgroundColor: colors.surfaceSecondary }]}>
              {FILTER_LAYERS.map((layer) => {
                const active = filterLayer === layer.id;
                return (
                  <Pressable key={layer.id} style={[styles.layerTab, active && [styles.layerTabActive, { backgroundColor: colors.surface }]]} onPress={() => setFilterLayer(layer.id)}>
                    <Text style={[styles.layerTabText, { color: colors.textSecondary }, active && [styles.layerTabTextActive, { color: colors.text }]]}>{layer.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <SheetScrollView style={styles.optionList} keyboardShouldPersistTaps="handled">
              {filterLayer === 'channels' ? (
                <ChannelTypeFilterList
                  groups={channelFilterGroups}
                  selectedIds={channelIds}
                  onChange={setChannelIds}
                  expandedKeys={expandedPlatformKeys}
                  onExpandedKeysChange={setExpandedPlatformKeys}
                  hint="Tap a channel to pick specific numbers."
                />
              ) : null}

              {filterLayer === 'labels' ? (
                <>
                  <AppSearchField value={tagSearch} onChangeText={setTagSearch} placeholder="Search tags" tone="background" />
                  <Text style={[styles.selectedTagCount, { color: colors.textSecondary }]}>{tagIds.length} selected</Text>
                  {tagsQuery.isLoading ? <InlineSkeleton /> : (
                  <View style={styles.tagCloud}>
                  {tagOptions.map((tag) => {
                    const active = tagIds.includes(tag.id);
                    const color = tag.color?.trim() || colors.textMuted;
                    return (
                      <Pressable
                        key={tag.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.tagPill,
                          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                          active && [styles.tagPillActive, { backgroundColor: colors.primarySoft, borderColor: colors.primary }],
                        ]}
                        onPress={() => {
                          setTagIds((current) => (active ? current.filter((id) => id !== tag.id) : [...current, tag.id]));
                        }}
                      >
                        <View style={[styles.tagPillDot, { backgroundColor: color }]} />
                        <Text style={[styles.tagPillText, { color: active ? colors.primary : colors.textSecondary }, active && styles.tagPillTextActive]} numberOfLines={1}>{tag.text}</Text>
                        {active ? <Check color={colors.primary} size={12} strokeWidth={3} /> : null}
                      </Pressable>
                    );
                  })}
                  {!tagOptions.length ? <Text style={[styles.emptyHint, { color: colors.textMuted }]}>No tags found.</Text> : null}
                  </View>
                  )}
                </>
              ) : null}

              {filterLayer === 'countries' ? (
                <>
                  <Text style={[styles.countryHint, { color: colors.textSecondary }]}>Filter contacts by phone country. Contacts without a phone number are excluded.</Text>
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
                  <AppSearchField value={countrySearch} onChangeText={setCountrySearch} placeholder="Search countries or dial codes" tone="background" />
                  <Text style={[styles.countrySelectedCount, { color: colors.textSecondary }]}>{countryCodes.length} selected</Text>
                  {countriesQuery.isLoading ? <InlineSkeleton width={160} height={14} /> : countriesQuery.isError ? (
                    <Text style={[styles.emptyHint, { color: colors.textMuted }]}>Could not load countries. Try again later.</Text>
                  ) : (
                    <View style={styles.countryOptions}>
                      {visibleCountries.map((country) => {
                        const active = countryCodes.includes(country.isoCode);
                        return (
                          <Pressable
                            key={country.isoCode}
                            style={[styles.countryOption, { backgroundColor: colors.surface, borderColor: colors.cardBorder }, active && [styles.countryOptionActive, { backgroundColor: colors.surfaceSecondary, borderColor: colors.primary }] ]}
                            onPress={() => setCountryCodes((current) => active ? current.filter((code) => code !== country.isoCode) : [...current, country.isoCode])}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: active }}
                          >
                            <Text style={styles.countryFlag}>{getCountryFlag(country.isoCode)}</Text>
                            <Text style={[styles.countryOptionName, { color: active ? colors.primary : colors.text }]} numberOfLines={1}>{country.name}</Text>
                            <Text style={[styles.countryOptionDialCode, { color: colors.textMuted }]}>+{country.dialCode}</Text>
                          </Pressable>
                        );
                      })}
                      {!visibleCountries.length ? <Text style={[styles.emptyHint, { color: colors.textMuted }]}>No countries match your search.</Text> : null}
                    </View>
                  )}
                </>
              ) : null}

              {filterLayer === 'users' ? (
                <>
                  <AppSearchField value={userSearch} onChangeText={setUserSearch} placeholder="Search owners" tone="background" />
                  <Pressable style={[styles.optionRow, ownerId == null && [styles.optionRowActive, { backgroundColor: colors.surfaceSecondary }]]} onPress={() => setOwnerId(null)}>
                    <Text style={[styles.optionText, { color: colors.textSecondary }, ownerId == null && [styles.optionTextActive, { color: colors.primary }]]}>Any owner</Text>
                  </Pressable>
                  {assigneeOptions.map((member) => {
                    const active = ownerId === member.workspaceMemberId;
                    return (
                      <Pressable key={member.workspaceMemberId} style={[styles.optionRow, active && [styles.optionRowActive, { backgroundColor: colors.surfaceSecondary }]]} onPress={() => setOwnerId(member.workspaceMemberId)}>
                        <Text style={[styles.optionText, { color: colors.textSecondary }, active && [styles.optionTextActive, { color: colors.primary }]]} numberOfLines={1}>
                          {member.name?.trim() || member.email}
                        </Text>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}

              {filterLayer === 'more' ? (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Conversation created date</Text>
                  <DateRangeFilter
                    value={{ from: conversationCreatedAtFrom, to: conversationCreatedAtTo }}
                    onChange={(range) => {
                      setConversationCreatedAtFrom(range.from);
                      setConversationCreatedAtTo(range.to);
                    }}
                  />
                  <Text style={[styles.sectionLabel, styles.sectionLabelSpaced, { color: colors.textSecondary }]}>Ban status</Text>
                  <View style={[styles.segment, { backgroundColor: colors.surfaceSecondary }]}>
                    {([
                      ['all', 'All', CircleSlash],
                      ['blocked', 'Banned', Ban],
                      ['unblocked', 'Unbanned', CheckCircle2],
                    ] as const).map(([value, label, Icon]) => {
                      const active = blockedStatus === value;
                      return (
                        <Pressable key={value} style={[styles.segmentOption, active && [styles.segmentOptionActive, { backgroundColor: colors.surface }]]} onPress={() => setBlockedStatus(value)}>
                          <Icon color={active ? colors.primary : colors.textSecondary} size={13} />
                          <Text style={[styles.segmentText, { color: colors.textSecondary }, active && [styles.segmentTextActive, { color: colors.text }]]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Assignment</Text>
                  <View style={[styles.segment, { backgroundColor: colors.surfaceSecondary }]}>
                    {([
                      ['all', 'All'],
                      ['assigned', 'Assigned'],
                      ['unassigned', 'Unassigned'],
                    ] as const).map(([value, label]) => {
                      const active = assignment === value;
                      return (
                        <Pressable key={value} style={[styles.segmentOption, active && [styles.segmentOptionActive, { backgroundColor: colors.surface }]]} onPress={() => setAssignment(value)}>
                          <Text style={[styles.segmentText, { color: colors.textSecondary }, active && [styles.segmentTextActive, { color: colors.text }]]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable style={[styles.switchRow, { borderColor: colors.cardBorder }]} onPress={() => setRecentlyActive((value) => !value)}>
                    <Text style={[styles.switchLabel, { color: colors.textSecondary }]}>Recently active</Text>
                    <AppToggle value={recentlyActive} variant="sidebar" />
                  </Pressable>
                  <Pressable style={[styles.switchRow, styles.switchRowSpaced, { borderColor: colors.cardBorder }]} onPress={() => setRecentlyAdded((value) => !value)}>
                    <Text style={[styles.switchLabel, { color: colors.textSecondary }]}>Recently added</Text>
                    <AppToggle value={recentlyAdded} variant="sidebar" />
                  </Pressable>
                </>
              ) : null}
            </SheetScrollView>

            <Pressable style={[styles.resetButton, !hasAdvancedFilters && styles.resetDisabled]} disabled={!hasAdvancedFilters} onPress={resetFilters}>
              <Text style={[styles.resetText, { color: colors.error }, !hasAdvancedFilters && [styles.resetTextDisabled, { color: colors.textMuted }]]}>Reset filters</Text>
            </Pressable>
            <Pressable style={[styles.applyButton, { backgroundColor: colors.primary }]} onPress={() => setFilterOpen(false)}>
              <Text style={styles.applyText}>Apply</Text>
            </Pressable>
        </BottomSheet>

      <BottomSheet visible={actionsOpen} onClose={() => setActionsOpen(false)} sheetStyle={styles.actionsSheet}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Contact actions</Text>
        </View>
        <View style={styles.actionList}>
          <ActionRow icon={Import} label="Import" disabled={actionBusy} loading={importMutation.isPending} onPress={pickImportFile} />
          <ActionRow icon={Download} label="Export" disabled={actionBusy} loading={exportMutation.isPending} onPress={() => exportMutation.mutate('all')} />
          <ActionRow icon={Download} label="Export filtered" disabled={actionBusy} loading={exportMutation.isPending} onPress={() => exportMutation.mutate('filtered')} />
          <ActionRow icon={CheckSquare} label="Export selected" disabled />
          <View style={[styles.actionDivider, { backgroundColor: colors.cardBorder }]} />
          <ActionRow icon={Trash2} label="Delete all contacts" destructive disabled={actionBusy} loading={deleteAllMutation.isPending} onPress={confirmDeleteAll} />
        </View>
      </BottomSheet>

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} sheetStyle={[styles.sheetSurface, styles.addSheetSurface]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Add contact</Text>
            </View>
            <SheetScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.addFormScroll}
              contentContainerStyle={styles.addFormContent}
            >
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Name *</Text>
              <TextInput value={addName} onChangeText={setAddName} placeholder="Full name" placeholderTextColor={colors.textMuted} style={[styles.fieldInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]} />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Phone *</Text>
              <TextInput value={addPhone} onChangeText={setAddPhone} placeholder="+8801XXXXXXXXX" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" style={[styles.fieldInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]} />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Email</Text>
              <TextInput value={addEmail} onChangeText={setAddEmail} placeholder="name@example.com" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" style={[styles.fieldInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder, color: colors.text }]} />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Channel</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Select channel"
                accessibilityState={{ expanded: addChannelPickerOpen }}
                onPress={() => setAddChannelPickerOpen((open) => !open)}
                style={[styles.channelSelect, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}
              >
                {selectedAddChannel ? <ChannelLogo type={selectedAddChannel.channelType} box={spacing.xxl} glyph={iconSize.sm} radius={radius.sm} /> : null}
                <View style={styles.copy}>
                  <Text style={[styles.optionText, { color: selectedAddChannel ? colors.text : colors.textMuted }]} numberOfLines={1}>
                    {selectedAddChannel?.channelName ?? 'Select channel'}
                  </Text>
                  {selectedAddChannel?.displayPhoneNumber ? <Text style={[styles.optionSubtext, { color: colors.textMuted }]}>{selectedAddChannel.displayPhoneNumber}</Text> : null}
                </View>
                <ChevronDown color={colors.textMuted} size={iconSize.sm} />
              </Pressable>
              {addChannelPickerOpen ? (
                <View style={[styles.channelSelectList, { borderColor: colors.cardBorder }]}>
              <View style={[styles.inlineSearch, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Search color={colors.textMuted} size={16} />
                <TextInput
                  value={addChannelSearch}
                  onChangeText={setAddChannelSearch}
                  placeholder="Search channels"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inlineSearchInput, { color: colors.text }]}
                />
              </View>
              {visibleAddChannels.map((option) => {
                const active = resolvedAddChannelIds[0] === option.accountId;
                return (
                  <Pressable
                    key={option.accountId}
                    style={[styles.optionRow, active && [styles.optionRowActive, { backgroundColor: colors.surfaceSecondary }]]}
                    onPress={() => {
                      setAddChannelAccountId(option.accountId);
                      setAddChannelPickerOpen(false);
                      setAddChannelSearch('');
                    }}
                  >
                    <ChannelLogo type={option.channelType} box={28} glyph={14} radius={8} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.optionText, { color: colors.textSecondary }, active && [styles.optionTextActive, { color: colors.primary }]]} numberOfLines={1}>{option.channelName}</Text>
                      {option.displayPhoneNumber ? (
                        <Text style={[styles.optionSubtext, { color: colors.textMuted }]} numberOfLines={1}>{option.displayPhoneNumber}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {!visibleAddChannels.length ? <Text style={[styles.emptyHint, { color: colors.textMuted }]}>No WhatsApp channels available.</Text> : null}

                </View>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Tags</Text>
              <View style={[styles.inlineSearch, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
                <Search color={colors.textMuted} size={16} />
                <TextInput
                  value={addTagSearch}
                  onChangeText={setAddTagSearch}
                  placeholder="Search tags"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inlineSearchInput, { color: colors.text }]}
                />
              </View>
              <Text style={[styles.selectedTagCount, { color: colors.textSecondary }]}>{addTags.length} selected</Text>
              <ScrollView style={styles.addTagOptionsScroll} contentContainerStyle={styles.addTagOptionsContent} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {visibleAddTags.map((tag) => {
                const active = addTags.some((item) => item.text.toLowerCase() === tag.text.toLowerCase());
                const color = tag.color?.trim() || colors.textMuted;
                return (
                  <Pressable
                    key={tag.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    style={[
                      styles.addTagOptionChip,
                      { borderColor: colors.cardBorder, backgroundColor: colors.surface },
                      active && { borderColor: colors.primary, backgroundColor: `${colors.primary}12`, borderWidth: borderWidth.selected },
                    ]}
                    onPress={() => setAddTags((current) => active
                      ? current.filter((item) => item.text.toLowerCase() !== tag.text.toLowerCase())
                      : [...current, { text: tag.text, color: tag.color }])}
                  >
                    <View style={[styles.addTagDot, { backgroundColor: color }]} />
                    <Text style={[styles.addTagOptionText, { color: active ? colors.primary : colors.textSecondary }, active && { fontWeight: fontWeight.bold }]} numberOfLines={1}>{tag.text}</Text>
                    {active ? <Check color={colors.primary} size={iconSize.xs} strokeWidth={3} /> : null}
                  </Pressable>
                );
              })}
              </ScrollView>
              {canCreateAddTag ? (
                <Pressable
                  style={[styles.createTagRow, { backgroundColor: colors.surfaceSecondary }]}
                  onPress={() => {
                    const next = addTagSearch.trim();
                    setAddTags((current) => (
                      current.some((item) => item.text.toLowerCase() === next.toLowerCase())
                        ? current
                        : [...current, { text: next, color: '#2563eb' }]
                    ));
                    setAddTagSearch('');
                  }}
                >
                  <Plus color={colors.primary} size={14} />
                  <Text style={[styles.createTagRowText, { color: colors.primary }]}>Create “{addTagSearch.trim()}”</Text>
                </Pressable>
              ) : null}
              {!visibleAddTags.length && !canCreateAddTag ? (
                <Text style={[styles.emptyHint, { color: colors.textMuted }]}>{addTagSearch.trim() ? 'No tags match your search.' : 'No tags available.'}</Text>
              ) : null}
            </SheetScrollView>

            <Pressable
              style={[styles.applyButton, { backgroundColor: colors.primary }, (!addName.trim() || !addPhone.trim() || createMutation.isPending) && styles.applyDisabled]}
              disabled={!addName.trim() || !addPhone.trim() || createMutation.isPending}
              onPress={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyText}>Add contact</Text>}
            </Pressable>
        </BottomSheet>

      <NotificationCenter visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </View>
  );
}

const ContactRow = memo(function ContactRow({ contact, navigation }: { contact: CrmContactListItem; navigation: any }) {
  const queryClient = useQueryClient();
  const [openingConversation, setOpeningConversation] = useState(false);
  const openingConversationRef = useRef(false);
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const title = getContactTitle(contact);
  const phone = formatPhoneNumberDisplay(contact.primaryPhone);
  const tags = (contact.tags ?? []).filter((tag) => !tag.isArchived).slice(0, 2);
  const hiddenTagCount = Math.max(0, (contact.tags ?? []).filter((tag) => !tag.isArchived).length - tags.length);
  const onPress = useCallback(() => {
    navigation.navigate('ContactDetails', { contactId: contact.id, contactName: title });
  }, [navigation, contact.id, title]);

  const openConversation = async () => {
    if (openingConversationRef.current) return;
    openingConversationRef.current = true;
    setOpeningConversation(true);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: ['crm-contact', contact.id],
        queryFn: () => fetchCrmContact(contact.id),
        staleTime: 5 * 60_000,
      });
      const conversation = [...(detail.conversations ?? [])].sort((left, right) => {
        const leftTime = Date.parse(left.lastMessageAt ?? left.createdAt);
        const rightTime = Date.parse(right.lastMessageAt ?? right.createdAt);
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      })[0];
      if (!conversation) {
        showNotice('No conversation yet', 'This contact does not have any conversations yet.');
        return;
      }
      navigation.dispatch(CommonActions.navigate({
        name: 'Inbox',
        params: { screen: 'Conversation', params: { conversationId: conversation.id, contactName: title } },
      }));
    } catch (error) {
      showNotice('Could not open conversation', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      openingConversationRef.current = false;
      setOpeningConversation(false);
    }
  };

  return (
    <Pressable onPress={onPress} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
      <View style={[styles.avatar, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}>
        <ColorfulAvatar name={title} size={38} url={contact.avatarUrl} />
        {contact.channelType ? (
          <View style={[styles.channelBadge, { borderColor: colors.surface }]}>
            <ChannelLogo type={contact.channelType} box={18} glyph={11} radius={9} />
          </View>
        ) : null}
      </View>

      <View style={styles.copy}>
        <View style={styles.contactHeading}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open conversation with ${title}`}
            accessibilityState={{ disabled: openingConversation, busy: openingConversation }}
            disabled={openingConversation}
            hitSlop={(controlSize.touchTarget - spacing.xxl) / 2}
            onPress={(event) => {
              event.stopPropagation();
              void openConversation();
            }}
            style={styles.conversationButton}
          >
            {openingConversation ? <ActivityIndicator size="small" color={colors.primary} /> : <ChatIcon color={colors.primary} size={iconSize.sm} />}
          </Pressable>
          <Text style={[styles.activity, { color: colors.textMuted }]}>{formatRelativeActivity(contact.lastActivityAt)}</Text>
        </View>
        <View style={styles.contactMethods}>
          <View style={styles.metaRow}>
            <Phone color={colors.textMuted} size={12} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>{phone ?? 'No phone'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Mail color={colors.textMuted} size={12} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>{contact.primaryEmail?.trim() || 'No email'}</Text>
          </View>
        </View>
        {contact.channelName || tags.length ? (
          <View style={styles.footerBadges}>
            {contact.channelName ? (
              <View style={[styles.channelPill, { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder }]}>
                <Text style={styles.channelPillText} numberOfLines={1}>{contact.channelName}</Text>
              </View>
            ) : null}
            {tags.length ? (
              <View style={styles.tagRow}>
                {tags.map((tag) => {
                  const color = tag.color?.trim() || '#64748b';
                  return (
                    <View key={tag.id} style={[styles.tagChip, { backgroundColor: hexWithAlpha(color), borderColor: hexWithAlpha(color, '33') }]}>
                      <Text style={[styles.tagChipText, { color }]} numberOfLines={1}>{tag.text}</Text>
                    </View>
                  );
                })}
                {hiddenTagCount > 0 ? <Text style={[styles.tagMore, { color: colors.textSecondary }]}>+{hiddenTagCount}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

function ActionRow({
  destructive = false,
  disabled = false,
  icon: Icon,
  label,
  loading = false,
  onPress,
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: React.ComponentType<{ color: string; size: number }>;
  label: string;
  loading?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const color = destructive ? colors.error : disabled ? colors.textMuted : colors.text;

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.actionRow, (disabled || loading) && styles.actionRowDisabled]}
    >
      {loading ? <ActivityIndicator color={color} size="small" /> : <Icon color={color} size={17} />}
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ContactsExportProgressCard({ job }: { job: CrmExportJob | null }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  if (!job || (job.status !== 'PENDING' && job.status !== 'PROCESSING')) return null;

  const totalRows = Math.max(job.totalRows, 0);
  const processedRows = Math.max(job.processedRows ?? 0, 0);
  const visibleProcessedRows = totalRows > 0 ? Math.min(processedRows, totalRows) : 0;
  const progress = totalRows > 0 ? Math.min(100, Math.round((visibleProcessedRows / totalRows) * 100)) : 0;
  const isQueued = job.status === 'PENDING';
  const modeLabel: Record<string, string> = {
    all: 'All contacts',
    filtered: 'Filtered contacts',
    selected: 'Selected contacts',
    single: 'Single contact',
  };

  return (
    <View style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
      <View style={styles.progressTop}>
        <View style={styles.progressCopyRow}>
          <View style={styles.progressIcon}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
          <View style={styles.progressCopy}>
            <View style={styles.progressTitleRow}>
              <Text style={[styles.progressTitle, { color: colors.text }]}>{isQueued ? 'Export queued' : 'Exporting contacts'}</Text>
              <View style={[styles.progressBadge, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.progressBadgeText, { color: colors.textSecondary }]}>{modeLabel[job.exportMode] ?? 'Contacts'}</Text>
              </View>
            </View>
            <Text style={[styles.progressDetail, { color: colors.textSecondary }]}>
              {totalRows > 0
                ? `${visibleProcessedRows.toLocaleString()} of ${totalRows.toLocaleString()} contacts processed`
                : 'Preparing contact count...'}
            </Text>
          </View>
        </View>
        <View style={styles.progressPercentWrap}>
          <Text style={[styles.progressPercent, { color: colors.text }]}>{totalRows > 0 ? `${progress}%` : '-'}</Text>
          <Text style={[styles.progressState, { color: colors.textSecondary }]}>{isQueued ? 'waiting' : 'in progress'}</Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${progress}%` }]} />
      </View>
      <Text style={[styles.progressHint, { color: colors.textSecondary }]}>
        You can keep working while the export is being processed.
      </Text>
    </View>
  );
}

function ContactsExportDownloads({
  downloadingId,
  job,
  onDismiss,
  onDownload,
}: {
  downloadingId: string | null;
  job: CrmExportJob | null;
  onDismiss: (jobId: string) => void;
  onDownload: (job: CrmExportJob) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  if (!job) return null;

  return (
    <View style={styles.downloadsSection}>
      <View style={[styles.downloadCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
        <View style={styles.downloadTop}>
          <View style={styles.downloadIcon}>
            <Download color="#0891b2" size={15} />
          </View>
          <View style={styles.downloadCopy}>
            <Text style={[styles.downloadTitle, { color: colors.text }]} numberOfLines={1}>Export ready</Text>
            <Text style={[styles.downloadMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {job.fileName || 'contacts.csv'}
            </Text>
          </View>
          <Pressable
            disabled={downloadingId === job.id}
            onPress={() => onDownload(job)}
            style={[styles.downloadButton, { borderColor: '#a5f3fc' }, downloadingId === job.id && styles.actionRowDisabled]}
          >
            {downloadingId === job.id ? <ActivityIndicator color="#0891b2" size="small" /> : <Download color="#0891b2" size={13} />}
            <Text style={styles.downloadButtonText}>Download</Text>
          </Pressable>
          <Pressable onPress={() => onDismiss(job.id)} hitSlop={8} style={styles.downloadDismiss}>
            <X color={colors.textMuted} size={16} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const createStyles = createThemedStyles((colors) => StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  topbar: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.separator, borderBottomWidth: borderWidth.thin, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.inset, paddingHorizontal: spacing.roomy },
  topbarCopy: { flex: 1, minWidth: 0, paddingRight: spacing.md },
  topbarActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.control },
  title: { color: colors.text, fontSize: fontSize.title, fontWeight: fontWeight.extrabold },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.caption, marginTop: spacing.xs },
  addButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.xl, height: 36, justifyContent: 'center', width: 36 },
  iconButton: { alignItems: 'center', borderColor: colors.cardBorder, borderRadius: radius.xl, borderWidth: borderWidth.thin, height: 36, justifyContent: 'center', width: 36 },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.control, marginHorizontal: spacing.lg, marginTop: spacing.lg },
  filterButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.cardBorder, borderRadius: radius.xl, borderWidth: borderWidth.thin, height: 44, justifyContent: 'center', position: 'relative', width: 44 },
  filterButtonActive: { borderColor: colors.primary },
  filterDot: { backgroundColor: colors.primary, borderRadius: radius.xs, height: 8, position: 'absolute', right: 8, top: 8, width: 8 },
  countLabel: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.semibold, marginHorizontal: spacing.roomy, marginTop: spacing.md },
  progressCard: { borderColor: colors.primary, borderRadius: radius.xl, borderWidth: borderWidth.thin, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.inset },
  progressTop: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  progressCopyRow: { flex: 1, flexDirection: 'row', gap: spacing.control, minWidth: 0 },
  progressIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.md, height: 36, justifyContent: 'center', width: 36 },
  progressCopy: { flex: 1, minWidth: 0 },
  progressTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  progressTitle: { color: colors.text, fontSize: fontSize.section, fontWeight: fontWeight.extrabold },
  progressBadge: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.tight },
  progressBadgeText: { color: colors.textSecondary, fontSize: fontSize.badge, fontWeight: fontWeight.extrabold, textTransform: 'uppercase' },
  progressDetail: { color: colors.textSecondary, fontSize: fontSize.caption, lineHeight: lineHeight.caption, marginTop: spacing.xs + spacing.hairline },
  progressPercentWrap: { alignItems: 'flex-end', minWidth: 64 },
  progressPercent: { color: colors.text, fontSize: fontSize.headingLarge, fontWeight: fontWeight.extrabold },
  progressState: { color: colors.textSecondary, fontSize: fontSize.compact, marginTop: spacing.hairline },
  progressTrack: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, height: 7, marginTop: spacing.inset, overflow: 'hidden' },
  progressFill: { backgroundColor: colors.primary, borderRadius: radius.pill, height: '100%' },
  progressHint: { color: colors.textSecondary, fontSize: fontSize.small, lineHeight: lineHeight.compact, marginTop: spacing.sm + spacing.hairline },
  downloadsSection: { marginHorizontal: spacing.lg, marginTop: spacing.control },
  downloadCard: { borderColor: colors.cardBorder, borderRadius: radius.control, borderWidth: borderWidth.thin, paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  downloadTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm + spacing.hairline },
  downloadIcon: { alignItems: 'center', backgroundColor: colors.infoSoft, borderRadius: radius.lg, height: 32, justifyContent: 'center', width: 32 },
  downloadCopy: { flex: 1, minWidth: 0 },
  downloadTitle: { color: colors.text, fontSize: fontSize.caption, fontWeight: fontWeight.extrabold },
  downloadMeta: { color: colors.textSecondary, fontSize: fontSize.compact, lineHeight: lineHeight.micro, marginTop: spacing.xxs },
  downloadButton: { alignItems: 'center', borderColor: colors.infoBorder, borderRadius: radius.pill, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.xs + spacing.hairline, paddingHorizontal: spacing.control, paddingVertical: spacing.compact },
  downloadButtonText: { color: colors.info, fontSize: fontSize.small, fontWeight: fontWeight.extrabold },
  downloadDismiss: { alignItems: 'center', height: 28, justifyContent: 'center', width: 24 },
  listFill: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  card: { alignItems: 'flex-start', borderRadius: radius.xl, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.control, padding: spacing.control },
  avatar: { alignItems: 'center', borderRadius: radius.xxxl, borderWidth: borderWidth.strong, height: 48, justifyContent: 'center', position: 'relative', width: 48 },
  avatarImage: { borderRadius: radius.xxxl, height: 48, width: 48 },
  avatarText: { color: colors.primary, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  channelBadge: { borderColor: '#fff', borderRadius: radius.inset, borderWidth: borderWidth.strong, bottom: -2, overflow: 'hidden', position: 'absolute', right: -2 },
  copy: { flex: 1, minWidth: 0 },
  conversationButton: { alignItems: 'center', justifyContent: 'center', width: spacing.xxl, height: spacing.xxl, borderRadius: radius.pill },
  contactHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact, justifyContent: 'space-between', minWidth: 0 },
  name: { color: colors.text, flex: 1, fontSize: fontSize.body, fontWeight: fontWeight.bold, letterSpacing: -0.15, minWidth: 0 },
  contactMethods: { alignItems: 'center', flexDirection: 'row', gap: spacing.control, marginTop: spacing.xs },
  metaRow: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.xs + spacing.hairline, minHeight: 15, minWidth: 0 },
  metaText: { color: colors.textSecondary, flex: 1, fontSize: fontSize.compact, minWidth: 0 },
  footerBadges: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + spacing.hairline, marginTop: spacing.compact },
  channelPill: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: borderWidth.thin, paddingHorizontal: spacing.sm, paddingVertical: spacing.tight },
  channelPillText: { color: colors.warning, fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + spacing.hairline },
  tagChip: { borderRadius: radius.pill, borderWidth: borderWidth.thin, paddingHorizontal: spacing.compact + spacing.hairline, paddingVertical: spacing.xxs },
  tagChipText: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  tagMore: { alignSelf: 'center', color: colors.textSecondary, fontSize: fontSize.compact, fontWeight: fontWeight.semibold },
  activity: { color: colors.textMuted, flexShrink: 0, fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  emptyClearButton: { backgroundColor: colors.primarySoft, borderRadius: radius.md, marginTop: spacing.inset, paddingHorizontal: spacing.inset, paddingVertical: spacing.control },
  emptyClearButtonText: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  loader: { marginTop: 60 },
  sheetOverlay: { backgroundColor: 'rgba(15,23,42,0.45)', flex: 1, justifyContent: 'flex-end' },
  sheetSurface: { paddingBottom: spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  actionsSheet: { paddingBottom: spacing.xxl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { color: colors.text, fontSize: fontSize.heading, fontWeight: fontWeight.extrabold },
  actionList: { gap: spacing.xs },
  actionRow: { alignItems: 'center', borderRadius: radius.lg, flexDirection: 'row', gap: spacing.md, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.control },
  actionRowDisabled: { opacity: 0.48 },
  actionLabel: { color: colors.text, flex: 1, fontSize: fontSize.section, fontWeight: fontWeight.bold },
  actionDivider: { backgroundColor: colors.surfaceSecondary, height: 1, marginVertical: spacing.compact },
  layerTabs: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md, padding: spacing.xs },
  layerTab: { alignItems: 'center', borderRadius: radius.inset, flex: 1, paddingVertical: spacing.sm },
  layerTabActive: { backgroundColor: colors.surface, elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4 },
  layerTabText: { color: colors.textSecondary, fontSize: fontSize.compact, fontWeight: fontWeight.semibold },
  layerTabTextActive: { color: colors.text, fontWeight: fontWeight.bold },
  optionList: { gap: spacing.compact, maxHeight: 400 },
  channelSelect: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, borderWidth: borderWidth.thin, borderRadius: radius.md, padding: spacing.control, minHeight: controlSize.touchTarget },
  channelSelectList: { borderWidth: borderWidth.thin, borderRadius: radius.md, padding: spacing.xs, marginTop: spacing.xs },
  optionRow: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', gap: spacing.control, paddingHorizontal: spacing.control, paddingVertical: spacing.control },
  optionRowActive: { backgroundColor: colors.primarySoft },
  optionText: { color: colors.text, flex: 1, fontSize: fontSize.section, fontWeight: fontWeight.medium },
  optionTextActive: { color: colors.primary, fontWeight: fontWeight.bold },
  selectedTagCount: { fontSize: fontSize.small, marginVertical: spacing.sm },
  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tagPill: { alignItems: 'center', borderRadius: radius.pill, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.sm - 2, maxWidth: '100%', ...chipSize.compact },
  tagPillActive: { borderWidth: borderWidth.selected },
  tagPillDot: { borderRadius: radius.xs, height: 8, width: 8 },
  tagPillText: { flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.medium },
  tagPillTextActive: { fontWeight: fontWeight.bold },
  emptyHint: { color: colors.textMuted, fontSize: fontSize.caption, paddingVertical: spacing.md },
  countryHint: { fontSize: fontSize.small, lineHeight: lineHeight.caption, marginBottom: spacing.control },
  countryChipList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, marginBottom: spacing.control },
  countryChip: { alignItems: 'center', borderRadius: radius.pill, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.xs + spacing.hairline, maxWidth: '100%', paddingHorizontal: spacing.sm + spacing.hairline, paddingVertical: spacing.compact },
  countryChipText: { flexShrink: 1, fontSize: fontSize.compact, fontWeight: fontWeight.semibold },
  countryFlag: { fontSize: fontSize.subheading },
  countrySelectedCount: { fontSize: fontSize.small, marginBottom: spacing.sm },
  countryOptions: { gap: spacing.compact },
  countryOption: { alignItems: 'center', borderRadius: radius.chip, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.control, paddingHorizontal: spacing.control, paddingVertical: spacing.sm + spacing.hairline },
  countryOptionActive: { borderWidth: borderWidth.selected },
  countryOptionName: { flex: 1, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  countryOptionDialCode: { fontSize: fontSize.compact },
  inlineSearch: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.inputBorder, borderRadius: radius.md, borderWidth: borderWidth.thin, flexDirection: 'row', marginBottom: spacing.sm, paddingHorizontal: spacing.control },
  inlineSearchInput: { color: colors.text, flex: 1, height: 40, marginLeft: spacing.sm },
  sectionLabel: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.bold, letterSpacing: letterSpacing.wide, marginBottom: spacing.sm, textTransform: 'uppercase' },
  sectionLabelSpaced: { marginTop: spacing.inset },
  segment: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.xxl, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.xs },
  segmentOption: { alignItems: 'center', borderRadius: radius.control, flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', paddingVertical: spacing.sm },
  segmentOptionActive: { backgroundColor: colors.surface, elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4 },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.small, fontWeight: fontWeight.semibold },
  segmentTextActive: { color: colors.text, fontWeight: fontWeight.bold },
  switchRow: { alignItems: 'center', borderColor: colors.primaryBorder, borderRadius: radius.control, borderWidth: borderWidth.thin, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  switchRowSpaced: { marginTop: spacing.sm },
  switchLabel: { color: colors.text, fontSize: fontSize.section, fontWeight: fontWeight.semibold },
  resetButton: { alignItems: 'center', marginTop: spacing.inset, paddingVertical: spacing.compact },
  resetDisabled: { opacity: 0.45 },
  resetText: { color: colors.error, fontSize: fontSize.section, fontWeight: fontWeight.semibold },
  resetTextDisabled: { color: colors.textMuted },
  applyButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.md, marginTop: spacing.control, paddingVertical: spacing.inset },
  applyDisabled: { opacity: 0.55 },
  applyText: { color: colors.primaryText, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  fieldLabel: { color: colors.text, fontSize: fontSize.caption, fontWeight: fontWeight.semibold, marginBottom: spacing.compact, marginTop: spacing.control },
  fieldInput: { backgroundColor: colors.background, borderColor: colors.inputBorder, borderRadius: radius.md, borderWidth: borderWidth.thin, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  addSheetSurface: { height: '85%' },
  addFormScroll: { flex: 1, minHeight: 0 },
  addTagOptionsScroll: { maxHeight: 200 },
  addTagOptionsContent: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addTagDot: { width: spacing.sm, height: spacing.sm, borderRadius: radius.xs },
  addTagOptionChip: { alignSelf: 'flex-start', alignItems: 'center', borderRadius: radius.pill, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.compact, maxWidth: '100%', ...chipSize.compact },
  addTagOptionText: { flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.medium },
  addFormContent: { paddingBottom: spacing.xxl },
  optionSubtext: { color: colors.textMuted, fontSize: fontSize.small, marginTop: spacing.xxs },
  createTagRow: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, paddingHorizontal: spacing.control, paddingVertical: spacing.control },
  createTagRowText: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
}));
