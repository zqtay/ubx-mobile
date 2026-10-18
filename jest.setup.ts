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
