/**
 * Simulated u-blox configuration database (CFG-VALGET/VALSET/VALDEL/CFG/RST) for the fake USB
 * receiver, seeded with a real module's RAM layer from its u-center dump.
 */
import { KEY } from '@/config/keys';
import { buildValSetFrames, LAYER, LAYER_MASK, parseValGetResponse } from '@/config/valCodec';
import { buildUbx } from '@/protocols/ubx/builder';
import { UBX } from '@/protocols/ubx/ids';

import { BE122_DUMP } from '../fixtures/m10Dumps';

/** RAM values from the CFG-VALGET pages of a dump. */
export function dumpRamValues(dump: string): Map<number, number> {
  const values = new Map<number, number>();
  for (const line of dump.split('\n')) {
    const m = /^CFG-VALGET - (.*)$/.exec(line.trim());
    if (!m) continue;
    const bytes = Uint8Array.from(m[1].trim().split(/\s+/), (h) => parseInt(h, 16));
    // cls id lenLo lenHi, then the payload.
    for (const it of parseValGetResponse(bytes.subarray(4))?.items ?? []) values.set(it.key, it.value);
  }
  return values;
}

export interface SimConfigOptions {
  /** RAM values at power-up (default: the BE-122 dump). Also used as the Default layer. */
  ram?: Map<number, number>;
  /** Default layer (default: same as `ram`). */
  defaults?: Map<number, number>;
  hasFlash?: boolean;
  /**
   * What the receiver does when UART1's baud rate is changed in RAM: switch to it (no ACK
   * reaches the phone, as on real hardware), ignore it (ACK, stays at the old rate), or go
   * silent.
   */
  baudChange?: 'switch' | 'ignore' | 'vanish';
  /** Keys whose CFG-VALSET is answered with a NAK. */
  rejectKeys?: number[];
  /** Keys that keep their value although VALSET was acknowledged (read-back mismatch). */
  stickyKeys?: number[];
}

type Values = Map<number, number>;

const ack = (cls: number, id: number) => buildUbx(UBX.ACK_ACK[0], UBX.ACK_ACK[1], Uint8Array.of(cls, id));
const nak = (cls: number, id: number) => buildUbx(UBX.ACK_NAK[0], UBX.ACK_NAK[1], Uint8Array.of(cls, id));

export class ConfigSim {
  ram: Values;
  bbr: Values = new Map();
  flash: Values = new Map();
  readonly def: Values;
  /** CFG-RST requests received (navBbrMask, resetMode). */
  resets: { navBbrMask: number; mode: number }[] = [];
  private transaction?: { layers: number; items: { key: number; value: number }[] };

  constructor(
    private readonly options: SimConfigOptions,
    /** Called when the receiver's UART baud rate changes (undefined = silent). */
    private readonly onBaud: (baud: number | undefined) => void,
  ) {
    const ram = options.ram ?? dumpRamValues(BE122_DUMP);
    this.ram = new Map(ram);
    this.def = new Map(options.defaults ?? ram);
  }

  /** Replies to a CFG message, or undefined when `id` is not a configuration message. */
  handle(id: number, payload: Uint8Array): Uint8Array[] | undefined {
    const cls = 0x06;
    switch (id) {
      case UBX.CFG_VALGET[1]:
        return this.valget(payload);
      case UBX.CFG_VALSET[1]:
        return this.valset(payload);
      case UBX.CFG_VALDEL[1]: {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const layers = payload[1];
        for (let o = 4; o + 4 <= payload.length; o += 4) {
          const key = view.getUint32(o, true);
          if (layers & LAYER_MASK.BBR) this.bbr.delete(key);
          if (layers & LAYER_MASK.FLASH) this.flash.delete(key);
        }
        return [ack(cls, id)];
      }
      case UBX.CFG_CFG[1]: {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        if (view.getUint32(0, true) !== 0) {
          this.bbr.clear();
          this.flash.clear();
        }
        if (view.getUint32(8, true) !== 0) this.ram = this.stored();
        return [ack(cls, id)];
      }
      case UBX.CFG_RST[1]: {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const mode = payload[2];
        this.resets.push({ navBbrMask: view.getUint16(0, true), mode });
        if (mode === 0x01 || mode === 0x00) {
          // Software/hardware reset: the configuration is rebuilt from stored layers.
          this.ram = this.stored();
          this.onBaud(this.ram.get(KEY.UART1_BAUDRATE));
        }
        return [];
      }
      default:
        return undefined;
    }
  }

