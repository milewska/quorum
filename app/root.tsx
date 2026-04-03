import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";
import { getSession } from "~/auth.server";
import appStylesHref from "./app.css?url";
import type { Route } from "./+types/root";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStylesHref },
  { rel: "icon", href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>Q</text></svg>" },
];

export const meta: MetaFunction = () => [
  { charSet: "utf-8" },
  { property: "og:site_name", content: "Quorum" },
  { property: "og:type", content: "website" },
  { property: "og:locale", content: "en_US" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "theme-color", content: "#4f46e5" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getSession(request, context.cloudflare.env);
  return { user };
}

/** Pure HTML shell — always renders, even during errors and hydration. */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { user } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <div id="app">
      {/* Loading bar */}
      {isNavigating && (
        <div
          className="nav-loading-bar"
          style={{ width: navigation.state === "loading" ? "80%" : "30%" }}
        />
      )}

      <header className="site-header">
        <nav className="site-header__nav">
          <a href="/" className="site-header__logo">
            Quorum
          </a>
          <div className="site-header__links">
            <a href="/events" className="site-header__link">Events</a>
          </div>
          <div className="site-header__actions">
            {user ? (
              <>
                <a href="/dashboard" className="site-header__user">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.fullName}
                      className="site-header__avatar"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="site-header__avatar site-header__avatar--initials">
                      {user.fullName[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="site-header__name">
                    {user.fullName}
                  </span>
                </a>
                <form action="/auth/logout" method="post">
                  <button type="submit" className="btn btn--ghost">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <a href="/auth/login" className="btn btn--primary">
                Sign in
              </a>
            )}
          </div>
        </nav>
      </header>

      <main className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <p className="site-footer__copy">
          &copy; {new Date().getFullYear()} Quorum &middot; Built in Hawai'i
        </p>
        <p className="site-footer__build" suppressHydrationWarning>
          v {__GIT_COMMIT_HASH__} &middot; Built {new Intl.DateTimeFormat("en-US", {
            timeZone: "Pacific/Honolulu",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          }).format(new Date(__BUILD_TIME__))}
        </p>
      </footer>
    </div>
  );
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();

  let status = 500;
  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try again.";

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (status === 404) {
      title = "Page not found";
      message = "The page you're looking for doesn't exist or has been moved.";
    } else if (status === 403) {
      title = "Access denied";
      message = "You don't have permission to view this page.";
    } else if (status === 401) {
      title = "Sign in required";
      message = "You need to sign in to access this page.";
    }
  }

  return (
    <div className="error-page">
      <p className="error-page__code">{status}</p>
      <h1 className="error-page__title">{title}</h1>
      <p className="error-page__message">{message}</p>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <Link to="/" className="btn btn--primary">
          Go home
        </Link>
        <Link to="/events" className="btn btn--ghost">
          Browse events
        </Link>
      </div>
    </div>
  );
}
