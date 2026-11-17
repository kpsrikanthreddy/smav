import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, LogIn, Printer } from 'lucide-react';
import { UserOutletMembership, UserSession } from '../types';
import { BASE_INPUT_CLASS, Button, Card, FormField, PasswordField } from './ui';

interface LoginScreenProps {
  onLoginSuccess: (session: UserSession, redirectTo?: string) => void;
  onMultiBusinessFound: (outlets: UserOutletMembership[], tempToken: string, userId: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onMultiBusinessFound,
}) => {
  const [emailOrId, setEmailOrId] = useState('');
  const [password, setPassword] = useState('');
  const [outletCode, setOutletCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

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

  // Forced first-login temporary password change state
  const [passwordChangeState, setPasswordChangeState] = useState<{
    token: string;
    email: string;
    outletCode?: string;
  } | null>(null);
  const [firstLoginNewPassword, setFirstLoginNewPassword] = useState('');
  const [firstLoginConfirmPassword, setFirstLoginConfirmPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOrId.trim() || !password.trim()) {
      setErrorMessage('Please enter both your email address (or username) and password.');
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
          device_id: 'SMAV-POS-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.requiresPasswordChange && data.passwordChangeToken) {
          setPasswordChangeState({
            token: data.passwordChangeToken,
            email: data.email || emailOrId.trim(),
            outletCode: outletCode.trim() || undefined,
          });
          setFirstLoginNewPassword('');
          setFirstLoginConfirmPassword('');
          setErrorMessage(null);
          setIsLoading(false);
          return;
        }
        if (data.requiresPasswordReset) {
          setErrorMessage(
            'Security notice: Your account requires a password reset to migrate to central auth. Click Reset your credentials below.'
          );
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
        onMultiBusinessFound(
          data.availableOutlets,
          data.tempToken || '',
          data.userId || data.session?.userId || ''
        );
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

  const handleCompleteFirstLoginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordChangeState) return;
    if (firstLoginNewPassword.length < 8) {
      setErrorMessage('Your new personal password must be at least 8 characters long.');
      return;
    }
    if (firstLoginNewPassword !== firstLoginConfirmPassword) {
      setErrorMessage('Passwords do not match. Please confirm your new password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/complete-first-login-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passwordChangeToken: passwordChangeState.token,
          newPassword: firstLoginNewPassword,
          outletCode: passwordChangeState.outletCode,
          device_id: 'SMAV-POS-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.message || 'Unable to set new password. Please sign in again.');
        setIsLoading(false);
        return;
      }

      setPasswordChangeState(null);
      setFirstLoginNewPassword('');
      setFirstLoginConfirmPassword('');

      if (data.multiBusiness && data.availableOutlets) {
        onMultiBusinessFound(
          data.availableOutlets,
          data.tempToken || '',
          data.userId || data.session?.userId || ''
        );
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
          outletCode: forgotOutletCode.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.resetToken) {
          setResetToken(data.resetToken);
          setForgotStep('reset');
          setForgotMessage('Verification reset token generated. Enter your new password below.');
        } else {
          setForgotSuccess(true);
          setForgotMessage(
            data.message ||
              'If that email is registered in Central SMAV Auth, a password reset email has been sent. You can also ask your outlet ADMIN or SUPERADMIN to set a temporary password.'
          );
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
          newPassword: newPassword.trim(),
        }),
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
    <div className="min-h-screen w-full bg-[#F5F6FA] flex items-center justify-center p-4 sm:p-6 text-[#2F3033] font-sans safe-bottom">
      <Card padding="lg" className="w-full max-w-[420px] shadow-[0_8px_28px_rgba(16,24,40,0.06)]">
        {/* Compact Brand Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF1B7A] via-[#FF6A00] to-[#FFA500] flex items-center justify-center mb-3 shadow-sm">
            <Printer className="w-6 h-6 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[#2F3033]">SMAV Print Agent</h1>
          <p className="text-xs text-[#6F737D] mt-0.5">Secure Enterprise Authentication Gateway</p>
        </div>

        {/* Inline Error Display */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-[#DC2626] mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium leading-snug">{errorMessage}</p>
              {errorDetails && (
                <pre className="mt-2 text-[10px] bg-white border border-[#FECACA] p-2 rounded-lg overflow-x-auto text-[#7F1D1D] font-mono">
                  {errorDetails}
                </pre>
              )}
            </div>
          </div>
        )}

        {passwordChangeState ? (
          <form onSubmit={handleCompleteFirstLoginPassword} className="space-y-3.5">
            <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-[#B45309]">
                <KeyRound className="w-4 h-4" />
                <span>Password Change Required</span>
              </div>
              <p className="leading-relaxed">
                Signed in with a temporary password for{' '}
                <span className="font-mono font-semibold text-[#2F3033]">{passwordChangeState.email}</span>. Choose a personal password to continue.
              </p>
            </div>

            <PasswordField
              id="first-login-new-password"
              label="New Personal Password (min. 8 characters)"
              value={firstLoginNewPassword}
              onChange={(e) => setFirstLoginNewPassword(e.target.value)}
              placeholder="Enter new password"
              minLength={8}
              required
              autoFocus
            />

            <PasswordField
              id="first-login-confirm-password"
              label="Confirm New Password"
              value={firstLoginConfirmPassword}
              onChange={(e) => setFirstLoginConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              minLength={8}
              required
            />

            <div className="pt-1 space-y-2">
              <Button
                type="submit"
                fullWidth
                size="lg"
                loading={isLoading}
                leftIcon={<KeyRound className="w-4 h-4" />}
              >
                Set Password &amp; Sign In
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                size="sm"
                onClick={() => {
                  setPasswordChangeState(null);
                  setErrorMessage(null);
                }}
              >
                Back to Sign In
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <FormField label="Email Address or Username" htmlFor="login-email-or-id" required>
              <input
                id="login-email-or-id"
                type="text"
                value={emailOrId}
                onChange={(e) => setEmailOrId(e.target.value)}
                placeholder="name@company.com or username"
                autoComplete="username"
                required
                autoFocus
                className={BASE_INPUT_CLASS}
              />
            </FormField>

            <PasswordField
              id="login-password"
              label="Password / PIN"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />

            <FormField
              label="Outlet Code (optional)"
              htmlFor="login-outlet-code"
              hint="Used to identify an outlet's authentication provider when required."
            >
              <input
                id="login-outlet-code"
                type="text"
                value={outletCode}
                onChange={(e) => setOutletCode(e.target.value)}
                placeholder="e.g. mozz, glossylooks"
                className={`${BASE_INPUT_CLASS} font-mono`}
              />
            </FormField>

            <div className="pt-1">
              <Button
                type="submit"
                fullWidth
                size="lg"
                loading={isLoading}
                leftIcon={<LogIn className="w-4 h-4" />}
              >
                Sign In
              </Button>
            </div>
          </form>
        )}

        <div className="mt-4 pt-3.5 border-t border-[#F0F1F5] text-center">
          <p className="text-xs text-[#6F737D]">
            Forgot Password?{' '}
            <button
              type="button"
              onClick={() => {
                setIsForgotModalOpen(true);
                setForgotMessage(null);
                setForgotSuccess(false);
              }}
              className="text-[#FF1B7A] hover:text-[#FF6A00] font-semibold underline underline-offset-2 transition cursor-pointer"
            >
              Reset your credentials
            </button>
          </p>
        </div>
      </Card>

      {/* Forgot Password / Secure Reset Modal */}
      {isForgotModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EC]">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#FF1B7A]" />
                <h3 className="text-base font-bold text-[#2F3033]">Reset Account Password</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsForgotModalOpen(false)}
                aria-label="Close password reset dialog"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:text-[#2F3033] hover:bg-[#F5F6FA] transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {forgotMessage && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                  forgotSuccess
                    ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                    : 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]'
                }`}
              >
                {forgotSuccess ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <p className="leading-relaxed">{forgotMessage}</p>
              </div>
            )}

            {forgotStep === 'request' ? (
              <form onSubmit={handleRequestReset} className="space-y-3.5">
                <p className="text-xs text-[#6F737D] leading-relaxed">
                  Enter your registered email address. The central SMAV authentication gateway will issue a reset flow or generate a time-limited token.
                </p>
                <FormField label="Registered Email" htmlFor="forgot-email" required>
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    className={BASE_INPUT_CLASS}
                  />
                </FormField>
                <FormField label="Outlet Code (optional)" htmlFor="forgot-outlet-code">
                  <input
                    id="forgot-outlet-code"
                    type="text"
                    value={forgotOutletCode}
                    onChange={(e) => setForgotOutletCode(e.target.value)}
                    placeholder="e.g. glossylooks, mozz"
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <div className="pt-1 flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setIsForgotModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" loading={forgotLoading}>
                    Request Reset
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} className="space-y-3.5">
                <p className="text-xs text-[#6F737D] leading-relaxed">
                  Set a new password for your account across authorized SMAV outlets.
                </p>
                <PasswordField
                  id="forgot-new-password"
                  label="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter at least 6 characters"
                  required
                  minLength={6}
                />
                <div className="pt-1 flex items-center justify-between gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setForgotStep('request')}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    loading={forgotLoading}
                    disabled={forgotSuccess}
                  >
                    Set New Password
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
