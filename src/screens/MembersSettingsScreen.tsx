import * as Clipboard from 'expo-clipboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, CircleSlash, Copy, Globe2, Layers, Mail, Pencil, RefreshCw, ShieldCheck, Trash2, UserCheck, UserPlus2, UsersRound, UserX, X, type LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/SettingsStack';
import { radius, spacing } from '../theme/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createWorkspaceInvites,
  deleteWorkspaceInvite,
  deleteWorkspaceMember,
  fetchWorkspaceRosterMembers,
  refreshWorkspaceInviteLink,
  updateWorkspaceMemberChannelAssignments,
  updateWorkspaceMemberRole,
  updateWorkspaceMemberStatus,
  validateInviteEmail,
  type WorkspaceInviteRoleHint,
  type WorkspaceMemberStatusUpdate,
  type WorkspaceRosterMember,
} from '../api/workspaces';
import { fetchChannels, type Channel } from '../api/channels';
import { fetchMyProfile } from '../api/profile';
import { showNotice } from '../components/AppToast';
import { BottomSheet, SheetScrollView } from '../components/BottomSheet';
import { ChannelLogo } from '../components/ChannelLogo';
import { ColorfulAvatar } from '../components/ColorfulAvatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { ListSkeleton } from '../components/Skeleton';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { useTheme } from '../theme/ThemeContext';
import { AppBadge, AppButton, AppIconButton, AppSearchField, ScreenHeader, badgePalette, type BadgeTone } from '../ui';

const EMPTY_MEMBERS: WorkspaceRosterMember[] = [];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const INVITE_LIMIT_MESSAGE = 'Workspace reached its member limit. Please contact your workspace admin to free up a seat or upgrade the plan.';

const ROLE_OPTIONS: Array<{ value: WorkspaceInviteRoleHint; label: string; description: string }> = [
  { value: 'AGENT', label: 'Agent', description: 'For inbox operators who handle assigned conversations.' },
  { value: 'MANAGER', label: 'Manager', description: 'For supervisors who monitor team workflow and coverage.' },
];

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

function isInviteRow(member: WorkspaceRosterMember) {
  return (member.kind ?? 'MEMBER') === 'INVITE';
}

function isEditableRosterMember(member: WorkspaceRosterMember) {
  return !isInviteRow(member) && Boolean(member.workspaceMemberId);
}

function isAgentRosterMember(member: WorkspaceRosterMember) {
  const roles = member.roleKeys ?? [];
  return roles.includes('workspace_agent') || (!roles.includes('workspace_admin') && !roles.includes('workspace_manager'));
}

function memberActionName(member: WorkspaceRosterMember) {
  return member.name?.trim() || member.email;
}

function displayName(member: WorkspaceRosterMember) {
  return member.name?.trim() || member.email.split('@')[0] || member.email;
}

function roleLabel(member: WorkspaceRosterMember) {
  if (member.roleLabel) return member.roleLabel;
  if (member.roleKeys?.includes('workspace_admin')) return 'Owner';
  if (member.roleKeys?.includes('workspace_manager')) return 'Supervisor';
  return 'Agent';
}

function statusLabel(status: WorkspaceRosterMember['status']) {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'INVITED') return 'Invited';
  return 'Disabled';
}

function memberStatusTone(status: WorkspaceRosterMember['status']): BadgeTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'INVITED') return 'info';
  return 'neutral';
}

