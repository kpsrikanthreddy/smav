import React from 'react';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}

const TONE_MAP: Record<StatusTone, string> = {
  neutral: 'bg-[#F5F6FA] text-[#6F737D] border-[#E5E7EC]',
  success: 'bg-[#ECFDF5] text-[#15803D] border-[#BBF7D0]',
  warning: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
  danger: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
  info: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]',
  brand: 'bg-[#FFF1F5] text-[#D81B60] border-[#FBCFE8]',
};

const DOT_MAP: Record<StatusTone, string> = {
  neutral: 'bg-[#6F737D]',
  success: 'bg-[#15803D]',
  warning: 'bg-[#D97706]',
  danger: 'bg-[#DC2626]',
  info: 'bg-[#2563EB]',
  brand: 'bg-[#FF1B7A]',
};

export const StatusBadge: React.FC<StatusBadgeProps> = React.memo(({
  label,
  tone = 'neutral',
  dot = false,
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap ${TONE_MAP[tone]} ${className}`}
  >
    {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_MAP[tone]}`} />}
    <span>{label}</span>
  </span>
));

StatusBadge.displayName = 'StatusBadge';
