import { keyDef, type CfgType } from './keys';

/**
 * Configuration group names by group ID (bits 16–23 of a key ID), from the u-blox interface
 * descriptions (technical spec §13.1). Groups not listed are shown by number.
 */
const GROUP_NAMES: Record<number, string> = {
  0x03: 'CFG-TMODE',
  0x05: 'CFG-TP',
  0x11: 'CFG-NAVSPG',
  0x14: 'CFG-NAVHPG',
  0x17: 'CFG-NAV2',
  0x18: 'CFG-NAVMASK',
  0x21: 'CFG-RATE',
  0x22: 'CFG-ODO',
  0x23: 'CFG-ANA',
  0x24: 'CFG-GEOFENCE',
  0x25: 'CFG-MOT',
  0x26: 'CFG-BATCH',
  0x31: 'CFG-SIGNAL',
  0x34: 'CFG-BDS',
  0x35: 'CFG-GAL',
  0x36: 'CFG-SBAS',
  0x37: 'CFG-QZSS',
  0x41: 'CFG-ITFM',
  0x51: 'CFG-I2C',
  0x52: 'CFG-UART1',
  0x53: 'CFG-UART2',
  0x64: 'CFG-SPI',
  0x65: 'CFG-USB',
  0x71: 'CFG-I2CINPROT',
  0x72: 'CFG-I2COUTPROT',
  0x73: 'CFG-UART1INPROT',
  0x74: 'CFG-UART1OUTPROT',
  0x75: 'CFG-UART2INPROT',
  0x76: 'CFG-UART2OUTPROT',
  0x77: 'CFG-USBINPROT',
  0x78: 'CFG-USBOUTPROT',
  0x79: 'CFG-SPIINPROT',
  0x7a: 'CFG-SPIOUTPROT',
  0x91: 'CFG-MSGOUT',
  0x92: 'CFG-INFMSG',
  0x93: 'CFG-NMEA',
  0xa2: 'CFG-TXREADY',
  0xa3: 'CFG-HW',
  0xc7: 'CFG-RINV',
  0xd0: 'CFG-PM',
  0xde: 'CFG-LOGFILTER',
  0xf6: 'CFG-SEC',
};

export function groupIdOf(key: number): number {
  return (key >>> 16) & 0xff;
}

export function groupName(groupId: number): string {
  return GROUP_NAMES[groupId] ?? `Group 0x${groupId.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Type of a key: from the key database, else derived from the size bits (unsigned/bits). */
export function keyType(key: number): CfgType {
  const known = keyDef(key)?.type;
  if (known) return known;
  switch ((key >>> 28) & 0x07) {
    case 1:
      return 'L';
    case 2:
      return 'U1';
    case 3:
      return 'U2';
    case 4:
      return 'U4';
    default:
      return 'U8';
  }
}

/** Allowed range of a value of this type; undefined for floating point. */
export function valueRange(type: CfgType): { min: number; max: number } | undefined {
  switch (type) {
    case 'L':
      return { min: 0, max: 1 };
    case 'U1':
    case 'E1':
    case 'X1':
      return { min: 0, max: 0xff };
    case 'U2':
    case 'E2':
    case 'X2':
      return { min: 0, max: 0xffff };
    case 'U4':
    case 'E4':
    case 'X4':
      return { min: 0, max: 0xffffffff };
    case 'I1':
      return { min: -128, max: 127 };
    case 'I2':
      return { min: -32768, max: 32767 };
    case 'I4':
      return { min: -2147483648, max: 2147483647 };
    case 'U8':
    case 'X8':
      return { min: 0, max: Number.MAX_SAFE_INTEGER };
    case 'I8':
      return { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER };
    default:
      return undefined;
  }
}

/** Display of a raw value: hex for bitfields (X types), the enum label when known. */
export function formatRawValue(key: number, value: number | undefined): string {
  if (value === undefined) return '—';
  const type = keyType(key);
  if (type.startsWith('X')) return `0x${value.toString(16).toUpperCase()}`;
  const label = keyDef(key)?.enumValues?.[value];
  return label ? `${value} (${label})` : String(value);
}

/**
 * Parses an edited value (decimal, or hex with 0x). Returns undefined when it is not a number
 * in the type's range.
 */
export function parseRawValue(key: number, text: string): number | undefined {
  const t = text.trim();
  const type = keyType(key);
  const value = /^0x[0-9a-f]+$/i.test(t)
    ? parseInt(t, 16)
    : /^-?\d+(\.\d+)?$/.test(t)
      ? Number(t)
      : NaN;
  if (!Number.isFinite(value)) return undefined;
  const range = valueRange(type);
  if (!range) return value;
  if (!Number.isInteger(value) || value < range.min || value > range.max) return undefined;
  return value;
}
