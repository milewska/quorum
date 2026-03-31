import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { LinksFunction } from "react-router";
import { rootAuthLoader } from "~/auth.server";
import appStylesHref from "./app.css?url";
import type { Route } from "./+types/root";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStylesHref },
];

export async function loader(args: Route.LoaderArgs) {
  return rootAuthLoader(args);
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
  const auth = useLoaderData<typeof loader>();
  const user = auth?.user ?? null;
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <div id="app" data-navigating={isNavigating || undefined}>
      <header className="site-header">
        <nav className="site-header__nav">
          <a href="/" className="site-header__logo">
            Quorum
          </a>
          <div className="site-header__actions">
            {user ? (
              <>
                <a href="/dashboard" className="site-header__user">
                  {user.profilePictureUrl ? (
                    <img
                      src={user.profilePictureUrl}
                      alt={[user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ")}
                      className="site-header__avatar"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="site-header__avatar site-header__avatar--initials">
                      {(user.firstName?.[0] ?? user.email[0]).toUpperCase()}
                    </span>
                  )}
                  <span className="site-header__name">
                    {user.firstName ?? user.email}
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
          &copy; {new Date().getFullYear()} Quorum
        </p>
        <p className="site-footer__build">
          v{__APP_VERSION__} &middot; deployed{" "}
          {new Date(__BUILD_TIME__).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          })}
        </p>
      </footer>
    </div>
  );
}
