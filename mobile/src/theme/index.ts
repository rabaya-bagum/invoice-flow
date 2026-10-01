export const colors = {
  light: {
    background: '#FFFFFF',
    surface: '#F5F7FA',
    text: '#0F172A',
    muted: '#64748B',
    primary: '#2563EB',
  },
  dark: {
    background: '#0B1120',
    surface: '#151E32',
    text: '#F8FAFC',
    muted: '#94A3B8',
    primary: '#60A5FA',
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { card: 16, button: 12 } as const;
