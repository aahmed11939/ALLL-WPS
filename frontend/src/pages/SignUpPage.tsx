import { useState } from "react";
import { useSignUp, useAuth } from "@clerk/react";
import { useLocation, Link } from "wouter";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";

type Step = "credentials" | "verify";

export default function SignUpPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { signUp, errors, fetchStatus } = useSignUp();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [globalError, setGlobalError] = useState<string | null>(null);

  if (isLoaded && isSignedIn) {
    setLocation("/app");
    return null;
  }

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) {
      setGlobalError(error.message ?? "Could not create account. Please try again.");
      return;
    }
    const { error: sendError } = await signUp.verifications.sendEmailCode();
    if (sendError) {
      setGlobalError(sendError.message ?? "Could not send verification code. Please try again.");
      return;
    }
    setStep("verify");
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) {
      setGlobalError(error.message ?? "Verification failed. Please check the code and try again.");
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
    if (error) {
      setGlobalError(error.message ?? "Could not resend code. Please try again.");
    }
  };

  const isLoading = fetchStatus === "fetching";

  const brandPanel = (
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
  );

  return (
    <div className="flex min-h-screen">
      {brandPanel}

      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src={wpsLogo} alt="ALLL WPS Designer" className="h-12 w-auto mb-3" />
            <h1 className="text-xl font-bold text-slate-900">ALLL WPS Designer</h1>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
            {step === "credentials" ? (
              <>
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Create your account</h2>
                <p className="text-sm text-slate-500 mb-6">
                  Get started with ALLL WPS Designer
                </p>

                <form onSubmit={handleCredentials} className="space-y-4">
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
                    {errors.fields.emailAddress && (
                      <p className="mt-1 text-xs text-rose-600">
                        {errors.fields.emailAddress.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a strong password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 pr-10 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        tabIndex={-1}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showPassword ? (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {errors.fields.password && (
                      <p className="mt-1 text-xs text-rose-600">
                        {errors.fields.password.message}
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
                    disabled={isLoading || !email || !password}
                    className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
                  >
                    {isLoading ? "Creating account…" : "Create account"}
                  </button>
                </form>

                <div id="clerk-captcha" />

                <p className="mt-6 text-center text-sm text-slate-500">
                  Already have an account?{" "}
                  <Link href="/sign-in" className="text-teal-700 font-semibold hover:text-teal-600">
                    Sign in
                  </Link>
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Verify your email</h2>
                <p className="text-sm text-slate-500 mb-6">
                  We sent a code to <span className="font-medium text-slate-700">{email}</span>.
                  Enter it below to continue.
                </p>

                <form onSubmit={handleVerify} className="space-y-4">
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
                    {errors.fields.code && (
                      <p className="mt-1 text-xs text-rose-600">{errors.fields.code.message}</p>
                    )}
                  </div>

                  {globalError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                      <p className="text-xs text-rose-700">{globalError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || code.length < 6}
                    className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? "Verifying…" : "Verify email"}
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isLoading}
                    className="text-teal-700 font-medium hover:text-teal-600 disabled:opacity-50 transition-colors"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("credentials"); setCode(""); setGlobalError(null); }}
                    className="text-slate-500 hover:text-slate-700 transition-colors"
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
  );
}
