import type { GnssEvent } from '@/domain/events';
import type { SourceKind } from '@/domain/types';

export type GnssEventSink = (event: GnssEvent) => void;

/**
 * A provider of GNSS data (technical spec §7.1, REQ-ARC-01). Sources translate their input
 * (Android APIs, USB bytes, a log file) into normalised events; the UI never depends on them.
 */
export interface GnssSource {
  readonly kind: SourceKind;
  /** Short human name for the status chip and Device screen, e.g. "Demo receiver". */
  readonly label: string;
  start(emit: GnssEventSink): Promise<void>;
  stop(): Promise<void>;
  /** Called when the app returns to the foreground after `suspend()`. */
  resume?(): Promise<void>;
  /** Called when the app goes to the background (REQ-NFR-08). Defaults to `stop()`. */
  suspend?(): Promise<void>;
}
