/**
 * FetchIt brand palette — mirrors the web app's CSS variables (src/index.css)
 * but applied to the dark, native iOS shell. The web app uses a cream/light
 * landing page; the mobile port is dark-first per the port spec:
 *   Background #1A1A1A · Accent #FFD700 · Text #FFFFFF
 */
export const Colors = {
  // Core brand
  yellow: '#FFD700', // primary / highlights / CTAs
  orange: '#FF6B35', // secondary accent ("Most Popular", Max framing)
  charcoal: '#1A1A1A', // app background / dark sections

  white: '#FFFFFF',
  cream: '#FFFDF7',

  // Dark-shell surfaces (match the web chat page: sidebar #111, bubbles #2A2A2A)
  background: '#1A1A1A',
  surface: '#222222', // cards / inputs
  surfaceAlt: '#2A2A2A', // raised bubbles / list rows
  sidebar: '#111111',
  incognito: '#1A1A2E', // incognito chat tint

  // Text
  text: '#FFFFFF',
  textMuted: '#B0B4BA',
  textFaint: '#7A7E85',
  placeholder: '#6B6F76',

  // Lines & states
  border: '#333333',
  borderFocus: '#FFD700',
  error: '#FF5C5C',
  success: '#3FCF8E',

  // Plan accents (Account / Plans cards)
  planFree: '#666666',
  planPlus: '#4DA3FF',
  planPro: '#FFD700',
  planMax: '#FF6B35',
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  pill: 999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 34,
} as const;

export type AppColor = keyof typeof Colors;
