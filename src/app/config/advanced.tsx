import { FlashList } from '@shopify/flash-list';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { formatRawValue, groupIdOf, groupName, keyType, parseRawValue } from '@/config/groups';
import { keyDef, keyName } from '@/config/keys';
import { useConfigStore } from '@/sources';
import { storedValue, unsavedKeys } from '@/state/configStore';
import { AppText, Banner, Button, Chip } from '@/ui/components';
import { ConfigLoadState, StagedBar, useConfigAvailability } from '@/ui/config/ConfigParts';
import { unavailableMessage } from '@/ui/config/labels';
import { useBottomInset } from '@/ui/hooks/useBottomInset';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { radius, spacing } from '@/ui/theme/tokens';

type Item = { kind: 'group'; id: number; name: string } | { kind: 'key'; key: number };

/** Every configuration key the receiver reports, with values per layer (REQ-CFG-17). */
export default function AdvancedConfigScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const availability = useConfigAvailability();
  const status = useConfigStore((s) => s.status);
  const ram = useConfigStore((s) => s.ram);
  const bbr = useConfigStore((s) => s.bbr);
  const flash = useConfigStore((s) => s.flash);
  const def = useConfigStore((s) => s.def);
  const staged = useConfigStore((s) => s.staged);
  const busy = useConfigStore((s) => s.busy);
  const bottom = useBottomInset(staged.size > 0 || !!busy);
  const allLoaded = useConfigStore((s) => s.allLoaded);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | undefined>();

  // Read every key once (the overview loads only the keys of its sections).
  useEffect(() => {
    if (availability === 'ok' && !allLoaded && !busy && status !== 'error') {
      void useConfigStore.getState().loadAll();
    }
  }, [availability, allLoaded, busy, status]);

  const unsaved = useMemo(
    () => new Set(unsavedKeys({ ram, bbr, flash, def })),
    [ram, bbr, flash, def],
  );
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keys = [...ram.keys()]
      .filter(
        (k) =>
          !q ||
          keyName(k).toLowerCase().includes(q) ||
          `0x${k.toString(16)}`.includes(q.replace(/^0x0*/, '0x')) ||
          groupName(groupIdOf(k)).toLowerCase().includes(q),
      )
      .sort((a, b) => groupIdOf(a) - groupIdOf(b) || (a & 0xffff) - (b & 0xffff));
    const out: Item[] = [];
    let group: number | undefined;
    for (const key of keys) {
      if (groupIdOf(key) !== group) {
        group = groupIdOf(key);
        out.push({ kind: 'group', id: group, name: groupName(group) });
      }
      out.push({ kind: 'key', key });
    }
    return out;
  }, [ram, search]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={styles.top}>
        {availability !== 'ok' ? (
          <Banner tone="info" message={unavailableMessage(t, availability)} />
        ) : null}
        {status !== 'ready' ? <ConfigLoadState /> : null}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('config.advanced.search')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('config.advanced.search')}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.search,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        <AppText variant="caption" muted>
          {t('config.advanced.count', { count: items.filter((i) => i.kind === 'key').length })}
        </AppText>
      </View>
      <FlashList
        testID="advanced-list"
        contentContainerStyle={{ paddingBottom: bottom }}
        data={items}
        keyExtractor={(i) => (i.kind === 'group' ? `g${i.id}` : `k${i.key}`)}
        getItemType={(i) => i.kind}
        extraData={{ staged, expanded, unsaved }}
        renderItem={({ item }) =>
          item.kind === 'group' ? (
            <AppText
              variant="label"
              accessibilityRole="header"
              style={[styles.group, { backgroundColor: colors.surfaceAlt }]}>
              {item.name}
            </AppText>
          ) : (
            <KeyRow
              keyId={item.key}
              current={ram.get(item.key)}
              stagedValue={staged.get(item.key)}
              unsaved={unsaved.has(item.key)}
              expanded={expanded === item.key}
              onToggle={() => setExpanded(expanded === item.key ? undefined : item.key)}
              layers={{
                RAM: ram.get(item.key),
                BBR: bbr.get(item.key),
                Flash: flash.get(item.key),
                Default: def.get(item.key),
              }}
              saved={storedValue({ bbr, flash, def }, item.key)}
            />
          )
        }
      />
      <StagedBar />
    </View>
  );
}

