import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useGnssStore } from '@/state/gnssStore';
import { chipState } from '@/ui/fixLabel';

import { openReceiverSheet } from './DataGate';
import { StatusChip, type ChipSource } from './StatusChip';

const CHIP_SOURCE = { android: 'phone', usb: 'usb', replay: 'replay' } as const satisfies Record<
  string,
  ChipSource
>;

/** Header chip bound to the live source state (REQ-SRC-03). Opens the receiver sheet. */
export function HeaderStatusChip() {
  const { t } = useTranslation();
  const snapshot = useGnssStore(
    useShallow((s) => ({ source: s.source, connection: s.connection, fix: s.fix })),
  );
  const state = chipState(snapshot);

  let label: string;
  if (!snapshot.source) {
    label = t('source.none');
  } else {
    const stateText =
      state.key === 'fix'
        ? t(`fix.${state.fixKey!}`)
        : t(`source.state.${state.key as Exclude<typeof state.key, 'fix' | 'none'>}`);
    label = t('source.chipLabel', {
      source: t(`source.kind.${snapshot.source}`),
      state: stateText,
    });
  }

  return (
    <StatusChip
      source={snapshot.source ? CHIP_SOURCE[snapshot.source] : 'none'}
      tone={state.tone}
      label={label}
      onPress={openReceiverSheet}
    />
  );
}
