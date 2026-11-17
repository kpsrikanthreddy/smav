import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className = '',
}) => (
  <div className={className}>
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold text-[#2F3033] mb-1.5"
    >
      {label}
      {required && <span className="text-[#FF1B7A] ml-0.5">*</span>}
    </label>
    {children}
    {error ? (
      <p role="alert" className="mt-1.5 text-xs text-[#B91C1C] font-medium">
        {error}
      </p>
    ) : hint ? (
      <p className="mt-1.5 text-[11px] text-[#6F737D] leading-snug">{hint}</p>
    ) : null}
  </div>
);

export const BASE_INPUT_CLASS =
  'w-full min-h-[44px] rounded-xl bg-white border border-[#E5E7EC] px-3.5 py-2.5 text-sm text-[#2F3033] placeholder-[#8B909C] focus:outline-none focus:border-[#FF1B7A] focus:ring-2 focus:ring-[#FF1B7A]/15 disabled:bg-[#F5F6FA] disabled:text-[#6F737D] transition';

export interface PasswordFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  label,
  hint,
  error,
  id,
  required,
  className = '',
  ...inputProps
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          className={`${BASE_INPUT_CLASS} pr-12 ${className}`}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center text-[#6F737D] hover:text-[#2F3033] hover:bg-[#F5F6FA] transition cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </FormField>
  );
};
