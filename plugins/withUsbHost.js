// USB host support for external GNSS receivers (technical spec §5.3, REQ-SER-13):
// - declares the USB host feature as optional,
// - lets Android offer UBX Mobile when a supported USB serial device is plugged in,
// - writes res/xml/device_filter.xml with the supported vendor IDs.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const ATTACHED = 'android.hardware.usb.action.USB_DEVICE_ATTACHED';

/** Vendor (and optionally product) IDs, decimal, of supported receivers, bridges and flight controllers. */
const VENDORS = [
  { id: 5446, name: '0x1546 u-blox' },
  { id: 1027, name: '0x0403 FTDI' },
  { id: 4292, name: '0x10C4 Silicon Labs CP210x' },
  { id: 1659, name: '0x067B Prolific PL2303' },
  { id: 6790, name: '0x1A86 WCH CH34x' },
  // Betaflight/INAV flight controllers (GPS passthrough, REQ-SER-15). Product-specific, so other
  // STM32/AT32 devices such as ST-Link debuggers do not offer the app.
  { id: 1155, product: 22336, name: '0x0483:0x5740 STM32 VCP (flight controller)' },
  { id: 11836, product: 22336, name: '0x2E3C:0x5740 AT32 VCP (flight controller)' },
];

function deviceFilterXml() {
  const lines = VENDORS.map(
    (v) =>
      `  <usb-device vendor-id="${v.id}"${v.product ? ` product-id="${v.product}"` : ''}/> <!-- ${v.name} -->`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${lines.join('\n')}\n</resources>\n`;
}

const withUsbManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] ?? [];
    if (
      !manifest['uses-feature'].some((f) => f.$['android:name'] === 'android.hardware.usb.host')
    ) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.hardware.usb.host', 'android:required': 'false' },
      });
    }

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity['intent-filter'] = activity['intent-filter'] ?? [];
    const hasFilter = activity['intent-filter'].some((f) =>
      (f.action ?? []).some((a) => a.$['android:name'] === ATTACHED),
    );
    if (!hasFilter)
      activity['intent-filter'].push({ action: [{ $: { 'android:name': ATTACHED } }] });

    activity['meta-data'] = activity['meta-data'] ?? [];
    if (!activity['meta-data'].some((m) => m.$['android:name'] === ATTACHED)) {
      activity['meta-data'].push({
        $: { 'android:name': ATTACHED, 'android:resource': '@xml/device_filter' },
      });
    }
    return cfg;
  });

const withDeviceFilter = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'device_filter.xml'), deviceFilterXml());
      return cfg;
    },
  ]);

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withUsbHost = (config) => withDeviceFilter(withUsbManifest(config));

module.exports = withUsbHost;
module.exports.deviceFilterXml = deviceFilterXml;
