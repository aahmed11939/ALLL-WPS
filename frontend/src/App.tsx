import { ClerkProvider, useAuth } from "@clerk/react";
import { Switch, Route, Redirect, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { useEffect, useRef } from "react";
import AuthPage from "./pages/AuthPage";
import MainApp from "./pages/MainApp";
import LandingPage from "./pages/LandingPage";
import SubscribePage from "./pages/SubscribePage";
import AdminPage from "./pages/AdminPage";
import CheckoutSuccess from "./components/CheckoutSuccess";
import SubscriptionGate from "./components/SubscriptionGate";
import { invalidateBillingCache } from "./hooks/useBillingStatus";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) || "";

// Only use the proxy in production — the api-server proxy middleware is
// disabled in dev mode, so passing proxyUrl in dev causes a 404 for clerk.browser.js.
const clerkProxyUrl: string | undefined =
  import.meta.env.PROD
    ? ((import.meta.env.VITE_CLERK_PROXY_URL as string) ||
       `${window.location.origin}/api/__clerk`)
    : undefined;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
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

function SignInRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/app" />;
  return <AuthPage defaultTab="sign-in" />;
}

function SignUpRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/app" />;
  return <AuthPage defaultTab="sign-up" />;
}

function SubscribeRoute() {
  return <SubscribePage />;
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
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <BillingCacheCleaner />
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in" component={SignInRoute} />
        <Route path="/sign-up" component={SignUpRoute} />
        <Route path="/subscribe" component={SubscribeRoute} />
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
