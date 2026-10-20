/**
 * Betaflight / INAV flight controller GPS passthrough (REQ-SER-15..18, technical spec §16):
 * read-only MSP identification and the CLI `gpspassthrough` handshake. Transport-independent:
 * the USB source provides a `FcLink`.
 */

/** Native USB virtual COM ports of flight controllers (vendor:product). */
export const FLIGHT_CONTROLLER_USB_IDS: readonly { vendorId: number; productId: number }[] = [
  { vendorId: 0x0483, productId: 0x5740 }, // STM32 VCP (F4/F7/H7)
  { vendorId: 0x2e3c, productId: 0x5740 }, // AT32 VCP
];

export function isFlightControllerUsb(d: { vendorId: number; productId: number }): boolean {
  return FLIGHT_CONTROLLER_USB_IDS.some(
    (id) => id.vendorId === d.vendorId && id.productId === d.productId,
  );
}

/** MSP v1 commands used (all read-only). */
export const MSP = { API_VERSION: 1, FC_VARIANT: 2, FC_VERSION: 3 } as const;

const VARIANT_NAMES: Record<string, string> = {
  BTFL: 'Betaflight',
  INAV: 'INAV',
  EMUF: 'EmuFlight',
  RTFL: 'Rotorflight',
};

export interface FlightControllerInfo {
  /** MSP variant code, e.g. `BTFL`. */
  variant: string;
  /** Display name, e.g. `Betaflight`. */
  name: string;
  /** From MSP_FC_VERSION as reported (calendar versions may not fit major.minor.patch). */
  version?: string;
  apiVersion?: string;
  /** The CLI `version` line, e.g. `Betaflight / STM32F7X2 (S7X2) 4.5.1 …`. */
  versionLine?: string;
}

/** MSP v1 request without payload: `$M<`, size 0, command, checksum (size XOR command). */
export function mspRequest(command: number): Uint8Array {
  return Uint8Array.of(0x24, 0x4d, 0x3c, 0, command, command);
}

export interface MspReply {
  command: number;
  payload: Uint8Array;
  /** `$M!`: the flight controller does not support the command. */
  error: boolean;
}

/** All complete, valid MSP v1 replies in a byte buffer. */
export function parseMspReplies(bytes: Uint8Array): MspReply[] {
  const replies: MspReply[] = [];
  for (let i = 0; i + 6 <= bytes.length; i++) {
    if (bytes[i] !== 0x24 || bytes[i + 1] !== 0x4d) continue;
    const dir = bytes[i + 2];
    if (dir !== 0x3e && dir !== 0x21) continue; // '>' reply, '!' error
    const size = bytes[i + 3];
    const command = bytes[i + 4];
    const end = i + 5 + size;
    if (end >= bytes.length) break;
    let sum = size ^ command;
    for (let j = i + 5; j < end; j++) sum ^= bytes[j];
    if (sum !== bytes[end]) continue;
    replies.push({ command, payload: bytes.slice(i + 5, end), error: dir === 0x21 });
    i = end;
  }
  return replies;
}

/** What the handshake needs from the serial port. */
export interface FcLink {
  write(bytes: Uint8Array): Promise<void>;
  /** Raw bytes received since the last `clear()`. */
  received(): Uint8Array;
  clear(): void;
  sleep(ms: number): Promise<void>;
}

const POLL_MS = 20;

async function waitFor(link: FcLink, done: () => boolean, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (done()) return true;
    await link.sleep(POLL_MS);
  }
  return done();
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** Identifies a flight controller with read-only MSP requests; undefined if nothing answers. */
export async function identifyFlightController(
  link: FcLink,
  timeoutMs = 500,
): Promise<FlightControllerInfo | undefined> {
  link.clear();
  for (const cmd of [MSP.API_VERSION, MSP.FC_VARIANT, MSP.FC_VERSION])
    await link.write(mspRequest(cmd));
  const replies = () => parseMspReplies(link.received());
  await waitFor(
    link,
    () => {
      const r = replies();
      return (
        r.some((x) => x.command === MSP.FC_VARIANT) && r.some((x) => x.command === MSP.FC_VERSION)
      );
    },
    timeoutMs,
  );
  const all = replies().filter((r) => !r.error);
  const variantReply = all.find((r) => r.command === MSP.FC_VARIANT);
  if (!variantReply || variantReply.payload.length < 4) return undefined;
  const variant = text(variantReply.payload.subarray(0, 4));
  if (!/^[A-Z0-9]{4}$/.test(variant)) return undefined;
  const version = all.find((r) => r.command === MSP.FC_VERSION)?.payload;
  const api = all.find((r) => r.command === MSP.API_VERSION)?.payload;
  return {
    variant,
    name: VARIANT_NAMES[variant] ?? variant,
    version:
      version && version.length >= 3 ? `${version[0]}.${version[1]}.${version[2]}` : undefined,
    apiVersion: api && api.length >= 3 ? `${api[1]}.${api[2]}` : undefined,
  };
}

