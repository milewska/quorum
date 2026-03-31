/**
 * Auth helpers — Google OAuth SSO (CF-native, no external auth providers).
 * Pattern matches Sidebar: Google OAuth → D1 session → HttpOnly cookie.
 *
 * Usage in loaders/actions:
 *   const session = await getSession(request, env);        // null if not signed in
 *   const session = await requireSession(request, env);    // throws redirect if not signed in
 */
import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";

// ── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const COOKIE_NAME = "qsid"; // quorum session id

// ── Cookie helpers ───────────────────────────────────────────────────────────

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function cookieStr(
  name: string,
  value: string,
  request: Request,
  maxAgeSec: number,
): string {
  const isLocal = new URL(request.url).hostname === "localhost";
  const secure = isLocal ? "" : "; Secure";
  return `${name}=${value}; Path=/; SameSite=Lax; HttpOnly${secure}; Max-Age=${maxAgeSec}`;
}

function redirectUri(request: Request): string {
  const { origin } = new URL(request.url);
  return `${origin}/auth/callback`;
}

// ── Session types ────────────────────────────────────────────────────────────

export type SessionUser = {
  id: string;        // users.id (our internal UUID)
  googleId: string;  // Google sub
  email: string;
  fullName: string;
  avatarUrl: string | null;
};

// ── Session CRUD ─────────────────────────────────────────────────────────────

export async function getSession(
  request: Request,
  env: Env,
): Promise<SessionUser | null> {
  const sid = parseCookies(request)[COOKIE_NAME];
  if (!sid) return null;

  const db = getDb(env);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      googleId: users.googleId,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sid))
    .limit(1);

  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) {
    // Expired — clean up
    await db.delete(sessions).where(eq(sessions.id, sid));
    return null;
  }

  return {
    id: row.userId,
    googleId: row.googleId,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
  };
}

export async function requireSession(
  request: Request,
  env: Env,
): Promise<SessionUser> {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  return session;
}

// ── Login flow ───────────────────────────────────────────────────────────────

export function buildLoginRedirect(request: Request, env: Env): Response {
  if (!env.GOOGLE_CLIENT_ID)
    throw new Response("GOOGLE_CLIENT_ID not configured", { status: 500 });

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${GOOGLE_AUTH_URL}?${params}`,
      "Set-Cookie": cookieStr("oauth_state", state, request, 600),
    },
  });
}

// ── Callback flow ────────────────────────────────────────────────────────────

export async function handleOAuthCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oaErr = url.searchParams.get("error");

  const errorRedirect = (msg: string) =>
    Response.redirect(`${url.origin}/?error=${encodeURIComponent(msg)}`);

  if (oaErr) return errorRedirect(oaErr);
  if (!code || !state) return errorRedirect("invalid_callback");

  // CSRF: validate state cookie
  const storedState = parseCookies(request)["oauth_state"];
  if (!storedState || storedState !== state) return errorRedirect("invalid_state");

  // Exchange code for access token
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(request),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) return errorRedirect("token_exchange_failed");
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Fetch user info
  const userRes = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return errorRedirect("userinfo_failed");
  const profile = (await userRes.json()) as {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };

  // Email allowlist
  const allowed = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e: string) => e.trim())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(profile.email)) {
    return errorRedirect("not_authorized");
  }

  // Upsert user in D1
  const db = getDb(env);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.googleId, profile.sub))
    .limit(1);

  let userId: string;
  if (existing) {
    userId = existing.id;
    await db
      .update(users)
      .set({
        email: profile.email,
        fullName: profile.name,
        avatarUrl: profile.picture ?? null,
      })
      .where(eq(users.id, userId));
  } else {
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      googleId: profile.sub,
      email: profile.email,
      fullName: profile.name,
      avatarUrl: profile.picture ?? null,
    });
    userId = id;
  }

  // Create session
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.insert(sessions).values({ id: sid, userId, expiresAt });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/dashboard`,
      "Set-Cookie": cookieStr(COOKIE_NAME, sid, request, SESSION_TTL_SEC),
    },
  });
}

// ── Logout ───────────────────────────────────────────────────────────────────

export async function handleLogout(
  request: Request,
  env: Env,
): Promise<Response> {
  const sid = parseCookies(request)[COOKIE_NAME];
  if (sid) {
    const db = getDb(env);
    await db.delete(sessions).where(eq(sessions.id, sid));
  }
  const { origin } = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/`,
      "Set-Cookie": cookieStr(COOKIE_NAME, "", request, 0),
    },
  });
}
