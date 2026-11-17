import React from 'react';

export interface SummaryLine {
  label: string;
  value: string;
  tone?: 'default' | 'discount' | 'accent';
}

export interface CartSummaryProps {
  lines: SummaryLine[];
  grandTotalLabel?: string;
  grandTotalValue: string;
  itemCountLabel?: string;
  action?: React.ReactNode;
}

export const CartSummary: React.FC<CartSummaryProps> = React.memo(({
  lines,
  grandTotalLabel = 'Grand Total',
  grandTotalValue,
  itemCountLabel,
  action,
}) => (
  <div className="bg-[#F9FAFC] border border-[#E5E7EC] rounded-2xl p-4 space-y-2.5">
    <div className="space-y-1.5 text-xs">
      {lines.map((line) => (
        <div key={line.label} className="flex items-center justify-between gap-2">
          <span className="text-[#6F737D]">{line.label}</span>
          <span
            className={`font-semibold tabular-nums ${
              line.tone === 'discount'
                ? 'text-[#B45309]'
                : line.tone === 'accent'
                  ? 'text-[#15803D]'
                  : 'text-[#2F3033]'
            }`}
          >
            {line.value}
          </span>
        </div>
      ))}
    </div>

    <div className="pt-2.5 border-t border-[#E5E7EC] flex items-center justify-between gap-3">
      <div>
        <span className="text-sm font-bold text-[#2F3033] block">{grandTotalLabel}</span>
        {itemCountLabel && (
          <span className="text-[11px] text-[#6F737D]">{itemCountLabel}</span>
        )}
      </div>
      <span className="text-lg font-bold text-[#15803D] tabular-nums">{grandTotalValue}</span>
    </div>

    {action && <div className="pt-1">{action}</div>}
  </div>
));

CartSummary.displayName = 'CartSummary';
