import { ubxChecksum } from './checksum';

/** Builds a complete UBX frame. A poll request is a frame with an empty payload. */
export function buildUbx(
  cls: number,
  id: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const frame = new Uint8Array(8 + payload.length);
  frame[0] = 0xb5;
  frame[1] = 0x62;
  frame[2] = cls;
  frame[3] = id;
  frame[4] = payload.length & 0xff;
  frame[5] = (payload.length >> 8) & 0xff;
  frame.set(payload, 6);
  const ck = ubxChecksum(frame, 2, 6 + payload.length);
  frame[6 + payload.length] = ck & 0xff;
  frame[7 + payload.length] = ck >> 8;
  return frame;
}

export function buildPoll(msg: readonly [number, number]): Uint8Array {
  return buildUbx(msg[0], msg[1]);
}

/** Little-endian payload writer, used to build frames (and test fixtures). */
export class PayloadWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  u1(offset: number, v: number): this {
    this.view.setUint8(offset, v);
    return this;
  }
  i1(offset: number, v: number): this {
    this.view.setInt8(offset, v);
    return this;
  }
  u2(offset: number, v: number): this {
    this.view.setUint16(offset, v, true);
    return this;
  }
  i2(offset: number, v: number): this {
    this.view.setInt16(offset, v, true);
    return this;
  }
  u4(offset: number, v: number): this {
    this.view.setUint32(offset, v, true);
    return this;
  }
  i4(offset: number, v: number): this {
    this.view.setInt32(offset, v, true);
    return this;
  }
  ascii(offset: number, text: string, length: number): this {
    for (let i = 0; i < length; i++)
      this.bytes[offset + i] = i < text.length ? text.charCodeAt(i) & 0x7f : 0;
    return this;
  }
  bytesAt(offset: number, data: ArrayLike<number>): this {
    this.bytes.set(data, offset);
    return this;
  }
  build(): Uint8Array {
    return this.bytes;
  }
}
