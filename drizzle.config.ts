import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/d1-migrations",
  dialect: "sqlite",
  verbose: true,
  strict: false,
});
