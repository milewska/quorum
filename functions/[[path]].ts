/**
 * Cloudflare Pages Functions entry point.
 * React Router's server bundle is served from here.
 * The `getLoadContext` function bridges Cloudflare's execution context
 * into React Router's `context.cloudflare` so loaders/actions can access
 * env vars and bindings (R2, etc.) via `context.cloudflare.env`.
 */
import { createPagesFunctionHandler } from "@react-router/cloudflare";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — generated at build time by React Router
import * as build from "virtual:react-router/server-build";

export const onRequest: PagesFunction<Env> = createPagesFunctionHandler({
  build,
  getLoadContext(ctx) {
    return { cloudflare: ctx };
  },
});
