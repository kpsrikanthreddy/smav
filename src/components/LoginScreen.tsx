import React, { useState } from 'react';
import { Printer, Eye, EyeOff, LogIn, KeyRound, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { UserSession, UserOutletMembership } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (session: UserSession, redirectTo?: string) => void;
  onMultiBusinessFound: (outlets: UserOutletMembership[], tempToken: string, userId: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onMultiBusinessFound
}) => {
  const [emailOrId, setEmailOrId] = useState('');
  const [password, setPassword] = useState('');
  const [outletCode, setOutletCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Forgot Password Modal State
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOutletCode, setForgotOutletCode] = useState('');
  const [forgotStep, setForgotStep] = useState<'request' | 'reset'>('request');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOrId.trim() || !password.trim()) {
      setErrorMessage('Please enter both email/user ID and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrId: emailOrId.trim(),
          password: password.trim(),
          outletCode: outletCode.trim() || undefined,
          device_id: 'SMAV-POS-' + Math.random().toString(36).substring(2, 8).toUpperCase()
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.requiresPasswordReset) {
          setErrorMessage('Security notice: Your account requires a password reset to migrate to central auth. Click Forgot Password below.');
        } else {
          setErrorMessage(data.message || 'Invalid credentials. Please verify your details.');
        }
        setIsLoading(false);
        return;
      }

      if (data.multiBusiness && data.availableOutlets) {
        onMultiBusinessFound(data.availableOutlets, data.tempToken || '', data.availableOutlets[0]?.outletId || '');
        setIsLoading(false);
        return;
      }

      if (data.session) {
        onLoginSuccess(data.session, data.redirectTo);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setForgotMessage('Please enter your registered email address.');
      return;
    }

    setForgotLoading(true);
    setForgotMessage(null);

    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail.trim(),
          outletCode: forgotOutletCode.trim() || undefined
        })
      });

      const data = await res.json();
      if (data.success) {
        if (data.resetToken) {
          setResetToken(data.resetToken);
          setForgotStep('reset');
          setForgotMessage('Verification reset token generated. Enter your new password below.');
        } else {
          setForgotMessage(data.message || 'If registered, reset instructions have been recorded.');
        }
      } else {
        setForgotMessage(data.message || 'Failed to request password reset.');
      }
    } catch (err: any) {
      setForgotMessage(err.message || 'Error communicating with server.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim() || newPassword.length < 6) {
      setForgotMessage('Password must be at least 6 characters long.');
      return;
    }

    setForgotLoading(true);
    setForgotMessage(null);

    try {
      const res = await fetch('/api/auth/confirm-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetToken,
          newPassword: newPassword.trim()
        })
      });

      const data = await res.json();
      if (data.success) {
        setForgotSuccess(true);
        setForgotMessage('Password updated successfully! You can now sign in with your new password.');
        setTimeout(() => {
          setIsForgotModalOpen(false);
          setForgotSuccess(false);
          setForgotStep('request');
          setForgotEmail('');
          setNewPassword('');
          setResetToken('');
        }, 2200);
      } else {
        setForgotMessage(data.message || 'Failed to update password.');
      }
    } catch (err: any) {
      setForgotMessage(err.message || 'Error communicating with server.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E1B] text-slate-100 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-pink-500 selection:text-white">
      {/* Centered Login Card - Pixel-Accurate to Starters4U Restaurant Portal */}
      <div className="w-full max-w-[460px] bg-[#121629] border border-[#1e2540] rounded-3xl p-6 sm:p-8 shadow-2xl relative backdrop-blur-sm">
        
        {/* Top Centered Squircle Icon */}
        <div className="w-14 h-14 rounded-2xl bg-[#1d1f3b] border border-[#2b2f56] flex items-center justify-center mx-auto mb-4 shadow-inner">
          <Printer className="w-7 h-7 text-[#ff3b80]" />
        </div>

        {/* Branding & Subtitle */}
        <h1 className="text-xl sm:text-2xl font-bold text-white text-center tracking-tight">
          SMAV Print Agent
        </h1>
        <p className="text-xs text-slate-400 text-center mt-1 mb-6">
          Secure Multi-Business POS & Thermal Printing
        </p>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="mb-5 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 flex items-start gap-3 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">
              {errorMessage}
            </div>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Field 1: Email Address / User ID */}
          <div>
            <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
              Email Address / User ID
            </label>
            <input
              type="text"
              value={emailOrId}
              onChange={(e) => setEmailOrId(e.target.value)}
              placeholder="Enter registered email or user ID"
              className="w-full rounded-xl bg-[#161a33]/90 border border-[#2a3055] text-white placeholder-slate-500 px-4 py-3 text-sm focus:outline-none focus:border-[#ff3b80] focus:ring-1 focus:ring-[#ff3b80]/40 transition"
              autoComplete="username"
              required
            />
          </div>

          {/* Field 2: Password / PIN with Show/Hide Toggle */}
          <div>
            <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
              Password / PIN
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl bg-[#161a33]/90 border border-[#2a3055] text-white placeholder-slate-500 px-4 py-3 pr-11 text-sm focus:outline-none focus:border-[#ff3b80] focus:ring-1 focus:ring-[#ff3b80]/40 transition"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Field 3: Outlet Code (optional) */}
          <div>
            <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
              Outlet Code (optional)
            </label>
            <input
              type="text"
              value={outletCode}
              onChange={(e) => setOutletCode(e.target.value)}
              placeholder="e.g. mozz, glossylooks"
              className="w-full rounded-xl bg-[#161a33]/90 border border-[#2a3055] text-white placeholder-slate-500 px-4 py-3 text-sm focus:outline-none focus:border-[#ff3b80] focus:ring-1 focus:ring-[#ff3b80]/40 transition font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Used to identify an outlet's authentication provider when required.
            </p>
          </div>

          {/* Pink-to-Orange Gradient Button */}
          <div className="pt-2">
            <div className="p-[2px] rounded-xl bg-gradient-to-r from-[#ff1b7a] via-[#ff6a00] to-[#ffa500] shadow-lg shadow-pink-500/10">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#242938] hover:bg-[#2c3245] disabled:opacity-70 text-white font-semibold py-3 px-4 rounded-[10px] text-sm flex items-center justify-center gap-2 transition duration-200"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn className="w-4 h-4 text-white" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Footer Links & Forgot Password */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-400">
            Forgot Password?{' '}
            <button
              type="button"
              onClick={() => {
                setIsForgotModalOpen(true);
                setForgotMessage(null);
                setForgotSuccess(false);
              }}
              className="text-[#ff3b80] hover:text-[#ff6a00] font-medium underline underline-offset-2 transition"
            >
              Reset your credentials
            </button>{' '}
            or contact your outlet administrator.
          </p>
        </div>
      </div>

      {/* Forgot Password / Secure Reset Modal */}
      {isForgotModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#ff3b80]" />
                <h3 className="text-base font-bold text-white">Reset Account Password</h3>
              </div>
              <button
                onClick={() => setIsForgotModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                ✕
              </button>
            </div>

            {forgotMessage && (
              <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                forgotSuccess
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                  : 'bg-sky-500/15 border border-sky-500/30 text-sky-200'
              }`}>
                {forgotSuccess ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 text-sky-400 mt-0.5" />}
                <p>{forgotMessage}</p>
              </div>
            )}

            {forgotStep === 'request' ? (
              <form onSubmit={handleRequestReset} className="space-y-3.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enter your registered email address. The central SMAV authentication gateway will generate a secure time-limited token.
                </p>
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">Registered Email</label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="e.g. ananya@glossylooks.com"
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">Outlet Code (optional)</label>
                  <input
                    type="text"
                    value={forgotOutletCode}
                    onChange={(e) => setForgotOutletCode(e.target.value)}
                    placeholder="e.g. glossylooks, mozz"
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsForgotModalOpen(false)}
                    className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-white shadow"
                  >
                    {forgotLoading ? 'Verifying...' : 'Request Token'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">Verification Token</label>
                  <input
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-slate-300 px-3.5 py-2.5 text-xs font-mono"
                    readOnly
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter at least 6 characters"
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setForgotStep('request')}
                    className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading || forgotSuccess}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-white shadow"
                  >
                    {forgotLoading ? 'Updating...' : 'Set New Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
