// Initialise translations so components render real strings in tests.
import '@/i18n';

// react-native-mmkv uses an in-memory mock under Jest, but its index still imports the
// Nitro native module at load time; stub it so no native binding is required.
jest.mock('react-native-nitro-modules', () => ({ NitroModules: {} }));

// Icon fonts cannot be loaded in Jest; render a plain view tagged with the icon name instead.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Icon = ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` });
  return { __esModule: true, default: Icon };
});

// Tests run as a portrait phone (Jest's default window is 750 dp wide, which would select the
// tablet/landscape layouts). Tests of wide layouts change the dimensions themselves.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Dimensions } = require('react-native') as typeof import('react-native');
Dimensions.set({
  window: { width: 390, height: 844, scale: 3, fontScale: 1 },
  screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
});
