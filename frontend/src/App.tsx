import { ClerkProvider, useAuth } from "@clerk/react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import MainApp from "./pages/MainApp";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) || "";

const clerkProxyUrl =
  (import.meta.env.VITE_CLERK_PROXY_URL as string) ||
  `${window.location.origin}/api/__clerk`;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function HomeRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <Redirect to="/app" /> : <Redirect to="/sign-in" />;
}

function AppRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <MainApp />;
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
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
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