function AccessPill({ member }: { member: WorkspaceRosterMember }) {
  const { colors } = useTheme();
  const channels = member.channelAssignments ?? [];

  if (member.status === 'INVITED' || member.kind === 'INVITE') {
    return (
      <View style={[styles.accessPill, styles.pendingAccess]}>
        <View style={styles.pendingDot} />
        <Text style={styles.pendingText} numberOfLines={1}>Pending invitation</Text>
      </View>
    );
  }

  if (member.accessScope === 'ALL_CHANNELS') {
    return (
      <View style={[styles.accessPill, styles.allAccess, { backgroundColor: colors.surface }]}>
        <Globe2 color="#2563eb" size={14} />
        <Text style={[styles.accessStrong, { color: colors.text }]}>All channels</Text>
        <Text style={[styles.accessMuted, { color: colors.textMuted }]}>workspace-wide</Text>
      </View>
    );
  }

  if (channels.length === 0) {
    return (
      <View style={[styles.accessPill, styles.noChannelAccess, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}>
        <CircleSlash color={colors.textSecondary} size={14} />
        <Text style={[styles.accessMuted, { color: colors.textSecondary }]}>No channel access</Text>
      </View>
    );
  }

  if (channels.length === 1) {
    const channel = channels[0];
    return (
      <View style={[styles.singleChannel, { backgroundColor: colors.surfaceSecondary }]}>
        <ChannelLogo type={channel.channelType} box={18} glyph={10} radius={9} />
        <Text style={[styles.channelName, { color: colors.primary }]} numberOfLines={1}>{channel.channelName}</Text>
      </View>
    );
  }

  return (
    <View style={styles.multiChannel}>
      <View style={styles.channelStack}>
        {channels.slice(0, 3).map((channel, index) => (
          <View key={channel.channelId} style={{ marginLeft: index === 0 ? 0 : -7 }}>
            <ChannelLogo type={channel.channelType} box={22} glyph={12} radius={11} />
          </View>
        ))}
      </View>
      <Text style={[styles.accessMuted, { color: colors.textSecondary }]}>{channels.length} channels</Text>
    </View>
  );
}

function ChannelOptionRow({
  channel,
  selected,
  onToggle,
}: {
  channel: Channel;
  selected: boolean;
  onToggle: (channelId: string) => void;
}) {
  const { colors } = useTheme();
  const phone = channel.accounts[0]?.displayPhoneNumber;
  return (
    <Pressable
      onPress={() => onToggle(channel.id)}
      style={[
        styles.channelRow,
        { backgroundColor: selected ? colors.surfaceSecondary : colors.surface, borderColor: selected ? colors.primary : colors.cardBorder },
      ]}
      accessibilityState={{ selected }}
    >
      <ChannelLogo type={channel.type} box={24} glyph={13} radius={12} />
      <View style={styles.channelCopy}>
        <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>{channel.name}</Text>
        {phone ? <Text style={[styles.channelSub, { color: colors.textMuted }]} numberOfLines={1}>{phone}</Text> : null}
      </View>
      <View style={[
        styles.checkbox,
        { borderColor: selected ? colors.primary : colors.cardBorder, backgroundColor: selected ? colors.primary : 'transparent' },
      ]}>
        {selected ? <Check color="#fff" size={12} /> : null}
      </View>
    </Pressable>
  );
}

function ChannelSelectDropdown({
  channels,
  selectedIds,
  onToggle,
  loading = false,
}: {
  channels: Channel[];
  selectedIds: string[];
  onToggle: (channelId: string) => void;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => {
      const phone = channel.accounts[0]?.displayPhoneNumber ?? '';
      return [channel.name, phone, channel.type, channel.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [channels, search]);

  const selected = useMemo(
    () => channels.filter((channel) => selectedIds.includes(channel.id)),
    [channels, selectedIds],
  );

  if (loading) {
    return <Text style={[styles.helperText, { color: colors.textMuted }]}>Loading channels…</Text>;
  }

  if (channels.length === 0) {
    return (
      <View style={[styles.noChannels, { borderColor: colors.cardBorder, backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>No channels are connected yet. The invite will still work.</Text>
      </View>
    );
  }

  return (
    <View style={styles.dropdown}>
      <Pressable
        onPress={() => setExpanded((current) => !current)}
        style={[
          styles.dropdownTrigger,
          { backgroundColor: colors.background, borderColor: expanded ? colors.primary : colors.cardBorder },
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={selected.length === 0 ? 'Select channels' : `${selected.length} channels selected`}
      >
        <Text
          style={[styles.dropdownTriggerText, { color: selected.length === 0 ? colors.textMuted : colors.text }]}
          numberOfLines={1}
        >
          {selected.length === 0
            ? 'Select channels'
            : `${selected.length} ${selected.length === 1 ? 'channel' : 'channels'} selected`}
        </Text>
        <ChevronDown
          color={colors.textMuted}
          size={18}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {selected.length > 0 ? (
        <View style={styles.selectedWrap}>
          {selected.map((channel) => (
            <View
              key={channel.id}
              style={[styles.selectedChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}
            >
              <ChannelLogo type={channel.type} box={20} glyph={11} radius={10} />
              <Text style={[styles.selectedChipText, { color: colors.text }]} numberOfLines={1}>
                {channel.name}
              </Text>
              <Pressable
                onPress={() => onToggle(channel.id)}
                hitSlop={8}
                accessibilityLabel={`Remove ${channel.name}`}
              >
                <X color={colors.textMuted} size={13} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {expanded ? (
        <View style={[styles.dropdownPanel, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
          <AppSearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search channels"
            size="sm"
            tone="surface"
            fill={false}
          />
          <SheetScrollView
            style={styles.optionsList}
            contentContainerStyle={styles.optionsContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {filtered.map((channel) => (
              <ChannelOptionRow
                key={channel.id}
                channel={channel}
                selected={selectedIds.includes(channel.id)}
                onToggle={onToggle}
              />
            ))}
            {filtered.length === 0 ? (
              <Text style={[styles.helperText, { color: colors.textMuted }]}>No channels match your search.</Text>
            ) : null}
          </SheetScrollView>
        </View>
      ) : null}
    </View>
  );
}

function SheetActionRow({
  icon: Icon,
  label,
  danger = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        { backgroundColor: pressed ? colors.surfaceSecondary : colors.background, borderColor: colors.cardBorder },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.actionIcon, { backgroundColor: danger ? '#fff1f2' : colors.surfaceSecondary }]}>
        <Icon color={danger ? '#e11d48' : colors.primary} size={15} />
      </View>
      <Text style={[styles.actionLabel, { color: danger ? '#e11d48' : colors.text }]}>{label}</Text>
      <ChevronRight color={colors.textMuted} size={16} />
    </Pressable>
  );
}

const MemberCard = memo(function MemberCard({ member, onSelect }: { member: WorkspaceRosterMember; onSelect: (member: WorkspaceRosterMember) => void }) {
  const { colors } = useTheme();
  const name = displayName(member);
  const tone = memberStatusTone(member.status);
  const palette = badgePalette(colors, tone);

  return (
    <Pressable
      onPress={() => onSelect(member)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.cardBorder, opacity: pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Manage ${displayName(member)}`}
    >
      <View style={styles.memberHeader}>
        <View style={styles.avatarWrap}>
          <ColorfulAvatar name={name} url={member.avatarUrl} size={42} />
          <View style={[styles.presenceDot, { backgroundColor: palette.fg, borderColor: colors.surface }]} />
        </View>
        <View style={styles.memberCopy}>
          <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.memberEmail, { color: colors.textSecondary }]} numberOfLines={1}>{member.email}</Text>
        </View>
        <AppBadge size="sm" tone={tone} dot label={statusLabel(member.status)} />
        <ChevronRight color={colors.textMuted} size={16} />
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaBlock}>
          <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Role</Text>
          <Text style={[styles.rolePill, { backgroundColor: colors.surfaceSecondary, color: colors.primary }]}>{roleLabel(member)}</Text>
        </View>
        <View style={[styles.metaBlock, styles.accessBlock]}>
          <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Channel access</Text>
          <AccessPill member={member} />
        </View>
      </View>
    </Pressable>
  );
});

export function MembersSettingsScreen() {
  return <MembersSettingsContent />;
}

export function MemberDetailsScreen() {
  const route = useRoute<RouteProp<SettingsStackParamList, 'MemberDetails'>>();
  return <MembersSettingsContent detail={route.params} />;
}

function MembersSettingsContent({ detail }: { detail?: SettingsStackParamList['MemberDetails'] }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { workspace, loading: workspaceLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const [search, setSearch] = useState(detail?.email ?? '');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<WorkspaceInviteRoleHint>('AGENT');
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [limitToAssigned, setLimitToAssigned] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [editMember, setEditMember] = useState<WorkspaceRosterMember | null>(null);
  const [editChannelIds, setEditChannelIds] = useState<string[]>([]);
  const [editLimitToAssigned, setEditLimitToAssigned] = useState(false);
  const [roleMember, setRoleMember] = useState<WorkspaceRosterMember | null>(null);
  const [roleSelection, setRoleSelection] = useState<WorkspaceInviteRoleHint>('AGENT');
  const [roleLimitToAssigned, setRoleLimitToAssigned] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { kind: 'status'; member: WorkspaceRosterMember; status: WorkspaceMemberStatusUpdate }
    | { kind: 'delete'; member: WorkspaceRosterMember }
    | null
  >(null);
  const [isProcessingMemberAction, setIsProcessingMemberAction] = useState(false);
  const [copyingInviteId, setCopyingInviteId] = useState<string | null>(null);

  useEffect(() => {
    setEditMember(null);
    setRoleMember(null);
    setPendingAction(null);
  }, [workspaceId]);

  const rosterQuery = useQuery({
    queryKey: ['workspace-roster', 'settings-members', workspaceId, search],
    queryFn: () => fetchWorkspaceRosterMembers(workspaceId!, search, 100),
    enabled: Boolean(workspaceId) && (!detail || detail.workspaceId === workspaceId),
    staleTime: 20_000,
  });

  const channelsQuery = useQuery({
    queryKey: ['channels', 'invite', workspaceId],
    queryFn: fetchChannels,
    enabled: (inviteOpen || editMember !== null) && Boolean(workspaceId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ['me-profile'],
    queryFn: fetchMyProfile,
    staleTime: 60_000,
  });

  const members = rosterQuery.data?.items ?? EMPTY_MEMBERS;
  const openMember = useCallback((member: WorkspaceRosterMember) => {
    if (!workspaceId) return;
    navigation.navigate('MemberDetails', {
      memberId: member.id,
      kind: member.kind ?? 'MEMBER',
      email: member.email,
      workspaceId,
    });
  }, [navigation, workspaceId]);
  const renderMember = useCallback(
    ({ item }: { item: WorkspaceRosterMember }) => <MemberCard member={item} onSelect={openMember} />,
    [openMember],
  );
  const actionMember = detail && detail.workspaceId === workspaceId
    ? members.find((member) => member.id === detail.memberId && (member.kind ?? 'MEMBER') === detail.kind) ?? null
    : null;
  const summary = useMemo(() => ({
    total: members.length,
    active: members.filter((member) => member.status === 'ACTIVE').length,
    invited: members.filter((member) => member.status === 'INVITED').length,
  }), [members]);

  const existingEmailSet = useMemo(
    () => new Set(members.map((member) => member.email.trim().toLowerCase())),
    [members],
  );

  const workspaceChannels = useMemo(
    () => (channelsQuery.data?.items ?? []).filter((channel) => !workspaceId || channel.workspaceId === workspaceId),
    [channelsQuery.data, workspaceId],
  );

  const hasRequiredChannels = workspaceChannels.length === 0 || selectedChannelIds.length > 0;
  const normalizedDraft = normalizeEmail(emailDraft);
  const hasValidDraft = normalizedDraft ? isValidEmail(normalizedDraft) : false;
  const hasRecipient = emails.length > 0 || hasValidDraft;

  const openInvite = () => {
    setEmails([]);
    setEmailDraft('');
    setEmailError(null);
    setInviteRole('AGENT');
    setSelectedChannelIds([]);
    setLimitToAssigned(false);
    setSendEmail(true);
    setInviteOpen(true);
  };

  const addEmailsFromText = async (value: string): Promise<boolean> => {
    const parts = value
      .split(/[\n,;]+/)
      .map((item) => normalizeEmail(item))
      .filter(Boolean);

    if (parts.length === 0) return false;

    const invalidEmail = parts.find((email) => !isValidEmail(email));
    if (invalidEmail) {
      setEmailError(`"${invalidEmail}" is not a valid email address.`);
      return false;
    }

    const duplicate = parts.find((email) => existingEmailSet.has(email) || emails.includes(email));
    if (duplicate) {
      setEmailError(`"${duplicate}" already belongs to this workspace.`);
      return false;
    }

    if (workspaceId) {
      try {
        const result = await validateInviteEmail(workspaceId, parts[0]);
        if (result.exists) {
          setEmailError(result.userExists
            ? 'A user with this email address already exists in the system.'
            : 'This email already has a pending invite.');
          return false;
        }
      } catch {
        return false;
      }
    }

    setEmails((current) => Array.from(new Set([...current, ...parts])));
    setEmailError(null);
    return true;
  };

  const commitEmailDraft = async () => {
    if (!normalizeEmail(emailDraft)) return;
    if (await addEmailsFromText(emailDraft)) setEmailDraft('');
  };

  const handleDraftChange = (value: string) => {
    if (emailError) setEmailError(null);
    if (/[,;\n]/.test(value)) {
      void (async () => {
        const added = await addEmailsFromText(value);
        setEmailDraft(added ? '' : value);
      })();
      return;
    }
    setEmailDraft(value);
  };

  const toggleChannel = (channelId: string) => {
    setSelectedChannelIds((current) => current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId]);
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      let workingEmails = [...emails];
      const draft = normalizeEmail(emailDraft);
      if (draft) {
        if (!(await addEmailsFromText(draft))) throw new Error('Fix the email addresses before sending.');
        workingEmails = Array.from(new Set([...workingEmails, draft]));
        setEmailDraft('');
      }
      if (workingEmails.length === 0) throw new Error('Enter at least one email address.');
      const channelAccessMode = selectedChannelIds.length > 0 ? 'ASSIGNED_CHANNELS' : 'NO_CHANNELS';
      return createWorkspaceInvites({
        workspaceId: workspaceId!,
        emails: workingEmails,
        roleHint: inviteRole,
        channelAccessMode,
        limitToAssignedConversations: inviteRole === 'AGENT' && channelAccessMode === 'ASSIGNED_CHANNELS' ? limitToAssigned : false,
        channelIds: channelAccessMode === 'ASSIGNED_CHANNELS' ? selectedChannelIds : [],
        sendEmail,
      });
    },
    onSuccess: async (result) => {
      setInviteOpen(false);
      setEmails([]);
      setEmailDraft('');
      setEmailError(null);
      setInviteRole('AGENT');
      setSelectedChannelIds([]);
      setLimitToAssigned(false);
      setSendEmail(true);
      await queryClient.invalidateQueries({ queryKey: ['workspace-roster'] });
      const count = result.items.length;
      showNotice(
        'Workspace invites created',
        sendEmail
          ? `${count} invitation ${count === 1 ? 'email was' : 'emails were'} queued.`
          : 'The invitation links are ready in the roster.',
      );
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'Fix the email addresses before sending.') return;
      if (error instanceof Error && error.message.toLowerCase().includes('member limit')) {
        showNotice('Workspace is full', INVITE_LIMIT_MESSAGE);
        return;
      }
      showNotice('Could not create invites', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  const canSubmit = hasRecipient && hasRequiredChannels && !inviteMutation.isPending;

  const myRoleKeys = workspace?.roleKeys ?? [];
  const isAdmin = myRoleKeys.includes('super_admin') || myRoleKeys.includes('workspace_admin');
  const isManager = myRoleKeys.includes('workspace_manager');
  const canManageAssignments = isAdmin;
  const canManageRoleChange = isAdmin;
  const canManageLifecycle = isAdmin || isManager;

  const getMemberPermissions = (member: WorkspaceRosterMember) => {
    const roles = member.roleKeys ?? [];
    const targetIsAdmin = roles.includes('super_admin') || roles.includes('workspace_admin');
    const targetIsManager = roles.includes('workspace_manager');
    const targetIsAgent = roles.includes('workspace_agent') || (!targetIsAdmin && !targetIsManager);
    const profile = profileQuery.data;
    const profileEmail = profile?.email.trim().toLowerCase();
    const isCurrentUser = profile != null && (
      (member.userId != null && profile.id === member.userId)
      || (profileEmail != null && profileEmail === member.email.trim().toLowerCase())
    );
    return {
      isCurrentUser,
      canEditAccess: canManageAssignments && member.canManageChannelAssignments !== false && !isCurrentUser,
      canChangeRole: canManageRoleChange && !isCurrentUser && !targetIsAdmin && (targetIsManager || targetIsAgent),
      canManageLifecycle: canManageLifecycle && !isCurrentUser
        && (isAdmin || (isManager && !targetIsAdmin && !targetIsManager)),
    };
  };

  const invalidateRoster = () => queryClient.invalidateQueries({ queryKey: ['workspace-roster'] });

  const openEditAccess = (member: WorkspaceRosterMember) => {
    setEditChannelIds((member.channelAssignments ?? []).map((assignment) => assignment.channelId));
    setEditLimitToAssigned(member.limitToAssignedConversations ?? false);
    setEditMember(member);
  };

  const openChangeRole = (member: WorkspaceRosterMember) => {
    const roles = member.roleKeys ?? [];
    setRoleSelection(roles.includes('workspace_manager') ? 'MANAGER' : 'AGENT');
    setRoleLimitToAssigned(member.limitToAssignedConversations ?? false);
    setRoleMember(member);
  };

  const editAccessMutation = useMutation({
    mutationFn: () => updateWorkspaceMemberChannelAssignments({
      workspaceId: workspaceId!,
      workspaceMemberId: editMember!.workspaceMemberId!,
      channelIds: editChannelIds,
      limitToAssignedConversations: editLimitToAssigned,
    }),
    onSuccess: async () => {
      setEditMember(null);
      await invalidateRoster();
      await queryClient.invalidateQueries({ queryKey: ['channels'] });
      showNotice('Member access updated');
    },
    onError: (error) => {
      showNotice('Could not update member access', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: () => updateWorkspaceMemberRole({
      workspaceId: workspaceId!,
      workspaceMemberId: roleMember!.workspaceMemberId!,
      role: roleSelection === 'MANAGER' ? 'workspace_manager' : 'workspace_agent',
      limitToAssignedConversations: roleSelection === 'MANAGER' ? false : roleLimitToAssigned,
    }),
    onSuccess: async () => {
      setRoleMember(null);
      await invalidateRoster();
      showNotice('Member role updated');
    },
    onError: (error) => {
      showNotice('Could not update member role', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  const performMemberStatusUpdate = async (member: WorkspaceRosterMember, status: WorkspaceMemberStatusUpdate) => {
    if (!workspaceId || !member.workspaceMemberId) return;
    const isDeactivate = status === 'DISABLED';
    try {
      setIsProcessingMemberAction(true);
      await updateWorkspaceMemberStatus({ workspaceId, workspaceMemberId: member.workspaceMemberId, status });
      showNotice(isDeactivate ? 'Member deactivated' : 'Member reactivated');
      await invalidateRoster();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('member limit')) {
        showNotice('Workspace is full', INVITE_LIMIT_MESSAGE);
        return;
      }
      showNotice(
        isDeactivate ? 'Could not deactivate member' : 'Could not reactivate member',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setIsProcessingMemberAction(false);
      setPendingAction(null);
    }
  };

  const handleToggleMemberStatus = (member: WorkspaceRosterMember) => {
    if (isProcessingMemberAction || copyingInviteId) return;
    if (member.status === 'DISABLED') {
      void performMemberStatusUpdate(member, 'ACTIVE');
      return;
    }
    setPendingAction({ kind: 'status', member, status: 'DISABLED' });
  };

  const waitForMemberRemoval = async (workspaceMemberId: string) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        await queryClient.refetchQueries({ queryKey: ['workspace-roster'] });
      } catch {
        continue;
      }
      const snapshots = queryClient.getQueriesData<{ items?: WorkspaceRosterMember[] }>({
        queryKey: ['workspace-roster'],
      });
      const stillPresent = snapshots.some(([, data]) => data?.items?.some((item) => item.workspaceMemberId === workspaceMemberId));
      if (!stillPresent) return true;
    }
    return false;
  };

  const performDeleteMember = async (member: WorkspaceRosterMember) => {
    if (!workspaceId || !member.workspaceMemberId) return;
    try {
      setIsProcessingMemberAction(true);
      await deleteWorkspaceMember({ workspaceId, workspaceMemberId: member.workspaceMemberId });
    } catch (error) {
      showNotice('Could not delete member', error instanceof Error ? error.message : 'Please try again.');
      setIsProcessingMemberAction(false);
      setPendingAction(null);
      return;
    }
    const removed = await waitForMemberRemoval(member.workspaceMemberId);
    if (removed) {
      showNotice('Member deleted');
    } else {
      showNotice('Member deletion is still processing', 'The member will disappear from the roster once the deletion completes.');
    }
    await invalidateRoster();
    setIsProcessingMemberAction(false);
    setPendingAction(null);
    if (detail && navigation.isFocused()) navigation.goBack();
  };

  const handleCopyInviteLink = async (member: WorkspaceRosterMember) => {
    if (!workspaceId || copyingInviteId || isProcessingMemberAction) return;
    try {
      setCopyingInviteId(member.id);
      const result = await refreshWorkspaceInviteLink(workspaceId, member.id);
      await Clipboard.setStringAsync(result.inviteUrl);
      showNotice('Invitation link copied');
      await invalidateRoster();
    } catch (error) {
      showNotice('Could not copy invitation link', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setCopyingInviteId(null);
    }
  };

  const handleRemoveInvite = async (member: WorkspaceRosterMember) => {
    if (!workspaceId || copyingInviteId || isProcessingMemberAction) return;
    try {
      setIsProcessingMemberAction(true);
      await deleteWorkspaceInvite(workspaceId, member.id);
      showNotice('Invite removed');
      await invalidateRoster();
      if (detail && navigation.isFocused()) navigation.goBack();
    } catch (error) {
      showNotice('Could not remove invite', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsProcessingMemberAction(false);
    }
  };

  const actionPermissions = actionMember ? getMemberPermissions(actionMember) : null;
  const actionIsInvite = actionMember ? isInviteRow(actionMember) : false;
  const actionIsEditable = actionMember ? isEditableRosterMember(actionMember) : false;
  const pendingName = pendingAction ? memberActionName(pendingAction.member) : '';
  const pendingIsDelete = pendingAction?.kind === 'delete';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={detail ? 'Member details' : 'Members'}
        subtitle={detail ? 'Manage workspace access and membership' : 'Team access and workspace coverage'}
        onBack={() => navigation.goBack()}
        right={(
          <AppIconButton
            icon={RefreshCw}
            accessibilityLabel="Refresh members"
            loading={rosterQuery.isRefetching}
            onPress={() => void rosterQuery.refetch()}
          />
        )}
      />

      {!detail ? (
        <>
          <View style={[styles.searchRow, { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder }]}>
            <View style={styles.searchFieldWrap}>
              <AppSearchField
                value={search}
                onChangeText={setSearch}
                placeholder="Search members"
                size="sm"
                tone="background"
              />
            </View>
            <AppButton
              label="Invite"
              icon={UserPlus2}
              onPress={openInvite}
              style={styles.inviteButton}
            />
          </View>

          <View style={styles.statsRow}>
            <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>{summary.total}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Text style={[styles.statValue, { color: '#16a34a' }]}>{summary.active}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Active</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Text style={[styles.statValue, { color: '#2563eb' }]}>{summary.invited}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Invited</Text>
            </View>
          </View>

          {workspaceLoading || rosterQuery.isLoading ? (
            <ListSkeleton rows={6} avatar />
          ) : !workspaceId ? (
            <ErrorState message="Unable to load workspace." />
          ) : rosterQuery.isError ? (
            <ErrorState
              message={rosterQuery.error instanceof Error ? rosterQuery.error.message : 'Could not load members.'}
              onRetry={() => void rosterQuery.refetch()}
            />
          ) : (
            <FlatList
              data={members}
              keyExtractor={(item) => `${item.kind ?? 'MEMBER'}-${item.id}`}
              contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
              ListEmptyComponent={(
                <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                  <UsersRound color={colors.textMuted} size={30} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No members found</Text>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>Try another search or invite a teammate.</Text>
                </View>
              )}
              renderItem={renderMember}
            />
          )}

        </>
      ) : null}

      <BottomSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} sheetStyle={[styles.sheet, styles.inviteSheet]}>
        <View style={styles.sheetHeader}>
          <View style={[styles.sheetIcon, { backgroundColor: colors.surfaceSecondary }]}>
            <UserPlus2 color={colors.primary} size={20} />
          </View>
          <View style={styles.sheetCopy}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Invite team members</Text>
            <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>Send an email invite - they&apos;ll get access right after accepting.</Text>
          </View>
        </View>

        <SheetScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetBody}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
        >
          <View style={styles.fieldBlock}>
            <View style={styles.fieldLabelRow}>
              <Mail color={colors.textMuted} size={14} />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Email addresses</Text>
            </View>
            <View style={[styles.chipBox, { backgroundColor: colors.background, borderColor: emailError ? colors.error : colors.cardBorder }]}>
              <View style={styles.chipWrap}>
                {emails.map((email) => (
                  <View key={email} style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>{email}</Text>
                    <Pressable
                      onPress={() => setEmails((current) => current.filter((item) => item !== email))}
                      hitSlop={8}
                      accessibilityLabel={`Remove ${email}`}
                    >
                      <X color={colors.textMuted} size={13} />
                    </Pressable>
                  </View>
                ))}
              </View>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                value={emailDraft}
                onChangeText={handleDraftChange}
                onBlur={() => void commitEmailDraft()}
                onSubmitEditing={() => void commitEmailDraft()}
                placeholder={emails.length === 0 ? 'name@company.com, another@company.com' : 'Add another email'}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text }]}
              />
            </View>
            <Text style={[styles.helperText, { color: colors.textMuted }]}>Press Enter or comma to add multiple addresses.</Text>
            {emailError ? <Text style={[styles.errorText, { color: colors.error }]}>{emailError}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <View style={styles.fieldLabelRow}>
              <ShieldCheck color={colors.textMuted} size={14} />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Role</Text>
            </View>
            <View style={styles.roleList}>
              {ROLE_OPTIONS.map((option) => {
                const selected = inviteRole === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setInviteRole(option.value)}
                    style={[
                      styles.roleCard,
                      { backgroundColor: colors.background, borderColor: selected ? colors.primary : colors.cardBorder },
                      selected && styles.roleCardActive,
                    ]}
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.roleCardTop}>
                      <Text style={[styles.roleCardLabel, { color: colors.text }]}>{option.label}</Text>
                      {selected ? <Check color={colors.primary} size={16} /> : null}
                    </View>
                    <Text style={[styles.roleCardDescription, { color: colors.textSecondary }]}>{option.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <View style={styles.fieldLabelRow}>
              <Layers color={colors.textMuted} size={14} />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Channels</Text>
            </View>
            <ChannelSelectDropdown
              channels={workspaceChannels}
              selectedIds={selectedChannelIds}
              onToggle={toggleChannel}
              loading={channelsQuery.isLoading}
            />
            {!hasRequiredChannels ? (
              <Text style={[styles.errorText, { color: colors.error }]}>Select at least one channel.</Text>
            ) : null}
          </View>

          {inviteRole === 'AGENT' ? (
            <Pressable
              onPress={() => setLimitToAssigned((current) => !current)}
              style={[styles.toggleCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}
              accessibilityState={{ checked: limitToAssigned }}
              accessibilityRole="checkbox"
            >
              <View style={[styles.checkbox, { borderColor: limitToAssigned ? colors.primary : colors.cardBorder, backgroundColor: limitToAssigned ? colors.primary : 'transparent' }]}>
                {limitToAssigned ? <Check color="#fff" size={14} /> : null}
              </View>
              <View style={styles.toggleCopy}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>Agents can see only assigned conversations</Text>
                <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>
                  {limitToAssigned ? 'On - agents only see conversations assigned to them.' : 'Off - agents can see all conversations in their channels.'}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => setSendEmail((current) => !current)}
            style={[styles.toggleCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}
            accessibilityState={{ checked: sendEmail }}
            accessibilityRole="checkbox"
          >
            <View style={[styles.checkbox, { borderColor: sendEmail ? colors.primary : colors.cardBorder, backgroundColor: sendEmail ? colors.primary : 'transparent' }]}>
              {sendEmail ? <Check color="#fff" size={14} /> : null}
            </View>
            <View style={styles.toggleCopy}>
              <Text style={[styles.toggleTitle, { color: colors.text }]}>Send invite email</Text>
            </View>
          </Pressable>
        </SheetScrollView>

        <View style={[styles.sheetFooter, { borderTopColor: colors.cardBorder }]}>
          <Text style={[styles.footerSummary, { color: colors.textMuted }]}>
            {emails.length + (hasValidDraft ? 1 : 0)} {emails.length + (hasValidDraft ? 1 : 0) === 1 ? 'recipient' : 'recipients'} · {selectedChannelIds.length} {selectedChannelIds.length === 1 ? 'channel' : 'channels'}
          </Text>
          <View style={styles.sheetActions}>
            <AppButton variant="secondary" label="Cancel" onPress={() => setInviteOpen(false)} />
            <AppButton
              label={inviteMutation.isPending ? 'Sending...' : sendEmail ? 'Send invite email' : 'Generate invitation links'}
              icon={Mail}
              loading={inviteMutation.isPending}
              disabled={!canSubmit}
              onPress={() => inviteMutation.mutate()}
            />
          </View>
        </View>
      </BottomSheet>

      {detail ? (
        <ScrollView contentContainerStyle={[styles.detailContent, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]} keyboardShouldPersistTaps="handled">
          {workspaceLoading || rosterQuery.isLoading ? <ListSkeleton rows={3} avatar />
            : rosterQuery.isError ? <ErrorState message="Could not load member." onRetry={() => void rosterQuery.refetch()} />
            : !actionMember ? <ErrorState message="This member is no longer available in this workspace." /> : null}
          {actionMember && !editMember && !roleMember ? (
            <View style={[styles.actionBody, styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.sheetHeader}>
                <ColorfulAvatar name={displayName(actionMember)} url={actionMember.avatarUrl} size={44} />
                <View style={styles.sheetCopy}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>{displayName(actionMember)}</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{actionMember.email}</Text>
                </View>
              </View>
              <View style={styles.detailSummary}>
                <AppBadge size="sm" tone={memberStatusTone(actionMember.status)} label={statusLabel(actionMember.status)} />
                <AppBadge size="sm" label={roleLabel(actionMember)} />
              </View>
              <AccessPill member={actionMember} />
              <View style={styles.actionList} pointerEvents={isProcessingMemberAction || copyingInviteId ? 'none' : 'auto'}>
                {actionIsInvite ? (
                  <>
                    <SheetActionRow
                      icon={Copy}
                      label={copyingInviteId === actionMember.id ? 'Copying...' : 'Copy invite link'}
                      onPress={() => void handleCopyInviteLink(actionMember)}
                    />
                    {canManageLifecycle ? (
                      <SheetActionRow
                        icon={Trash2}
                        label="Remove invite"
                        danger
                        onPress={() => void handleRemoveInvite(actionMember)}
                      />
                    ) : null}
                  </>
                ) : actionIsEditable && actionPermissions ? (
                  <>
                    {actionPermissions.canEditAccess ? (
                      <SheetActionRow
                        icon={Pencil}
                        label="Edit access"
                        onPress={() => openEditAccess(actionMember)}
                      />
                    ) : null}
                    {actionPermissions.canChangeRole ? (
                      <SheetActionRow
                        icon={ShieldCheck}
                        label="Change role"
                        onPress={() => openChangeRole(actionMember)}
                      />
                    ) : null}
                    {actionPermissions.canManageLifecycle ? (
                      <>
                        {actionMember.status === 'DISABLED' ? (
                          <SheetActionRow
                            icon={UserCheck}
                            label="Activate"
                            onPress={() => handleToggleMemberStatus(actionMember)}
                          />
                        ) : (
                          <SheetActionRow
                            icon={UserX}
                            label="Deactivate"
                            onPress={() => handleToggleMemberStatus(actionMember)}
                          />
                        )}
                        <SheetActionRow
                          icon={Trash2}
                          label="Delete"
                          danger
                          onPress={() => {
                            const target = actionMember;
                            setPendingAction({ kind: 'delete', member: target });
                          }}
                        />
                      </>
                    ) : null}
                    {!actionPermissions.canEditAccess && !actionPermissions.canChangeRole && !actionPermissions.canManageLifecycle ? (
                      <View style={[styles.viewOnly, { borderColor: colors.cardBorder, backgroundColor: colors.surfaceSecondary }]}>
                        <ShieldCheck color={colors.textMuted} size={15} />
                        <Text style={[styles.viewOnlyText, { color: colors.textMuted }]}>View only</Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View style={[styles.viewOnly, { borderColor: colors.cardBorder, backgroundColor: colors.surfaceSecondary }]}>
                    <ShieldCheck color={colors.textMuted} size={15} />
                    <Text style={[styles.viewOnlyText, { color: colors.textMuted }]}>View only</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}

          {editMember ? (
            <View style={[styles.actionBody, styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.sheetHeader}>
                <ColorfulAvatar name={displayName(editMember)} url={editMember.avatarUrl} size={44} />
                <View style={styles.sheetCopy}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>Edit access for {memberActionName(editMember)}</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>Update channel visibility and agent inbox scope in one place.</Text>
                </View>
              </View>
              <View style={styles.sheetBody}>
                <View style={styles.fieldBlock}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Channels</Text>
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>Search and tap to add or remove channel access.</Text>
                  <ChannelSelectDropdown
                    channels={workspaceChannels}
                    selectedIds={editChannelIds}
                    onToggle={(channelId) => setEditChannelIds((current) => current.includes(channelId)
                      ? current.filter((id) => id !== channelId)
                      : [...current, channelId])}
                    loading={channelsQuery.isLoading}
                  />
                </View>
                {isAgentRosterMember(editMember) ? (
                  <Pressable
                    onPress={() => setEditLimitToAssigned((current) => !current)}
                    style={[styles.toggleCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                    accessibilityState={{ checked: editLimitToAssigned }}
                    accessibilityRole="checkbox"
                  >
                    <View style={[styles.checkbox, { borderColor: editLimitToAssigned ? colors.primary : colors.cardBorder, backgroundColor: editLimitToAssigned ? colors.primary : 'transparent' }]}>
                      {editLimitToAssigned ? <Check color="#fff" size={14} /> : null}
                    </View>
                    <View style={styles.toggleCopy}>
                      <Text style={[styles.toggleTitle, { color: colors.text }]}>Only show assigned conversations</Text>
                      <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>
                        Search, filters, unread updates, and new messages stay limited to this agent&apos;s assigned inbox conversations.
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
              <View style={[styles.sheetFooter, { borderTopColor: colors.cardBorder }]}>
                <View style={styles.sheetActions}>
                  <AppButton variant="secondary" label="Cancel" onPress={() => setEditMember(null)} />
                  <AppButton
                    label={editAccessMutation.isPending ? 'Saving...' : 'Save access changes'}
                    loading={editAccessMutation.isPending}
                    onPress={() => editAccessMutation.mutate()}
                  />
                </View>
              </View>
            </View>
          ) : null}

          {roleMember ? (
            <View style={[styles.actionBody, styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.sheetHeader}>
                <ColorfulAvatar name={displayName(roleMember)} url={roleMember.avatarUrl} size={44} />
                <View style={styles.sheetCopy}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>Change role for {memberActionName(roleMember)}</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>Conversations stay assigned. Only the workspace role changes.</Text>
                </View>
              </View>
              <View style={styles.sheetBody}>
                <View style={styles.fieldBlock}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Role</Text>
                  <View style={styles.roleList}>
                    {ROLE_OPTIONS.map((option) => {
                      const selected = roleSelection === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setRoleSelection(option.value)}
                          style={[
                            styles.roleCard,
                            { backgroundColor: colors.background, borderColor: selected ? colors.primary : colors.cardBorder },
                            selected && styles.roleCardActive,
                          ]}
                          accessibilityState={{ selected }}
                        >
                          <View style={styles.roleCardTop}>
                            <Text style={[styles.roleCardLabel, { color: colors.text }]}>{option.label}</Text>
                            {selected ? <Check color={colors.primary} size={16} /> : null}
                          </View>
                          <Text style={[styles.roleCardDescription, { color: colors.textSecondary }]}>{option.description}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                {roleSelection === 'AGENT' ? (
                  <Pressable
                    onPress={() => setRoleLimitToAssigned((current) => !current)}
                    style={[styles.toggleCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                    accessibilityState={{ checked: roleLimitToAssigned }}
                    accessibilityRole="checkbox"
                  >
                    <View style={[styles.checkbox, { borderColor: roleLimitToAssigned ? colors.primary : colors.cardBorder, backgroundColor: roleLimitToAssigned ? colors.primary : 'transparent' }]}>
                      {roleLimitToAssigned ? <Check color="#fff" size={14} /> : null}
                    </View>
                    <View style={styles.toggleCopy}>
                      <Text style={[styles.toggleTitle, { color: colors.text }]}>Agents can see only assigned conversations</Text>
                      <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>
                        Turn this on to keep the member scoped to assigned inbox conversations only.
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <View style={[styles.infoNote, { borderColor: colors.cardBorder, backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.infoNoteText, { color: colors.textSecondary }]}>
                      Managers keep their existing channel access and can continue to work with the same assigned conversations.
                    </Text>
                  </View>
                )}
              </View>
              <View style={[styles.sheetFooter, { borderTopColor: colors.cardBorder }]}>
                <Text style={[styles.footerSummary, { color: colors.textMuted }]}>
                  Current role: {(roleMember.roleKeys ?? []).includes('workspace_manager') ? 'Manager' : 'Agent'}
                </Text>
                <View style={styles.sheetActions}>
                  <AppButton variant="secondary" label="Cancel" onPress={() => setRoleMember(null)} />
                  <AppButton
                    label={changeRoleMutation.isPending ? 'Saving...' : 'Save role'}
                    loading={changeRoleMutation.isPending}
                    onPress={() => changeRoleMutation.mutate()}
                  />
                </View>
              </View>
            </View>
          ) : null}

        </ScrollView>
      ) : null}

      <ConfirmDialog
        visible={pendingAction !== null}
        title={pendingIsDelete ? 'Delete member?' : 'Deactivate member?'}
        body={pendingIsDelete
          ? `This will remove ${pendingName} from the workspace. Their assigned conversations will be unassigned first. Deletion runs in the background and can take a moment.`
          : `This will disable ${pendingName} so they can no longer log in until reactivated.`}
        confirmLabel={isProcessingMemberAction ? (pendingIsDelete ? 'Deleting...' : 'Deactivating...') : (pendingIsDelete ? 'Delete' : 'Deactivate')}
        destructive={pendingIsDelete}
        loading={isProcessingMemberAction}
        icon={pendingIsDelete ? Trash2 : UserX}
        onClose={() => {
          if (!isProcessingMemberAction) setPendingAction(null);
        }}
        onConfirm={() => {
          if (!pendingAction || isProcessingMemberAction) return;
          if (pendingAction.kind === 'delete') {
            void performDeleteMember(pendingAction.member);
          } else {
            void performMemberStatusUpdate(pendingAction.member, pendingAction.status);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  detailContent: { padding: spacing.lg, gap: spacing.lg },
  detailCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg },
  detailSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  searchRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchFieldWrap: { flex: 1, minWidth: 0 },
  inviteButton: { height: 38, paddingHorizontal: 14 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  stat: { borderRadius: 14, borderWidth: 1, flex: 1, padding: 12 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  listContent: { gap: 10, padding: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14 },
  memberHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  avatarWrap: { position: 'relative' },
  presenceDot: { borderRadius: 6, borderWidth: 2, bottom: 0, height: 12, position: 'absolute', right: 0, width: 12 },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, fontWeight: '800' },
  memberEmail: { fontSize: 12, marginTop: 3 },
  metaRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  metaBlock: { minWidth: 82 },
  accessBlock: { flex: 1, minWidth: 0 },
  metaLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  rolePill: { alignSelf: 'flex-start', borderRadius: 999, fontSize: 11, fontWeight: '800', marginTop: 6, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5 },
  accessPill: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 7, marginTop: 6, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6 },
  allAccess: { borderColor: '#bfdbfe', borderStyle: 'dashed' },
  pendingAccess: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderStyle: 'dashed' },
  pendingDot: { backgroundColor: '#64748b', borderRadius: 2, height: 4, width: 4 },
  pendingText: { color: '#64748b', flexShrink: 1, fontSize: 11, fontWeight: '700' },
  accessStrong: { fontSize: 11, fontWeight: '800' },
  accessMuted: { flexShrink: 1, fontSize: 11, fontWeight: '600' },
  noChannelAccess: { paddingHorizontal: 7, paddingVertical: 3, gap: 5 },
  singleChannel: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 999, flexDirection: 'row', gap: 7, marginTop: 6, maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 5 },
  channelName: { flexShrink: 1, fontSize: 11, fontWeight: '800' },
  multiChannel: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 7 },
  channelStack: { flexDirection: 'row' },
  emptyCard: { alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 28 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 12 },
  emptyBody: { fontSize: 13, lineHeight: 19, marginTop: 4, textAlign: 'center' },
  sheet: { paddingBottom: 12, paddingHorizontal: 20, paddingTop: 6 },
  inviteSheet: { height: '88%' },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', marginBottom: 12 },
  sheetIcon: { alignItems: 'center', borderRadius: 18, height: 42, justifyContent: 'center', width: 42 },
  sheetCopy: { flex: 1, marginLeft: 12, minWidth: 0 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetSubtitle: { fontSize: 12, marginTop: 2 },
  sheetScroll: { flex: 1, minHeight: 0 },
  sheetBody: { gap: 18, paddingBottom: 20, paddingTop: 4 },
  fieldBlock: { gap: 8 },
  fieldLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  chipBox: { borderRadius: 14, borderWidth: 1, gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 6, maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 5 },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
  input: { fontSize: 14, minHeight: 32, paddingVertical: 4, textAlignVertical: 'top' },
  helperText: { fontSize: 11 },
  errorText: { fontSize: 12, fontWeight: '600' },
  roleList: { gap: 8 },
  roleCard: { borderRadius: 14, borderWidth: 1, padding: 12 },
  roleCardActive: { borderWidth: 1.5 },
  roleCardTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  roleCardLabel: { fontSize: 13, fontWeight: '800' },
  roleCardDescription: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  noChannels: { borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
  dropdown: { gap: 8 },
  dropdownTrigger: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 46, paddingHorizontal: 12, paddingVertical: 11 },
  dropdownTriggerText: { flex: 1, fontSize: 14, fontWeight: '600', minWidth: 0 },
  selectedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selectedChip: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, maxWidth: '100%', paddingLeft: 4, paddingRight: 6, paddingVertical: 4 },
  selectedChipText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
  dropdownPanel: { borderRadius: 14, borderWidth: 1, gap: 6, padding: 8 },
  optionsList: { maxHeight: 248 },
  optionsContent: { gap: 6 },
  channelRow: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  channelCopy: { flex: 1, minWidth: 0 },
  channelSub: { fontSize: 11, marginTop: 2 },
  toggleCard: { alignItems: 'flex-start', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 12 },
  toggleCopy: { flex: 1, minWidth: 0 },
  toggleTitle: { fontSize: 13, fontWeight: '800' },
  toggleSub: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  checkbox: { alignItems: 'center', borderRadius: 6, borderWidth: 1, height: 22, justifyContent: 'center', marginTop: 1, width: 22 },
  sheetFooter: { borderTopWidth: 1, gap: 10, paddingTop: 12 },
  footerSummary: { fontSize: 11 },
  sheetActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  actionBody: { gap: 12, paddingBottom: 8 },
  actionList: { gap: 6 },
  actionRow: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  actionIcon: { alignItems: 'center', borderRadius: 10, height: 32, justifyContent: 'center', width: 32 },
  actionLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  viewOnly: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', paddingVertical: 10 },
  viewOnlyText: { fontSize: 13, fontWeight: '700' },
  infoNote: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  infoNoteText: { fontSize: 12, lineHeight: 18 },
  warningNote: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  warningNoteText: { fontSize: 12, lineHeight: 18 },
});
