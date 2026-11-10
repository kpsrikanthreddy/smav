import React from 'react';
import { Scissors, Utensils, ShoppingBag, Building2, ArrowRight, ShieldCheck, LogOut } from 'lucide-react';
import { UserOutletMembership, UserSession } from '../types';

interface OutletSelectionScreenProps {
  availableOutlets: UserOutletMembership[];
  tempToken: string;
  onSelectOutlet: (outletId: string) => void;
  onLogout: () => void;
}

export const OutletSelectionScreen: React.FC<OutletSelectionScreenProps> = ({
  availableOutlets,
  onSelectOutlet,
  onLogout
}) => {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'salon':
        return <Scissors className="w-5 h-5 text-rose-400" />;
      case 'restaurant':
        return <Utensils className="w-5 h-5 text-amber-400" />;
      case 'retail':
        return <ShoppingBag className="w-5 h-5 text-emerald-400" />;
      default:
        return <Building2 className="w-5 h-5 text-sky-400" />;
    }
  };

  const getCategoryTheme = (category: string) => {
    switch (category) {
      case 'salon':
        return 'border-rose-500/20 bg-rose-500/5 hover:border-rose-500/50';
      case 'restaurant':
        return 'border-amber-500/20 bg-amber-500/5 hover:border-amber-500/50';
      case 'retail':
        return 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/50';
      default:
        return 'border-sky-500/20 bg-sky-500/5 hover:border-sky-500/50';
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E1B] text-slate-100 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-xl bg-[#121629] border border-[#1e2540] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Multi-Tenant Account Verified
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Select Active Outlet</h2>
            <p className="text-xs text-slate-400 mt-1">
              Your credentials are authorized for multiple enterprise outlets. Choose your destination:
            </p>
          </div>
          <button
            onClick={onLogout}
            title="Sign Out"
            className="text-slate-400 hover:text-rose-400 p-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 transition text-xs flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>

        {/* Outlets Grid */}
        <div className="space-y-3.5">
          {availableOutlets.map((outlet) => (
            <div
              key={outlet.outletId}
              onClick={() => onSelectOutlet(outlet.outletId)}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 group ${getCategoryTheme(outlet.outletCategory)}`}
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shadow-inner group-hover:scale-105 transition">
                  {getCategoryIcon(outlet.outletCategory)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white group-hover:text-pink-400 transition">
                      {outlet.outletName}
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase">
                      {outlet.outletCode}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Role: <span className="text-white font-medium capitalize">{outlet.specificTitle || outlet.role}</span>
                    {outlet.isPrimary && <span className="ml-2 text-sky-400 font-semibold">• Primary</span>}
                  </p>
                </div>
              </div>

              <div className="w-9 h-9 rounded-xl bg-slate-800 group-hover:bg-gradient-to-r group-hover:from-pink-500 group-hover:to-orange-500 flex items-center justify-center text-slate-400 group-hover:text-white transition shadow">
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          ))}
        </div>

        {/* Security Notice */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Server-enforced tenant isolation. Only data for your selected outlet will be loaded.</span>
        </div>
      </div>
    </div>
  );
};
