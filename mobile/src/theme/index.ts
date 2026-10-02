export const colors = {
  light: {
    background: '#FFFFFF',
    surface: '#F5F7FA',
    text: '#0F172A',
    muted: '#617087',
    primary: '#2563EB',
    danger: '#D42222',
    onPrimary: '#FFFFFF',
    border: '#CBD5E1',
  },
  dark: {
    background: '#0B1120',
    surface: '#151E32',
    text: '#F8FAFC',
    muted: '#94A3B8',
    primary: '#60A5FA',
    danger: '#F87171',
    onPrimary: '#0B1120',
    border: '#334155',
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { card: 16, button: 12 } as const;
