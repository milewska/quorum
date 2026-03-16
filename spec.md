# Quorum — V1.0 Specification

## Product Summary

Quorum is a commitment-driven event platform where organizers post potential events with multiple date options and a minimum attendance threshold. Participants make public, name-attached commitments to dates that work for them. When a time slot's commitment count hits the threshold — quorum — the event becomes real, the organizer confirms, and participants are notified to register externally.

---

## User Roles & Core Flows

### Organizer

1. Sign in via Google OAuth or magic link (WorkOS).
2. Create event: title, description, location (free-text city/region), cover image, visibility (public/private), quorum threshold, commitment deadline (max 90 days out).
3. Add 1+ date/time slots.
4. Publish → event goes **Active**. Share link; public events also appear in browse.
5. Monitor commitment counts per slot in real time.
6. Receive email when any slot hits quorum → event moves to **Quorum Reached**.
7. Confirm event: select the winning slot(s), provide external registration URL → event moves to **Confirmed**. All committed participants on confirmed slot(s) are emailed.
8. Post-event: mark which committed participants actually registered → event moves to **Completed**, reputation scores update.

### Participant

1. Sign in via Google OAuth or magic link.
2. Browse public active events (filterable by location text) or follow a private link.
3. View event details: description, image, slots, commitment counts, who's committed.
4. Commit to 1+ time slots. Commitment is public (full name displayed).
5. Withdraw commitment any time **before** quorum is reached on that slot. No withdrawal after quorum (reputation penalty applies if event confirmed and participant doesn't register).
6. Receive email when a committed slot reaches quorum and again when the organizer confirms.
7. Register externally via the link provided by the organizer.

---

## Data Model

### User
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| fullName | string | From OAuth profile |
| email | string | Unique |
| avatarUrl | string | Nullable, from OAuth |
| reputationScore | decimal | Default 100. Percentage-based follow-through rate. |
| createdAt | timestamp | |

### Event
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| organizerId | UUID | FK → User |
| title | string | |
| description | text | |
| location | string | Free-text city/region |
| imageUrl | string | Nullable. Stored in R2. |
| visibility | enum | `public` · `private` |
| threshold | integer | Min commitments for quorum |
| deadline | timestamp | Max 90 days from creation |
| registrationUrl | string | Nullable. Set at confirmation. |
| status | enum | `draft` · `active` · `quorum_reached` · `confirmed` · `completed` · `expired` |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### TimeSlot
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| eventId | UUID | FK → Event |
| startsAt | timestamp | |
| endsAt | timestamp | |
| commitmentCount | integer | Denormalized counter |
| status | enum | `active` · `quorum_reached` · `confirmed` |

### Commitment
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| userId | UUID | FK → User |
| timeSlotId | UUID | FK → TimeSlot |
| eventId | UUID | FK → Event (denormalized for queries) |
| createdAt | timestamp | |
| withdrawnAt | timestamp | Nullable. Soft-delete for withdrawal. |

### Attendance
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| userId | UUID | FK → User |
| eventId | UUID | FK → Event |
| registered | boolean | Marked by organizer post-confirmation |
| markedAt | timestamp | |

### Relationships
- User 1→N Event (as organizer)
- User 1→N Commitment
- Event 1→N TimeSlot
- Event 1→N Commitment
- TimeSlot 1→N Commitment
- Event 1→N Attendance
- User 1→N Attendance

---

## Tech Stack

| Tool | Role | Rationale |
|---|---|---|
| **Remix** | Full-stack SSR framework | File-based routing, progressive enhancement, form actions, runs on Cloudflare Pages natively. |
| **Cloudflare Pages + Workers** | Hosting & compute | Edge-deployed, generous free tier, `wrangler` CLI for deploy. |
| **Cloudflare R2** | Object storage | Event cover images. S3-compatible, zero egress fees, same Cloudflare account. |
| **Neon** | Postgres database | Serverless Postgres, free tier, branching. `us-east-1`. |
| **Drizzle ORM** | Query builder & migrations | Type-safe, lightweight, Postgres-native, runs in Workers. |
| **WorkOS** | Authentication | Google OAuth + magic link. No custom auth code. Handles SSO plumbing. |
| **Resend** | Transactional email | Simple API, free tier (100 emails/day). Sending from `quorum.mechies.com`. |
| **TypeScript** | Language | End-to-end type safety. |

---

## Auth Approach

- **Provider:** WorkOS AuthKit.
- **Methods:** Google OAuth (primary), magic link via email (fallback).
- **Session:** Cookie-based. Encrypted session cookie stored on the client; verified server-side in Remix loaders/actions. No server-side session store required.
- **User creation:** On first successful auth, a `User` row is created with `fullName`, `email`, `avatarUrl` sourced from the OAuth/magic-link profile.
- **Authorization:** Simple role check — the `organizerId` field on an Event determines who can edit/confirm/manage it. Any authenticated user can commit.

---

## Key Constraints

- No payment processing or financial transactions.
- No in-app registration — participants are redirected externally after confirmation.
- No calendar integrations.
- No mobile app — responsive web only.
- No admin/moderation dashboard; organizers self-manage.
- No categories, tags, or search/filter beyond location text match.
- No participant-suggested time slots (V2).
- No automatic on-site registration tracking (V2 — organizer manually marks in V1).
- No test suite until V1.1.
- Free tiers for all services in V1.0.
- Domain: `quorum.mechies.com`.

---

## V2 Backlog (Out of Scope)

- Participant-suggested time slots for small groups.
- Automatic on-site registration / attendance tracking.
- Test suite.
- Categories, tags, advanced search/filter.
- Calendar integrations (Google Calendar, iCal export).
- Payment processing / deposits.
