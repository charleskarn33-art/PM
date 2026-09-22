import type { StatusTone } from '@ipt/shared';

export const colors = {
  navy: '#0b1f3a',
  navyLight: '#13305a',
  red: '#d71920',
  white: '#ffffff',
  background: '#f4f6fa',
  card: '#ffffff',
  border: '#dde3ec',
  text: '#0b1f3a',
  textMuted: '#5b6b82',
} as const;

/** GREEN success · AMBER warning · RED danger · BLUE info · GRAY N/A */
export const toneColors: Record<StatusTone, { fg: string; bg: string }> = {
  success: { fg: '#15803d', bg: '#dcfce7' },
  warning: { fg: '#b45309', bg: '#fef3c7' },
  danger: { fg: '#b91c1c', bg: '#fee2e2' },
  info: { fg: '#1d4ed8', bg: '#dbeafe' },
  neutral: { fg: '#475569', bg: '#e2e8f0' },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;
/** Minimum touch target for field use (gloves, sunlight). */
export const touchTarget = 56;
