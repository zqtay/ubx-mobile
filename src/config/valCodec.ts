import { buildUbx, PayloadWriter } from '@/protocols/ubx/builder';
import { UBX } from '@/protocols/ubx/ids';

import { keyDef, type CfgType } from './keys';

/**
 * CFG-VALGET / VALSET / VALDEL encoding (technical spec §13.2). A key ID carries the value
 * size in bits 28–30, so any key — even one the app does not know — can be read and written.
 */

export const LAYER = { RAM: 0, BBR: 1, FLASH: 2, DEFAULT: 7 } as const;
export type Layer = (typeof LAYER)[keyof typeof LAYER];

/** VALSET / VALDEL layer bit mask. */
export const LAYER_MASK = { RAM: 0x01, BBR: 0x02, FLASH: 0x04 } as const;

/** At most 64 key/value pairs per message. */
export const MAX_ITEMS = 64;

/** CFG-VALGET key requesting every item of every group (answered in pages of 64). */
export const ALL_KEYS = 0x0fffffff;

export interface CfgItem {
  key: number;
  value: number;
}

/** Value size in bytes from the key ID (1-bit values occupy one byte). */
export function valueSize(key: number): number {
  switch ((key >>> 28) & 0x07) {
    case 1:
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 4;
    case 5:
      return 8;
    default:
      throw new Error(`Invalid key size bits in 0x${key.toString(16)}`);
  }
}

const SIGNED = new Set<CfgType>(['I1', 'I2', 'I4', 'I8']);

function typeOf(key: number): CfgType | undefined {
  return keyDef(key)?.type;
}

export function encodeValue(key: number, value: number, view: DataView, offset: number): void {
  const size = valueSize(key);
  const type = typeOf(key);
  if (type === 'R4') view.setFloat32(offset, value, true);
  else if (type === 'R8') view.setFloat64(offset, value, true);
  else if (size === 1) view.setUint8(offset, value & 0xff);
  else if (size === 2) view.setUint16(offset, value & 0xffff, true);
  else if (size === 4) view.setUint32(offset, value >>> 0, true);
  else view.setBigUint64(offset, BigInt.asUintN(64, BigInt(Math.trunc(value))), true);
}

export function decodeValue(key: number, view: DataView, offset: number): number {
  const size = valueSize(key);
  const type = typeOf(key);
  const signed = type !== undefined && SIGNED.has(type);
  if (type === 'R4') return view.getFloat32(offset, true);
  if (type === 'R8') return view.getFloat64(offset, true);
  if (size === 1) return signed ? view.getInt8(offset) : view.getUint8(offset);
  if (size === 2) return signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
  if (size === 4) return signed ? view.getInt32(offset, true) : view.getUint32(offset, true);
  return Number(signed ? view.getBigInt64(offset, true) : view.getBigUint64(offset, true));
}

/** CFG-VALGET poll payload: version 0, layer, position, keys. */
export function buildValGetPayload(
  layer: Layer,
  keys: readonly number[],
  position = 0,
): Uint8Array {
  if (keys.length > MAX_ITEMS) throw new Error('Too many keys for one CFG-VALGET');
  const w = new PayloadWriter(4 + 4 * keys.length).u1(0, 0).u1(1, layer).u2(2, position);
  keys.forEach((k, i) => w.u4(4 + 4 * i, k));
  return w.build();
}

export interface ValGetResponse {
  layer: number;
  position: number;
  items: CfgItem[];
}

export function parseValGetResponse(payload: Uint8Array): ValGetResponse | undefined {
  if (payload.length < 4) return undefined;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const items: CfgItem[] = [];
  let o = 4;
  while (o + 4 <= payload.length) {
    const key = view.getUint32(o, true);
    o += 4;
    let size: number;
    try {
      size = valueSize(key);
    } catch {
      return undefined;
    }
    if (o + size > payload.length) return undefined;
    items.push({ key, value: decodeValue(key, view, o) });
    o += size;
  }
  return { layer: payload[1], position: view.getUint16(2, true), items };
}

function itemsPayload(header: [number, number, number], items: readonly CfgItem[]): Uint8Array {
  const size = items.reduce((n, it) => n + 4 + valueSize(it.key), 0);
  const bytes = new Uint8Array(4 + size);
  const view = new DataView(bytes.buffer);
  bytes[0] = header[0];
  bytes[1] = header[1];
  bytes[2] = header[2];
  let o = 4;
  for (const it of items) {
    view.setUint32(o, it.key >>> 0, true);
    encodeValue(it.key, it.value, view, o + 4);
    o += 4 + valueSize(it.key);
  }
  return bytes;
}

/**
 * CFG-VALSET frames. Up to 64 items fit one message (version 0, no transaction). Larger sets use
 * a transaction (version 1: begin, continue…, apply) so the receiver applies all or nothing.
 */
export function buildValSetFrames(layers: number, items: readonly CfgItem[]): Uint8Array[] {
  const chunks: CfgItem[][] = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS) chunks.push(items.slice(i, i + MAX_ITEMS));
  if (chunks.length <= 1) {
    return [
      buildUbx(UBX.CFG_VALSET[0], UBX.CFG_VALSET[1], itemsPayload([0, layers, 0], chunks[0] ?? [])),
    ];
  }
  return chunks.map((chunk, i) => {
    const transaction = i === 0 ? 1 : i === chunks.length - 1 ? 3 : 2;
    return buildUbx(
      UBX.CFG_VALSET[0],
      UBX.CFG_VALSET[1],
      itemsPayload([1, layers, transaction], chunk),
    );
  });
}

/** CFG-VALDEL frame: removes keys from BBR and/or Flash (layers mask without RAM). */
export function buildValDelFrame(layers: number, keys: readonly number[]): Uint8Array {
  const w = new PayloadWriter(4 + 4 * keys.length).u1(0, 0).u1(1, layers);
  keys.forEach((k, i) => w.u4(4 + 4 * i, k));
  return buildUbx(UBX.CFG_VALDEL[0], UBX.CFG_VALDEL[1], w.build());
}

export type RestartKind = 'hot' | 'warm' | 'cold';

const NAV_BBR_MASK: Record<RestartKind, number> = { hot: 0x0000, warm: 0x0001, cold: 0xffff };

/** CFG-RST: GNSS-only controlled software reset (the serial link stays up) or a full software reset. */
export function buildResetFrame(kind: RestartKind, mode: 'gnss' | 'software' = 'gnss'): Uint8Array {
  const w = new PayloadWriter(4).u2(0, NAV_BBR_MASK[kind]).u1(2, mode === 'gnss' ? 0x02 : 0x01);
  return buildUbx(UBX.CFG_RST[0], UBX.CFG_RST[1], w.build());
}

/**
 * CFG-CFG clearing all saved configuration and loading defaults (factory reset). Device mask:
 * BBR, Flash, EEPROM, SPI flash.
 */
export function buildFactoryResetFrame(): Uint8Array {
  const w = new PayloadWriter(13).u4(0, 0xffffffff).u4(4, 0).u4(8, 0xffffffff).u1(12, 0x17);
  return buildUbx(UBX.CFG_CFG[0], UBX.CFG_CFG[1], w.build());
}
