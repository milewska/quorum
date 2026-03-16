import { defineConfig } from "drizzle-kit";

// drizzle-kit runs locally, so DATABASE_URL comes from .env
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: false,
});
