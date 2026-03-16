# Quorum — V1.0 Build Plan (10 Phases)

---

## Phase 1: Foundation

**Delivers:** A deployed "Hello Quorum" page at `quorum.mechies.com` with a working CI/CD pipeline, database schema, and all third-party integrations wired up.

**Tasks:**

- [ ] Install/verify CLIs: `wrangler`, `node` (≥20), `npm`, `git`
- [ ] Create GitHub repo `Milewska/quorum`, clone locally
- [ ] Scaffold Remix project with Cloudflare Pages template (`npx create-remix@latest --template remix-run/remix/templates/cloudflare`)
- [ ] Configure TypeScript strict mode, path aliases
- [ ] Install Drizzle ORM + `drizzle-kit` + `@neondatabase/serverless`
- [ ] Write full DB schema (Users, Events, TimeSlots, Commitments, Attendance) in Drizzle, run initial migration against Neon
- [ ] Create Cloudflare R2 bucket (`quorum-images`), bind in `wrangler.toml`
- [ ] Set up Cloudflare Pages project, link to GitHub repo for auto-deploy on `main`
- [ ] Configure custom domain `quorum.mechies.com` on Cloudflare Pages
- [ ] Add DNS records for Resend on `quorum.mechies.com` (SPF, DKIM, DMARC), verify domain
- [ ] Store all secrets as Cloudflare Pages environment variables: `DATABASE_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `RESEND_API_KEY`
- [ ] Create a root layout with minimal shell (header, footer placeholder)
- [ ] Deploy hello-world index route to `quorum.mechies.com` — verify it loads

**Human input:**

- Cloudflare API token (or login via `wrangler login`)
- Neon connection string (project must exist)
- WorkOS API key + Client ID (project must exist, Google OAuth connection configured, redirect URI set to `https://quorum.malamaconsulting.com/auth/callback`)
- Resend API key
- GitHub access (push permission to `Milewska/quorum`)
- DNS access: point `quorum.malamaconsulting.com` CNAME to Cloudflare Pages + add Resend verification records

**Done when:** `https://quorum.malamaconsulting.com` serves a page, the DB has all tables, `git push` to `main` triggers auto-deploy, and all env vars are set in Cloudflare.

---

## Phase 2: Authentication

**Delivers:** Users can sign in with Google or magic link, see their name in the header, and sign out.

**Tasks:**

- [ ] Integrate WorkOS AuthKit: redirect-based login flow
- [ ] Create `/auth/login` route — redirects to WorkOS hosted auth page
- [ ] Create `/auth/callback` route — exchanges code for user profile, creates/updates `User` row in DB
- [ ] Implement encrypted cookie session (Remix `createCookieSessionStorage`)
- [ ] Add session helpers: `requireUser(request)`, `getOptionalUser(request)`
- [ ] Update root layout: show user name + avatar when logged in, "Sign in" button when not
- [ ] Create `/auth/logout` route — clears session cookie
- [ ] Protect future organizer routes with `requireUser`

**Human input:** None.

**Done when:** A user can click "Sign in," authenticate via Google (or magic link), see their full name in the header, and sign out. The `users` table has a row for them.

---

## Phase 3: Event Creation

**Delivers:** An organizer can create an event with time slots and a cover image, save it as draft, and publish it.

**Tasks:**

- [ ] Create `/events/new` route — protected, multi-section form
- [ ] Form fields: title, description, location (free-text), visibility toggle (public/private), threshold (number), deadline (date picker, max 90 days)
- [ ] Time slot sub-form: add/remove date+time pairs (start, end)
- [ ] Image upload: file input → upload to R2 via Workers binding → store URL in `imageUrl`
- [ ] Server action: validate inputs, insert `Event` + `TimeSlot` rows, status = `draft`
- [ ] Create `/events/:id/edit` route — same form, pre-populated, organizer-only
- [ ] Add "Publish" action: sets status to `active`, validates at least 1 time slot exists
- [ ] Redirect to event detail page after publish

