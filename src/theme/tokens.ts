/**
 * Centralized SMAV Design System Tokens (Web)
 * Shared palette, typography roles, spacing, radius, shadows, and touch targets.
 */

export const SMAV_COLORS = {
  background: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceSubtle: '#F9FAFC',
  surfaceHover: '#F1F3F9',
  textPrimary: '#2F3033',
  textSecondary: '#6F737D',
  textMuted: '#8B909C',
  border: '#E5E7EC',
  borderStrong: '#D3D7E0',
  stepperGreen: '#15803D',
  stepperGreenHover: '#166534',
  stepperGreenSoft: '#ECFDF5',
  accentPink: '#FF1B7A',
  accentOrange: '#FF6A00',
  accentAmber: '#FFA500',
  infoBg: '#EFF6FF',
  infoText: '#1D4ED8',
  infoBorder: '#BFDBFE',
  successBg: '#ECFDF5',
  successText: '#15803D',
  successBorder: '#BBF7D0',
  warningBg: '#FFFBEB',
  warningText: '#B45309',
  warningBorder: '#FDE68A',
  dangerBg: '#FEF2F2',
  dangerText: '#B91C1C',
  dangerBorder: '#FECACA',
} as const;

export const SMAV_TYPOGRAPHY = {
  pageTitle: 'text-xl sm:text-2xl font-bold tracking-tight text-[#2F3033]',
  sectionHeading: 'text-base sm:text-lg font-bold tracking-tight text-[#2F3033]',
  cardTitle: 'text-sm sm:text-[15px] font-semibold text-[#2F3033] leading-snug',
  body: 'text-sm text-[#2F3033] leading-relaxed',
  caption: 'text-xs text-[#6F737D] leading-normal',
  microLabel: 'text-[11px] font-semibold uppercase tracking-wider text-[#6F737D]',
  price: 'font-bold tabular-nums tracking-tight text-[#2F3033]',
  numeric: 'tabular-nums',
} as const;

export const SMAV_LAYOUT = {
  pageShell: 'min-h-screen bg-[#F5F6FA] text-[#2F3033] font-sans antialiased',
  card: 'bg-white border border-[#E5E7EC] rounded-2xl shadow-[0_1px_3px_rgba(16,24,40,0.04)]',
  cardInteractive:
    'bg-white border border-[#E5E7EC] rounded-2xl shadow-[0_1px_3px_rgba(16,24,40,0.04)] hover:border-[#D3D7E0] hover:shadow-[0_4px_12px_rgba(16,24,40,0.06)] transition-all',
  input:
    'w-full min-h-[44px] rounded-xl bg-white border border-[#E5E7EC] px-3.5 py-2.5 text-sm text-[#2F3033] placeholder-[#8B909C] focus:outline-none focus:border-[#FF1B7A] focus:ring-2 focus:ring-[#FF1B7A]/15 transition',
  select:
    'w-full min-h-[44px] rounded-xl bg-white border border-[#E5E7EC] px-3.5 py-2.5 text-sm text-[#2F3033] focus:outline-none focus:border-[#FF1B7A] focus:ring-2 focus:ring-[#FF1B7A]/15 transition',
  primaryGradientButton:
    'min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#FF1B7A] via-[#FF6A00] to-[#FFA500] shadow-sm hover:brightness-105 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer',
  secondaryButton:
    'min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[#2F3033] bg-white border border-[#E5E7EC] hover:bg-[#F9FAFC] hover:border-[#D3D7E0] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer',
} as const;
