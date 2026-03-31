import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Returns a Drizzle client connected to Cloudflare D1.
 *
 * Usage in a loader/action:
 *   const db = getDb(context.cloudflare.env);
 */
export function getDb(env: Pick<Env, "DB">) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
