import type { GnssSnapshot } from '@/domain/types';

/** Why the configuration screens can or cannot be used (functional spec §11.1, REQ-CFG-01). */
export type ConfigAvailability = 'ok' | 'notUsb' | 'notConnected' | 'notUblox' | 'protocolTooOld';

/** Configuration uses CFG-VALGET/VALSET, available from protocol version 27 (u-blox 9 and later). */
export const MIN_PROTOCOL_VERSION = 27;

export function configAvailability(
  snapshot: Pick<GnssSnapshot, 'source' | 'connection' | 'device'>,
): ConfigAvailability {
  if (snapshot.source !== 'usb') return 'notUsb';
  const kind = snapshot.connection.kind;
  if (kind !== 'receiving' && kind !== 'waiting') return 'notConnected';
  const receiver = snapshot.device.receiver;
  if (receiver.vendor !== 'u-blox') return 'notUblox';
  const version = parseFloat(receiver.protocolVersion ?? '');
  if (!(version >= MIN_PROTOCOL_VERSION)) return 'protocolTooOld';
  return 'ok';
}
