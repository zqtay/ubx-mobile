import * as fc from 'fast-check';

import { ascii, concat, navDop, navPvt, nmea, rtcm1005 } from '../../../test/helpers/fixtures';
import { MAX_NMEA_LENGTH, StreamDecoder, type DecodedFrame } from '../stream/StreamDecoder';

const GGA = 'GNGGA,113902.00,0121.12500,N,10349.19000,E,1,05,0.78,32.4,M,7.5,M,,';

function decodeAll(
  bytes: Uint8Array,
  chunkSizes?: number[],
): { frames: DecodedFrame[]; decoder: StreamDecoder } {
  const decoder = new StreamDecoder();
  const frames: DecodedFrame[] = [];
  if (!chunkSizes) {
    frames.push(...decoder.push(bytes, 0));
  } else {
    let offset = 0;
    let i = 0;
    while (offset < bytes.length) {
      const size = Math.max(1, chunkSizes[i++ % chunkSizes.length]);
      frames.push(...decoder.push(bytes.subarray(offset, offset + size), 0));
      offset += size;
    }
  }
  return { frames, decoder };
}

describe('StreamDecoder (technical spec §6.1)', () => {
  it('splits interleaved NMEA, UBX and RTCM3 frames', () => {
    const stream = concat(
      nmea(GGA),
      navPvt(),
      ascii('garbage'),
      rtcm1005(),
      navDop(),
      nmea('GNTXT,1,1,02,hello'),
    );
    const { frames, decoder } = decodeAll(stream);
    expect(frames.map((f) => f.kind)).toEqual(['nmea', 'ubx', 'rtcm3', 'ubx', 'nmea']);
    expect(frames[0]).toMatchObject({ kind: 'nmea', text: expect.stringContaining('$GNGGA') });
    expect(frames[1]).toMatchObject({ kind: 'ubx', cls: 0x01, id: 0x07 });
    expect(frames[2]).toMatchObject({ kind: 'rtcm3', messageType: 1005, length: 19 });
    expect(decoder.stats).toMatchObject({
      nmeaFrames: 2,
      ubxFrames: 2,
      rtcmFrames: 1,
      junkBytes: 'garbage'.length,
      bytes: stream.length,
    });
    expect(decoder.pending).toBe(0);
  });

  it('reassembles frames split across arbitrary chunk boundaries', () => {
    const stream = concat(nmea(GGA), navPvt(), rtcm1005());
    for (const size of [1, 2, 3, 7, 50]) {
      const { frames } = decodeAll(stream, [size]);
      expect(frames.map((f) => f.kind)).toEqual(['nmea', 'ubx', 'rtcm3']);
    }
  });

  it('drops NMEA sentences with a bad checksum and counts them', () => {
    const bad = ascii('$GNGGA,113902.00,,,,,0,00,99.99,,,,,,*00\r\n');
    const { frames, decoder } = decodeAll(concat(bad, nmea(GGA)));
    expect(frames).toHaveLength(1);
    expect(decoder.stats.nmeaChecksumErrors).toBe(1);
  });

  it('accepts sentences without a checksum but counts them', () => {
    const { frames, decoder } = decodeAll(ascii('$GPGLL,4916.45,N,12311.12,W,225444,A\n'));
    expect(frames).toHaveLength(1);
    expect(decoder.stats.nmeaNoChecksum).toBe(1);
  });

  it('rejects non-printable bytes, nested $ and overlong lines', () => {
    const { frames } = decodeAll(
      concat(
        ascii('$GPGGA,1\x01,2\r\n'),
        ascii('$GPGGA,1$'),
        nmea(GGA),
        ascii('$' + 'A'.repeat(MAX_NMEA_LENGTH + 5)),
        nmea(GGA),
      ),
    );
    expect(frames.filter((f) => f.kind === 'nmea')).toHaveLength(2);
  });

  it('resynchronises after a UBX frame with a bad checksum', () => {
    const corrupt = navPvt();
    corrupt[corrupt.length - 1] ^= 0xff;
    const { frames, decoder } = decodeAll(concat(corrupt, navDop()));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ kind: 'ubx', id: 0x04 });
    expect(decoder.stats.ubxChecksumErrors).toBe(1);
  });

  it('does not let a corrupt UBX length field swallow following frames', () => {
    // Sync bytes followed by a huge length, then a valid sentence.
    const { frames } = decodeAll(
      concat(Uint8Array.of(0xb5, 0x62, 0x01, 0x07, 0xff, 0xff), nmea(GGA)),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].kind).toBe('nmea');
  });

  it('rejects RTCM3 frames with a bad CRC or reserved bits set', () => {
    const bad = rtcm1005();
    bad[bad.length - 1] ^= 0x01;
    const reserved = Uint8Array.of(0xd3, 0x40, 0x00);
    const { frames, decoder } = decodeAll(concat(bad, reserved, nmea(GGA)));
    expect(frames.map((f) => f.kind)).toEqual(['nmea']);
    expect(decoder.stats.rtcmCrcErrors).toBe(1);
  });

  it('waits for incomplete frames instead of dropping them', () => {
    const decoder = new StreamDecoder();
    const pvt = navPvt();
    expect(decoder.push(pvt.subarray(0, 1), 0)).toEqual([]);
    expect(decoder.push(pvt.subarray(1, 10), 0)).toEqual([]);
    expect(decoder.pending).toBe(10);
    expect(decoder.push(pvt.subarray(10), 5)).toHaveLength(1);
    expect(decoder.stats.lastFrameMs).toBe(5);
    decoder.push(ascii('$GPG'), 6);
    decoder.reset();
    expect(decoder.pending).toBe(0);
  });

  it('grows its buffer for large inputs', () => {
    const many = concat(...Array.from({ length: 2000 }, () => navPvt()));
    const { frames } = decodeAll(many, [70_000]);
    expect(frames).toHaveLength(2000);
  });

  describe('fuzz (REQ-NFR-05)', () => {
    it('never throws on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ maxLength: 4000 }),
          fc.array(fc.integer({ min: 1, max: 300 }), { minLength: 1 }),
          (bytes, sizes) => {
            decodeAll(bytes, sizes);
          },
        ),
        { numRuns: 300 },
      );
    });

    it('recovers every valid frame embedded in noise that contains no lead bytes', () => {
      const noise = fc
        .uint8Array({ maxLength: 200 })
        .map((a) => a.filter((b) => b !== 0x24 && b !== 0x21 && b !== 0xb5 && b !== 0xd3));
      const frame = fc.constantFrom(
        nmea(GGA),
        navPvt(),
        navDop(),
        rtcm1005(),
        nmea('GPGSV,1,1,01,14,07,312,25'),
      );
      fc.assert(
        fc.property(
          fc.array(fc.tuple(noise, frame), { maxLength: 20 }),
          fc.array(fc.integer({ min: 1, max: 64 }), { minLength: 1 }),
          (pieces, sizes) => {
            const stream = concat(...pieces.flatMap(([n, f]) => [n, f]));
            const { frames } = decodeAll(stream, sizes);
            expect(frames).toHaveLength(pieces.length);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