**Human input:** None.

**Done when:** An organizer can fill out the form, upload an image, add time slots, save as draft, then publish. The event exists in the DB with status `active`.

---

## Phase 4: Event Discovery & Detail Pages

**Delivers:** Anyone can browse public active events, filter by location, and view full event details with time slots and commitment counts.

**Tasks:**

- [ ] Create `/events` route — public listing of active public events
- [ ] Display event cards: image, title, location, deadline, progress toward quorum (e.g., "12 / 20 committed")
- [ ] Location text filter: input field, case-insensitive `ILIKE` query
- [ ] Sort by deadline (soonest first) or most commitments
- [ ] Create `/events/:id` route — full event detail page
- [ ] Detail page shows: image, title, description, location, organizer name, threshold, deadline countdown, visibility badge
- [ ] List all time slots with date/time, commitment count, and progress bar
- [ ] Show committed participants per slot (full name, avatar)
- [ ] If event is private and user arrived via direct link, display normally (no listing)
- [ ] Handle non-existent / draft events with 404

**Human input:** None.

**Done when:** Visiting `/events` shows published public events. Typing a city in the filter narrows results. Clicking an event shows its full detail page with time slots and commitment counts (currently zero).

---

## Phase 5: Commitments

**Delivers:** A signed-in participant can commit to time slots, see their commitment reflected immediately, and withdraw before quorum.

**Tasks:**

