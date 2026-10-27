import assert from 'node:assert/strict';
import test from 'node:test';
import { application } from './helpers/application.mjs';

test('assignment requests distinguish human, AI, and clearing both owners', async () => {
  const requests = [];
  const inbox = application({ 'src/api/client': { apiFetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return {}; } } })('src/api/inbox');
  await inbox.updateConversationAssignment('thread', 'member');
  await inbox.updateConversationAssignment('thread', null, 'agent');
  await inbox.updateConversationAssignment('thread', null, null);
  assert.deepEqual(requests.map((item) => item.body), [
    { assigneeWorkspaceMemberId: 'member' },
    { assigneeWorkspaceMemberId: null, assigneeAiAgentId: 'agent' },
    { assigneeWorkspaceMemberId: null, assigneeAiAgentId: null },
  ]);
});

test('AI assignment and handoff history preserves names and handoff reasons', () => {
  const { getAssignmentEventPresentation } = application()('src/lib/inbox-utils');
  const event = { actedBy: null, fromMember: null, toMember: null, note: null };
  assert.equal(getAssignmentEventPresentation({ ...event, reason: 'AI_ASSIGNED', toAiAgent: { name: 'Sales' } }).body, 'AI Agent Sales was assigned to this conversation');
  const handoff = getAssignmentEventPresentation({ ...event, reason: 'AI_HANDOFF', fromAiAgent: { name: 'Sales' }, toMember: { userName: 'Sam' }, note: 'Needs help' });
  assert.equal(handoff.actorLabel, 'System');
  assert.equal(handoff.body, 'AI Agent Sales handed off to Sam: Needs help');
  assert.equal(getAssignmentEventPresentation({ ...event, reason: 'AI_HANDOFF_PENDING', note: 'No members available' }).body, 'AI Agent handoff is pending: No members available');
  assert.equal(getAssignmentEventPresentation({ ...event, reason: 'MANUAL', actedBy: { userName: 'Sam' }, toMember: { userName: 'Alex' } }).body, 'Sam assigned Alex to this conversation');
});

function draftHarness(overrides = {}) {
  const calls = [];
  const api = Object.fromEntries(['createChannelKnowledgeBase', 'createKnowledgeEntry', 'updateKnowledgeEntry', 'updateKnowledgeBase', 'uploadKnowledgeBaseFile', 'replaceKnowledgeSource', 'deleteKnowledgeEntry', 'deleteKnowledgeSource'].map((key) => [key, async (...args) => {
    calls.push(key);
    if (overrides[key]) return overrides[key](...args);
    return { id: key === 'createChannelKnowledgeBase' ? 'base' : 'saved-entry', name: 'Knowledge' };
  }]));
  return { calls, ...application({ 'src/api/knowledge-base': api })('src/lib/ai-agent-knowledge-draft') };
}

test('preparing knowledge makes no requests until save and validates before writes', async () => {
  const h = draftHarness();
  const draft = h.knowledgeDraftFromBase(null);
  draft.name = 'Knowledge';
  draft.entries.push({ id: 'new', title: 'Incomplete', content: '', existing: false, changed: true });
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.saveAgentKnowledgeDraft(draft, 'workspace', 'channel', () => {}), /Complete every/);
  assert.equal(h.calls.length, 0);
  draft.entries = [];
  await assert.rejects(h.saveAgentKnowledgeDraft(draft, 'workspace', undefined, () => {}), /Select a channel/);
  assert.equal(h.calls.length, 0);
});

test('a failed knowledge save resumes without recreating the base or completed entries', async () => {
  let failUpload = true;
  const h = draftHarness({ uploadKnowledgeBaseFile: () => { if (failUpload) throw new Error('offline'); } });
  let draft = h.knowledgeDraftFromBase(null);
  draft.name = 'Knowledge';
  draft.entries = [{ id: 'new', title: 'Hours', content: '9 to 5', existing: false, changed: true }];
  draft.files = [{ id: 'file', file: { uri: 'file:///faq.txt', name: 'faq.txt', mimeType: 'text/plain' } }];
  await assert.rejects(h.saveAgentKnowledgeDraft(draft, 'workspace', 'channel', (next) => { draft = next; }), /offline/);
  assert.equal(draft.base.id, 'base');
  assert.equal(draft.entries[0].existing, true);
  assert.equal(draft.entries[0].changed, false);
  failUpload = false;
  assert.equal(await h.saveAgentKnowledgeDraft(draft, 'workspace', 'channel', (next) => { draft = next; }), 'base');
  assert.equal(h.calls.filter((key) => key === 'createChannelKnowledgeBase').length, 1);
  assert.equal(h.calls.filter((key) => key === 'createKnowledgeEntry').length, 1);
  assert.equal(draft.files.length, 0);
  assert.equal(h.knowledgeDraftDirty(draft), false);
});

