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
import { borderWidth, controlSize, fontSize, fontWeight, letterSpacing, radius, spacing } from '../theme/tokens';

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
  hint: { fontSize: fontSize.small, marginBottom: spacing.xs + spacing.xxs },
  search: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: borderWidth.thin,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm + spacing.xxs,
  },
  searchInput: { flex: 1, height: controlSize.icon, marginLeft: spacing.sm },
  selectedRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  selectedCount: { fontSize: fontSize.small },
  clear: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  group: { borderRadius: radius.md, borderWidth: borderWidth.thin, marginBottom: spacing.xs + spacing.xxs, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
  main: { alignItems: 'center', borderRadius: radius.md, flex: 1, flexDirection: 'row', gap: spacing.sm, minWidth: 0, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  groupName: { flexShrink: 1, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  countBadge: { borderRadius: radius.pill, minWidth: 20, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
  countBadgeText: { fontSize: fontSize.small, fontWeight: fontWeight.bold, textAlign: 'center' },
  check: { alignItems: 'center', borderRadius: radius.pill, borderWidth: borderWidth.thin, height: 18, justifyContent: 'center', width: 18 },
  chevron: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  body: { borderTopWidth: borderWidth.thin, gap: spacing.xs + spacing.xxs, padding: spacing.xs + spacing.xxs },
  bodyHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xxs },
  bodyLabel: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold, letterSpacing: letterSpacing.overline, textTransform: 'uppercase' },
  selectAll: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  childRow: { alignItems: 'center', borderRadius: radius.md, borderWidth: borderWidth.thin, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + spacing.xxs },
  childName: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  childMeta: { fontSize: fontSize.small, marginTop: spacing.xxs },
  empty: { fontSize: fontSize.caption, paddingVertical: spacing.md },
});
