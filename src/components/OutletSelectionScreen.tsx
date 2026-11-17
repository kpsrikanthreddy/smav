import React from 'react';
import {
  ArrowRight,
  Building2,
  LogOut,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  Utensils,
} from 'lucide-react';
import { UserOutletMembership, getVisibleRole } from '../types';
import { Button, Card, StatusBadge } from './ui';

interface OutletSelectionScreenProps {
  availableOutlets: UserOutletMembership[];
  tempToken: string;
  onSelectOutlet: (outletId: string, tempToken: string) => void;
  onLogout: () => void;
}

export const OutletSelectionScreen: React.FC<OutletSelectionScreenProps> = ({
  availableOutlets,
  tempToken,
  onSelectOutlet,
  onLogout,
}) => {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'salon':
        return <Scissors className="w-5 h-5 text-[#FF1B7A]" />;
      case 'restaurant':
        return <Utensils className="w-5 h-5 text-[#FF6A00]" />;
      case 'retail':
        return <ShoppingBag className="w-5 h-5 text-[#15803D]" />;
      default:
        return <Building2 className="w-5 h-5 text-[#1D4ED8]" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F6FA] text-[#2F3033] flex items-center justify-center p-4 sm:p-6 font-sans safe-bottom">
      <Card padding="lg" className="w-full max-w-xl shadow-[0_8px_28px_rgba(16,24,40,0.06)] space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <StatusBadge label="Multi-Tenant Verified" tone="success" dot />
            <h2 className="text-xl sm:text-2xl font-bold text-[#2F3033] tracking-tight pt-1">
              Select Active Outlet
            </h2>
            <p className="text-xs text-[#6F737D]">
              Choose the authorized enterprise outlet workspace to open.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            leftIcon={<LogOut className="w-3.5 h-3.5" />}
          >
            Sign Out
          </Button>
        </div>

        <div className="space-y-3">
          {availableOutlets.map((outlet) => (
            <button
              key={outlet.outletId}
              type="button"
              onClick={() => onSelectOutlet(outlet.outletId, tempToken)}
              className="w-full text-left p-4 rounded-2xl bg-white border border-[#E5E7EC] hover:border-[#FF1B7A]/50 hover:shadow-sm transition flex items-center justify-between gap-3 group cursor-pointer"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-[#F5F6FA] border border-[#E5E7EC] flex items-center justify-center shrink-0">
                  {getCategoryIcon(outlet.outletCategory)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-[#2F3033] group-hover:text-[#FF1B7A] transition truncate">
                      {outlet.outletName}
                    </h3>
                    <span className="text-[11px] font-mono text-[#6F737D] uppercase">
                      {outlet.outletCode}
                    </span>
                  </div>
                  <p className="text-xs text-[#6F737D] mt-0.5">
                    Role: <span className="font-semibold text-[#2F3033]">{getVisibleRole(outlet.displayRole || outlet.role)}</span>
                    {outlet.isPrimary && (
                      <span className="ml-2 text-[#1D4ED8] font-semibold">· Primary</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="w-9 h-9 rounded-xl bg-[#F5F6FA] group-hover:bg-gradient-to-r group-hover:from-[#FF1B7A] group-hover:to-[#FF6A00] flex items-center justify-center text-[#6F737D] group-hover:text-white transition shrink-0">
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>
          ))}
        </div>

        <div className="pt-3 border-t border-[#E5E7EC] flex items-center gap-2 text-xs text-[#6F737D]">
          <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0" />
          <span>Server-enforced tenant isolation loads data strictly for your selected outlet.</span>
        </div>
      </Card>
    </div>
  );
};
