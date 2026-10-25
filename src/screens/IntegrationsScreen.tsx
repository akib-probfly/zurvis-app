import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, ChevronRight, Layers3, PackageOpen, Search, Settings2, ShoppingBag, Store, Trash2, Truck } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { disableCourierConnection, listCourierConnections, type CourierConnection } from '../api/couriers';
import { IntegrationLogo } from '../components/IntegrationLogo';
import { updateWorkspaceSettings } from '../api/workspaces';
import type { SettingsStackParamList } from '../navigation/SettingsStack';
import { useWorkspaceAccess } from '../lib/workspace-access';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import { AppButton, AppCard, AppListRow, AppText, ScreenHeader } from '../ui';

const CATALOG_TOTAL = 4;

export function IntegrationsScreen() {
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { workspace, canManage } = useWorkspaceAccess();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const connectionsQuery = useQuery({ queryKey: ['courier-connections'], queryFn: listCourierConnections, enabled: Boolean(workspace?.ecommerceEnabled) });
  const courierConnections = (connectionsQuery.data?.items ?? []).filter((item) => item.status !== 'DISABLED');
  const connectedCount = courierConnections.filter((item) => item.status === 'CONNECTED').length;
  const ecommerceMutation = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!workspace?.id) throw new Error('Workspace is not ready. Please try again.');
      return updateWorkspaceSettings(workspace.id, { ecommerceEnabled: enabled });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces', 'mine'] });
    },
    onError: (cause: Error) => Alert.alert('Could not update Ecommerce Setup', cause.message),
  });
  const browseCatalog = () => navigation.navigate('IntegrationCatalog');
  const openDetails = (connection: CourierConnection) => navigation.navigate('CourierConnectionDetails', { connectionId: connection.id });
  const openConfigure = (connection: CourierConnection) => navigation.navigate('CourierConnectionConfigure', { connectionId: connection.id });
  const confirmDisconnect = (connection: CourierConnection) => {
    Alert.alert('Disconnect courier?', `Disconnect ${connection.displayName} from this workspace?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect(connection) },
    ]);
  };
  const disconnect = async (connection: CourierConnection) => {
    if (disconnectingId) return;
    setDisconnectingId(connection.id);
    try {
      await disableCourierConnection(connection.id);
      await queryClient.invalidateQueries({ queryKey: ['courier-connections'] });
    } catch (cause) {
      Alert.alert('Could not disconnect courier', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Integrations"
        onBack={() => navigation.goBack()}
        right={<AppButton icon={Search} label="Browse Catalog" onPress={browseCatalog} />}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppCard padding="none"><AppListRow icon={Bot} title="AI Agents" description="Create and manage AI agents" last onPress={() => navigation.navigate('AiAgents')} /></AppCard>
        <View style={styles.statsGrid}>
          <StatCard label="Connected" value={String(connectedCount)} icon={Layers3} color={colors.primary} soft={colors.primarySoft} />
          <StatCard label="Available" value={String(CATALOG_TOTAL)} icon={PackageOpen} color={colors.success} soft={colors.successSoft} />
          <StatCard label="Stores" value="2" icon={Store} color={colors.indigo} soft={colors.indigoSoft} />
          <StatCard label="Delivery partners" value="2" icon={Truck} color={colors.warning} soft={colors.warningSoft} />
        </View>

        <AppCard style={styles.ecommerceCard}>
          <View style={[styles.ecommerceIcon, { backgroundColor: colors.warningSoft }]}><ShoppingBag color={colors.warning} size={20} /></View>
          <View style={styles.ecommerceCopy}>
            <AppText variant="bodyStrong">Ecommerce Setup</AppText>
          </View>
          <AppButton
            label={ecommerceMutation.isPending ? 'Saving...' : workspace?.ecommerceEnabled ? 'Disable' : 'Enable'}
            variant={workspace?.ecommerceEnabled ? 'secondary' : 'primary'}
            loading={ecommerceMutation.isPending}
            disabled={!workspace?.id || !canManage}
            onPress={() => ecommerceMutation.mutate(!workspace?.ecommerceEnabled)}
          />
        </AppCard>

        <View style={styles.sectionHeader}>
          <AppText variant="section">Connected integrations</AppText>
          <Pressable onPress={browseCatalog} accessibilityRole="button"><AppText variant="small" tone="primary">Browse catalog</AppText></Pressable>
        </View>
        {courierConnections.length ? (
          <View style={styles.connectedList}>
            {courierConnections.map((connection) => (
              <AppCard key={connection.id} padding="sm" style={styles.connectedCard}>
                <Pressable onPress={() => openDetails(connection)} style={styles.connectedMain} accessibilityRole="button">
                  <IntegrationLogo integrationId={connection.provider} size={46} />
                  <View style={styles.ecommerceCopy}>
                    <View style={styles.connectionTitleRow}>
                      <AppText variant="bodyStrong" numberOfLines={1} style={styles.connectionName}>{connection.displayName}</AppText>
                        <View style={[styles.statusBadge, { backgroundColor: connection.status === 'CONNECTED' ? colors.successSoft : connection.status === 'ERROR' ? colors.dangerSoft : colors.warningSoft }]}>
                        {connection.status === 'CONNECTED' ? <Check color={colors.success} size={12} /> : null}
                        <Text style={[styles.statusText, { color: connection.status === 'CONNECTED' ? colors.success : connection.status === 'ERROR' ? colors.error : colors.warning }]}>{connection.status === 'CONNECTED' ? 'Connected' : connection.status}</Text>
                      </View>
                    </View>
                    <AppText variant="small" tone="secondary" numberOfLines={2}>{integrationDescription(connection.provider)}</AppText>
                  </View>
                  <ChevronRight color={colors.textMuted} size={18} />
                </Pressable>
                <View style={[styles.connectedActions, { borderTopColor: colors.cardBorder }]}>
                  <AppButton label="Disconnect" icon={Trash2} variant="destructive" loading={disconnectingId === connection.id} disabled={!canManage || (disconnectingId !== null && disconnectingId !== connection.id)} onPress={() => confirmDisconnect(connection)} style={styles.connectionAction} />
                  <AppButton label="Configure" icon={Settings2} variant="ghost" disabled={!canManage} onPress={() => openConfigure(connection)} style={styles.connectionAction} />
                </View>
              </AppCard>
            ))}
          </View>
        ) : (
          <View style={[styles.emptyState, { borderColor: colors.cardBorder, backgroundColor: colors.surfaceSecondary }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}><PackageOpen color={colors.textSecondary} size={21} /></View>
            <AppText variant="bodyStrong">No integrations connected yet</AppText>
            <AppButton icon={Search} label="Browse Catalog" onPress={browseCatalog} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function integrationDescription(provider: string) {
  if (provider.toUpperCase() === 'PATHAO') return 'Book parcels and track delivery across Bangladesh.';
  if (provider.toUpperCase() === 'STEADFAST') return 'Book parcels, print labels and track delivery.';
  return `${provider} courier account`;
}

function StatCard({ label, value, icon: Icon, color, soft }: { label: string; value: string; icon: LucideIcon; color: string; soft: string }) {
  return (
    <AppCard padding="md" style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: soft }]}><Icon color={color} size={16} /></View>
      <View style={styles.statCopy}>
        <AppText variant="tiny" tone="secondary">{label.toUpperCase()}</AppText>
        <Text style={[styles.statValue, { color }]}>{value}</Text>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxxl },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  statCard: { alignItems: 'center', flexBasis: '48%', flexDirection: 'row', gap: spacing.sm },
  statIcon: { alignItems: 'center', borderRadius: radius.md, height: 34, justifyContent: 'center', width: 34 },
  statCopy: { flex: 1, minWidth: 0 },
  statValue: { fontSize: fontSize.heading, fontWeight: fontWeight.extrabold, marginTop: 2 },
  ecommerceCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  ecommerceIcon: { alignItems: 'center', borderRadius: radius.md, height: 44, justifyContent: 'center', width: 44 },
  ecommerceCopy: { flex: 1, minWidth: 0 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  connectedList: { gap: spacing.sm },
  connectedCard: { gap: spacing.sm },
  connectedMain: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 56 },
  connectionTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  connectionName: { flexShrink: 1 },
  statusBadge: { alignItems: 'center', borderRadius: radius.pill, flexDirection: 'row', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold },
  connectedActions: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.sm },
  connectionAction: { height: 34 },
  emptyState: { alignItems: 'center', borderRadius: radius.xl, borderStyle: 'dashed', borderWidth: 1, gap: spacing.sm, justifyContent: 'center', minHeight: 210, padding: spacing.xl },
  emptyIcon: { alignItems: 'center', borderRadius: radius.pill, height: 44, justifyContent: 'center', width: 44 },
  emptyDescription: { lineHeight: 18, maxWidth: 300, textAlign: 'center' },
});
