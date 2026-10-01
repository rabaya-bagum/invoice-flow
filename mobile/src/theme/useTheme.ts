import { useColorScheme } from 'react-native';
import { colors } from './index';

export function useTheme() {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
