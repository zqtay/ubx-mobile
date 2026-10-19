import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  filterConsole,
  useConsole,
  type ConsoleKind,
  type StoredConsoleEntry,
} from '@/state/consoleStore';
import { AppText, Banner, Chip } from '@/ui/components';
import { consoleTime, decodeUbx, hexDump } from '@/ui/console/decode';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

const KINDS: ConsoleKind[] = ['nmea', 'ubx', 'rtcm', 'error', 'info'];
/** Distance from the end that still counts as "at the bottom" (auto-scroll stays on). */
const BOTTOM_SLOP = 40;

/** Live message stream (REQ-LOG-01, functional spec §8). */
export default function ConsoleScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const entries = useConsole((s) => s.entries);
  const names = useConsole((s) => s.names);
  const paused = useConsole((s) => s.paused);
  const missed = useConsole((s) => s.missed);
  const setPaused = useConsole((s) => s.setPaused);
  const clear = useConsole((s) => s.clear);

  const [showFilter, setShowFilter] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [kinds, setKinds] = useState<ReadonlySet<ConsoleKind>>(() => new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<number | undefined>();
  const [atBottom, setAtBottom] = useState(true);
  // Last entry the user has seen at the bottom; newer ones while scrolled up show the pill.
  const [seenId, setSeenId] = useState<number | undefined>();
  const list = useRef<FlashListRef<StoredConsoleEntry>>(null);

  const visible = useMemo(
    () => filterConsole(entries, kinds, selected),
    [entries, kinds, selected],
  );
  const lastId = visible.at(-1)?.id;

  // Follow new messages while at the bottom.
  useEffect(() => {
    if (lastId !== undefined && atBottom) list.current?.scrollToEnd({ animated: false });
  }, [lastId, atBottom]);
  const unseen = !atBottom && lastId !== undefined && lastId !== seenId;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const bottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - BOTTOM_SLOP;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom || atBottom) setSeenId(lastId);
  };
  const toggle = <T,>(set: ReadonlySet<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.actions}>
              <HeaderButton
                icon={paused ? 'play' : 'pause'}
                label={paused ? t('console.resume') : t('console.pause')}
                onPress={() => setPaused(!paused)}
              />
              <HeaderButton icon="delete-outline" label={t('console.clear')} onPress={clear} />
              <HeaderButton
                icon={showFilter ? 'filter' : 'filter-outline'}
                label={t('console.filter')}
                selected={showFilter || kinds.size > 0 || selected.size > 0}
                onPress={() => setShowFilter(!showFilter)}
              />
              <HeaderButton
                icon="wrap"
                label={t('console.wrap')}
                selected={wrap}
                onPress={() => setWrap(!wrap)}
              />
            </View>
          ),
        }}
      />

      {showFilter ? (
        <View testID="console-filter" style={[styles.filter, { borderBottomColor: colors.border }]}>
          <View style={styles.chips}>
            {KINDS.map((k) => (
              <Chip
                key={k}
                label={t(`console.kind.${k}`)}
                selected={kinds.has(k)}
                onPress={() => setKinds(toggle(kinds, k))}
              />
            ))}
          </View>
          {names.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chips}>
                <Chip
                  label={t('console.all')}
                  selected={selected.size === 0}
                  onPress={() => setSelected(new Set())}
                />
                {names.map((n) => (
                  <Chip
                    key={n}
                    label={n}
                    selected={selected.has(n)}
                    onPress={() => setSelected(toggle(selected, n))}
                  />
                ))}
              </View>
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {paused ? (
        <View style={styles.banner}>
          <Banner
            tone="info"
            message={t('console.paused', { count: missed })}
            actionLabel={t('console.resume')}
            onAction={() => setPaused(false)}
          />
        </View>
      ) : null}

      <FlashList
        ref={list}
        testID="console-list"
        data={visible}
        keyExtractor={(e) => String(e.id)}
        extraData={{ wrap, expanded }}
        onScroll={onScroll}
        scrollEventThrottle={100}
        renderItem={({ item }) => (
          <ConsoleRow
            entry={item}
            wrap={wrap}
            expanded={expanded === item.id}
            onPress={
              item.ubx ? () => setExpanded(expanded === item.id ? undefined : item.id) : undefined
            }
          />
        )}
        ListEmptyComponent={
          <AppText muted style={styles.empty}>
            {entries.length === 0 ? t('console.empty') : t('console.noMatch')}
          </AppText>
        }
      />

      {unseen ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSeenId(lastId);
            setAtBottom(true);
            list.current?.scrollToEnd({ animated: true });
          }}
          style={[styles.pill, { backgroundColor: colors.primary }]}>
          <AppText variant="label" color={colors.onPrimary}>
            {t('console.newMessages')}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function ConsoleRow({
  entry,
  wrap,
  expanded,
  onPress,
}: {
  entry: StoredConsoleEntry;
  wrap: boolean;
  expanded: boolean;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const color =
    entry.kind === 'error'
      ? colors.danger
      : entry.kind === 'info'
        ? colors.textMuted
        : entry.kind === 'ubx'
          ? colors.primary
          : colors.text;
  const text = entry.kind === 'error' ? `✗ ${entry.text}` : entry.text;
  const detail = useMemo(() => {
    if (!expanded || !entry.ubx) return undefined;
    const { cls, id, payload } = entry.ubx;
    return { decoded: decodeUbx(cls, id, payload), hex: hexDump(payload), size: payload.length };
  }, [expanded, entry.ubx]);

  return (
    <Pressable
      testID={`console-row-${entry.id}`}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { expanded } : undefined}
      onPress={onPress}
      style={styles.row}>
      <View style={styles.line}>
        <AppText variant="caption" muted style={styles.time}>
          {consoleTime(entry.atMs)}
        </AppText>
        <AppText
          variant="mono"
          color={color}
          numberOfLines={wrap ? undefined : 1}
          style={styles.text}>
          {text}
        </AppText>
      </View>
      {detail ? (
        <View style={[styles.detail, { backgroundColor: colors.surfaceAlt }]}>
          <AppText variant="label">{t('console.decoded')}</AppText>
          <AppText variant="mono" style={styles.small}>
            {detail.decoded ?? t('console.noDecoder')}
          </AppText>
          <AppText variant="label">{t('console.payload', { count: detail.size })}</AppText>
          <AppText variant="mono" style={styles.small}>
            {detail.hex}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

function HeaderButton({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: 'play' | 'pause' | 'delete-outline' | 'filter' | 'filter-outline' | 'wrap';
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      onPress={onPress}
      hitSlop={4}
      style={styles.headerButton}>
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={selected ? colors.primary : colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
  },
  headerButton: {
    width: minTouchTarget - 8,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filter: {
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  banner: {
    padding: spacing.sm,
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  line: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  time: {
    paddingTop: 2,
    fontVariant: ['tabular-nums'],
  },
  text: {
    flex: 1,
  },
  detail: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  small: {
    fontSize: 12,
    lineHeight: 16,
  },
  empty: {
    padding: spacing.xl,
    textAlign: 'center',
  },
  pill: {
    position: 'absolute',
    bottom: spacing.lg,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
});
