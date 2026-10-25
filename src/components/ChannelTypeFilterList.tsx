import { Check, ChevronDown, ChevronUp, Minus, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChannelLogo } from './ChannelLogo';
import {
  filterChannelTypeGroups,
  toggleChannelIds,
  type ChannelTypeGroup,
} from '../lib/channel-filter-groups';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  groups: ChannelTypeGroup[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  expandedKeys: string[];
  onExpandedKeysChange: (keys: string[]) => void;
  hint?: string;
  searchable?: boolean;
  loading?: boolean;
};

export function ChannelTypeFilterList({
  groups,
  selectedIds,
  onChange,
  expandedKeys,
  onExpandedKeysChange,
  hint,
  searchable = false,
  loading = false,
}: Props) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const visibleGroups = useMemo(
    () => (searchable ? filterChannelTypeGroups(groups, search) : groups),
    [groups, search, searchable],
  );

  function toggleExpanded(typeKey: string) {
    onExpandedKeysChange(
      expandedKeys.includes(typeKey)
        ? expandedKeys.filter((key) => key !== typeKey)
        : [...expandedKeys, typeKey],
    );
  }

  return (
    <View>
      {hint ? <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text> : null}
      {searchable ? (
        <>
          <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Search color={colors.textMuted} size={16} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search"
              placeholderTextColor={colors.textMuted}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          <View style={styles.selectedRow}>
            <Text style={[styles.selectedCount, { color: colors.textSecondary }]}>{selectedIds.length} selected</Text>
            {selectedIds.length > 0 ? (
              <Pressable onPress={() => onChange([])}>
                <Text style={[styles.clear, { color: colors.primary }]}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      {loading ? <Text style={[styles.empty, { color: colors.textMuted }]}>Loading channels...</Text> : null}

      {visibleGroups.map((typeGroup) => {
        const expanded = expandedKeys.includes(typeGroup.typeKey);
        const platformChannelIds = typeGroup.channels.map((channel) => channel.channelId);
        const selectedCount = platformChannelIds.filter((id) => selectedIds.includes(id)).length;
        const allSelected = platformChannelIds.length > 0 && selectedCount === platformChannelIds.length;
        const someSelected = selectedCount > 0 && !allSelected;

        return (
          <View
            key={typeGroup.typeKey}
            style={[styles.group, { backgroundColor: colors.surfaceSecondary, borderColor: colors.cardBorder }]}
          >
            <View style={styles.header}>
              <Pressable
                style={[styles.main, expanded && { backgroundColor: `${colors.primary}14` }]}
                onPress={() => toggleExpanded(typeGroup.typeKey)}
              >
                <ChannelLogo type={typeGroup.type} box={28} glyph={14} radius={14} />
                <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={1}>{typeGroup.typeName}</Text>
                <View style={[styles.countBadge, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.countBadgeText, { color: colors.textSecondary }]}>{typeGroup.channels.length}</Text>
                </View>
              </Pressable>
              <Pressable
                style={[
                  styles.check,
                  { borderColor: colors.cardBorder },
                  (allSelected || someSelected) && { borderColor: colors.primary, backgroundColor: `${colors.primary}14` },
                ]}
                onPress={() => onChange(toggleChannelIds(selectedIds, platformChannelIds, allSelected))}
                accessibilityLabel={`Toggle all ${typeGroup.typeName} channels`}
              >
                {allSelected ? <Check color={colors.primary} size={12} /> : someSelected ? <Minus color={colors.primary} size={12} /> : null}
              </Pressable>
              <Pressable
                style={styles.chevron}
                onPress={() => toggleExpanded(typeGroup.typeKey)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${typeGroup.typeName} channels`}
                accessibilityState={{ expanded }}
              >
                {expanded ? <ChevronUp color={colors.textMuted} size={18} /> : <ChevronDown color={colors.textMuted} size={18} />}
              </Pressable>
            </View>

            {expanded ? (
              <View style={[styles.body, { borderTopColor: colors.cardBorder }]}>
                <View style={styles.bodyHeader}>
                  <Text style={[styles.bodyLabel, { color: colors.textMuted }]}>All {typeGroup.typeName} channels</Text>
                  <Pressable onPress={() => onChange(toggleChannelIds(selectedIds, platformChannelIds, allSelected))}>
                    <Text style={[styles.selectAll, { color: colors.primary }]}>{allSelected ? 'Clear all' : 'Select all'}</Text>
                  </Pressable>
                </View>
                {typeGroup.channels.map((channel) => {
                  const active = selectedIds.includes(channel.channelId);
                  return (
                    <Pressable
                      key={channel.key}
                      style={[
                        styles.childRow,
                        { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                        active && { borderColor: `${colors.primary}4D`, backgroundColor: `${colors.primary}14` },
                      ]}
                      onPress={() => onChange(toggleChannelIds(selectedIds, [channel.channelId], active))}
                    >
                      <ChannelLogo type={typeGroup.type} box={28} glyph={14} radius={14} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.childName, { color: colors.text }]} numberOfLines={1}>{channel.name}</Text>
                        {channel.displayPhoneNumber ? (
                          <Text style={[styles.childMeta, { color: colors.textMuted }]} numberOfLines={1}>{channel.displayPhoneNumber}</Text>
                        ) : null}
                      </View>
                      <View style={[styles.check, { borderColor: active ? colors.primary : colors.cardBorder, backgroundColor: active ? `${colors.primary}14` : 'transparent' }]}>
                        {active ? <Check color={colors.primary} size={12} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}

      {!loading && !visibleGroups.length ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          {search.trim() ? 'No channels match the current search.' : 'No channels available.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 11, marginBottom: 6 },
  search: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, height: 40, marginLeft: 8 },
  selectedRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  selectedCount: { fontSize: 12 },
  clear: { fontSize: 12, fontWeight: '700' },
  group: { borderRadius: 12, borderWidth: 1, marginBottom: 6, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 2, paddingHorizontal: 4, paddingVertical: 2 },
  main: { alignItems: 'center', borderRadius: 10, flex: 1, flexDirection: 'row', gap: 8, minWidth: 0, paddingHorizontal: 4, paddingVertical: 4 },
  groupName: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  countBadge: { borderRadius: 999, minWidth: 20, paddingHorizontal: 5, paddingVertical: 1 },
  countBadgeText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  check: { alignItems: 'center', borderRadius: 999, borderWidth: 1, height: 18, justifyContent: 'center', width: 18 },
  chevron: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  body: { borderTopWidth: 1, gap: 6, paddingBottom: 6, paddingHorizontal: 6, paddingTop: 6 },
  bodyHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  bodyLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  selectAll: { fontSize: 11, fontWeight: '700' },
  childRow: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  childName: { fontSize: 13, fontWeight: '700' },
  childMeta: { fontSize: 11, marginTop: 1 },
  empty: { fontSize: 13, paddingVertical: 12 },
});
