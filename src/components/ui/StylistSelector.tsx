import React from 'react';
import { Stylist } from '../../types';

export interface StylistSelectorProps {
  index: number;
  serviceName: string;
  stylists: Stylist[];
  selectedStylistId: string;
  isLoadingStylists: boolean;
  isMissingHighlight: boolean;
  selectRef: (el: HTMLSelectElement | null) => void;
  onChange: (stylist: Stylist | null) => void;
}

export const StylistSelector: React.FC<StylistSelectorProps> = React.memo(({
  index,
  serviceName,
  stylists,
  selectedStylistId,
  isLoadingStylists,
  isMissingHighlight,
  selectRef,
  onChange,
}) => {
  const isInvalid = isMissingHighlight && !selectedStylistId;

  return (
    <div className="space-y-1">
      <label
        htmlFor={`stylist-${index}`}
        className="block text-[11px] font-semibold text-[#6F737D]"
      >
        Assigned stylist for this service <span className="text-[#FF1B7A]">*</span>
      </label>
      <select
        ref={selectRef}
        id={`stylist-${index}`}
        aria-label={`Stylist for ${serviceName}`}
        aria-invalid={isInvalid}
        value={selectedStylistId}
        disabled={isLoadingStylists || stylists.length === 0}
        onChange={(e) => {
          const chosen = stylists.find((st) => st.id === e.target.value) || null;
          onChange(chosen);
        }}
        className={`w-full min-h-[44px] rounded-xl border bg-white px-3 py-2 text-xs sm:text-sm text-[#2F3033] focus:outline-none focus:ring-2 transition ${
          isInvalid
            ? 'border-[#DC2626] ring-2 ring-[#DC2626]/20 bg-[#FEF2F2]'
            : 'border-[#E5E7EC] focus:border-[#FF1B7A] focus:ring-[#FF1B7A]/15'
        }`}
      >
        <option value="">
          {isLoadingStylists
            ? 'Loading stylists...'
            : stylists.length === 0
              ? 'No active stylists available'
              : 'Select stylist (required)'}
        </option>
        {stylists.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name}
            {st.role || st.specialty ? ` (${st.role || st.specialty})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
});

StylistSelector.displayName = 'StylistSelector';
