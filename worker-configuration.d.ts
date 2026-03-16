// Cloudflare Worker / Pages Functions environment bindings.
// This file is referenced by tsconfig "types" so all loaders/actions
// automatically see the typed Env interface via AppLoadContext.

interface Env {
  // Secrets (set in Cloudflare dashboard or via `wrangler pages secret put`)
  DATABASE_URL: string;
  WORKOS_API_KEY: string;
  WORKOS_CLIENT_ID: string;
  RESEND_API_KEY: string;
  SESSION_SECRET: string;

  // R2 bucket for event cover images
  IMAGES: R2Bucket;
}
