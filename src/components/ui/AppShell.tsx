import React from 'react';
import { LogOut, Printer, ShoppingCart } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

export interface AppShellTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface OutletOption {
  id: string;
  label: string;
}

export interface AppShellProps {
  roleLabel: string;
  roleTone?: 'brand' | 'info' | 'success';
  revision: number;
  outletName: string;
  userFullName: string;
  tabs: AppShellTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  outletOptions?: OutletOption[];
  selectedOutletId?: string;
  onOutletChange?: (outletId: string) => void;
  isSwitchingOutlet?: boolean;
  onLogout: () => void;
  cartItemCount?: number;
  cartTotalAmount?: number;
  onOpenSelectedCart?: () => void;
  bannerError?: string | null;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  roleLabel,
  roleTone = 'info',
  revision,
  outletName,
  userFullName,
  tabs,
  activeTab,
  onTabChange,
  outletOptions,
  selectedOutletId,
  onOutletChange,
  isSwitchingOutlet = false,
  onLogout,
  cartItemCount = 0,
  cartTotalAmount = 0,
  onOpenSelectedCart,
  bannerError,
  children,
}) => {
  return (
    <div className="min-h-screen bg-[#F5F6FA] text-[#2F3033] flex flex-col font-sans safe-bottom">
      <header className="bg-white border-b border-[#E5E7EC] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 pt-2.5 pb-2">
          <div className="flex items-center justify-between gap-3">
            {/* Brand + Outlet Context */}
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#FF1B7A] via-[#FF6A00] to-[#FFA500] flex items-center justify-center shadow-sm shrink-0">
                <Printer className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm sm:text-base font-bold tracking-tight text-[#2F3033] truncate">
                    SMAV Print Agent
                  </h1>
                  <StatusBadge label={roleLabel} tone={roleTone} />
                  <span className="hidden sm:inline-block text-[11px] font-medium text-[#6F737D] tabular-nums">
                    Rev #{revision}
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-[#6F737D] truncate">
                  {outletName} · <span className="font-medium text-[#2F3033]">{userFullName}</span>
                </p>
              </div>
            </div>

            {/* Right Header Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {outletOptions && outletOptions.length > 1 && onOutletChange && (
                <select
                  aria-label="Switch assigned outlet"
                  value={selectedOutletId}
                  disabled={isSwitchingOutlet}
                  onChange={(e) => onOutletChange(e.target.value)}
                  className="hidden sm:block min-h-[38px] max-w-[240px] rounded-xl bg-white border border-[#E5E7EC] px-2.5 py-1.5 text-xs font-medium text-[#2F3033] focus:outline-none focus:border-[#FF1B7A]"
                >
                  {outletOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={onOpenSelectedCart}
                className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  cartItemCount > 0
                    ? 'border-[#FF1B7A]/40 bg-[#FFF1F7] hover:bg-[#FFE4F0] text-[#2F3033]'
                    : 'border-[#E5E7EC] bg-white hover:bg-[#F5F6FA] text-[#2F3033]'
                }`}
                title="Open Selected Cart"
              >
                <ShoppingCart className="w-3.5 h-3.5 text-[#FF1B7A] shrink-0" />
                <span className="hidden sm:inline">Selected Cart</span>
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-[#FF1B7A] text-white text-[11px] font-bold tabular-nums">
                  {cartItemCount}
                </span>
                <span className="font-bold text-[#2F3033] tabular-nums">
                  ₹{Math.round(cartTotalAmount).toLocaleString('en-IN')}
                </span>
              </button>

              <button
                type="button"
                onClick={onLogout}
                title="Sign Out"
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EC] bg-white hover:bg-[#FEF2F2] hover:border-[#FECACA] hover:text-[#B91C1C] px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-[#6F737D] transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>

          {/* Mobile outlet switcher row when multi-outlet */}
          {outletOptions && outletOptions.length > 1 && onOutletChange && (
            <div className="sm:hidden mt-2">
              <select
                aria-label="Switch assigned outlet mobile"
                value={selectedOutletId}
                disabled={isSwitchingOutlet}
                onChange={(e) => onOutletChange(e.target.value)}
                className="w-full min-h-[40px] rounded-xl bg-[#F5F6FA] border border-[#E5E7EC] px-3 py-1.5 text-xs font-medium text-[#2F3033]"
              >
                {outletOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Horizontal Scrollable Primary Tabs */}
          <nav
            aria-label="Primary workspace navigation"
            className="mt-2 pt-2 border-t border-[#F0F1F5] flex items-center gap-1.5 overflow-x-auto no-scrollbar"
          >
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`min-h-[38px] shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-[#2F3033] text-white shadow-xs'
                      : 'text-[#6F737D] hover:text-[#2F3033] hover:bg-[#F5F6FA]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {bannerError && (
        <div role="alert" className="max-w-7xl mx-auto w-full px-3.5 sm:px-6 lg:px-8 pt-4">
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs font-medium text-[#B91C1C]">
            {bannerError}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-3.5 py-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
};
