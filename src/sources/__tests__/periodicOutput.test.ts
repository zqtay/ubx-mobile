import { KEY, msgoutKey, OUTPUT_MESSAGES } from '@/config/keys';
import type { GnssEvent } from '@/domain/events';
import { UsbSerialSource } from '@/sources/usb/UsbSerialSource';

import { BE122_DUMP } from '../../../test/fixtures/m10Dumps';
import { dumpRamValues } from '../../../test/helpers/configSim';
import { BE122_SIM, FakeUsbNative } from '../../../test/helpers/fakeUsb';
import type { UsbSerialModule } from '../../../modules/usb-serial';

const key = (label: string) =>
  msgoutKey(
    OUTPUT_MESSAGES.find((m) => m.label === label)!,
    'UART1',
  );

async function connect(periodicOutput: boolean, ram?: Map<number, number>) {
  const native = new FakeUsbNative({ ...BE122_SIM, config: ram ? { ram } : {} });
  const events: GnssEvent[] = [];
  const source = new UsbSerialSource({
    device: native.devices[0],
    native: native as unknown as UsbSerialModule,
    baud: 'auto',
    probeUbx: true,
    periodicOutput,
    setDtrRts: true,
    listenMs: 50,
    probeMs: 50,
  });
  const started = source.start((e) => void events.push(e));
  await jest.advanceTimersByTimeAsync(6000);
  await started;
  const dataMode = [...events]
    .reverse()
    .find(
      (e): e is Extract<GnssEvent, { t: 'receiver' }> => e.t === 'receiver' && !!e.patch.dataMode,
    )?.patch.dataMode;
  return { native, sim: native.config!, dataMode };
}

describe('opt-in periodic UBX output (REQ-SER-09)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('enables the polled messages in RAM at rates suited to the measurement rate', async () => {
    const { sim, dataMode } = await connect(true);
    // BE-122: 10 Hz measurements → NAV-PVT every 2nd epoch (5 Hz), the rest every 10th (1 Hz).
    expect(sim.ram.get(key('NAV-PVT'))).toBe(2);
    expect(sim.ram.get(key('NAV-SAT'))).toBe(10);
    expect(sim.ram.get(key('NAV-STATUS'))).toBe(10);
    expect(sim.bbr.size).toBe(0); // never saved
    expect(dataMode).toBe('periodic');
  });

  it('leaves messages the receiver already outputs alone and never writes in poll mode', async () => {
    const ram = dumpRamValues(BE122_DUMP);
    ram.set(key('NAV-PVT'), 1);
    ram.set(KEY.RATE_MEAS, 1000);
    const { sim } = await connect(true, ram);
    expect(sim.ram.get(key('NAV-PVT'))).toBe(1);
    expect(sim.ram.get(key('NAV-SAT'))).toBe(1);

    const polling = await connect(false);
    expect(polling.native.written.some((w) => w.cls === 0x06 && w.id === 0x8a)).toBe(false);
    expect(polling.dataMode).toBe('poll');
  });
});
