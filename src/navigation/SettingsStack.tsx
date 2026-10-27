import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { WorkspaceSettingsScreen } from '../screens/WorkspaceSettingsScreen';
import { MembersSettingsScreen, MemberDetailsScreen } from '../screens/MembersSettingsScreen';
import { BillingSettingsScreen } from '../screens/BillingSettingsScreen';
import { BillingPlanDetailsScreen } from '../screens/BillingPlanDetailsScreen';
import { BillingCheckoutScreen } from '../screens/BillingCheckoutScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { QuickRepliesSettingsScreen } from '../screens/QuickRepliesSettingsScreen';
import { AssignmentPolicySettingsScreen } from '../screens/AssignmentPolicySettingsScreen';
import { InboxAppearanceSettingsScreen } from '../screens/InboxAppearanceSettingsScreen';
import { TagsSettingsScreen } from '../screens/TagsSettingsScreen';
import { BroadcastSettingsScreen } from '../screens/BroadcastSettingsScreen';
import { BroadcastCampaignScreen } from '../screens/BroadcastCampaignScreen';
import { BroadcastCreateScreen } from '../screens/BroadcastCreateScreen';
import { PrivacyPolicyScreen } from '../screens/PrivacyPolicyScreen';
import { ProductsScreen } from '../screens/ProductsScreen';
import { ProductFormScreen } from '../screens/ProductFormScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { IntegrationCatalogScreen } from '../screens/IntegrationCatalogScreen';
import { IntegrationsScreen } from '../screens/IntegrationsScreen';
import { AiAgentsScreen } from '../screens/AiAgentsScreen';
import { AiAgentFormScreen } from '../screens/AiAgentFormScreen';
import type { AiAgentType } from '../api/ai-agents';
import { CourierConnectionDetailsScreen } from '../screens/CourierConnectionDetailsScreen';
import { CreateOrderScreen } from '../screens/CreateOrderScreen';
import type { CreateOrderRouteParams } from './CreateOrderRouteParams';
import type { BillingInterval } from '../api/billing';

export type SettingsStackParamList = {
  SettingsList: undefined;
  Profile: undefined;
  Workspace: undefined;
  Members: undefined;
  MemberDetails: { memberId: string; kind: 'MEMBER' | 'INVITE'; email: string; workspaceId: string };
  Notifications: undefined;
  InboxAppearance: undefined;
  QuickReplies: undefined;
  Tags: undefined;
  AssignmentPolicy: undefined;
  Broadcast: undefined;
  BroadcastCampaign: { campaignId: string };
  BroadcastCreate: { campaignId?: string } | undefined;
  Billing: {
    tab?: 'current' | 'packages' | 'invoices' | 'history';
    checkout?: 'success' | 'cancel';
    planKey?: string;
    reference?: string;
  } | undefined;
  BillingPlanDetails: {
    planKey: string;
    workspaceId: string;
    cycle: BillingInterval;
  };
  BillingCheckout: {
    checkoutUrl: string;
    planKey: string;
    workspaceId: string;
  };
  PrivacyPolicy: undefined;
  Products: undefined;
  Orders: undefined;
  CreateOrder: CreateOrderRouteParams;
  IntegrationCatalog: undefined;
  Integrations: undefined;
  AiAgents: undefined;
  AiAgentForm: { agentId?: string; templateType?: AiAgentType };
  CourierConnectionDetails: { connectionId: string };
  CourierConnectionConfigure: { connectionId: string };
  ProductForm: { productId?: string } | undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SettingsList" component={SettingsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Workspace" component={WorkspaceSettingsScreen} />
      <Stack.Screen name="Members" component={MembersSettingsScreen} />
      <Stack.Screen name="MemberDetails" component={MemberDetailsScreen} />
      <Stack.Screen name="Notifications" component={NotificationSettingsScreen} />
      <Stack.Screen name="InboxAppearance" component={InboxAppearanceSettingsScreen} />
      <Stack.Screen name="QuickReplies" component={QuickRepliesSettingsScreen} />
      <Stack.Screen name="Tags" component={TagsSettingsScreen} />
      <Stack.Screen name="AssignmentPolicy" component={AssignmentPolicySettingsScreen} />
      <Stack.Screen name="Broadcast" component={BroadcastSettingsScreen} />
      <Stack.Screen name="BroadcastCampaign" component={BroadcastCampaignScreen} />
      <Stack.Screen name="BroadcastCreate" component={BroadcastCreateScreen} />
      <Stack.Screen name="Billing" component={BillingSettingsScreen} />
      <Stack.Screen name="BillingPlanDetails" component={BillingPlanDetailsScreen} />
      <Stack.Screen name="BillingCheckout" component={BillingCheckoutScreen} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      <Stack.Screen name="Products" component={ProductsScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="CreateOrder" component={CreateOrderScreen} />
      <Stack.Screen name="IntegrationCatalog" component={IntegrationCatalogScreen} />
      <Stack.Screen name="Integrations" component={IntegrationsScreen} />
      <Stack.Screen name="AiAgents" component={AiAgentsScreen} />
      <Stack.Screen name="AiAgentForm" component={AiAgentFormScreen} />
      <Stack.Screen name="CourierConnectionDetails" component={CourierConnectionDetailsScreen} />
      <Stack.Screen name="CourierConnectionConfigure" component={CourierConnectionDetailsScreen} />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} />
    </Stack.Navigator>
  );
}
