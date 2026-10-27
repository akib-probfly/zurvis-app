import { useQuery } from '@tanstack/react-query';
import { Archive, Bot, Mail, MailOpen, RotateCcw, Search, Star, X } from 'lucide-react-native';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchAssigneeOptions, type AssigneeFilterOption, type ConversationAiAgent } from '../api/inbox';
import { latestAccessToken, subscribeAccessToken } from '../api/client';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet, SheetScrollView } from './BottomSheet';
import { ColorfulAvatar } from './ColorfulAvatar';

type ConversationAssignee = {
  workspaceMemberId: string;
  userName?: string | null;
  userEmail?: string | null;
  avatarUrl?: string | null;
} | null;

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string | null;
  workspaceId?: string | null;
  channelId?: string | null;
  assignee: ConversationAssignee;
  assignedAiAgent?: ConversationAiAgent | null;
  activeAiAgent?: { id: string; name: string } | null;
  status?: string | null;
  unreadCount?: number;
  isStarred?: boolean;
  isUpdating: boolean;
  isUpdatingRead?: boolean;
  isUpdatingStatus?: boolean;
  isUpdatingStar?: boolean;
  errorMessage?: string | null;
  onAssign: (member: AssigneeFilterOption | null, aiAgentId?: string | null) => void;
  onToggleRead: () => void;
  onToggleStatus: () => void;
  onToggleStar: () => void;
};

type SheetTab = 'assignment' | 'actions';

function getRoleBadgeLabel(roleKey: AssigneeFilterOption['roleKey']) {
  switch (roleKey) {
    case 'workspace_admin':
      return 'Admin';
    case 'workspace_manager':
      return 'Manager';
    case 'workspace_agent':
      return 'Agent';
    default:
      return roleKey;
  }
}

