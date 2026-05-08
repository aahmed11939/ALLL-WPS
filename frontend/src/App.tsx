import { ClerkProvider, SignIn, SignUp, Show } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import LandingPage from "./pages/LandingPage";
import MainApp from "./pages/MainApp";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) || "";

const clerkProxyUrl = (import.meta.env.VITE_CLERK_PROXY_URL as string) || undefined;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: "#0f766e",
    colorForeground: "#0f172a",
    colorMutedForeground: "#64748b",
    colorDanger: "#e11d48",
    colorBackground: "#ffffff",
    colorInput: "#f8fafc",
    colorInputForeground: "#0f172a",
    colorNeutral: "#e2e8f0",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-xl w-[420px] max-w-full overflow-hidden shadow-lg border border-slate-200",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-900 font-bold",
    headerSubtitle: "text-slate-500",
    socialButtonsBlockButtonText: "text-slate-700",
    formFieldLabel: "text-slate-700 font-medium text-sm",
    footerActionLink: "text-teal-700 hover:text-teal-600 font-semibold",
    footerActionText: "text-slate-500",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-teal-600",
    formFieldSuccessText: "text-teal-600",
    alertText: "text-rose-600",
    logoBox: "mb-1",
    logoImage: "h-9 w-auto",
    socialButtonsBlockButton: "border border-slate-200 hover:bg-slate-50",
    formButtonPrimary: "bg-teal-700 hover:bg-teal-600 text-white font-semibold",
    formFieldInput:
      "border border-slate-300 bg-slate-50 text-slate-900 focus:border-teal-500 focus:ring-teal-500",
    footerAction: "bg-slate-50",
    dividerLine: "bg-slate-200",
    alert: "border border-rose-200 bg-rose-50",
    otpCodeFieldInput: "border border-slate-300 bg-slate-50",
    formFieldRow: "",
    main: "",
  },
};

const brandPanel = (
  <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-teal-700 px-12 text-white">
    <img src="/logo.png" alt="ALLL WPS Designer" className="h-16 w-auto mb-8" />
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

function SignInPage() {
  return (
    <div className="flex min-h-screen">
      {brandPanel}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src="/logo.png" alt="ALLL WPS Designer" className="h-12 w-auto mb-3" />
            <h1 className="text-xl font-bold text-slate-900">ALLL WPS Designer</h1>
          </div>
          <SignIn
            routing="path"
            path={`${basePath}/sign-in`}
            signUpUrl={`${basePath}/sign-up`}
          />
        </div>
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-screen">
      {brandPanel}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src="/logo.png" alt="ALLL WPS Designer" className="h-12 w-auto mb-3" />
            <h1 className="text-xl font-bold text-slate-900">ALLL WPS Designer</h1>
          </div>
          <SignUp
            routing="path"
            path={`${basePath}/sign-up`}
            signInUrl={`${basePath}/sign-in`}
          />
        </div>
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function AppRoute() {
  return (
    <>
      <Show when="signed-in">
        <MainApp />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to your ALLL WPS Designer account",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Get started with ALLL WPS Designer",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/app" component={AppRoute} />
        <Route path="/app/*" component={AppRoute} />
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
