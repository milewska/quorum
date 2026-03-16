import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Returns a Drizzle client connected to Neon via HTTP.
 * This pattern works inside Cloudflare Workers (no persistent TCP connections).
 *
 * Usage in a loader/action:
 *   const db = getDb(context.cloudflare.env);
 */
export function getDb(env: Pick<Env, "DATABASE_URL">) {
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof getDb>;
