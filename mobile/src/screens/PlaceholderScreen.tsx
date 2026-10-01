import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/ListStates';
import { useTheme } from '../theme/useTheme';

export function PlaceholderScreen({ title, hint }: { title: string; hint: string }) {
  const c = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
      <EmptyState title={title} hint={hint} />
    </SafeAreaView>
  );
}
