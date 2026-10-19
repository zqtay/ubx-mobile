import type { TFunction } from 'i18next';

import { constellationMeta } from '@/domain/constellations';
import type { Constellation, GnssSnapshot } from '@/domain/types';

import { DASH, formatClock, formatDuration } from './format';

/** One Device-screen card: a title and label/value rows. Shared by the screen and the share text. */
export interface DeviceSection {
  title: string;
  /** Explanatory caption under the title. */
  hint?: string;
  rows: { label: string; value: string | number | undefined; mono?: boolean }[];
}

const names = (list: readonly Constellation[] | undefined) =>
  list && list.length > 0 ? list.map((c) => constellationMeta(c).name).join(', ') : undefined;

/** Device information as sections (REQ-DEV-02..08). Which sections appear depends on the source. */
/** Missing identity values read "waiting…" for this long after connecting. */
const IDENTIFY_GRACE_MS = 5000;

export function deviceSections(
  t: TFunction,
  s: GnssSnapshot,
  nowMs: number = Date.now(),
): DeviceSection[] {
  const sections: DeviceSection[] = [];
  const yesNo = (v: boolean | undefined) =>
    v === undefined ? undefined : v ? t('device.yes') : t('device.no');
  const android = s.device.android;
  const r = s.device.receiver;

  if (android) {
    sections.push({
      title: t('device.phone'),
      rows: [
        { label: t('device.manufacturer'), value: android.manufacturer },
        { label: t('device.model'), value: android.model },
        { label: t('device.android'), value: `${android.androidRelease} (API ${android.sdkInt})` },
        { label: t('device.fingerprint'), value: android.fingerprint, mono: true },
      ],
    });
    sections.push({
      title: t('device.gnssHardware'),
      rows: [
        {
          label: t('device.hardwareModel'),
          value: android.gnssHardwareModelName ?? t('device.notReported'),
        },
        {
          label: t('device.hardwareYear'),
          value: android.gnssYearOfHardware ?? t('device.notReported'),
        },
      ],
    });
    const caps = android.capabilities;
    sections.push({
      title: t('device.capabilities'),
      rows:
        caps && Object.keys(caps).length > 0
          ? Object.entries(caps).map(([key, value]) => ({
              label: t(`device.capability.${key}` as 'device.capability.measurements', {
                defaultValue: key,
              }),
              value: yesNo(value),
            }))
          : [{ label: t('device.capabilities'), value: t('device.notReported') }],
    });
    sections.push({
      title: t('device.observed'),
      rows: [
        { label: t('device.constellationsSeen'), value: names(android.observed?.constellations) },
        { label: t('device.bandsSeen'), value: android.observed?.bands.join(', ') || undefined },
        { label: t('device.dualFrequency'), value: yesNo(android.observed?.dualFrequency) },
        { label: t('device.nmeaOutput'), value: yesNo(android.observed?.nmeaOutput) },
        { label: t('device.maxSvUsed'), value: android.observed?.maxSvUsed },
      ],
    });
    if (android.antennaInfos && android.antennaInfos.length > 0) {
      sections.push({
        title: t('device.antennaCard'),
        rows: android.antennaInfos.map((a) => ({
          label: t('device.phaseCenter', { freq: (a.carrierHz / 1e6).toFixed(2) }),
          value: `${a.pcoXmm.toFixed(1)} / ${a.pcoYmm.toFixed(1)} / ${a.pcoZmm.toFixed(1)} mm`,
          mono: true,
        })),
      });
    }
    sections.push({
      title: t('device.session'),
      rows: [
        {
          label: t('device.startedAt'),
          value: s.session ? formatClock(s.session.startedAtMs) : undefined,
        },
        {
          label: t('device.ttff'),
          value: s.session?.ttffMs !== undefined ? formatDuration(s.session.ttffMs) : undefined,
        },
        { label: t('device.locationUpdates'), value: android.locationUpdates },
        { label: t('device.statusUpdates'), value: android.statusUpdates },
      ],
    });
    return sections;
  }

  // While the receiver is being identified, missing values are "waiting…" rather than "—"
  // (functional spec §7).
  const identifying =
    s.connection.kind === 'connecting' ||
    s.connection.kind === 'detecting' ||
    (s.session !== undefined && nowMs - s.session.startedAtMs < IDENTIFY_GRACE_MS);
  const waiting = t('device.waiting');
  const pending = <T>(v: T | undefined) => v ?? (identifying ? waiting : undefined);

  const usb = s.device.usb;
  if (usb) {
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
    const bridge = usb.driver !== 'cdc-acm';
    sections.push({
      title: bridge ? t('device.usbAdapter') : t('device.usbDevice'),
      hint: bridge ? t('device.adapterHint') : undefined,
      rows: [
        { label: t('device.product'), value: usb.productName },
        { label: t('device.manufacturer'), value: usb.manufacturerName },
        {
          label: t('device.vidPid'),
          value: `${hex(usb.vendorId)}:${hex(usb.productId)}`,
          mono: true,
        },
        { label: t('device.serialNumber'), value: usb.serialNumber, mono: true },
        { label: t('device.driver'), value: usb.driver.toUpperCase() },
        {
          label: t('device.baud'),
          value: !bridge ? t('device.baudNative') : (usb.baud ?? t('device.detecting')),
          mono: true,
        },
      ],
    });
  }
  sections.push({
    title: t('device.receiver'),
    rows: [
      {
        label: t('device.vendor'),
        value:
          r.vendor === 'u-blox'
            ? 'u-blox'
            : r.vendor === 'generic' || (r.nmeaDetected && !identifying)
              ? t('device.vendorGeneric')
              : pending(undefined),
      },
      { label: t('device.module'), value: pending(r.module) },
      { label: t('device.hardware'), value: pending(r.hwVersion), mono: true },
      { label: t('device.software'), value: pending(r.swVersion), mono: true },
      { label: t('device.firmware'), value: pending(r.fwVersion), mono: true },
      { label: t('device.protocol'), value: pending(r.protocolVersion), mono: true },
      { label: t('device.uniqueId'), value: pending(r.uniqueId), mono: true },
    ],
  });
  if (r.gnssSupported || r.gnssEnabled || r.gnssDefault) {
    sections.push({
      title: t('device.gnss'),
      rows: [
        { label: t('device.supported'), value: names(r.gnssSupported) },
        { label: t('device.default'), value: names(r.gnssDefault) },
        { label: t('device.enabled'), value: names(r.gnssEnabled) },
        { label: t('device.maxConcurrent'), value: r.maxConcurrentGnss },
      ],
    });
  }
  const blocks = r.rf ?? [];
  for (const rf of blocks) {
    sections.push({
      title:
        blocks.length > 1
          ? `${t('device.rf')} · ${t('device.rfBlock', { n: rf.blockId })}`
          : t('device.rf'),
      rows: [
        { label: t('device.antenna'), value: rf.antennaStatus?.toUpperCase() },
        { label: t('device.antennaPower'), value: rf.antennaPower?.toUpperCase() },
        { label: t('device.jamming'), value: rf.jammingState },
        { label: t('device.jamIndicator'), value: rf.jamIndicator },
        { label: t('device.noise'), value: rf.noisePerMs },
        {
          label: t('device.agc'),
          value: rf.agcPercent !== undefined ? `${rf.agcPercent} %` : undefined,
        },
      ],
    });
  }
  sections.push({
    title: t('device.protocols'),
    rows: [
      {
        label: t('device.nmea'),
        value: r.nmeaDetected ? t('device.detected') : t('device.notDetected'),
      },
      { label: t('device.nmeaVersion'), value: r.nmeaVersion },
      { label: t('device.talkers'), value: r.talkers?.join(', '), mono: true },
      {
        label: t('device.ubx'),
        value: r.ubxDetected ? t('device.detected') : t('device.notDetected'),
      },
      {
        label: t('device.dataMode'),
        value: r.dataMode ? t(`device.dataModeValue.${r.dataMode}`) : pending(undefined),
      },
    ],
  });
  const messages = s.stats.messages ?? [];
  if (messages.length > 0) {
    sections.push({
      title: t('device.messages'),
      hint: t('device.messagesHint'),
      rows: messages.map((m) => ({
        label: m.name,
        value: `${m.rateHz.toFixed(1)} Hz · ${m.count}`,
        mono: true,
      })),
    });
  }
  sections.push({
    title: t('device.stream'),
    rows: [
      { label: t('device.bytes'), value: s.stats.bytes.toLocaleString(), mono: true },
      {
        label: t('device.throughput'),
        value:
          s.stats.bytesPerSecond !== undefined
            ? `${Math.round(s.stats.bytesPerSecond)} B/s`
            : undefined,
        mono: true,
      },
      {
        label: t('device.lastData'),
        value:
          s.stats.lastFrameMs !== undefined
            ? t('device.ago', { age: formatAge(nowMs - s.stats.lastFrameMs) })
            : undefined,
        mono: true,
      },
      {
        label: t('device.frames'),
        value: `${s.stats.nmeaFrames} / ${s.stats.ubxFrames} / ${s.stats.rtcmFrames}`,
        mono: true,
      },
      {
        label: t('device.errors'),
        value: s.stats.nmeaChecksumErrors + s.stats.ubxChecksumErrors + s.stats.rtcmCrcErrors,
        mono: true,
      },
      { label: t('device.junk'), value: s.stats.junkBytes, mono: true },
    ],
  });
  return sections;
}

/** "0.4 s", "12 s", "3 min". */
export function formatAge(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 120) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}

/** Plain-text report for copy/share (REQ-DEV-07). */
export function deviceReportText(appName: string, sections: DeviceSection[], atMs: number): string {
  const lines = [`${appName} — ${new Date(atMs).toISOString()}`];
  for (const section of sections) {
    lines.push('', section.title);
    if (section.hint) lines.push(`  (${section.hint})`);
    for (const row of section.rows) {
      lines.push(
        `  ${row.label}: ${row.value === undefined || row.value === '' ? DASH : row.value}`,
      );
    }
  }
  return lines.join('\n');
}
