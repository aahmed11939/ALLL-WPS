import { useEffect } from "react";
import { useLocation } from "wouter";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";

interface Props {
  checkoutResult?: "success" | "cancel" | null;
}

export default function LandingPage({ checkoutResult }: Props) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (checkoutResult === "cancel") {
      const id = setTimeout(() => setLocation("/subscribe?cancelled=true"), 2000);
      return () => clearTimeout(id);
    }
  }, [checkoutResult, setLocation]);

  if (checkoutResult === "cancel") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center max-w-sm px-6">
          <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg className="h-6 w-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Checkout cancelled</h2>
          <p className="text-sm text-slate-500">No payment was made. Redirecting you back…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Nav */}
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-4 shadow-sm">
        <img src={wpsLogo} alt="ALLL WPS Designer" className="h-9 w-auto" />
        <div>
          <p className="text-sm font-bold text-slate-900 leading-tight">ALLL WPS Designer</p>
          <p className="text-[10px] text-slate-400 font-mono">Municipal Drinking-Water Pump Station</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLocation("/sign-in")}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setLocation("/subscribe")}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition-colors shadow-sm"
          >
            Subscribe — $4,999/year
          </button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-8">
          <img src={wpsLogo} alt="ALLL WPS Designer" className="h-20 w-auto mx-auto mb-6" />
          <h1 className="text-4xl font-bold text-slate-900 mb-4 max-w-2xl">
            Engineering-grade pump station design in your browser
          </h1>
          <p className="text-lg text-slate-500 max-w-xl mx-auto leading-relaxed">
            ALLL WPS Designer gives municipal engineers the tools to size, analyse, and document
            drinking-water pump stations — from hydraulic surge to professional PDF/Excel reports.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-16">
          <button
            type="button"
            onClick={() => setLocation("/subscribe")}
            className="rounded-xl bg-teal-700 px-8 py-3.5 text-base font-semibold text-white hover:bg-teal-600 transition-colors shadow-md"
          >
            Subscribe — $4,999/year
          </button>
          <button
            type="button"
            onClick={() => setLocation("/sign-in")}
            className="rounded-xl border border-slate-300 bg-white px-8 py-3.5 text-base font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Sign in
          </button>
        </div>

        {/* Feature grid */}
        <div className="grid sm:grid-cols-3 gap-6 max-w-3xl w-full text-left">
          {[
            {
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              ),
              title: "Hydraulic Analysis",
              desc: "Darcy-Weisbach friction losses, minor losses, TDH calculations with system curve generation.",
            },
            {
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              ),
              title: "Surge Protection",
              desc: "Method of Characteristics transient analysis with what-if device comparison.",
            },
            {
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              ),
              title: "Professional Reports",
              desc: "Export complete design documentation as PDF or Excel for project submittal packages.",
            },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="h-10 w-10 rounded-lg bg-teal-50 flex items-center justify-center mb-4">
                <svg className="h-5 w-5 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {icon}
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 mb-1.5">{title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-[11px] text-slate-400 font-mono">
        ALLL WPS Designer · © 2026 · $4,999/year per seat
        {" · "}
        <a href="mailto:Support@alll-ai.com" className="text-teal-600 hover:text-teal-700 hover:underline">
          Support@alll-ai.com
        </a>
      </footer>
    </div>
  );
}