- [ ] Add "Commit" button per time slot on event detail page (requires auth)
- [ ] Server action: insert `Commitment` row, increment `commitmentCount` on `TimeSlot` (transaction)
- [ ] Prevent duplicate commitments (same user + same slot)
- [ ] Show "Committed ✓" state on slots the current user has committed to
- [ ] Add "Withdraw" button — sets `withdrawnAt`, decrements counter (transaction)
- [ ] Disable withdrawal if the slot's status is `quorum_reached` or `confirmed`
- [ ] Prevent organizer from committing to their own event (or allow — your call; I'll prevent it)
- [ ] Update committed participants list in real time (on page reload / Remix revalidation)

**Human input:** None.

**Done when:** A user can commit to one or more slots, see the count update, see their name in the committed list, and withdraw. Withdrawal is blocked after quorum.

---

## Phase 6: Quorum Detection & Email Notifications

**Delivers:** When a time slot hits the threshold, the event status updates automatically and both the organizer and committed participants receive email notifications.

**Tasks:**

- [ ] After each commitment insert, check if `commitmentCount >= event.threshold`
- [ ] If quorum reached: update `TimeSlot.status` → `quorum_reached`; if event status is `active`, update to `quorum_reached`
- [ ] Integrate Resend SDK: helper function `sendEmail(to, subject, html)`
- [ ] Email to organizer: "Your event [title] reached quorum on [date]. Confirm it now." with link to confirmation page
- [ ] Email to all committed participants on that slot: "Great news — [event title] has reached quorum for [date]. The organizer will confirm soon."
- [ ] Prevent duplicate notifications (idempotency: only notify once per slot reaching quorum)
- [ ] Handle edge case: withdrawal brings count below threshold — revert slot status to `active` (event status stays `quorum_reached` if another slot still qualifies)

**Human input:** None.

**Done when:** Committing the threshold-th person triggers status changes and sends emails to the organizer and participants. Verified via Resend dashboard logs.

---

## Phase 7: Event Confirmation & Registration Link

**Delivers:** An organizer can confirm a quorum-reached event, provide a registration URL, and all committed participants on the confirmed slot(s) are notified.

**Tasks:**

- [ ] Create `/events/:id/manage` route — organizer-only dashboard for a single event
- [ ] Show all time slots with statuses. Highlight slots that reached quorum.
- [ ] "Confirm" action per quorum-reached slot: sets `TimeSlot.status` → `confirmed`
- [ ] Confirmation form includes registration URL input (required)
- [ ] On confirm: update `Event.status` → `confirmed`, store `registrationUrl`
- [ ] Email all committed participants on confirmed slot(s): "It's happening! [event title] is confirmed for [date]. Register here: [url]"
- [ ] Organizer can confirm multiple slots if multiple hit quorum (each is a confirmed instance)
- [ ] Update event detail page: show "Confirmed" badge, registration link for committed users

**Human input:** None.

**Done when:** After a slot hits quorum, the organizer can visit the manage page, enter a registration URL, confirm the slot, and committed participants receive an email with the link.

---

## Phase 8: Organizer & Participant Dashboards

**Delivers:** Organizers see all their events with statuses, and participants see all their commitments in one place.

**Tasks:**

- [ ] Create `/dashboard` route — role-adaptive (shows both organizer and participant views)
- [ ] Organizer section: list of all events the user created, grouped or filterable by status (draft, active, quorum_reached, confirmed, completed, expired)
- [ ] Quick actions per event: edit (draft), view, manage, delete (draft only)
- [ ] Participant section: list of all events the user has committed to, with slot date, event status, and commitment status
- [ ] Show "Withdraw" inline for eligible commitments
- [ ] Link to event detail page from each row

**Human input:** None.

**Done when:** A user can visit `/dashboard` and see events they organized (with management links) and events they committed to (with current statuses and withdraw option).

---

## Phase 9: Attendance Tracking & Reputation

**Delivers:** Organizers can mark which participants registered, events can be completed, and users have a visible reputation score.

**Tasks:**

- [ ] On `/events/:id/manage` for confirmed events: show list of committed participants with a "Registered" checkbox per person
- [ ] Server action: upsert `Attendance` row with `registered = true/false`
- [ ] Add "Complete Event" action — sets `Event.status` → `completed`
- [ ] On completion: calculate reputation for each committed participant — `reputation = (times registered / times committed to confirmed events) × 100`
- [ ] Update `User.reputationScore` for all affected participants
- [ ] Display reputation score on event detail page next to each committed participant's name (e.g., "Jane Doe · 92%")
- [ ] Create `/users/:id` route — simple public profile: name, avatar, reputation score, number of events committed to
- [ ] Handle expired events: scheduled or on-load check — if `deadline` passed and no slot reached quorum, set status to `expired`, email organizer + participants

**Human input:** None.

**Done when:** After confirming an event, the organizer can mark attendees, complete the event, and affected users' reputation scores update. Expired events auto-transition. User profiles show reputation.

---

## Phase 10: Polish & Launch

**Delivers:** A production-ready V1.0 with proper error handling, polished UX, and SEO fundamentals.

**Tasks:**

- [ ] Global error boundary (Remix `ErrorBoundary`) — friendly 404, 500 pages
- [ ] Form validation: client-side + server-side error messages on all forms
- [ ] Empty states: no events found, no commitments yet, no time slots added
- [ ] Loading states: Remix `useNavigation` pending UI for form submissions and page transitions
- [ ] Mobile audit: test all pages at 320px–768px, fix layout issues, ensure touch targets ≥ 44px
- [ ] Image optimization: validate upload size/type, serve responsive sizes from R2
- [ ] SEO: `<title>`, `<meta description>`, Open Graph tags on event detail pages
- [ ] Favicon and basic branding (logo placeholder in header)
- [ ] Rate-limit commitment actions (prevent spam commits)
- [ ] Review all email templates for copy and formatting
- [ ] Robots.txt, sitemap basics
- [ ] Final deploy to `quorum.mechies.com`, smoke test all flows end-to-end
- [ ] Write `README.md` with setup instructions, env var list, and deploy steps

**Human input:** Logo / brand assets if available (otherwise ships with text placeholder).

**Done when:** All pages render correctly on mobile and desktop, errors show friendly messages, emails look good, SEO tags are present, and a full end-to-end walkthrough (create → commit → quorum → confirm → complete) succeeds on production at `quorum.malamaconsulting.com`.
