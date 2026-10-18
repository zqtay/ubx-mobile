/** UBX message classes and IDs used by the app (technical spec §6.5). */
export const UBX = {
  NAV_STATUS: [0x01, 0x03],
  NAV_DOP: [0x01, 0x04],
  NAV_PVT: [0x01, 0x07],
  NAV_TIMELS: [0x01, 0x26],
  NAV_SVINFO: [0x01, 0x30],
  NAV_SAT: [0x01, 0x35],
  NAV_SIG: [0x01, 0x43],
  INF_ERROR: [0x04, 0x00],
  INF_WARNING: [0x04, 0x01],
  INF_NOTICE: [0x04, 0x02],
  INF_TEST: [0x04, 0x03],
  INF_DEBUG: [0x04, 0x04],
  ACK_NAK: [0x05, 0x00],
  ACK_ACK: [0x05, 0x01],
  CFG_MSG: [0x06, 0x01],
  CFG_RST: [0x06, 0x04],
  CFG_CFG: [0x06, 0x09],
  CFG_VALSET: [0x06, 0x8a],
  CFG_VALGET: [0x06, 0x8b],
  CFG_VALDEL: [0x06, 0x8c],
  MON_VER: [0x0a, 0x04],
  MON_HW: [0x0a, 0x09],
  MON_GNSS: [0x0a, 0x28],
  MON_RF: [0x0a, 0x38],
  SEC_UNIQID: [0x27, 0x03],
} as const satisfies Record<string, readonly [number, number]>;

export type UbxMessageName = keyof typeof UBX;

const CLASS_NAMES: Record<number, string> = {
  0x01: 'NAV',
  0x02: 'RXM',
  0x04: 'INF',
  0x05: 'ACK',
  0x06: 'CFG',
  0x09: 'UPD',
  0x0a: 'MON',
  0x0d: 'TIM',
  0x10: 'ESF',
  0x13: 'MGA',
  0x21: 'LOG',
  0x27: 'SEC',
  0x28: 'HNR',
};

const NAMES = new Map<number, string>(
  Object.entries(UBX).map(([name, [cls, id]]) => [
    (cls << 8) | id,
    `UBX-${name.replace('_', '-')}`,
  ]),
);

/** Human name such as `UBX-NAV-PVT`, or `UBX-NAV-0x99` / `UBX-0x77-0x01` for unknown messages. */
export function ubxMessageName(cls: number, id: number): string {
  const known = NAMES.get((cls << 8) | id);
  if (known) return known;
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  return `UBX-${CLASS_NAMES[cls] ?? hex(cls)}-${hex(id)}`;
}

export function isMessage(cls: number, id: number, msg: readonly [number, number]): boolean {
  return cls === msg[0] && id === msg[1];
}
