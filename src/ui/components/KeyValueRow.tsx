import { StyleSheet, View } from 'react-native';

import { spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

/** Shown for values a source cannot provide (REQ-SAT-05). */
export const NOT_AVAILABLE = '—';

export interface KeyValueRowProps {
  label: string;
  /** `undefined`/`null`/empty string render as "—". A real 0 is displayed as 0. */
  value?: string | number | null;
  /** Optional unit appended to the value, e.g. "dB-Hz". */
  unit?: string;
  mono?: boolean;
}

export function formatValue(value: KeyValueRowProps['value'], unit?: string): string {
  if (value === undefined || value === null || value === '') return NOT_AVAILABLE;
  return unit ? `${value} ${unit}` : String(value);
}

export function KeyValueRow({ label, value, unit, mono }: KeyValueRowProps) {
  const text = formatValue(value, unit);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${text}`}>
      <AppText variant="label" muted style={styles.label}>
        {label}
      </AppText>
      <AppText variant={mono ? 'mono' : 'body'} style={styles.value} selectable>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
    minHeight: 28,
  },
  label: {
    flexBasis: '40%',
    flexShrink: 0,
  },
  value: {
    flex: 1,
    textAlign: 'right',
  },
});
