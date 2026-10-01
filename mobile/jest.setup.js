// expo-linking needs the native manifest to build URLs; tests only need a stable custom scheme.
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path) => `invoiceflow://${path}`,
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: ({ children }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const Picker = (props) =>
    React.createElement(View, { accessibilityLabel: props.accessibilityLabel });
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});