/** Whether a variant is known to support the Betaflight/INAV CLI `gpspassthrough`. */
export function supportsPassthrough(info: FlightControllerInfo): boolean {
  return info.variant in VARIANT_NAMES;
}

export type PassthroughResult =
  | { ok: true; versionLine?: string; transcript: string[] }
  | { ok: false; reason: 'no-cli' | 'refused'; message: string; transcript: string[] };

/** Errors the CLI prints: `###ERROR…###`, "Invalid command", "Unknown command", "…failed". */
const CLI_ERROR = /error|unknown|invalid|fail/i;

/** How often `#` is sent before giving up, and how long each attempt waits for the CLI. */
const CLI_ATTEMPTS = 3;
const CLI_WAIT_MS = 800;

/** Text received from the CLI, without bridged GNSS data (which starts with `$` or UBX sync). */
function cliText(bytes: Uint8Array): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x24 || bytes[i] === 0xb5) {
      end = i;
      break;
    }
  }
  return text(bytes.subarray(0, end));
}

/** Bytes as readable text for the diagnostics log: ⏎ for line ends, \xHH for other bytes. */
export function printable(bytes: Uint8Array, max = 300): string {
  let out = '';
  for (const b of bytes.subarray(0, max)) {
    if (b === 0x0a) out += '⏎';
    else if (b === 0x0d) continue;
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return bytes.length > max ? `${out}…` : out;
}

/**
 * Enters the CLI with `#` (retried, in case the first byte is lost), reads `version`, then sends
 * `gpspassthrough`. Sends nothing else: no `exit` (reboots), `save` or `set` (REQ-SER-16).
 * The transcript of what was sent and received goes to the diagnostics log.
 */
export async function enablePassthrough(
  link: FcLink,
  info: FlightControllerInfo,
): Promise<PassthroughResult> {
  const transcript: string[] = [];
  const exchange = async (out: string, done: () => boolean, waitMs: number) => {
    link.clear();
    await link.write(ascii(out));
    const ok = await waitFor(link, done, waitMs);
    transcript.push(
      `> ${out.replace(/\r\n$/, '')}`,
      `< ${printable(link.received()) || '(nothing)'}`,
    );
    return ok;
  };

  let inCli = false;
  for (let attempt = 0; attempt < CLI_ATTEMPTS && !inCli; attempt++) {
    inCli = await exchange('#', () => /CLI|(^|\n)# ?$/.test(text(link.received())), CLI_WAIT_MS);
  }
  if (!inCli) {
    const got = transcript.filter((l) => l.startsWith('<') && l !== '< (nothing)').at(-1);
    return {
      ok: false,
      reason: 'no-cli',
      message: got
        ? `The flight controller did not open its CLI (it answered: ${got.slice(2, 82)}).`
        : 'The flight controller did not open its CLI (no answer to "#").',
      transcript,
    };
  }

  // The version line is for the Device screen only; its absence is not an error.
  await link.sleep(100);
  const name = new RegExp(`${info.name}|${info.variant}`, 'i');
  const versionLines = () =>
    text(link.received())
      .split(/\r?\n/)
      .map((l) => l.replace(/^#\s*/, '').trim())
      .filter((l) => name.test(l) && l.toLowerCase() !== 'version');
  await exchange('version\r\n', () => versionLines().length > 0, 1000);
  const versionLine = versionLines()[0];

  await exchange('gpspassthrough\r\n', () => false, 700);
  const reply = cliText(link.received())
    .split(/\r?\n/)
    .map((l) => l.replace(/^#\s*/, '').trim())
    .filter((l) => l && !/^gpspassthrough$/i.test(l));
  const error = reply.find((l) => CLI_ERROR.test(l));
  if (error) {
    return {
      ok: false,
      reason: 'refused',
      message: error.replace(/^#+|#+$/g, '').trim(),
      transcript,
    };
  }
  return { ok: true, versionLine, transcript };
}