export function ConversationAssignmentSheet({
  visible,
  onClose,
  title,
  workspaceId,
  channelId,
  assignee,
  assignedAiAgent,
  activeAiAgent,
  status,
  unreadCount = 0,
  isStarred = false,
  isUpdating,
  isUpdatingRead,
  isUpdatingStatus,
  isUpdatingStar,
  errorMessage,
  onAssign,
  onToggleRead,
  onToggleStatus,
  onToggleStar,
}: Props) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { workspace } = useWorkspaceAccess();
  const token = useSyncExternalStore(subscribeAccessToken, () => latestAccessToken);
  const canAssignAi = useMemo(() => {
    let claims: { permissions?: string[]; workspaceId?: string } = {};
    try { claims = JSON.parse(globalThis.atob(token?.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '')); } catch { /* No assignment access without a valid workspace scope. */ }
    return claims.workspaceId === workspaceId && (
      (workspace?.id === workspaceId && (workspace?.roleKeys ?? []).some((role) => ['super_admin', 'workspace_admin', 'workspace_manager'].includes(role)))
      || (claims.permissions ?? []).includes('conversation.assign.any'));
  }, [token, workspace, workspaceId]);
  const [agentSearch, setAgentSearch] = useState('');
  const [tab, setTab] = useState<SheetTab>('assignment');
  const isClosed = status === 'CLOSED';

  const assigneesQuery = useQuery({
    queryKey: ['assignee-filter-options', workspaceId, channelId],
    queryFn: () => fetchAssigneeOptions(workspaceId ?? undefined, channelId ?? undefined),
    enabled: visible && Boolean(workspaceId),
    staleTime: 60_000,
  });

  const members = useMemo(() => assigneesQuery.data ?? [], [assigneesQuery.data]);
  const currentUserEmail = session?.user?.email?.toLowerCase() ?? null;
  const currentUserLabel = session?.user?.name ?? session?.user?.email ?? 'me';
  const currentUserOption = useMemo(
    () => members.find((member) => member.email.toLowerCase() === currentUserEmail) ?? null,
    [members, currentUserEmail],
  );
  const unavailableAi = assignedAiAgent && (assignedAiAgent.status !== 'ACTIVE' || activeAiAgent?.id !== assignedAiAgent.id);
  const assigneeLabel = assignee?.userName ?? assignee?.userEmail
    ?? (assignedAiAgent ? `${unavailableAi ? 'AI Agent unavailable' : 'AI Agent'} ? ${assignedAiAgent.name}` : 'Unassigned');
  const visibleMembers = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => `${member.name ?? ''} ${member.email}`.toLowerCase().includes(query));
  }, [members, agentSearch]);

  useEffect(() => {
    if (!visible) {
      setAgentSearch('');
      setTab('assignment');
    }
  }, [visible]);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title || 'Conversation'}</Text>
      </View>
      <View style={[styles.tabs, { backgroundColor: colors.surfaceSecondary }]}>
        {([
          { id: 'assignment', label: 'Assignment' },
          { id: 'actions', label: 'Actions' },
        ] as const).map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setTab(item.id)}
              style={[styles.tab, active && styles.tabActive, active && { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.tabText, { color: active ? colors.text : colors.textSecondary }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <SheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tab === 'assignment' ? (
          <>
            <View style={[styles.currentCard, { backgroundColor: colors.surfaceSecondary }]}>
              {assignee || assignedAiAgent ? (
                <View style={[styles.currentChip, { backgroundColor: colors.background }]}>
                  {assignee ? (
                  <ColorfulAvatar
                    name={assigneeLabel}
                    size={28}
                    url={assignee.avatarUrl ?? null}
                    allowColorful={false}
                  />
                  ) : <Bot color={colors.primary} size={28} />}
                  <Text style={[styles.currentName, { color: colors.text }]} numberOfLines={1}>{assigneeLabel}</Text>
                  <Pressable
                    accessibilityLabel="Unassign conversation"
                    disabled={isUpdating || isClosed || (!assignee && !canAssignAi)}
                    hitSlop={8}
                    onPress={() => onAssign(null, null)}
                    style={[styles.unassign, { backgroundColor: colors.textMuted }, (isUpdating || isClosed) && styles.disabled]}
                  >
                    <X color="#fff" size={12} />
                  </Pressable>
                </View>
              ) : (
                <Text style={[styles.unassigned, { color: colors.textSecondary }]}>Unassigned</Text>
              )}
            </View>

            {currentUserOption ? (
              <Pressable
                disabled={isUpdating || isClosed || assignee?.workspaceMemberId === currentUserOption.workspaceMemberId}
                onPress={() => onAssign(currentUserOption)}
                style={[styles.assignMe, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }, (isUpdating || isClosed) && styles.disabled]}
              >
                <View style={styles.assignMeLeft}>
                  <ColorfulAvatar
                    name={currentUserLabel}
                    size={28}
                    url={currentUserOption.avatarUrl}
                    allowColorful={false}
                  />
                  <Text style={[styles.assignMeText, { color: colors.text }]}>Assign to me</Text>
                </View>
                <Text style={[styles.assignMeHint, { color: colors.textMuted }]} numberOfLines={1}>{currentUserLabel}</Text>
              </Pressable>
            ) : null}

            {canAssignAi && activeAiAgent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Assign to AI Agent ${activeAiAgent.name}`}
                disabled={isUpdating || isClosed || assignedAiAgent?.id === activeAiAgent.id}
                onPress={() => onAssign(null, activeAiAgent.id)}
                style={[styles.assignMe, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder },
                  (isUpdating || isClosed || assignedAiAgent?.id === activeAiAgent.id) && styles.disabled]}
              >
                <View style={styles.assignMeLeft}><Bot color={colors.primary} size={28} /><Text style={[styles.assignMeText, { color: colors.text }]}>AI Agent</Text></View>
                <Text style={[styles.assignMeHint, { color: colors.textMuted }]} numberOfLines={1}>{activeAiAgent.name}</Text>
              </Pressable>
            ) : null}

            <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.inputBorder }]}>
              <Search color={colors.textMuted} size={16} />
              <TextInput
                value={agentSearch}
                onChangeText={setAgentSearch}
                placeholder="Search agents"
                placeholderTextColor={colors.textMuted}
                style={[styles.searchInput, { color: colors.text }]}
              />
            </View>

            {assigneesQuery.isLoading ? (
              <View style={[styles.loadingRow, { backgroundColor: colors.surfaceSecondary }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading members...</Text>
              </View>
            ) : assigneesQuery.isError ? (
              <Text style={[styles.empty, { color: colors.error }]}>Could not load eligible agents.</Text>
            ) : visibleMembers.length ? (
              visibleMembers.map((member) => {
                const selected = assignee?.workspaceMemberId === member.workspaceMemberId;
                return (
                  <Pressable
                    key={member.workspaceMemberId}
                    disabled={isUpdating || isClosed || selected}
                    onPress={() => onAssign(member)}
                    style={[
                      styles.memberRow,
                      { backgroundColor: selected ? colors.primary : colors.surfaceSecondary },
                      (isUpdating || isClosed) && styles.disabled,
                    ]}
                  >
                    <ColorfulAvatar
                      name={member.name ?? member.email}
                      size={28}
                      url={member.avatarUrl}
                      allowColorful={false}
                    />
                    <View style={styles.memberCopy}>
                      <Text style={[styles.memberName, { color: selected ? '#fff' : colors.text }]} numberOfLines={1}>
                        {member.name ?? member.email}
                      </Text>
                      <View style={[styles.roleBadge, selected ? styles.roleBadgeSelected : { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                        <Text style={[styles.roleBadgeText, { color: selected ? '#fff' : colors.textSecondary }]}>
                          {getRoleBadgeLabel(member.roleKey)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text style={[styles.empty, { color: colors.textMuted }]}>No eligible agents matched your search.</Text>
            )}

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {isClosed ? (
              <Text style={[styles.closedHint, { color: colors.textMuted }]}>Reopen this conversation to change assignment.</Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Status</Text>
              <Text style={[styles.metaValue, { color: isClosed ? colors.error : colors.text }]}>{isClosed ? 'Closed' : 'Open'}</Text>
            </View>
            <Pressable
              style={[styles.action, { backgroundColor: colors.surfaceSecondary }]}
              disabled={isUpdatingStar}
              onPress={() => {
                onToggleStar();
                onClose();
              }}
            >
              <Star color="#f59e0b" fill={isStarred ? '#f59e0b' : 'none'} size={18} />
              <Text style={[styles.actionText, { color: colors.primary }]}>
                {isStarred ? 'Unstar conversation' : 'Star conversation'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.action, { backgroundColor: colors.surfaceSecondary }]}
              disabled={isUpdatingRead}
              onPress={() => {
                onToggleRead();
                onClose();
              }}
            >
              {unreadCount > 0
                ? <Mail color={colors.primary} size={18} />
                : <MailOpen color={colors.primary} size={18} />}
              <Text style={[styles.actionText, { color: colors.primary }]}>{unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}</Text>
            </Pressable>
            <Pressable
              style={[styles.action, { backgroundColor: colors.surfaceSecondary }]}
              disabled={isUpdatingStatus}
              onPress={() => {
                onToggleStatus();
                onClose();
              }}
            >
              {isClosed
                ? <RotateCcw color={colors.error} size={18} />
                : <Archive color={colors.primary} size={18} />}
              <Text style={[styles.actionText, { color: isClosed ? colors.error : colors.primary }]}>
                {isClosed ? 'Reopen conversation' : 'Mark as closed'}
              </Text>
            </Pressable>
          </>
        )}
      </SheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '88%', paddingHorizontal: 16, paddingTop: 4 },
  content: { gap: 8, paddingBottom: 8 },
  header: { marginBottom: 8, paddingTop: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  tabs: { borderRadius: 14, flexDirection: 'row', gap: 4, marginBottom: 12, padding: 4 },
  tab: { alignItems: 'center', borderRadius: 10, flex: 1, paddingVertical: 8 },
  tabActive: { elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4 },
  tabText: { fontSize: 13, fontWeight: '700' },
  metaRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metaLabel: { fontSize: 13 },
  metaValue: { fontSize: 13, fontWeight: '700' },
  action: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 10, marginTop: 6, paddingHorizontal: 14, paddingVertical: 12 },
  actionText: { fontSize: 14, fontWeight: '700' },
  currentCard: { borderRadius: 16, marginBottom: 12, padding: 12 },
  currentChip: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  currentName: { flex: 1, fontSize: 14, fontWeight: '600' },
  unassign: { alignItems: 'center', borderRadius: 11, height: 22, justifyContent: 'center', width: 22 },
  unassigned: { fontSize: 14, paddingVertical: 6 },
  assignMe: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 12, paddingVertical: 10 },
  assignMeLeft: { alignItems: 'center', flexDirection: 'row', flex: 1, gap: 8, minWidth: 0 },
  assignMeText: { fontSize: 14, fontWeight: '600' },
  assignMeHint: { flexShrink: 1, fontSize: 12, marginLeft: 8, maxWidth: '38%' },
  search: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', marginBottom: 12, paddingHorizontal: 10 },
  searchInput: { flex: 1, fontSize: 14, height: 40, marginLeft: 8 },
  loadingRow: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  loadingText: { fontSize: 13 },
  memberRow: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 10, minHeight: 52, paddingHorizontal: 10, paddingVertical: 8 },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, fontWeight: '600' },
  roleBadge: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, marginTop: 4, paddingHorizontal: 8, paddingVertical: 2 },
  roleBadgeSelected: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.2)' },
  roleBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  empty: { fontSize: 13, paddingVertical: 12 },
  errorBox: { backgroundColor: '#fff1f2', borderColor: '#fecdd3', borderRadius: 12, borderWidth: 1, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8 },
  errorText: { color: '#be123c', fontSize: 12 },
  closedHint: { fontSize: 12, marginTop: 8 },
  disabled: { opacity: 0.55 },
});
