import { useMemo, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { latestAccessToken, subscribeAccessToken } from '../api/client';
import { workspaceIdFromAccessToken } from '../lib/jwt-workspace';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { aiAgentQueryKeys, fetchAiAgents, fetchAiAgentTemplates } from '../api/ai-agents';

export function useAiAgentAccess() {
  const token = useSyncExternalStore(subscribeAccessToken, () => latestAccessToken);
  const { workspace, loading, error, refetch } = useWorkspaceAccess();
  const workspaceId = workspaceIdFromAccessToken(token);
  const permissions = useMemo<string[]>(() => {
    try {
      const payload = token?.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
      const claims = payload ? JSON.parse(globalThis.atob(payload)) : null;
      return Array.isArray(claims?.permissions) ? claims.permissions : [];
    } catch { return []; }
  }, [token]);
  const manager = workspace?.id === workspaceId && (workspace.roleKeys ?? []).some((role) => ['workspace_admin', 'workspace_manager'].includes(role));
  const canUpdate = Boolean(workspaceId && (manager || permissions.includes('workspace.settings.update')));
  const canRead = canUpdate || Boolean(workspaceId && permissions.includes('workspace.settings.read'));
  return { workspaceId, canRead, canUpdate, loading, error, refetch };
}

export function useAiAgents(workspaceId: string | null, enabled = true) {
  return useQuery({ queryKey: aiAgentQueryKeys.list(workspaceId), queryFn: fetchAiAgents, enabled: Boolean(workspaceId) && enabled, staleTime: 30_000 });
}

export function useAiAgentTemplates(enabled: boolean) {
  return useQuery({ queryKey: aiAgentQueryKeys.templates, queryFn: fetchAiAgentTemplates, enabled, staleTime: 300_000 });
}

export function useAiAgentMutation<T>(operation: (value: T) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: operation, onSuccess: async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: aiAgentQueryKeys.all }),
      client.invalidateQueries({ queryKey: ['channels'] }),
    ]);
  } });
}
