import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { QuantityStepper } from './QuantityStepper';

export interface ItemCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  price: number;
  mrp?: number;
  discountLabel?: string;
  imageUrl?: string;
  leadingIndicator?: React.ReactNode;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  disabledReason?: string;
  addLabel?: string;
  footer?: React.ReactNode;
  lineTotal?: number;
  fallbackIcon?: React.ReactNode;
}

export const ItemCard: React.FC<ItemCardProps> = React.memo(({
  title,
  subtitle,
  meta,
  price,
  mrp,
  discountLabel,
  imageUrl,
  leadingIndicator,
  quantity,
  onIncrement,
  onDecrement,
  disabled = false,
  disabledReason,
  addLabel = 'ADD',
  footer,
  lineTotal,
  fallbackIcon,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      className={`bg-white border rounded-2xl p-3.5 sm:p-4 transition-all ${
        disabled
          ? 'border-[#E5E7EC] opacity-65'
          : quantity > 0
            ? 'border-[#15803D]/35 shadow-[0_2px_8px_rgba(21,128,61,0.06)]'
            : 'border-[#E5E7EC] hover:border-[#D3D7E0] shadow-[0_1px_3px_rgba(16,24,40,0.04)]'
      }`}
    >
      <div className="flex items-start gap-3">
        {(imageUrl || fallbackIcon) && (
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-[#F5F6FA] border border-[#E5E7EC] shrink-0 overflow-hidden flex items-center justify-center text-[#6F737D]">
            {imageUrl && !imgFailed ? (
              <img
                src={imageUrl}
                alt={title}
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              fallbackIcon || <Package className="w-5 h-5 text-[#8B909C]" />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {leadingIndicator}
                <h4 className="text-sm font-semibold text-[#2F3033] leading-snug line-clamp-2">
                  {title}
                </h4>
              </div>
              {subtitle && (
                <p className="text-xs text-[#6F737D] mt-0.5 truncate">{subtitle}</p>
              )}
              {meta && (
                <p className="text-[11px] text-[#8B909C] mt-0.5 truncate">{meta}</p>
              )}
              {disabled && disabledReason && (
                <p className="text-[11px] font-medium text-[#B45309] mt-0.5">{disabledReason}</p>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-end gap-1">
              <QuantityStepper
                quantity={quantity}
                onIncrement={onIncrement}
                onDecrement={onDecrement}
                itemName={title}
                addLabel={addLabel}
                disabled={disabled}
                compact
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-bold text-[#2F3033] tabular-nums">
                ₹{price}
              </span>
              {typeof mrp === 'number' && mrp > price && (
                <span className="text-xs text-[#8B909C] line-through tabular-nums">
                  ₹{mrp}
                </span>
              )}
              {discountLabel && (
                <span className="text-[11px] font-semibold text-[#1D4ED8]">
                  {discountLabel}
                </span>
              )}
            </div>

            {typeof lineTotal === 'number' && quantity > 0 && (
              <span className="text-xs font-bold text-[#15803D] tabular-nums">
                Line: ₹{lineTotal}
              </span>
            )}
          </div>
        </div>
      </div>

      {footer && <div className="mt-3 pt-3 border-t border-[#F0F1F5]">{footer}</div>}
    </div>
  );
});

ItemCard.displayName = 'ItemCard';
