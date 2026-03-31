/**
 * Type-safe helper to access Cloudflare environment variables in
 * loaders/actions. Usage:
 *
 *   export async function loader({ context }: Route.LoaderArgs) {
 *     const env = getEnv(context);
 *     const db = getDb(env);
 *     ...
 *   }
 */
export function getEnv(context: { cloudflare: { env: Env } }): Env {
  return context.cloudflare.env;
}
