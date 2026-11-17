import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'text-white bg-gradient-to-r from-[#FF1B7A] via-[#FF6A00] to-[#FFA500] shadow-sm hover:brightness-105 border border-transparent',
  secondary:
    'text-[#2F3033] bg-[#F5F6FA] hover:bg-[#ECEEF5] border border-[#E5E7EC]',
  outline:
    'text-[#2F3033] bg-white hover:bg-[#F9FAFC] border border-[#E5E7EC] hover:border-[#D3D7E0]',
  ghost:
    'text-[#6F737D] hover:text-[#2F3033] bg-transparent hover:bg-[#F5F6FA] border border-transparent',
  danger:
    'text-[#B91C1C] bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA]',
  success:
    'text-white bg-[#15803D] hover:bg-[#166534] border border-transparent shadow-sm',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[38px] px-3 py-1.5 text-xs rounded-xl',
  md: 'min-h-[44px] px-4 py-2.5 text-sm rounded-xl',
  lg: 'min-h-[48px] px-5 py-3 text-sm rounded-xl',
};

export const Button: React.FC<ButtonProps> = React.memo(({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leftIcon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}) => {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none ${
        VARIANT_CLASSES[variant]
      } ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin shrink-0" />
      ) : (
        leftIcon
      )}
      {children}
    </button>
  );
});

Button.displayName = 'Button';
