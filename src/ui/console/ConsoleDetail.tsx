import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { StoredConsoleEntry } from '@/state/consoleStore';
import { AppText } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

import {
  consoleDateTime,
  decodeUbx,
  hexDump,
  nmeaParts,
  nmeaTime,
  ubxClassId,
  ubxItow,
} from './decode';

/** Detail of the selected Console message (functional spec §8). */
export function ConsoleDetail({ entry }: { entry: StoredConsoleEntry | undefined }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const detail = useMemo(() => {
    if (!entry) return undefined;
    if (entry.ubx) {
      const { cls, id, payload } = entry.ubx;
      return {
        kind: 'ubx' as const,
        classId: ubxClassId(cls, id),
        decoded: decodeUbx(cls, id, payload),
        messageTime: ubxItow(cls, payload),
        hex: hexDump(payload),
        size: payload.length,
      };
    }
    if (entry.kind === 'nmea') {
      const parts = nmeaParts(entry.text);
      return { kind: 'nmea' as const, parts, messageTime: parts ? nmeaTime(parts) : undefined };
    }
    return { kind: 'text' as const };
  }, [entry]);

  if (!entry || !detail) {
    return (
      <AppText muted style={styles.placeholder}>
        {t('console.selectHint')}
      </AppText>
    );
  }

  return (
    <View style={styles.container} testID="console-detail">
      <AppText variant="heading" color={entry.kind === 'error' ? colors.danger : colors.text}>
        {entry.name}
      </AppText>
      <AppText variant="caption" muted>
        {[
          t(`console.kind.${entry.kind}`),
          detail.kind === 'ubx' ? detail.classId : undefined,
          detail.kind === 'ubx' ? t('console.bytes', { count: detail.size }) : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
      </AppText>
      <View style={styles.field} testID="console-received">
        <AppText variant="caption" muted style={styles.timeLabel}>
          {t('console.received')}
        </AppText>
        <AppText variant="mono" style={[styles.small, styles.flex]} selectable>
          {consoleDateTime(entry.atMs)}
        </AppText>
      </View>
      {'messageTime' in detail && detail.messageTime ? (
        <View style={styles.field} testID="console-message-time">
          <AppText variant="caption" muted style={styles.timeLabel}>
            {t('console.messageTime')}
          </AppText>
          <AppText variant="mono" style={[styles.small, styles.flex]} selectable>
            {detail.messageTime}
          </AppText>
        </View>
      ) : null}

      {detail.kind === 'ubx' ? (
        <>
          <AppText variant="label">{t('console.decoded')}</AppText>
          <AppText variant="mono" style={styles.small} selectable>
            {detail.decoded ?? t('console.noDecoder')}
          </AppText>
          <AppText variant="label">{t('console.payload', { count: detail.size })}</AppText>
          <AppText variant="mono" style={styles.small} selectable>
            {detail.hex}
          </AppText>
        </>
      ) : detail.kind === 'nmea' ? (
        <>
          <AppText variant="mono" style={styles.small} selectable>
            {entry.text}
          </AppText>
          {detail.parts ? (
            <>
              <AppText variant="label">
                {t('console.nmeaHeader', {
                  talker: detail.parts.talker,
                  type: detail.parts.type,
                  checksum: detail.parts.checksum ?? '—',
                })}
              </AppText>
              {detail.parts.fields.map((f, i) => (
                <View key={i} style={styles.field}>
                  <AppText variant="mono" muted style={[styles.small, styles.index]}>
                    {i + 1}
                  </AppText>
                  <AppText variant="mono" style={[styles.small, styles.flex]} selectable>
                    {f === '' ? '—' : f}
                  </AppText>
                </View>
              ))}
            </>
          ) : null}
        </>
      ) : (
        <AppText variant="mono" style={styles.small} selectable>
          {entry.text}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  placeholder: {
    padding: spacing.md,
    textAlign: 'center',
  },
  small: {
    fontSize: 12,
    lineHeight: 17,
  },
  field: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  index: {
    width: 24,
    textAlign: 'right',
  },
  timeLabel: {
    width: 96,
    paddingTop: 1,
  },
  flex: {
    flex: 1,
  },
});
