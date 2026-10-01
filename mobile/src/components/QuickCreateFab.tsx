import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export interface QuickAction {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}

/** The "+" button: opens a small menu of things to create, closes on pick or backdrop tap. */
export function QuickCreateFab({ actions }: { actions: QuickAction[] }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      {open ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close menu"
          accessibilityRole="button"
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.menu}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="menuitem"
              accessibilityLabel={a.label}
              onPress={() => {
                setOpen(false);
                a.onPress();
              }}
              style={[styles.item, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <Ionicons name={a.icon} size={20} color={c.primary} />
              <Text style={{ color: c.text, fontWeight: '600' }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close quick create' : 'Quick create'}
        accessibilityState={{ expanded: open }}
        style={[styles.fab, { backgroundColor: c.primary }]}
      >
        <Ionicons name={open ? 'close' : 'add'} size={28} color={c.onPrimary} />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  menu: { position: 'absolute', right: 20, bottom: 92, gap: spacing.sm, alignItems: 'flex-end' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 24,
    borderWidth: 1,
  },
});
