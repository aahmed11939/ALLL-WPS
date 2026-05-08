import { useState, useEffect } from "react";
import { useSignIn, useSignUp, useAuth } from "@clerk/react";
import { useLocation } from "wouter";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";

// ── Standalone sub-components (defined at module level to avoid remount on re-render) ──

function EyeOpen() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
    </svg>
  );
}

interface PasswordFieldProps {
  value: string;
  onChange: (v: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
}

function PasswordField({
  value,
  onChange,
  showPassword,
  onToggleShow,
  placeholder = "Enter your password",
  autoComplete = "current-password",
  minLength,
}: PasswordFieldProps) {
  return (
    <div className="relative">
      <input
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 pr-10 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none transition-colors"
      />
      <button
        type="button"
        onClick={onToggleShow}
        tabIndex={-1}
        aria-label={showPassword ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
      >
        {showPassword ? <EyeOff /> : <EyeOpen />}
      </button>
    </div>
  );
}

type Tab = "sign-in" | "sign-up";
type SignUpStep = "credentials" | "verify";

interface Props {
  defaultTab?: Tab;
}

export default function AuthPage({ defaultTab = "sign-in" }: Props) {
  const { isSignedIn, isLoaded } = useAuth();
  const { signIn, errors: signInErrors, fetchStatus: signInFetch } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetch } = useSignUp();
  const [, setLocation] = useLocation();

  const [tab, setTab] = useState<Tab>(defaultTab);
  const [signUpStep, setSignUpStep] = useState<SignUpStep>("credentials");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setLocation("/app");
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (isLoaded && isSignedIn) return null;

  const switchTab = (t: Tab) => {
    setTab(t);
    setGlobalError(null);
    setEmail("");
    setPassword("");
    setCode("");
    setShowPassword(false);
    setSignUpStep("credentials");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) {
      setGlobalError(error.message ?? "Sign-in failed. Please try again.");
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/app");
          if (url.startsWith("http")) {
            window.location.href = url;
          } else {
            setLocation(url);
          }
        },
      });
    }
  };

  const handleSignUpCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) {
      setGlobalError(error.message ?? "Could not create account. Please try again.");
      return;
    }
    const { error: sendError } = await signUp.verifications.sendEmailCode();
    if (sendError) {
      setGlobalError(sendError.message ?? "Could not send verification code.");
      return;
    }
    setSignUpStep("verify");
  };

  const handleSignUpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) {
      setGlobalError(error.message ?? "Verification failed. Check the code and try again.");
      return;
    }
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/app");
          if (url.startsWith("http")) {
            window.location.href = url;
          } else {
            setLocation(url);
          }
        },
      });
    }
  };

  const handleResend = async () => {
    setGlobalError(null);
    const { error } = await signUp.verifications.sendEmailCode();
    if (error) setGlobalError(error.message ?? "Could not resend code.");
  };

  const isSignInLoading = signInFetch === "fetching";
  const isSignUpLoading = signUpFetch === "fetching";

  return (
    <div className="flex min-h-screen">
      {/* Brand panel — hidden on small screens */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-teal-700 px-12 text-white">
        <img src={wpsLogo} alt="ALLL WPS Designer" className="h-16 w-auto mb-8" />
        <h1 className="text-3xl font-bold mb-3">ALLL WPS Designer</h1>
        <p className="text-teal-200 text-center text-lg leading-relaxed max-w-sm">
          Engineering-grade municipal drinking-water pump station design
        </p>
        <div className="mt-12 space-y-3 text-sm text-teal-100 w-full max-w-xs">
          {[
            "Hydraulic surge analysis (MOC)",
            "Pump selection & system curves",
            "Professional PDF/Excel reports",
          ].map((f) => (
            <div key={f} className="flex items-center gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-teal-300 shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src={wpsLogo} alt="ALLL WPS Designer" className="h-12 w-auto mb-3" />
            <h1 className="text-xl font-bold text-slate-900">ALLL WPS Designer</h1>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Tab switcher */}
            {signUpStep === "credentials" && (
              <div className="flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => switchTab("sign-in")}
                  className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                    tab === "sign-in"
                      ? "text-teal-700 border-b-2 border-teal-700 bg-white"
                      : "text-slate-500 hover:text-slate-700 bg-slate-50"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("sign-up")}
                  className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                    tab === "sign-up"
                      ? "text-teal-700 border-b-2 border-teal-700 bg-white"
                      : "text-slate-500 hover:text-slate-700 bg-slate-50"
                  }`}
                >
                  Sign up
                </button>
              </div>
            )}

            <div className="p-8">
              {/* ── SIGN IN ── */}
              {tab === "sign-in" && (
                <>
                  <h2 className="text-xl font-bold text-slate-900 mb-1">Welcome back</h2>
                  <p className="text-sm text-slate-500 mb-6">
                    Sign in to your ALLL WPS Designer account
                  </p>

                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Email address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        autoComplete="email"
                        required
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none transition-colors"
                      />
                      {signInErrors.fields.identifier && (
                        <p className="mt-1 text-xs text-rose-600">
                          {signInErrors.fields.identifier.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Password
                      </label>
                      <PasswordField
                        value={password}
                        onChange={setPassword}
                        showPassword={showPassword}
                        onToggleShow={() => setShowPassword((v) => !v)}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                      />
                      {signInErrors.fields.password && (
                        <p className="mt-1 text-xs text-rose-600">
                          {signInErrors.fields.password.message}
                        </p>
                      )}
                    </div>

                    {globalError && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                        <p className="text-xs text-rose-700">{globalError}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSignInLoading || !email || !password}
                      className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
                    >
                      {isSignInLoading ? "Signing in…" : "Sign in"}
                    </button>
                  </form>
                </>
              )}

              {/* ── SIGN UP — credentials step ── */}
              {tab === "sign-up" && signUpStep === "credentials" && (
                <>
                  <h2 className="text-xl font-bold text-slate-900 mb-1">Create your account</h2>
                  <p className="text-sm text-slate-500 mb-6">
                    Get started with ALLL WPS Designer
                  </p>

                  <form onSubmit={handleSignUpCredentials} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Email address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        autoComplete="email"
                        required
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none transition-colors"
                      />
                      {signUpErrors.fields.emailAddress && (
                        <p className="mt-1 text-xs text-rose-600">
                          {signUpErrors.fields.emailAddress.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Password
                      </label>
                      <PasswordField
                        value={password}
                        onChange={setPassword}
                        showPassword={showPassword}
                        onToggleShow={() => setShowPassword((v) => !v)}
                        placeholder="Create a strong password"
                        autoComplete="new-password"
                        minLength={8}
                      />
                      {signUpErrors.fields.password && (
                        <p className="mt-1 text-xs text-rose-600">
                          {signUpErrors.fields.password.message}
                        </p>
                      )}
                    </div>

                    {globalError && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                        <p className="text-xs text-rose-700">{globalError}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSignUpLoading || !email || !password}
                      className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
                    >
                      {isSignUpLoading ? "Creating account…" : "Create account"}
                    </button>
                  </form>

                  <div id="clerk-captcha" />
                </>
              )}

              {/* ── SIGN UP — email verification step ── */}
              {tab === "sign-up" && signUpStep === "verify" && (
                <>
                  <h2 className="text-xl font-bold text-slate-900 mb-1">Verify your email</h2>
                  <p className="text-sm text-slate-500 mb-6">
                    We sent a code to{" "}
                    <span className="font-medium text-slate-700">{email}</span>.
                    Enter it below to continue.
                  </p>

                  <form onSubmit={handleSignUpVerify} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Verification code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000"
                        maxLength={6}
                        required
                        autoFocus
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 tracking-widest text-center focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none transition-colors"
                      />
                      {signUpErrors.fields.code && (
                        <p className="mt-1 text-xs text-rose-600">
                          {signUpErrors.fields.code.message}
                        </p>
                      )}
                    </div>

                    {globalError && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                        <p className="text-xs text-rose-700">{globalError}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSignUpLoading || code.length < 6}
                      className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSignUpLoading ? "Verifying…" : "Verify email"}
                    </button>
                  </form>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={isSignUpLoading}
                      className="text-teal-700 font-medium hover:text-teal-600 disabled:opacity-50 transition-colors"
                    >
                      Resend code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignUpStep("credentials");
                        setCode("");
                        setGlobalError(null);
                      }}
                      className="text-slate-500 hover:text-slate-700 transition-colors text-xs"
                    >
                      ← Change email
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