  /** Default ← Flash ← BBR, as loaded at start-up. */
  private stored(): Values {
    return new Map([...this.def, ...this.flash, ...this.bbr]);
  }

  private valget(payload: Uint8Array): Uint8Array[] {
    const layer = payload[1];
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const source =
      layer === LAYER.RAM
        ? this.ram
        : layer === LAYER.BBR
          ? this.bbr
          : layer === LAYER.FLASH
            ? this.options.hasFlash
              ? this.flash
              : undefined
            : this.def;
    if (!source) return [nak(0x06, UBX.CFG_VALGET[1])];
    const items: { key: number; value: number }[] = [];
    for (let o = 4; o + 4 <= payload.length; o += 4) {
      const key = view.getUint32(o, true);
      // Unknown keys are refused; keys not stored in BBR/Flash are left out.
      if (!this.def.has(key)) return [nak(0x06, UBX.CFG_VALGET[1])];
      const value = source.get(key);
      if (value !== undefined) items.push({ key, value });
    }
    return [buildUbx(UBX.CFG_VALGET[0], UBX.CFG_VALGET[1], valgetResponse(layer, items))];
  }

  private valset(payload: Uint8Array): Uint8Array[] {
    const [version, layers, transaction] = payload;
    const parsed = parseValGetResponse(payload);
    const id = UBX.CFG_VALSET[1];
    if (!parsed || parsed.items.some((it) => !this.def.has(it.key))) {
      this.transaction = undefined;
      return [nak(0x06, id)];
    }
    if (parsed.items.some((it) => this.options.rejectKeys?.includes(it.key))) {
      this.transaction = undefined;
      return [nak(0x06, id)];
    }
    if (version === 1 && transaction !== 0) {
      if (transaction === 1) this.transaction = { layers, items: [] };
      if (!this.transaction) return [nak(0x06, id)];
      this.transaction.items.push(...parsed.items);
      if (transaction !== 3) return [ack(0x06, id)];
      const items = this.transaction.items;
      this.transaction = undefined;
      return this.commit(layers, items);
    }
    return this.commit(layers, parsed.items);
  }

  private commit(layers: number, items: { key: number; value: number }[]): Uint8Array[] {
    const oldBaud = this.ram.get(KEY.UART1_BAUDRATE);
    for (const it of items) {
      if (this.options.stickyKeys?.includes(it.key)) continue;
      if (layers & LAYER_MASK.RAM) this.ram.set(it.key, it.value);
      if (layers & LAYER_MASK.BBR) this.bbr.set(it.key, it.value);
      if (layers & LAYER_MASK.FLASH && this.options.hasFlash) this.flash.set(it.key, it.value);
    }
    const newBaud = this.ram.get(KEY.UART1_BAUDRATE);
    if (newBaud !== oldBaud) {
      const behaviour = this.options.baudChange ?? 'switch';
      if (behaviour === 'ignore') {
        this.ram.set(KEY.UART1_BAUDRATE, oldBaud!);
        return [ack(0x06, UBX.CFG_VALSET[1])];
      }
      this.onBaud(behaviour === 'vanish' ? undefined : newBaud);
      // The receiver switches before its ACK leaves the UART: the phone never sees it.
      return [];
    }
    return [ack(0x06, UBX.CFG_VALSET[1])];
  }
}

/** CFG-VALGET response payload: version 1, layer, position 0, key/value pairs (≤ 64). */
function valgetResponse(layer: number, items: { key: number; value: number }[]): Uint8Array {
  // A VALSET frame has the same item layout: take its payload (strip sync, class/id, length and
  // checksum) and patch the header.
  const frame = buildValSetFrames(0, items)[0];
  const payload = frame.slice(6, frame.length - 2);
  payload[0] = 1;
  payload[1] = layer;
  return payload;
}
