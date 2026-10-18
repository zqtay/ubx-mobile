import type { GnssEvent } from '@/domain/events';

import { BE122_MON_VER_HEX, frameFromDump } from '../../../test/fixtures/be122';
import { M10_MON_VER } from '../ubx/encoders';
import { interpretUbx } from '../ubx/interpreter';
import { StreamDecoder } from '../stream/StreamDecoder';

/** Implementation plan M1.7: decoders checked against real BE-122 output. */
describe('real BE-122 data', () => {
  const frame = frameFromDump(BE122_MON_VER_HEX);

  it('decodes MON-VER into the receiver identity', () => {
    const [decoded] = new StreamDecoder().push(frame, 0);
    expect(decoded).toMatchObject({ kind: 'ubx', cls: 0x0a, id: 0x04 });
    if (decoded.kind !== 'ubx') throw new Error('expected UBX');
    const events = interpretUbx(decoded.cls, decoded.id, decoded.payload, 0);
    const patch = (events[0] as Extract<GnssEvent, { t: 'receiver' }>).patch;
    expect(patch).toEqual({
      vendor: 'u-blox',
      ubxDetected: true,
      swVersion: 'ROM SPG 5.10 (7b202e)',
      hwVersion: '000A0000',
      fwVersion: 'SPG 5.10',
      protocolVersion: '34.10',
      extensions: ['FWVER=SPG 5.10', 'PROTVER=34.10', 'GPS;GLO;GAL;BDS', 'SBAS;QZSS'],
      gnssSupported: ['GPS', 'GLONASS', 'GALILEO', 'BEIDOU', 'SBAS', 'QZSS'],
    });
  });

  it('is reproduced byte-for-byte by the demo receiver', () => {
    expect([...M10_MON_VER()]).toEqual([...frame]);
  });

  it('rejects dump lines whose length field does not match', () => {
    expect(() => frameFromDump('0A 04 05 00 01 02')).toThrow(/length/);
  });
});
