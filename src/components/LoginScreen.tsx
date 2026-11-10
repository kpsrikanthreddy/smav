import React, { useState, useEffect } from 'react';
import {
  Printer,
  Eye,
  EyeOff,
  LogIn,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  Database,
  Settings2,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Terminal
} from 'lucide-react';
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
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  // Central Supabase Connection Status
  const [supabaseStatus, setSupabaseStatus] = useState<any>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [projectUrlInput, setProjectUrlInput] = useState('');
  const [publishableKeyInput, setPublishableKeyInput] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  // Verification Testing Modal Tab
  const [activeConfigTab, setActiveConfigTab] = useState<'status' | 'verify' | 'settings'>('status');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

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

  const fetchSupabaseStatus = async () => {
    try {
      const res = await fetch('/api/central-supabase/status');
      if (res.ok) {
        const data = await res.json();
        setSupabaseStatus(data);
        if (data.fullUrl && !projectUrlInput) {
          setProjectUrlInput(data.fullUrl);
        }
      }
    } catch (_e) {}
  };

  useEffect(() => {
    fetchSupabaseStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOrId.trim() || !password.trim()) {
      setErrorMessage('Please enter both email/user ID and password.');
      setErrorDetails(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setErrorDetails(null);

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
        if (data.diagnostics) {
          setErrorDetails(JSON.stringify(data.diagnostics, null, 2));
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

  const handleSaveSupabaseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectUrlInput.trim() || !publishableKeyInput.trim()) {
      setConfigMessage('Both Project URL and Publishable Anon Key are required.');
      return;
    }

    setConfigSaving(true);
    setConfigMessage(null);

    try {
      const res = await fetch('/api/central-supabase/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectUrl: projectUrlInput.trim(),
          publishableKey: publishableKeyInput.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setConfigMessage('Central Supabase connected & saved successfully!');
        fetchSupabaseStatus();
      } else {
        setConfigMessage(data.message || 'Failed to update configuration.');
      }
    } catch (err: any) {
      setConfigMessage(err.message || 'Error updating configuration.');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleRunRealLoginVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyEmail.trim() || !verifyPassword.trim()) return;

    setVerifyLoading(true);
    setVerifyResult(null);

    try {
      const res = await fetch('/api/central-supabase/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: verifyEmail.trim(),
          password: verifyPassword.trim()
        })
      });

      const data = await res.json();
      setVerifyResult(data);
      fetchSupabaseStatus();
    } catch (err: any) {
      setVerifyResult({
        success: false,
        message: err.message || 'Network error running verification'
      });
    } finally {
      setVerifyLoading(false);
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
        setForgotMessage('Password successfully updated. You may now sign in with your new password.');
        setTimeout(() => {
          setIsForgotModalOpen(false);
          setForgotStep('request');
          setNewPassword('');
          setResetToken('');
        }, 2200);
      } else {
        setForgotMessage(data.message || 'Failed to update password.');
      }
    } catch (err: any) {
      setForgotMessage(err.message || 'Error confirming reset.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0d1021] flex flex-col items-center justify-center p-4 sm:p-6 text-slate-100 font-sans selection:bg-pink-500 selection:text-white relative">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-radial from-[#1e1b4b]/20 via-[#0d1021] to-[#0d1021] pointer-events-none" />

      {/* Main Centered Login Card */}
      <div className="w-full max-w-[440px] bg-[#121629] border border-[#1e2540] rounded-[24px] shadow-2xl p-7 sm:p-9 relative z-10">
        {/* Top Header / Branding */}
        <div className="flex flex-col items-center text-center mb-7">
          {/* Centered Printer Icon inside rounded squircle */}
          <div className="w-14 h-14 rounded-2xl bg-[#1b2038] border border-[#2d365e] flex items-center justify-center mb-4 shadow-inner">
            <Printer className="w-7 h-7 text-[#ff3b80]" strokeWidth={2.2} />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            SMAV Print Agent
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Secure Enterprise Authentication Gateway
          </p>

          {/* Central Supabase Status Badge */}
          <button
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#171c38] hover:bg-[#1f264d] border border-[#2b3561] text-slate-300 transition"
          >
            <span className={`w-2 h-2 rounded-full ${supabaseStatus?.isConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>Central Supabase: {supabaseStatus?.isConfigured ? 'Active' : 'Configure'}</span>
            <ChevronRight className="w-3 h-3 text-slate-400" />
          </button>
        </div>

        {/* Error Alert Display */}
        {errorMessage && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">{errorMessage}</p>
              {errorDetails && (
                <pre className="mt-2 text-[10px] bg-black/40 p-2 rounded overflow-x-auto text-rose-300 font-mono">
                  {errorDetails}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Login Form */}
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
              required
              autoFocus
              className="w-full rounded-xl bg-[#161a33]/90 border border-[#2a3055] text-white placeholder-slate-500 px-4 py-3 text-sm focus:outline-none focus:border-[#ff3b80] focus:ring-1 focus:ring-[#ff3b80]/40 transition"
            />
          </div>

          {/* Field 2: Password / PIN with show/hide control */}
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
                required
                className="w-full rounded-xl bg-[#161a33]/90 border border-[#2a3055] text-white placeholder-slate-500 px-4 py-3 pr-11 text-sm focus:outline-none focus:border-[#ff3b80] focus:ring-1 focus:ring-[#ff3b80]/40 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition p-1"
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
        <div className="mt-6 text-center space-y-2">
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

      {/* Central Supabase Gateway Connection & Verification Modal */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-[#ff3b80]" />
                <h3 className="text-base font-bold text-white">Central SMAV Supabase Gateway</h3>
              </div>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                ✕
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveConfigTab('status')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${activeConfigTab === 'status' ? 'bg-[#ff3b80]/20 text-[#ff3b80] border border-[#ff3b80]/30' : 'text-slate-400 hover:text-white'}`}
              >
                Project Status & Tables
              </button>
              <button
                type="button"
                onClick={() => setActiveConfigTab('verify')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${activeConfigTab === 'verify' ? 'bg-[#ff3b80]/20 text-[#ff3b80] border border-[#ff3b80]/30' : 'text-slate-400 hover:text-white'}`}
              >
                Verify Real Superadmin Login
              </button>
              <button
                type="button"
                onClick={() => setActiveConfigTab('settings')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${activeConfigTab === 'settings' ? 'bg-[#ff3b80]/20 text-[#ff3b80] border border-[#ff3b80]/30' : 'text-slate-400 hover:text-white'}`}
              >
                Environment Settings
              </button>
            </div>

            {/* Tab 1: Project Status & Tables */}
            {activeConfigTab === 'status' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#161a33] border border-[#2a3055] space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Gateway Status:</span>
                    <span className={`font-semibold ${supabaseStatus?.isConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {supabaseStatus?.isConfigured ? 'CONNECTED & AUTHORITATIVE' : 'CONFIG REQUIRED'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Project URL:</span>
                    <span className="font-mono text-slate-200">{supabaseStatus?.projectUrl || 'Not configured'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Publishable Key:</span>
                    <span className="font-mono text-slate-200">{supabaseStatus?.publishableKeyPreview || 'None'}</span>
                  </div>
                </div>

                {/* Table Schema Check */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Authoritative Database Schemas
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { name: 'public.smav_outlets', desc: 'Central outlet registry' },
                      { name: 'public.smav_profiles', desc: 'Superadmin & user profiles (RLS)' },
                      { name: 'public.smav_user_outlet_roles', desc: 'Tenant membership & roles' },
                      { name: 'public.smav_devices', desc: 'Authorized hardware devices' },
                      { name: 'public.smav_audit_logs', desc: 'Security audit trail' }
                    ].map((tbl) => (
                      <div key={tbl.name} className="p-2.5 rounded-xl bg-[#161a33]/60 border border-[#232947] flex items-center justify-between">
                        <div>
                          <div className="font-mono font-medium text-slate-200">{tbl.name}</div>
                          <div className="text-[10px] text-slate-400">{tbl.desc}</div>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs">
                  <p className="leading-relaxed">
                    <strong>RLS Policy:</strong> Users can read strictly their own profile via <code>auth.uid() = id</code>. Superadmin platform role is verified server-side.
                  </p>
                </div>
              </div>
            )}

            {/* Tab 2: Verify Real Superadmin Login (Requirement 13) */}
            {activeConfigTab === 'verify' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Test your real Superadmin credentials against the central Supabase Auth and <code>public.smav_profiles</code> table.
                </p>

                <form onSubmit={handleRunRealLoginVerification} className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1 block">Superadmin Email</label>
                    <input
                      type="email"
                      value={verifyEmail}
                      onChange={(e) => setVerifyEmail(e.target.value)}
                      placeholder="e.g. superadmin@smav.io"
                      required
                      className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-pink-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1 block">Superadmin Password</label>
                    <input
                      type="password"
                      value={verifyPassword}
                      onChange={(e) => setVerifyPassword(e.target.value)}
                      placeholder="Enter password"
                      required
                      className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-pink-500"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={verifyLoading}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-white flex items-center gap-1.5 shadow"
                    >
                      {verifyLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      <span>Verify Real Supabase Login</span>
                    </button>
                  </div>
                </form>

                {verifyResult && (
                  <div className={`p-3.5 rounded-xl text-xs space-y-2 border ${verifyResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-200'}`}>
                    <div className="flex items-center gap-2 font-semibold">
                      {verifyResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                      <span>{verifyResult.message}</span>
                    </div>

                    {verifyResult.diagnostics && (
                      <div className="space-y-1 font-mono text-[11px] pt-1">
                        <div>Step 1 (Supabase Auth signInWithPassword): {verifyResult.diagnostics.step1_auth?.status || 'SKIPPED'}</div>
                        <div>Step 2 (RLS Profile smav_profiles): {verifyResult.diagnostics.step2_profile?.status || 'SKIPPED'}</div>
                        <div>Step 3 (platform_role = SUPERADMIN): {verifyResult.diagnostics.step3_role_check?.status || 'SKIPPED'}</div>
                        <div>Step 4 (is_active = true): {verifyResult.diagnostics.step4_active_check?.status || 'SKIPPED'}</div>
                        <div>Step 5 (Redirect to /superadmin/outlets): {verifyResult.diagnostics.step5_redirection?.status || 'SKIPPED'}</div>
                      </div>
                    )}

                    {verifyResult.success && verifyResult.session && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsConfigModalOpen(false);
                          onLoginSuccess(verifyResult.session, verifyResult.redirectTo);
                        }}
                        className="mt-2 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs transition flex items-center justify-center gap-1.5"
                      >
                        <span>Launch Superadmin Dashboard</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Environment Settings */}
            {activeConfigTab === 'settings' && (
              <form onSubmit={handleSaveSupabaseConfig} className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Configure the central Supabase project URL and publishable key (never use the secret service-role key).
                </p>

                {configMessage && (
                  <div className="p-3 rounded-xl bg-pink-500/15 border border-pink-500/30 text-pink-200 text-xs">
                    {configMessage}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">
                    Central Supabase Project URL (SMAV_SUPABASE_URL)
                  </label>
                  <input
                    type="url"
                    value={projectUrlInput}
                    onChange={(e) => setProjectUrlInput(e.target.value)}
                    placeholder="https://your-project-id.supabase.co"
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">
                    Central Supabase Publishable Key (SMAV_SUPABASE_ANON_KEY)
                  </label>
                  <input
                    type="password"
                    value={publishableKeyInput}
                    onChange={(e) => setPublishableKeyInput(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs font-mono focus:outline-none focus:border-pink-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Safe publishable anon key. Server-side proxy enforces Superadmin privileges.
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsConfigModalOpen(false)}
                    className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={configSaving}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-white shadow"
                  >
                    {configSaving ? 'Saving...' : 'Save & Verify Connection'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

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
                    {forgotLoading ? 'Processing...' : 'Request Reset Token'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} className="space-y-3.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Set a new password for your account. This will update your credentials across authorized SMAV outlets.
                </p>
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter at least 6 characters"
                    required
                    minLength={6}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setForgotStep('request')}
                    className="text-xs text-slate-400 hover:text-white"
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
