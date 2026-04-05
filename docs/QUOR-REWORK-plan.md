# QUOR-REWORK — Post-Quorum Admin + Email Flow Rebuild

**Scoped by:** Heph
**Date:** 2026-04-05 HST
**Status:** PROPOSAL — awaiting Alex review. No code written yet.
**Mission:** "The management for events post-quorum is a total mess. The display for responded users, as well as the email flow — there's not enough versatility, the display is ugly. Rework by half."

---

## 1. Current State Audit

### 1.1 What already works (good news)

Three items Alex previously flagged as bugs are **already fixed** in the current codebase:

| Flagged Bug | Status | Where |
|---|---|---|
| Edit route cascade-deletes all commitments (slot nuke-and-replace) | **FIXED** | `app/routes/events.$id.edit.tsx:189-239` does proper upsert — matches existing slots by timestamp, preserves IDs + commitments, only deletes slots the organizer actually removed. |
| Quorum should be floor, not ceiling | **FIXED** | `events.$id.tsx:455-462` lets people commit past quorum. Manage page (`events.$id.manage.tsx:665+`) shows all active slots and lets host confirm any of them. Withdraw only blocked on `confirmed`. |
| No auto-emails on quorum hit | **FIXED** | `events.$id.tsx:304-319` updates slot/event status only. Emails fire solely when host clicks "Confirm this slot" in manage page. |

These can stay as-is. The real work is the **post-quorum admin experience** — which is genuinely a mess.

### 1.2 Real bugs still live

| # | Bug | Where | Severity |
|---|---|---|---|
| B1 | **Registration URL collision** — `events.registrationUrl` is a single column, but the manage page shows a per-slot URL field. Confirming a second slot overwrites the first slot's URL. First slot's participants got URL-A in email; they now see URL-B on the event page. | `events.$id.manage.tsx:162-164` + `db/schema.ts:54` | HIGH |
| B2 | **Silent email failures** — confirm action sends emails inside `try { ... } catch { console.error }`. Host sees "success" but emails may have partially or fully failed. No user-visible feedback, no retry. | `events.$id.manage.tsx:217-219` | HIGH |
| B3 | **Sequential email loop blocks action** — `for (email of allEmails) await sendMail(...)`. 50 participants = 50 serial Resend calls before response returns. First failure aborts the rest. | `events.$id.manage.tsx:207-216` | MEDIUM |
| B4 | **Withdraw that drops slot below quorum sends no notification** — slot silently flips back to `active`, host unaware. | `events.$id.tsx:367-380` | MEDIUM |
| B5 | **Guest attendance cannot be tracked** — `attendance.userId` is NOT NULL, so the manage page shows "—" for every guest. Host can't complete an event where guests attended. | `db/schema.ts:137-146` + `events.$id.manage.tsx:581-590` | MEDIUM |
| B6 | **No updatedAt bump on `mark_attendance` / `remove_participant`** — minor consistency issue. | `events.$id.manage.tsx:240-253, 336` | LOW |

### 1.3 "Display is ugly" — specifics

The manage page (`events.$id.manage.tsx`) has three stacked sections — Ready-to-Confirm, Confirmed, Gathering-Commitments — each a wall of text with per-slot participant sub-lists. Problems:

- **Triple wall of text**: three near-identical sections with inline commit forms = visual clutter.
- **No unified respondent view**: if Alice commits to three slots, she appears in three sub-lists. Host has no single-person view.
- **No sort, filter, or search**: can't order by name, date, tier; can't search "did Bob sign up?"
- **No CSV export**: host has to screenshot/copy-paste.
- **No tier/pledge-amount shown per person**: host can't see who paid what.
- **No commit-date shown**: host can't see order of sign-ups.
- **No reputation score on manage view**: event detail shows it, manage doesn't.
- **No avatars on manage view**: event detail shows them, manage doesn't.
- **No mailto/tel quick actions**: email/phone are text, not clickable.
- **No bulk actions**: remove-participant is one-at-a-time, no bulk email.
- **Per-slot registration URL field repeated on every card**: confusing, compounds B1.
- **Mobile**: inline forms + long participant rows likely break under ~600px.
- **Remove-participant**: no reason captured, no undo.
- **Attendance toggles mixed with confirm forms**: workflow progression unclear (confirm → mark attendance → complete is three sections tall).

