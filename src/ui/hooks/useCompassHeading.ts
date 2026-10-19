import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type CompassState =
  | { status: 'off' }
  | { status: 'starting' }
  | { status: 'unavailable' }
  | { status: 'ok'; headingDeg: number };

/** Heading changes smaller than this are ignored, so the sky plot does not jitter. */
const MIN_CHANGE_DEG = 2;

/**
 * Device compass heading for the heading-up sky view (REQ-SKY-09): true heading when location
 * permission allows it, otherwise magnetic heading.
 */
export function useCompassHeading(enabled: boolean): CompassState {
  const [state, setState] = useState<CompassState>({ status: 'off' });

  useEffect(() => {
    if (!enabled) return;
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    let last: number | undefined;
    // Asynchronous start: the state is set from callbacks, not synchronously in the effect.
    Promise.resolve()
      .then(() => !cancelled && setState({ status: 'starting' }))
      .then(() =>
        Location.watchHeadingAsync(
          (h) => {
            const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            if (cancelled || !(heading >= 0)) return;
            if (
              last !== undefined &&
              Math.abs(((heading - last + 540) % 360) - 180) < MIN_CHANGE_DEG
            ) {
              return;
            }
            last = heading;
            setState({ status: 'ok', headingDeg: heading });
          },
          () => !cancelled && setState({ status: 'unavailable' }),
        ),
      )
      .then((s) => {
        if (cancelled) s?.remove();
        else subscription = s ?? undefined;
      })
      .catch(() => !cancelled && setState({ status: 'unavailable' }));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);

  return enabled ? state : { status: 'off' };
}
