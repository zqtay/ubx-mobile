import * as Location from 'expo-location';

/**
 * Location permission outcome (REQ-AND-01):
 * - `granted`: precise location;
 * - `approximate`: only coarse location was granted, which gives no satellite data;
 * - `denied`: refused, can ask again;
 * - `blocked`: refused permanently, only system settings can change it.
 */
export type LocationPermission = 'granted' | 'approximate' | 'denied' | 'blocked';

export interface PermissionGateway {
  /** Current state without prompting. */
  check(): Promise<LocationPermission>;
  /** Prompts if possible and returns the resulting state. */
  request(): Promise<LocationPermission>;
}

function classify(response: Location.LocationPermissionResponse): LocationPermission {
  if (!response.granted) return response.canAskAgain ? 'denied' : 'blocked';
  return response.android?.accuracy === 'coarse' ? 'approximate' : 'granted';
}

export const expoLocationPermissions: PermissionGateway = {
  async check() {
    return classify(await Location.getForegroundPermissionsAsync());
  },
  async request() {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted && current.android?.accuracy !== 'coarse') return 'granted';
    if (!current.canAskAgain) return classify(current);
    return classify(await Location.requestForegroundPermissionsAsync());
  },
};