### 1.4 "Not enough versatility in email flow" — specifics

The current flow: host clicks "Confirm this slot" → system sends one fixed-template email to all committed participants on that slot. That's it. No other email controls exist.

Missing versatility:

- **No custom host message**: every email is the same template, no way to add "Looking forward to seeing you — parking is at the back" etc.
- **No ad-hoc "Send update" button**: host can't nudge committed participants pre-quorum, or post-confirm reminders, without confirming the slot.
- **No targeted sends**: can't email a single person, or a subset — it's always "all committed on this slot."
- **No per-tier targeting**: can't message only paid-tier committers.
- **No auto-ack on commit**: new committers get no confirmation email.
- **No event reminders**: no 24h / 1-week-before pings.
- **No waitlist notifications**: floor-not-ceiling means over-commits happen; host has no way to say "sorry, at capacity."
- **No withdrawal notification to host**: someone drops out, no email.
- **No slot-lost-quorum notification**: see B4.
- **Email HTML is inconsistent**: inline styles, mixed blue (#2563eb) and green (#16a34a) and gray buttons, no Malama/Quorum brand identity, no unsubscribe footer, no event-meta header.
- **No preview**: host clicks confirm, emails go immediately — can't review wording.
- **No send log**: no record of who-got-what-when for troubleshooting.

---

## 2. Rebuild Plan — Phased, Each Deployable Independently

Design principle: **KISS + CF-native**. All phases use existing stack (React Router 7, D1, R2, Resend). No new dependencies beyond `resend` (already present). Schema changes are additive where possible.

### Phase A — Bug fixes (tiny, urgent, ship first) — ~1 day

Small, high-value, no new UI. Deploy as a single commit.

- **A1. Fix registrationUrl collision (B1)** — Add `registration_url` column to `time_slots` table (nullable TEXT). Confirm action writes to `timeSlots.registrationUrl`, not `events.registrationUrl`. Event detail page reads per-slot URL for each confirmed slot the user is committed to. Event-level URL kept for backward compat during migration, then deprecated.
- **A2. Surface email failures (B2)** — Track `{sent: [], failed: []}` in confirm action, return to UI as a flash message: "Confirmed. Emailed 23 of 25 participants — 2 failures logged." Show which.
- **A3. Parallelize email sends (B3)** — `await Promise.allSettled(emails.map(sendMail))`. Aggregate results.
- **A4. Bump updatedAt (B6)** — trivial, one-liner in both actions.

*Ship A1–A4 as commit 1 of QUOR-REWORK.*

### Phase B — Respondent Display Rework — ~2 days

The core of the "ugly display" complaint. Ship as its own deploy.

- **B1. Unified respondents table** — single sortable table on manage page: Name · Slot(s) · Tier · Amount · Commit Date · Contact · Actions. Person-centric by default (Alice with 3 slots = 1 row), with "View by Slot" toggle for the old grouped view.
- **B2. Sort / filter / search** — sort by any column; filter by slot, tier, guest/signed-in, attendance status; search box (name/email/phone).
- **B3. CSV export button** — server-side endpoint `events/$id/manage/export.csv`, streams all respondent fields (host-only).
- **B4. Contact quick actions** — `mailto:` on email cells, `tel:` on phone cells.
- **B5. Reputation + avatar on manage view** — parity with event detail page.
- **B6. Commit timestamp visible** — sort respondents by sign-up order.

*Ship B1–B6 as commit 2 (or split in two if too large).*

### Phase C — Email Flow Rebuild — ~2–3 days

The versatility complaint. Multiple sub-deploys.

- **C1. Email brand shell** — single template shell in `app/email.server.ts`: header (Quorum + event title), body slot, footer (event link, "This is a one-time email from the event host" + host's name for transparency). Consistent Malama palette. All existing templates (confirmed/expired) ported into shell. — *Deploy independently.*
- **C2. Host custom message on confirm** — confirm form grows an optional "Personal note to participants" textarea. Merged into body of `eventConfirmedEmail` above the registration CTA. — *Deploy independently.*
- **C3. "Send Update" modal** — new button on manage page. Host picks recipients (all committed | by slot | by tier | selected rows), writes subject + body, sees preview, hits send. New action intent `send_update`. New email template `hostUpdateEmail`. Log send results. — *Deploy as its own commit.*
- **C4. Bulk-select + email selected** — checkboxes on respondent table, "Email selected" button drops into same Send-Update modal with preselected recipients. — *Ships with or after C3.*
- **C5. Preview before send** — modal shows rendered HTML preview of what each recipient will receive. Required step on all manual sends. — *Ships with C3.*
- **C6. Email send log (D1 table)** — new `email_sends` table: id, eventId, recipientEmail, subject, templateName, status (queued/sent/failed), errorMsg, sentAt. Every send writes a row. New manage-page tab "Communication" shows log. — *Deploy independently.*

*Optional / defer:*
- Auto-ack on new commit (toggle per event)
- Scheduled reminders (24h/1w) — CF Cron Trigger, own phase
- Host-withdrawal notifications (simple — single email when slot loses quorum)

### Phase D — Attendance + Completion Polish — ~1 day

- **D1. Schema: guest-capable attendance** — make `attendance.userId` nullable, add `commitment_id TEXT` nullable FK. Attendance can reference a commitment (covers guests) OR a user. Runtime check: exactly one of the two is set.
- **D2. Attendance UI covers guests** — replace "—" with the same toggle, keyed by commitmentId for guests.
- **D3. Remove-participant: reason + undo** — reason captured in a new `commitments.removalReason` column. 30s undo toast after remove.

### Phase E — Manage Page Visual Rebuild — ~2 days

- **E1. Tabbed manage layout** — four tabs: **Respondents** (the table from Phase B), **Slots** (confirm flow from current UI, cleaned up), **Communication** (Send Update + log from Phase C), **Attendance** (from Phase D). Removes the triple-wall-of-text problem.
- **E2. Card + chip visual pass** — status chips, tier chips, card backgrounds aligned with Malama palette. Replace inline forms with modals/drawers where they currently clutter cards.
- **E3. Mobile responsive pass** — table → stacked cards <768px, modals go full-screen.

---

## 3. Dependency Graph

```
A (bug fixes)  ─────────────────────────────────┐
                                                 │
B (respondent table) ────────────────┐           │
                                      │           │
C1 (email shell) ──┐                  │           │
C2 (custom msg)    ├── C3 (Send Update modal) ──┤  ├── E (visual rebuild)
                   │                  │           │
C6 (send log) ─────┘                  │           │
                                      │           │
D (guest attendance) ─────────────────┘           │
                                                  │
                                                  ↓
                                             Final polish
```

A ships first and independently. B and C can proceed in parallel. D is small and can slot in any time. E is last (depends on B + C for tab content).

## 4. Schema Changes Summary

| Phase | Table | Change | Migration |
|---|---|---|---|
| A1 | `time_slots` | Add `registration_url TEXT` nullable | `0002_slot_reg_url.sql` |
| C6 | new `email_sends` | Create table | `0003_email_sends.sql` |
| D1 | `attendance` | Drop NOT NULL on `user_id`, add `commitment_id TEXT` | `0004_guest_attendance.sql` |
| D3 | `commitments` | Add `removal_reason TEXT`, `removed_at TEXT` | `0005_commitment_removal.sql` |

All changes additive. No destructive migrations. Each applies locally + `--remote` before deploy.

## 5. Risk & Rollback

- Each phase is a separate commit + deploy. Rollback = revert commit + redeploy.
- Schema changes are additive only — old code keeps working after new migration.
- Email changes (C) can be toggled per-feature; worst case, revert C3 keeping C1/C2.
- No external service changes. Resend API key unchanged.

## 6. Out of Scope (for this rework)

- Series/multi-meeting events (Phase 11, separate initiative).
- Payment collection (tier amounts are declarative-only today).
- Real-time updates (still SSR + redirect pattern).
- i18n / translations.
- Unsubscribe link + preference center (simple opt-out via reply-to for now).

---

## 7. Recommended Ship Order

1. **Phase A** (~1 day) — bug fixes, obvious wins.
2. **Phase B** (~2 days) — unified respondent table.
3. **Phase C1 + C2** (~1 day) — email shell + custom host message on confirm.
4. **Phase D** (~1 day) — guest attendance unlock.
5. **Phase C3 + C4 + C5 + C6** (~2 days) — Send Update modal, send log.
6. **Phase E** (~2 days) — tabbed layout + visual polish.

**Total estimate: ~9 working days.** Sized for one shippable unit per day.

---

*End of plan. Awaiting Alex review before any code is written.*
