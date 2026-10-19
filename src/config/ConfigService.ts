import { UBX } from '@/protocols/ubx/ids';
import { logDiagnostic } from '@/state/diagnostics';
import { ConfigWriteRequest, type ConfigAction } from '@/sources/usb/UbxClient';

import { createBackup, storeBackup, type ConfigBackup } from './backups';
import { KEY, keyName } from './keys';
import type { ReceiverLink } from './link';
import {
  buildFactoryResetFrame,
  buildResetFrame,
  buildValGetPayload,
  buildValSetFrames,
  LAYER,
  LAYER_MASK,
  MAX_ITEMS,
  parseValGetResponse,
  type CfgItem,
  type Layer,
  type RestartKind,
} from './valCodec';

export class ConfigTimeoutError extends Error {}

export type LayerValues = Map<number, number>;

export interface LoadedConfig {
  ram: LayerValues;
  bbr: LayerValues;
  flash: LayerValues;
  def: LayerValues;
  /** The receiver answered for the Flash layer (it has flash memory). */
  hasFlash: boolean;
}

export interface Mismatch {
  key: number;
  expected: number;
  actual: number | undefined;
}

export type ApplyStatus =
  | 'applied'
  /** The receiver NAKed the change; nothing was applied. */
  | 'rejected'
  /** Applied, but read-back values differ. */
  | 'mismatch'
  /** No acknowledgement and the read-back does not match. */
  | 'timeout'
  /** The receiver did not accept the new baud rate; the old rate still works. */
  | 'baud-failed'
  /** No contact at the new or the old baud rate. */
  | 'lost';

export interface ApplyResult {
  status: ApplyStatus;
  mismatches: Mismatch[];
}

/** How long to wait for the receiver after switching baud rate (functional spec §11.5). */
const BAUD_CHECK_MS = 3000;

/**
 * Reads and writes u-blox configuration (technical spec §13.4, REQ-CFG). Every write goes
 * through the configuration channel as a ConfigWriteRequest, is logged, and is preceded once per
 * session by an automatic backup.
 */
export class ConfigService {
  private backedUp = false;

  constructor(
    private readonly link: ReceiverLink,
    private readonly receiver: ConfigBackup['receiver'] = {},
  ) {}

  get port() {
    return this.link.port;
  }

  /** The phone side's baud rate (UART bridges), for the throughput check. */
  get localBaud() {
    return this.link.localBaud;
  }

  /**
   * Reads `keys` from a layer. Requests are chunked; a chunk the receiver NAKs (an unknown key)
   * is bisected so known keys are still read. Keys absent from the result are not available in
   * that layer. Throws ConfigTimeoutError when the receiver does not answer.
   */
  async read(keys: readonly number[], layer: Layer): Promise<LayerValues> {
    const values: LayerValues = new Map();
    const readChunk = async (chunk: readonly number[]): Promise<void> => {
      if (chunk.length === 0) return;
      const response = await this.link.client.valget(buildValGetPayload(layer, chunk));
      if (response === 'timeout') throw new ConfigTimeoutError('The receiver did not answer');
      if (response === 'nak') {
        if (chunk.length === 1) return;
        const half = Math.ceil(chunk.length / 2);
        await readChunk(chunk.slice(0, half));
        await readChunk(chunk.slice(half));
        return;
      }
      for (const it of parseValGetResponse(response)?.items ?? []) values.set(it.key, it.value);
    };
    for (let i = 0; i < keys.length; i += MAX_ITEMS) await readChunk(keys.slice(i, i + MAX_ITEMS));
    return values;
  }

  /** Current (RAM), stored (BBR, Flash) and default values (REQ-CFG-02). */
  async load(keys: readonly number[]): Promise<LoadedConfig> {
    const ram = await this.read(keys, LAYER.RAM);
    const available = [...ram.keys()];
    const optional = async (layer: Layer) => {
      try {
        return await this.read(available, layer);
      } catch {
        return new Map<number, number>();
      }
    };
    const bbr = await optional(LAYER.BBR);
    const flash = await optional(LAYER.FLASH);
    const def = await optional(LAYER.DEFAULT);
    return { ram, bbr, flash, def, hasFlash: flash.size > 0 };
  }

  /**
   * Applies changes to RAM as one transaction and verifies them (REQ-CFG-03/04). A change of
   * the connected UART's baud rate follows the safe baud-change flow (REQ-CFG-09).
   */
  async apply(changes: readonly CfgItem[]): Promise<ApplyResult> {
    await this.backupOnce(changes.map((c) => c.key));
    const baud = changes.find((c) => c.key === KEY.UART1_BAUDRATE);
    const baudChange =
      baud !== undefined &&
      this.link.port === 'UART1' &&
      this.link.localBaud !== undefined &&
      baud.value !== this.link.localBaud
        ? { from: this.link.localBaud, to: baud.value }
        : undefined;

    const request = new ConfigWriteRequest(
      'apply',
      buildValSetFrames(LAYER_MASK.RAM, changes),
      describe('apply', changes),
    );
    if (baudChange) return this.applyWithBaudChange(request, changes, baudChange);

    const result = await this.write(request);
    if (result.outcomes.includes('nak')) return { status: 'rejected', mismatches: [] };
    const mismatches = await this.verify(changes, LAYER.RAM);
    if (mismatches.length === 0) return { status: 'applied', mismatches };
    return { status: result.ok ? 'mismatch' : 'timeout', mismatches };
  }

