import { Link } from "wouter";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Nav */}
      <header className="shrink-0 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <img src={wpsLogo} alt="ALLL WPS Designer" className="h-9 w-auto" />
          <span className="text-white font-bold text-sm tracking-tight">ALLL WPS Designer</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm text-slate-300 hover:text-white transition-colors font-medium px-4 py-2"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="text-sm bg-teal-600 hover:bg-teal-500 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Get Access
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-teal-900/50 border border-teal-700/50 px-4 py-1.5 text-xs font-medium text-teal-300 mb-8">
          <div className="h-1.5 w-1.5 rounded-full bg-teal-400" />
          Municipal Drinking-Water Infrastructure
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight max-w-3xl mb-6">
          Pump Station Design,{" "}
          <span className="text-teal-400">Engineering Grade</span>
        </h1>

        <p className="text-lg text-slate-400 leading-relaxed max-w-xl mb-10">
          ALLL WPS Designer is a professional tool for hydraulic analysis, surge protection,
          pump selection, and report generation for municipal water pump stations.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/sign-in"
            className="rounded-xl bg-teal-600 hover:bg-teal-500 px-8 py-3.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-teal-900/40"
          >
            Sign In to Your Account
          </Link>
          <Link
            href="/sign-up"
            className="rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-800 hover:bg-slate-700 px-8 py-3.5 text-sm font-semibold text-slate-300 transition-colors"
          >
            Request Access
          </Link>
        </div>

        {/* Features grid */}
        <div className="mt-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl w-full">
          {[
            {
              icon: "💧",
              title: "Surge Analysis",
              desc: "Method of characteristics (MOC) water hammer for Mode A, Mode B & suction-surge scenarios",
            },
            {
              icon: "⚙️",
              title: "Pump Selection",
              desc: "System curve generation, operating point overlay and pump-duty analysis",
            },
            {
              icon: "📐",
              title: "Hydraulic Design",
              desc: "Pipe sizing, friction losses, Darcy-Weisbach and Hazen-Williams",
            },
            {
              icon: "📄",
              title: "Export Reports",
              desc: "Professional Word & Excel calculation packages ready for regulatory submittal",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-800 bg-slate-800/50 p-5 text-left"
            >
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="text-sm font-semibold text-white mb-1">{f.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-800 py-5 text-center text-[11px] text-slate-600 font-mono">
        ALLL WPS Designer · Engineering-grade municipal pump station design
      </footer>
    </div>
  );
}
