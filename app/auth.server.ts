/**
 * Auth helpers — server-only (never import from client code).
 *
 * Pattern:
 *  - root.tsx loader  → calls authkitLoader (handles session refresh + returns user)
 *  - protected loaders → call requireUser (reads refreshed session, redirects if absent)
 *  - public loaders   → call getOptionalUser (reads session, returns null if absent)
 *  - auth routes       → call configureAuth directly before WorkOS functions
 */
import {
  authkitLoader,
  configure,
  withAuth,
} from "@workos-inc/authkit-react-router";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Must be called before any WorkOS function in a loader/action.
 * Safe to call multiple times per request — module-level state, always same values.
 */
export function configureAuth(env: Env) {
  configure({
    clientId: env.WORKOS_CLIENT_ID,
    apiKey: env.WORKOS_API_KEY,
    redirectUri: env.WORKOS_REDIRECT_URI,
    cookiePassword: env.SESSION_SECRET,
  });
}

type AuthArgs = LoaderFunctionArgs & {
  context: { cloudflare: { env: Env } };
};

/**
 * Root-level loader helper. Refreshes the session, returns auth data.
 * Use ONLY in root.tsx loader so session refresh headers get set for every request.
 */
export function rootAuthLoader(args: AuthArgs) {
  configureAuth(args.context.cloudflare.env);
  return authkitLoader(args as LoaderFunctionArgs, { ensureSignedIn: false });
}

/**
 * Protected-route helper. Reads the (root-refreshed) session.
 * Throws a redirect to WorkOS sign-in if the user is not authenticated.
 */
export async function requireUser(args: AuthArgs) {
  configureAuth(args.context.cloudflare.env);
  const auth = await withAuth(args as LoaderFunctionArgs);
  if (!auth.user) {
    throw redirect(
      await import("@workos-inc/authkit-react-router").then((m) =>
        m.getSignInUrl(),
      ),
    );
  }
  return auth as typeof auth & { user: NonNullable<typeof auth.user> };
}

/**
 * Public-route helper. Returns the user or null — never redirects.
 */
export async function getOptionalUser(args: AuthArgs) {
  configureAuth(args.context.cloudflare.env);
  const { user } = await withAuth(args as LoaderFunctionArgs);
  return user;
}
