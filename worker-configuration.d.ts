// Cloudflare Worker / Pages Functions environment bindings.
// This file is referenced by tsconfig "types" so all loaders/actions
// automatically see the typed Env interface via AppLoadContext.

interface Env {
  // D1 database binding
  DB: D1Database;

  // Google OAuth secrets (set via CF dashboard or `wrangler pages secret put`)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // Email allowlist (comma-separated, empty = allow all)
  ALLOWED_EMAILS: string;

  // Resend API key for transactional emails
  RESEND_API_KEY: string;

  // R2 bucket for event cover images
  IMAGES: R2Bucket;
}
