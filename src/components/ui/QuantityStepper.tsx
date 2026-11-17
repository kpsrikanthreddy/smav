import React from 'react';
import { Minus, Plus } from 'lucide-react';

export interface QuantityStepperProps {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  itemName?: string;
  addLabel?: string;
  disabled?: boolean;
  compact?: boolean;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = React.memo(({
  quantity,
  onIncrement,
  onDecrement,
  itemName = 'item',
  addLabel = 'ADD',
  disabled = false,
  compact = false,
}) => {
  if (quantity <= 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onIncrement();
        }}
        aria-label={`Add ${itemName}`}
        className={`min-h-[44px] min-w-[84px] rounded-xl bg-white border border-[#15803D] text-[#15803D] font-bold tracking-wide hover:bg-[#ECFDF5] active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer inline-flex items-center justify-center ${
          compact ? 'px-3 text-xs' : 'px-4 text-xs sm:text-sm'
        }`}
      >
        {addLabel}
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="min-h-[44px] min-w-[96px] rounded-xl bg-[#15803D] text-white inline-flex items-center justify-between shadow-sm select-none overflow-hidden"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onDecrement}
        aria-label={`Decrease quantity of ${itemName}`}
        className="w-9 h-[44px] inline-flex items-center justify-center hover:bg-[#166534] active:bg-[#14532D] disabled:opacity-50 transition cursor-pointer"
      >
        <Minus className="w-3.5 h-3.5 stroke-[2.5]" />
      </button>
      <span
        aria-live="polite"
        className="px-1.5 min-w-[24px] text-center text-xs sm:text-sm font-bold tabular-nums"
      >
        {quantity}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onIncrement}
        aria-label={`Increase quantity of ${itemName}`}
        className="w-9 h-[44px] inline-flex items-center justify-center hover:bg-[#166534] active:bg-[#14532D] disabled:opacity-50 transition cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
      </button>
    </div>
  );
});

QuantityStepper.displayName = 'QuantityStepper';