  /** Makes the current values of `keys` permanent (BBR + Flash when present) (REQ-CFG-05). */
  async save(keys: readonly number[], hasFlash: boolean): Promise<ApplyResult> {
    const ram = await this.read(keys, LAYER.RAM);
    const items = [...ram].map(([key, value]) => ({ key, value }));
    const layers = LAYER_MASK.BBR | (hasFlash ? LAYER_MASK.FLASH : 0);
    const result = await this.write(
      new ConfigWriteRequest('save', buildValSetFrames(layers, items), describe('save', items)),
    );
    if (result.outcomes.includes('nak')) return { status: 'rejected', mismatches: [] };
    const mismatches = await this.verify(items, hasFlash ? LAYER.FLASH : LAYER.BBR);
    return { status: mismatches.length === 0 ? 'applied' : 'mismatch', mismatches };
  }

  /** Writes the stored values back to RAM, undoing unsaved changes (REQ-CFG-06b). */
  async revert(saved: readonly CfgItem[]): Promise<ApplyResult> {
    return this.apply(saved);
  }

  /** Hot/warm/cold start, GNSS only, so the serial link stays up (REQ-CFG-14). */
  async restart(kind: RestartKind): Promise<void> {
    await this.write(new ConfigWriteRequest('restart', [buildResetFrame(kind)], `${kind} start`));
    this.link.restartSession();
  }

  /**
   * Factory reset (REQ-CFG-06c): clear stored configuration, load defaults, restart the
   * receiver, then detect it again (its baud rate may have changed).
   */
  async factoryReset(keysForBackup: readonly number[]): Promise<boolean> {
    await this.backupOnce(keysForBackup);
    const result = await this.write(
      new ConfigWriteRequest(
        'factory-reset',
        [buildFactoryResetFrame()],
        'clear BBR/Flash and load defaults',
      ),
    );
    if (!result.ok) return false;
    await this.write(
      new ConfigWriteRequest(
        'factory-reset',
        [buildResetFrame('cold', 'software')],
        'software reset',
      ),
    );
    await this.link.redetect();
    return true;
  }

  private async applyWithBaudChange(
    request: ConfigWriteRequest,
    changes: readonly CfgItem[],
    baud: { from: number; to: number },
  ): Promise<ApplyResult> {
    // The receiver switches immediately, so its ACK may be lost: only a NAK (still at the old
    // rate) means "rejected".
    const result = await this.write(request, 500);
    if (result.outcomes.includes('nak')) return { status: 'rejected', mismatches: [] };

    await this.link.setLocalBaud(baud.to);
    if (await this.ping()) {
      this.link.confirmBaud(baud.to);
      const mismatches = await this.verify(changes, LAYER.RAM);
      return { status: mismatches.length === 0 ? 'applied' : 'mismatch', mismatches };
    }
    await this.link.setLocalBaud(baud.from);
    if (await this.ping()) {
      logDiagnostic({
        level: 'warning',
        area: 'config',
        message: `Receiver did not accept ${baud.to} Bd; still at ${baud.from}`,
      });
      return { status: 'baud-failed', mismatches: [] };
    }
    logDiagnostic({
      level: 'error',
      area: 'config',
      message: `Lost contact after changing baud ${baud.from} → ${baud.to}`,
    });
    return { status: 'lost', mismatches: [] };
  }

  /** True when the receiver answers a MON-VER poll within BAUD_CHECK_MS. */
  private async ping(): Promise<boolean> {
    const client = this.link.client;
    const reply = client.waitForFrame(
      (f) => f.cls === UBX.MON_VER[0] && f.id === UBX.MON_VER[1],
      BAUD_CHECK_MS,
    );
    void client.poll(UBX.MON_VER);
    return (await reply) !== undefined;
  }

  private async verify(items: readonly CfgItem[], layer: Layer): Promise<Mismatch[]> {
    const actual = await this.read(
      items.map((i) => i.key),
      layer,
    ).catch(() => new Map<number, number>());
    return items
      .filter((i) => actual.get(i.key) !== i.value)
      .map((i) => ({ key: i.key, expected: i.value, actual: actual.get(i.key) }));
  }

  private async write(request: ConfigWriteRequest, ackTimeoutMs?: number) {
    const result = await this.link.client.configure(request, ackTimeoutMs);
    logDiagnostic({
      level: result.ok ? 'info' : 'warning',
      area: 'config',
      message: `${request.action}: ${result.ok ? 'ok' : result.outcomes.join(', ')}`,
      details: request.description,
    });
    return result;
  }

  /** Automatic backup of the current values before the first write of a session (FS §11.6). */
  private async backupOnce(keys: readonly number[]): Promise<void> {
    if (this.backedUp || keys.length === 0) return;
    const ram = await this.read(keys, LAYER.RAM).catch(() => new Map<number, number>());
    storeBackup(
      createBackup(
        'auto',
        this.receiver,
        [...ram].map(([key, value]) => ({ key, value })),
      ),
    );
    this.backedUp = true;
  }
}

function describe(action: ConfigAction, items: readonly CfgItem[]): string {
  return `${action}: ${items.map((i) => `${keyName(i.key)}=${i.value}`).join(', ')}`;
}
