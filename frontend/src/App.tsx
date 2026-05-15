import { ClerkProvider, SignIn, SignUp, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { useEffect, useRef } from "react";
import MainApp from "./pages/MainApp";
import LandingPage from "./pages/LandingPage";
import SubscribePage from "./pages/SubscribePage";
import AdminPage from "./pages/AdminPage";
import CheckoutSuccess from "./components/CheckoutSuccess";
import SubscriptionGate from "./components/SubscriptionGate";
import { invalidateBillingCache } from "./hooks/useBillingStatus";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

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
    colorForeground: "#1e293b",
    colorMutedForeground: "#64748b",
    colorDanger: "#e11d48",
    colorBackground: "#f8fafc",
    colorInput: "#ffffff",
    colorInputForeground: "#1e293b",
    colorNeutral: "#cbd5e1",
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-xl shadow-sm border border-slate-200 w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-900 font-bold",
    headerSubtitle: "text-slate-500",
    socialButtonsBlockButtonText: "text-slate-700 font-medium",
    formFieldLabel: "text-slate-700 font-medium text-sm",
    footerActionLink: "text-teal-700 hover:text-teal-600 font-medium",
    footerActionText: "text-slate-500",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-teal-700",
    formFieldSuccessText: "text-teal-700",
    alertText: "text-slate-700",
    logoBox: "flex justify-center",
    logoImage: "h-10 w-auto",
    socialButtonsBlockButton: "border-slate-200 hover:bg-slate-50",
    formButtonPrimary: "bg-teal-700 hover:bg-teal-600 text-white font-semibold",
    formFieldInput: "border-slate-300 bg-slate-50 text-slate-900 focus:border-teal-500 focus:ring-teal-500/20",
    footerAction: "bg-slate-50",
    dividerLine: "bg-slate-200",
    alert: "border-rose-200 bg-rose-50",
    otpCodeFieldInput: "border-slate-300 bg-slate-50 text-slate-900",
    formFieldRow: "",
    main: "",
  },
};

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/app`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/app`}
      />
    </div>
  );
}

function HomeRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const checkoutParam = params.get("checkout");

  if (!isLoaded) return null;

  if (checkoutParam === "success") {
    if (!isSignedIn) return <Redirect to="/sign-in" />;
    return <CheckoutSuccess />;
  }

  if (checkoutParam === "cancel") {
    return <LandingPage checkoutResult="cancel" />;
  }

  if (isSignedIn) return <Redirect to="/app" />;
  return <LandingPage />;
}

function AppRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return (
    <SubscriptionGate>
      <MainApp />
    </SubscriptionGate>
  );
}

function BillingCacheCleaner() {
  const { isSignedIn, isLoaded } = useAuth();
  const wasSignedIn = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (wasSignedIn.current === true && isSignedIn === false) {
      invalidateBillingCache();
    }
    wasSignedIn.current = isSignedIn ?? false;
  }, [isSignedIn, isLoaded]);

  return null;
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
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <BillingCacheCleaner />
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/subscribe" component={SubscribePage} />
        <Route path="/app" component={AppRoute} />
        <Route path="/app/*" component={AppRoute} />
        <Route path="/admin" component={AdminPage} />
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
