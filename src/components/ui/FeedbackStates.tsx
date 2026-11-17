import React from 'react';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export const LoadingState: React.FC<{
  title?: string;
  subtitle?: string;
  compact?: boolean;
}> = ({ title = 'Loading…', subtitle, compact = false }) => (
  <div
    className={`bg-white border border-[#E5E7EC] rounded-2xl flex flex-col items-center justify-center text-center ${
      compact ? 'p-5 gap-2' : 'p-8 sm:p-10 gap-3'
    }`}
  >
    <div className="w-8 h-8 rounded-full border-2 border-[#E5E7EC] border-t-[#FF1B7A] animate-spin" />
    <p className="text-sm font-semibold text-[#2F3033]">{title}</p>
    {subtitle && <p className="text-xs text-[#6F737D] max-w-sm">{subtitle}</p>}
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="bg-white border border-dashed border-[#D3D7E0] rounded-2xl p-8 text-center flex flex-col items-center gap-2.5">
    <div className="w-11 h-11 rounded-xl bg-[#F5F6FA] border border-[#E5E7EC] flex items-center justify-center text-[#6F737D]">
      {icon || <Inbox className="w-5 h-5" />}
    </div>
    <p className="text-sm font-semibold text-[#2F3033]">{title}</p>
    {description && <p className="text-xs text-[#6F737D] max-w-md leading-relaxed">{description}</p>}
    {action && <div className="pt-1">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}> = ({ title = 'Unable to complete action', message, onRetry, retryLabel = 'Retry' }) => (
  <div
    role="alert"
    className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl p-4 flex flex-wrap items-start justify-between gap-3 text-xs text-[#991B1B]"
  >
    <div className="flex items-start gap-2.5 flex-1 min-w-[200px]">
      <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="font-semibold text-[#7F1D1D]">{title}</p>
        <p className="leading-relaxed">{message}</p>
      </div>
    </div>
    {onRetry && (
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
        className="border-[#FECACA] text-[#991B1B] hover:bg-white"
      >
        {retryLabel}
      </Button>
    )}
  </div>
);

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div className="bg-white border border-[#E5E7EC] rounded-2xl shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
        <div className="space-y-1.5">
          <h3 className="text-base font-bold text-[#2F3033]">{title}</h3>
          <p className="text-xs text-[#6F737D] leading-relaxed">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