function KeyRow({
  keyId,
  current,
  stagedValue,
  unsaved,
  expanded,
  onToggle,
  layers,
  saved,
}: {
  keyId: number;
  current: number | undefined;
  stagedValue: number | undefined;
  unsaved: boolean;
  expanded: boolean;
  onToggle: () => void;
  layers: Record<'RAM' | 'BBR' | 'Flash' | 'Default', number | undefined>;
  saved: number | undefined;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const def = keyDef(keyId);
  const type = keyType(keyId);
  const name = keyName(keyId);
  const id = `0x${keyId.toString(16).toUpperCase().padStart(8, '0')}`;
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const stage = (value: number) => useConfigStore.getState().stage(keyId, value);
  const value = stagedValue ?? current;

  return (
    <View
      testID={`key-${id}`}
      style={[
        styles.row,
        {
          borderBottomColor: colors.border,
          borderLeftColor: stagedValue !== undefined ? colors.primary : 'transparent',
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${name}: ${formatRawValue(keyId, value)}`}
        onPress={onToggle}
        style={styles.summary}>
        <View style={styles.flex}>
          <AppText variant="mono" numberOfLines={1} style={styles.small}>
            {def ? name : id}
          </AppText>
          <AppText variant="caption" muted>
            {def ? `${id} · ${type}` : type}
            {unsaved ? ` · ${t('config.unsavedBadge')}` : ''}
          </AppText>
        </View>
        <AppText variant="mono" color={stagedValue !== undefined ? colors.primary : colors.text}>
          {stagedValue !== undefined
            ? `${formatRawValue(keyId, current)} → ${formatRawValue(keyId, stagedValue)}`
            : formatRawValue(keyId, current)}
        </AppText>
      </Pressable>

      {expanded ? (
        <View style={[styles.detail, { backgroundColor: colors.surfaceAlt }]}>
          <View style={styles.layers}>
            {(Object.keys(layers) as (keyof typeof layers)[]).map((layer) => (
              <View key={layer} style={styles.layer}>
                <AppText variant="caption" muted>
                  {layer}
                </AppText>
                <AppText variant="mono" style={styles.small}>
                  {formatRawValue(keyId, layers[layer])}
                </AppText>
              </View>
            ))}
          </View>
          {def?.unit ? (
            <AppText variant="caption" muted>
              {t('config.advanced.unit', { unit: def.unit })}
            </AppText>
          ) : null}
          {!def ? <Banner tone="warning" message={t('config.advanced.unknownKey')} /> : null}

          {type === 'L' ? (
            <View style={styles.inline}>
              <AppText variant="label" style={styles.flex}>
                {t('config.advanced.enabled')}
              </AppText>
              <Switch
                accessibilityLabel={name}
                value={!!value}
                onValueChange={(on) => stage(on ? 1 : 0)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          ) : def?.enumValues ? (
            <View style={styles.chips}>
              {Object.entries(def.enumValues).map(([v, label]) => (
                <Chip
                  key={v}
                  label={label}
                  selected={Number(v) === value}
                  onPress={() => stage(Number(v))}
                />
              ))}
            </View>
          ) : (
            <View style={styles.inline}>
              <TextInput
                value={text}
                onChangeText={(s) => {
                  setText(s);
                  setInvalid(false);
                }}
                placeholder={formatRawValue(keyId, value)}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('config.advanced.newValue', { name })}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: colors.text, borderColor: invalid ? colors.danger : colors.border },
                ]}
              />
              <Button
                label={t('config.advanced.stage')}
                onPress={() => {
                  const parsed = parseRawValue(keyId, text);
                  if (parsed === undefined) setInvalid(true);
                  else {
                    stage(parsed);
                    setText('');
                  }
                }}
              />
            </View>
          )}
          {invalid ? (
            <AppText variant="caption" color={colors.danger}>
              {t('config.advanced.invalid', { type })}
            </AppText>
          ) : null}
          {saved !== undefined && current !== saved ? (
            <Button
              variant="secondary"
              label={t('config.advanced.useSaved', { value: formatRawValue(keyId, saved) })}
              onPress={() => stage(saved)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  top: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  group: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  flex: {
    flex: 1,
  },
  small: {
    fontSize: 13,
  },
  detail: {
    gap: spacing.sm,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
  },
  layers: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  layer: {
    flex: 1,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
});
