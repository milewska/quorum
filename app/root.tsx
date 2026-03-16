import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { LinksFunction } from "react-router";
import appStylesHref from "./app.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStylesHref },
];

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
        <div id="app">
          <header className="site-header">
            <nav className="site-header__nav">
              <a href="/" className="site-header__logo">
                Quorum
              </a>
              <div className="site-header__actions">
                <a href="/auth/login" className="btn btn--primary">
                  Sign in
                </a>
              </div>
            </nav>
          </header>

          <main className="site-main">{children}</main>

          <footer className="site-footer">
            <p className="site-footer__copy">
              &copy; {new Date().getFullYear()} Quorum
            </p>
          </footer>
        </div>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
