# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quorum — Commitment-Driven Event Platform

Events only "go live" when enough people publicly commit. Threshold mechanics eliminate low-turnout events. Deployed at **quorum.malamaconsulting.com**. Full 10-phase plan in `phases.md`.

## Commands

```bash
npm run dev          # React Router dev server
npm run build        # Production build
npm run start        # wrangler pages dev ./build/client
npm run deploy       # build + wrangler pages deploy
npm run typecheck    # react-router typegen && tsc

# Database (D1 — SQLite via Cloudflare)
wrangler d1 execute quorum-db --file db/d1-migrations/0001_init.sql   # Apply schema
wrangler d1 execute quorum-db --file db/seed.sql                       # Seed sample data
wrangler d1 execute quorum-db --command "SELECT count(*) FROM events"  # Query directly
```

## Architecture

React Router 7 (formerly Remix) on Cloudflare Pages with a Cloudflare D1 database.

```
Quorum/
├── app/             # React Router routes and components
├── db/
│   ├── schema.ts    # Drizzle schema (SQLite): Users, Events, TimeSlots, Commitments, Attendance
│   ├── index.ts     # D1 connection helper (getDb)
│   ├── seed.sql     # D1 seed data (SQL)
│   ├── seed.ts      # [DEPRECATED] Old Neon seed script — use seed.sql instead
│   ├── d1-migrations/  # D1 migration files (SQLite)
│   └── migrations/     # [DEPRECATED] Old Neon/Postgres migration files
├── drizzle.config.ts   # Drizzle config (sqlite dialect)
├── wrangler.toml       # CF Pages config, D1 + R2 bindings
└── phases.md           # 10-phase build plan
```

## Stack

| Layer | Tech |
|-------|------|
| Frontend + routing | React Router 7 (App Router style) |
| Hosting | Cloudflare Pages |
| Database | **Cloudflare D1** (SQLite) + Drizzle ORM |
| Auth | WorkOS (SSO + magic link) |
| Email | Resend |
| Storage | Cloudflare R2 (`quorum-images`) |

> **Migration note (QUOR-2):** Database moved from Neon Postgres to Cloudflare D1. This eliminates the external Neon dependency. Schema is functionally identical — UUIDs stored as TEXT, timestamps as ISO 8601 TEXT, enums as TEXT. Old Neon files (`db/migrations/`, `db/seed.ts`) are deprecated but kept for reference.

## Auth Flow

WorkOS handles login. Routes: `/auth/login` → WorkOS hosted page → `/auth/callback` (exchanges code, upserts User row) → encrypted cookie session. Helpers: `requireUser(request)`, `getOptionalUser(request)`.

## Database Schema (Core Tables)

`users`, `events` (with quorum threshold field), `time_slots`, `commitments`, `attendance`.

All tables use TEXT primary keys (UUIDs generated via `crypto.randomUUID()`). Timestamps are ISO 8601 TEXT. Foreign keys use ON DELETE CASCADE where appropriate.

## Environment Variables (CF Pages)

`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, `RESEND_API_KEY`, `SESSION_SECRET` — set as CF Pages env vars, never committed.

`DB` is a D1 binding configured in `wrangler.toml`.

## Phase Status

Phase 1 (Foundation) complete. Phase 2 (QUOR-2: D1 database setup) complete — schema migrated from Neon to D1. Full plan in `phases.md`.