test('existing knowledge stages rename, entry edits, replacements, and deletion', async () => {
  const h = draftHarness();
  let draft = h.knowledgeDraftFromBase({ id: 'base', name: 'Old', entries: [{ id: 'entry', title: 'Hours', content: '9' }] });
  draft.name = 'New';
  draft.entries[0] = { ...draft.entries[0], content: '10', changed: true };
  draft.files = [{ id: 'replacement', sourceId: 'source', file: { uri: 'file:///new.txt', name: 'new.txt', mimeType: 'text/plain' } }];
  draft.removedEntries = ['deleted-entry'];
  draft.removedSources = ['deleted-source'];
  await h.saveAgentKnowledgeDraft(draft, 'workspace', undefined, (next) => { draft = next; });
  assert.deepEqual(h.calls, ['updateKnowledgeBase', 'updateKnowledgeEntry', 'replaceKnowledgeSource', 'deleteKnowledgeEntry', 'deleteKnowledgeSource']);
  assert.equal(h.knowledgeDraftDirty(draft), false);
});

test('only assignment managers can choose the active AI agent and closed threads disable it', () => {
  function render({ manager = true, status = 'OPEN', assignedAiAgent = null } = {}) {
    const token = `header.${Buffer.from(JSON.stringify({ workspaceId: 'workspace', permissions: [] })).toString('base64url')}.signature`;
    const load = application({
      react: { useMemo: (fn) => fn(), useState: (value) => [value, () => {}], useEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
      'react-native': { StyleSheet: { create: (value) => value }, View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator' },
      'lucide-react-native': { Archive: 'Archive', Bot: 'Bot', Mail: 'Mail', MailOpen: 'MailOpen', RotateCcw: 'RotateCcw', Search: 'Search', Star: 'Star', X: 'X' },
      '@tanstack/react-query': { useQuery: () => ({ data: [] }) },
      'src/api/client': { latestAccessToken: token, subscribeAccessToken: () => {} },
      'src/api/inbox': { fetchAssigneeOptions: async () => [] },
      'src/auth/AuthContext': { useAuth: () => ({ session: { user: { email: 'me@example.com' } } }) },
      'src/lib/workspace-access': { useWorkspaceAccess: () => ({ workspace: { id: 'workspace', roleKeys: [manager ? 'workspace_manager' : 'workspace_agent'] } }) },
      'src/theme/ThemeContext': { useTheme: () => ({ colors: {} }) },
      'src/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'ScrollView' },
      'src/components/ColorfulAvatar': { ColorfulAvatar: 'Avatar' },
    });
    const calls = [];
    const tree = load('src/components/ConversationAssignmentSheet').ConversationAssignmentSheet({ visible: true, workspaceId: 'workspace', assignee: null,
      status, assignedAiAgent, activeAiAgent: { id: 'ai', name: 'Sales' }, onAssign: (...args) => calls.push(args) });
    const elements = [];
    function walk(element) {
      if (Array.isArray(element)) return element.forEach(walk);
      if (!element?.props) return;
      elements.push(element);
      walk(element.props.children);
    }
    walk(tree);
    return { calls, elements, ai: elements.find((element) => element.props.accessibilityLabel === 'Assign to AI Agent Sales') };
  }
  const manager = render();
  assert.equal(manager.ai.props.disabled, false);
  manager.ai.props.onPress();
  assert.deepEqual(manager.calls, [[null, 'ai']]);
  assert.equal(render({ manager: false }).ai, undefined);
  assert.equal(render({ status: 'CLOSED' }).ai.props.disabled, true);
  assert.equal(render({ assignedAiAgent: { id: 'ai', name: 'Sales', status: 'ACTIVE' } }).ai.props.disabled, true);
  const paused = render({ assignedAiAgent: { id: 'old', name: 'Previous', status: 'PAUSED' } });
  assert.ok(paused.elements.some((element) => element.props.children === 'AI Agent unavailable ? Previous'));
  paused.elements.find((element) => element.props.accessibilityLabel === 'Unassign conversation').props.onPress();
  assert.deepEqual(paused.calls, [[null, null]]);
});
