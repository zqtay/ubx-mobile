import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  filterConsole,
  useConsole,
  type ConsoleKind,
  type StoredConsoleEntry,
} from '@/state/consoleStore';
import { AppText, Chip } from '@/ui/components';
import { ConsoleDetail } from '@/ui/console/ConsoleDetail';
import { consoleTime } from '@/ui/console/decode';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

const KINDS: ConsoleKind[] = ['nmea', 'ubx', 'rtcm', 'error', 'info'];
/** Distance from the end that still counts as "at the bottom" (auto-scroll stays on). */
const BOTTOM_SLOP = 40;
/** Default share of the message list; the divider can be dragged between the limits. */
const DEFAULT_LIST_SHARE = 0.55;
const MIN_SHARE = 0.2;
const MAX_SHARE = 0.8;
const DIVIDER = 20;
/** Control buttons show their labels only when the row is at least this wide (one line). */
const LABELS_MIN_WIDTH = 340;

/**
 * Live message stream (REQ-LOG-01, functional spec §8): message list and a control & detail
 * panel, stacked in portrait and side by side in landscape.
 */
export default function ConsoleScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  // Edge-to-edge: keep both panes clear of the system navigation bar and cut-outs.
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [share, setShare] = useState(DEFAULT_LIST_SHARE);
  const dragStart = useRef<{ share: number; at: number } | null>(null);
  const [controlsWidth, setControlsWidth] = useState(0);
  const showLabels = controlsWidth >= LABELS_MIN_WIDTH;
  const entries = useConsole((s) => s.entries);
  const names = useConsole((s) => s.names);
  const paused = useConsole((s) => s.paused);
  const missed = useConsole((s) => s.missed);
  const setPaused = useConsole((s) => s.setPaused);
  const clear = useConsole((s) => s.clear);

  const [showFilter, setShowFilter] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [kinds, setKinds] = useState<ReadonlySet<ConsoleKind>>(() => new Set());
  const [selectedNames, setSelectedNames] = useState<ReadonlySet<string>>(() => new Set());
  // The entry itself is kept, so its detail stays visible after it leaves the ring buffer.
  const [selected, setSelected] = useState<StoredConsoleEntry | undefined>();
  const [atBottom, setAtBottom] = useState(true);
  // Last entry the user has seen at the bottom; newer ones while scrolled up show the pill.
  const [seenId, setSeenId] = useState<number | undefined>();
  const list = useRef<FlashListRef<StoredConsoleEntry>>(null);

  const visible = useMemo(
    () => filterConsole(entries, kinds, selectedNames),
    [entries, kinds, selectedNames],
  );
  const lastId = visible.at(-1)?.id;

  // Follow new messages while at the bottom and nothing is selected: a selected message stays
  // where it is (functional spec §8).
  const following = atBottom && !selected;
  useEffect(() => {
    if (lastId !== undefined && following) list.current?.scrollToEnd({ animated: false });
  }, [lastId, following]);
  const unseen = !following && lastId !== undefined && lastId !== seenId;

  /** Selects a message (stops following); tapping it again clears the selection. */
  const select = (entry: StoredConsoleEntry) => {
    if (selected?.id === entry.id) {
      setSelected(undefined);
      return;
    }
    setSelected(entry);
    setSeenId(lastId);
  };
  /** "New messages" pill: clear the selection and follow again. */
  const follow = () => {
    setSelected(undefined);
    setSeenId(lastId);
    setAtBottom(true);
    list.current?.scrollToEnd({ animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const bottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - BOTTOM_SLOP;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (!selected && (bottom || atBottom)) setSeenId(lastId);
  };
  const toggle = <T,>(set: ReadonlySet<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const onClear = () => {
    clear();
    setSelected(undefined);
  };

  const total = (landscape ? size.width : size.height) - DIVIDER;
  const listSize = total > 0 ? Math.round(total * share) : undefined;
  const pointer = (e: GestureResponderEvent) =>
    landscape ? e.nativeEvent.pageX : e.nativeEvent.pageY;
  const onDividerMove = (e: GestureResponderEvent) => {
    const start = dragStart.current;
    if (!start || total <= 0) return;
    const next = start.share + (pointer(e) - start.at) / total;
    setShare(Math.min(MAX_SHARE, Math.max(MIN_SHARE, next)));
  };

  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor: colors.bg,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      testID={landscape ? 'console-landscape' : 'console-portrait'}>
      {/* The two panes share this measured box; the list gets `share` of it. */}
      <View
        testID="console-split"
        style={[styles.fill, landscape && styles.row]}
        onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout)}>
        <View
          testID="console-list-pane"
          style={
            listSize === undefined
              ? styles.fill
              : landscape
                ? { width: listSize }
                : { height: listSize }
          }>
          <FlashList
            ref={list}
            testID="console-list"
            data={visible}
            keyExtractor={(e) => String(e.id)}
            extraData={{ wrap, selectedId: selected?.id }}
            onScroll={onScroll}
            scrollEventThrottle={100}
            renderItem={({ item }) => (
              <ConsoleRow
                entry={item}
                wrap={wrap}
                selected={selected?.id === item.id}
                onSelect={select}
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
              onPress={follow}
              style={[styles.pill, { backgroundColor: colors.primary }]}>
              <AppText variant="label" color={colors.onPrimary}>
                {t('console.newMessages')}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <View
          testID="console-divider"
          accessibilityRole="adjustable"
          accessibilityLabel={t('console.divider')}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            setShare((v) =>
              Math.min(
                MAX_SHARE,
                Math.max(MIN_SHARE, v + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)),
              ),
            )
          }
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => {
            dragStart.current = { share, at: pointer(e) };
          }}
          onResponderMove={onDividerMove}
          onResponderRelease={() => {
            dragStart.current = null;
          }}
          style={[
            landscape ? styles.dividerV : styles.dividerH,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}>
          <View
            style={[landscape ? styles.gripV : styles.gripH, { backgroundColor: colors.textMuted }]}
          />
        </View>

        <ScrollView
          testID="console-panel"
          style={[styles.fill, { backgroundColor: colors.surface }]}
          contentContainerStyle={styles.panel}>
          <View
            testID="console-controls"
            style={styles.controls}
            onLayout={(e) => setControlsWidth(e.nativeEvent.layout.width)}>
            <ControlButton
              icon={paused ? 'play' : 'pause'}
              label={paused ? t('console.resume') : t('console.pause')}
              showLabel={showLabels}
              onPress={() => setPaused(!paused)}
            />
            <ControlButton
              icon="delete-outline"
              label={t('console.clear')}
              showLabel={showLabels}
              onPress={onClear}
            />
            <ControlButton
              icon={showFilter ? 'filter' : 'filter-outline'}
              label={t('console.filter')}
              showLabel={showLabels}
              selected={showFilter || kinds.size > 0 || selectedNames.size > 0}
              onPress={() => setShowFilter(!showFilter)}
            />
            <ControlButton
              icon="wrap"
              label={t('console.wrapShort')}
              accessibilityLabel={t('console.wrap')}
              showLabel={showLabels}
              selected={wrap}
              onPress={() => setWrap(!wrap)}
            />
          </View>
          {paused ? (
            <AppText variant="label" color={colors.info}>
              {t('console.paused', { count: missed })}
            </AppText>
          ) : null}

          {showFilter ? (
            <View testID="console-filter" style={styles.filter}>
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
                <View style={styles.chips}>
                  <Chip
                    label={t('console.all')}
                    selected={selectedNames.size === 0}
                    onPress={() => setSelectedNames(new Set())}
                  />
                  {names.map((n) => (
                    <Chip
                      key={n}
                      label={n}
                      selected={selectedNames.has(n)}
                      onPress={() => setSelectedNames(toggle(selectedNames, n))}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ConsoleDetail entry={selected} />
        </ScrollView>
      </View>
    </View>
  );
}

const ConsoleRow = memo(function ConsoleRow({
  entry,
  wrap,
  selected,
  onSelect,
}: {
  entry: StoredConsoleEntry;
  wrap: boolean;
  selected: boolean;
  onSelect: (entry: StoredConsoleEntry) => void;
}) {
  const { colors } = useAppTheme();
  const color =
    entry.kind === 'error'
      ? colors.danger
      : entry.kind === 'info'
        ? colors.textMuted
        : entry.kind === 'ubx'
          ? colors.primary
          : colors.text;
  return (
    <Pressable
      testID={`console-row-${entry.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onSelect(entry)}
      style={[
        styles.rowLine,
        {
          borderLeftColor: selected ? colors.primary : 'transparent',
          backgroundColor: selected ? colors.surfaceAlt : 'transparent',
        },
      ]}>
      <AppText variant="caption" muted style={styles.time}>
        {consoleTime(entry.atMs)}
      </AppText>
      <AppText
        variant="mono"
        color={color}
        numberOfLines={wrap ? undefined : 1}
        style={styles.text}>
        {entry.kind === 'error' ? `✗ ${entry.text}` : entry.text}
      </AppText>
    </Pressable>
  );
});

function ControlButton({
  icon,
  label,
  accessibilityLabel,
  showLabel,
  onPress,
  selected,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  accessibilityLabel?: string;
  /** Icon only when false (narrow panel); the label stays for screen readers. */
  showLabel: boolean;
  onPress: () => void;
  selected?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      onPress={onPress}
      // Compact button, full-size touch target (REQ-NFR-02).
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.control,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.infoBg : colors.surface,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      <MaterialCommunityIcons
        name={icon}
        size={18}
        color={selected ? colors.primary : colors.text}
      />
      {showLabel ? (
        <AppText variant="caption" numberOfLines={1}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
  },
  panel: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  control: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: minTouchTarget - 12,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filter: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  dividerH: {
    height: DIVIDER,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dividerV: {
    width: DIVIDER,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  gripH: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  gripV: {
    width: 4,
    height: 40,
    borderRadius: 2,
  },
  rowLine: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md - 3,
    paddingVertical: 2,
    borderLeftWidth: 3,
  },
  time: {
    paddingTop: 2,
    fontVariant: ['tabular-nums'],
  },
  text: {
    flex: 1,
  },
  empty: {
    padding: spacing.xl,
    textAlign: 'center',
  },
  pill: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
});
