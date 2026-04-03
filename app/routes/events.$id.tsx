import { and, eq, isNull, sql } from "drizzle-orm";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import { useState } from "react";
import { getSession, requireSession } from "~/auth.server";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { commitments, events, timeSlots, users } from "../../db/schema";
import type { Route } from "./+types/events.$id";
import type { CostTier } from "~/components/CostTierEditor";
import { formatInTimezone, formatTimeOnly, tzAbbreviation } from "~/components/TimezonePicker";
// Email imports removed — no auto-emails on quorum. Host confirms via manage page.
import { expireOverdueEvents } from "~/expiry.server";

// ─── SEO Meta (Open Graph + Twitter Cards) ───────────────────────────────────

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.event) {
    return [{ title: "Event Not Found — Quorum" }];
  }
  const ev = data.event;
  const title = `${ev.title} — Quorum`;
  const description = `${ev.location} · ${ev.threshold} commitments needed. ${(ev.description ?? "").slice(0, 140)}`;
  const url = `https://quorum.malamaconsulting.com/events/${ev.id}`;
  const image = ev.imageKey?.startsWith("https://") ? ev.imageKey : undefined;

  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    ...(image ? [{ property: "og:image", content: image }] : []),
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    ...(image ? [{ name: "twitter:image", content: image }] : []),
  ];
};

function deadlineCountdown(deadline: Date): string {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return "Deadline passed";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export async function loader(args: Route.LoaderArgs) {
  const { params, context } = args;
  const db = getDb(getEnv(context));

  const rows = await db
    .select({ event: events, organizerName: users.fullName })
    .from(events)
    .innerJoin(users, eq(users.id, events.organizerId))
    .where(eq(events.id, params.id))
    .limit(1);

  const row = rows[0];

  const sessionUser = await getSession(args.request, args.context.cloudflare.env);
  let dbUserId: string | null = sessionUser?.id ?? null;
  let isOrganizer = dbUserId !== null && dbUserId === row?.event.organizerId;

  if (!row || (row.event.status === "draft" && !isOrganizer)) {
    throw new Response("Not Found", { status: 404 });
  }

  // On-load expiry detection: if active + deadline passed → mark expired
  if (row.event.status === "active") {
    const env = getEnv(context);
    const baseUrl = new URL(args.request.url).origin;
    await expireOverdueEvents(db, env, [params.id], baseUrl);
    // Reload if status changed
    if (new Date(row.event.deadline) < new Date()) {
      return redirect(`/events/${params.id}`);
    }
  }

  const slots = await db
    .select()
    .from(timeSlots)
    .where(eq(timeSlots.eventId, params.id))
    .orderBy(timeSlots.startsAt);

  // Committed participants (non-withdrawn), grouped by slot client-side
  // Signed-in users
  const signedInParticipants = await db
    .select({
      slotId: commitments.timeSlotId,
      userId: users.id,
      name: users.fullName,
      avatarUrl: users.avatarUrl,
      reputationScore: users.reputationScore,
      isGuest: sql<number>`0`,
      guestEmail: sql<string | null>`null`,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(commitments.createdAt);

  // Guest participants (userId is null)
  const guestParticipants = await db
    .select({
      slotId: commitments.timeSlotId,
      name: commitments.guestName,
      guestEmail: commitments.guestEmail,
      guestPhone: commitments.guestPhone,
    })
    .from(commitments)
    .where(
      and(
        eq(commitments.eventId, params.id),
        isNull(commitments.withdrawnAt),
        isNull(commitments.userId),
      )
    )
    .orderBy(commitments.createdAt);

  const participants = [
    ...signedInParticipants.map((p) => ({
      slotId: p.slotId,
      userId: p.userId as string | null,
      name: p.name,
      avatarUrl: p.avatarUrl,
      reputationScore: p.reputationScore,
      isGuest: false,
      guestEmail: null as string | null,
      guestPhone: null as string | null,
    })),
    ...guestParticipants.map((p) => ({
      slotId: p.slotId,
      userId: null as string | null,
      name: p.name ?? "Guest",
      avatarUrl: null as string | null,
      reputationScore: null as number | null,
      isGuest: true,
      guestEmail: p.guestEmail,
      guestPhone: p.guestPhone,
    })),
  ];

  // Current user's active commitments with tier info
  const myCommitmentRows = dbUserId
    ? await db
        .select({
          timeSlotId: commitments.timeSlotId,
          tierLabel: commitments.tierLabel,
          tierAmount: commitments.tierAmount,
        })
        .from(commitments)
        .where(
          and(
            eq(commitments.userId, dbUserId),
            eq(commitments.eventId, params.id),
            isNull(commitments.withdrawnAt)
          )
        )
    : [];

  const myCommittedSlotIds = myCommitmentRows.map((r) => r.timeSlotId);
  const myTierBySlotId: Record<string, { tierLabel: string | null; tierAmount: number | null }> =
    Object.fromEntries(myCommitmentRows.map((r) => [r.timeSlotId, { tierLabel: r.tierLabel, tierAmount: r.tierAmount }]));

  const costTiers: CostTier[] = row.event.costTiersJson
    ? (JSON.parse(row.event.costTiersJson) as CostTier[])
    : [];

  // Aggregate total pledged cents per slot (for price quorum display)
  const pledgedRows = row.event.priceQuorumCents != null
    ? await db
        .select({
          slotId: commitments.timeSlotId,
          totalCents: sql<number>`coalesce(sum(${commitments.tierAmount}), 0)`,
        })
        .from(commitments)
        .where(and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt)))
        .groupBy(commitments.timeSlotId)
    : [];
  const pledgedBySlotId: Record<string, number> = Object.fromEntries(
    pledgedRows.map((r) => [r.slotId, r.totalCents])
  );

  return {
    event: row.event,
    organizerName: row.organizerName,
    slots,
    participants,
    isOrganizer,
    isSignedIn: sessionUser !== null,
    dbUserId,
    userName: sessionUser?.fullName ?? null,
    myCommittedSlotIds,
    myTierBySlotId,
    costTiers,
    pledgedBySlotId,
    // Computed server-side so SSR and client hydration see the same value.
    // If computed client-side (Date.now()), a timing diff flips canCommit's
    // ternary branch (<form> vs <div>), causing React error #418.
    deadlinePassed: new Date(row.event.deadline) < new Date(),
  };
}

// ─── Action (commit / withdraw) ───────────────────────────────────────────────

export async function action(args: Route.ActionArgs) {
  const { params, request, context } = args;
  const env = getEnv(context);
  const db = getDb(env);

  const sessionUser = await getSession(request, env);
  const dbUserId = sessionUser?.id ?? null;

  const form = await request.formData();
  const intent = form.get("intent") as string;

  // Load event with organizer email (needed for all intents)
  const eventRows = await db
    .select({
      event: events,
      organizerEmail: users.email,
      organizerName: users.fullName,
    })
    .from(events)
    .innerJoin(users, eq(users.id, events.organizerId))
    .where(eq(events.id, params.id))
    .limit(1);
  const eventData = eventRows[0];
  if (!eventData) throw new Response("Event not found", { status: 404 });

  const baseUrl = new URL(request.url).origin;

  // ── Batch commit (new Doodle-style flow) ──────────────────────────────────
  if (intent === "batch_commit") {
    const slotIds = ((form.get("slotIds") as string) ?? "").split(",").filter(Boolean);
    const guestName = (form.get("guestName") as string)?.trim() || null;
    const guestEmail = (form.get("guestEmail") as string)?.trim() || null;
    const guestPhone = (form.get("guestPhone") as string)?.trim() || null;
    const tierLabel = (form.get("tierLabel") as string) || null;
    const tierAmountRaw = form.get("tierAmount") as string | null;
    const tierAmount = tierAmountRaw ? parseInt(tierAmountRaw, 10) : null;

    if (slotIds.length === 0) return { error: "Please select at least one time slot." };
    if (!dbUserId && !guestName) {
      return { error: "Please enter your name." };
    }
    if (!dbUserId && !guestEmail) {
      return { error: "Please enter your email so the host can reach you." };
    }
    if (dbUserId && eventData.event.organizerId === dbUserId) {
      return { error: "Organizers cannot commit to their own event." };
    }

    // Load all target slots
    const allSlots = await db
      .select()
      .from(timeSlots)
      .where(eq(timeSlots.eventId, params.id));
    const slotMap = new Map(allSlots.map((s) => [s.id, s]));

    for (const slotId of slotIds) {
      const slot = slotMap.get(slotId);
      if (!slot) continue;

      // Skip if signed-in user already committed to this slot
      if (dbUserId) {
        const [existing] = await db
          .select({ id: commitments.id })
          .from(commitments)
          .where(
            and(
              eq(commitments.userId, dbUserId),
              eq(commitments.timeSlotId, slotId),
              isNull(commitments.withdrawnAt)
            )
          )
          .limit(1);
        if (existing) continue;
      }

      await db.insert(commitments).values({
        userId: dbUserId,
        timeSlotId: slotId,
        eventId: params.id,
        tierLabel,
        tierAmount,
        guestName: dbUserId ? null : guestName,
        guestEmail: dbUserId ? null : guestEmail,
        guestPhone: dbUserId ? null : guestPhone,
      });

      const newCount = slot.commitmentCount + 1;
      await db
        .update(timeSlots)
        .set({ commitmentCount: newCount })
        .where(eq(timeSlots.id, slotId));

      // Quorum detection — update status only, NO auto-emails.
      // Host decides when to confirm and trigger notifications.
      if (slot.status === "active" && newCount >= eventData.event.threshold) {
        await db
          .update(timeSlots)
          .set({ status: "quorum_reached" })
          .where(eq(timeSlots.id, slotId));

        if (eventData.event.status === "active" || eventData.event.status === "draft") {
          await db
            .update(events)
            .set({ status: "quorum_reached", updatedAt: new Date().toISOString() })
            .where(eq(events.id, params.id));
        }
        // No emails here — host confirms via manage page, emails sent only then.
      }
    }

    return redirect(`/events/${params.id}`);
  }

  // ── Single-slot withdraw (signed-in users only) ───────────────────────────
  if (intent === "withdraw") {
    const slotId = form.get("slotId") as string;
    if (!slotId) throw new Response("Missing slotId", { status: 400 });
    if (!dbUserId) throw new Response("Must be signed in to withdraw", { status: 403 });

    const [slot] = await db
      .select()
      .from(timeSlots)
      .where(and(eq(timeSlots.id, slotId), eq(timeSlots.eventId, params.id)))
      .limit(1);
    if (!slot) throw new Response("Slot not found", { status: 404 });

    // Only block withdrawal on confirmed slots — quorum is a minimum, not a lock
    if (slot.status === "confirmed") {
      throw new Response("Cannot withdraw from a confirmed slot", { status: 403 });
    }

    const [existing] = await db
      .select({ id: commitments.id })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, dbUserId),
          eq(commitments.timeSlotId, slotId),
          isNull(commitments.withdrawnAt)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(commitments)
        .set({ withdrawnAt: new Date().toISOString() })
        .where(eq(commitments.id, existing.id));

      const newCount = Math.max(0, slot.commitmentCount - 1);
      await db
        .update(timeSlots)
        .set({ commitmentCount: newCount })
        .where(eq(timeSlots.id, slotId));

      if ((slot.status as string) === "quorum_reached" && newCount < eventData.event.threshold) {
        await db.update(timeSlots).set({ status: "active" }).where(eq(timeSlots.id, slotId));
        const stillQuorum = await db
          .select({ id: timeSlots.id })
          .from(timeSlots)
          .where(and(eq(timeSlots.eventId, params.id), eq(timeSlots.status, "quorum_reached")))
          .limit(1);
        if (stillQuorum.length === 0 && eventData.event.status === "quorum_reached") {
          await db
            .update(events)
            .set({ status: "active", updatedAt: new Date().toISOString() })
            .where(eq(events.id, params.id));
        }
      }
    }
  }

  return redirect(`/events/${params.id}`);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  quorum_reached: "Quorum Reached",
  confirmed: "Confirmed",
  completed: "Completed",
  expired: "Expired",
};

function formatCents(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EventDetail() {
  const {
    event,
    organizerName,
    slots,
    participants,
    isOrganizer,
    isSignedIn,
    dbUserId,
    userName,
    myCommittedSlotIds,
    myTierBySlotId,
    costTiers,
    pledgedBySlotId,
    deadlinePassed,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  const deadlineDate = new Date(event.deadline);
  const countdown = deadlineCountdown(deadlineDate);

  // Batch commit: track which slots are checked
  const [checkedSlots, setCheckedSlots] = useState<Set<string>>(new Set());
  const [selectedTierLabel, setSelectedTierLabel] = useState<string | null>(
    costTiers.length === 0 ? "__free__" : null
  );

  function toggleSlot(id: string) {
    setCheckedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group participants by slot id
  const bySlot = participants.reduce<Record<string, typeof participants>>(
    (acc, p) => {
      (acc[p.slotId] ??= []).push(p);
      return acc;
    },
    {}
  );

  // Can this user commit? (not organizer, not past deadline)
  // Allow commits while event is active, quorum_reached, or even confirmed
  // (host may have confirmed one slot but others remain open)
  const canCommit = !isOrganizer && !deadlinePassed &&
    (event.status === "active" || event.status === "quorum_reached" || event.status === "confirmed");

  // Committable slots: not already committed by this user, not yet confirmed by host
  // Quorum is a MINIMUM — more people can always join until the host confirms
  const committableSlotIds = slots
    .filter((s) => !myCommittedSlotIds.includes(s.id) && s.status !== "confirmed")
    .map((s) => s.id);

  const selectedTier = costTiers.find((t) => t.label === selectedTierLabel);
  const hasSelection = checkedSlots.size > 0;
  const canSubmit = hasSelection && (costTiers.length === 0 || selectedTierLabel !== null);

  return (
    <section className="page-section">
      <div className="event-detail">
        {/* Header */}
        <div className="event-detail__header">
          <div className="event-detail__badges">
            <span className={`badge badge--${event.status}`}>
              {STATUS_LABEL[event.status] ?? event.status}
            </span>
            {event.visibility === "private" && (
              <span className="badge badge--private">Private</span>
            )}
          </div>

          <h1 className="event-detail__title">{event.title}</h1>

          <p className="event-detail__meta">
            {event.location} &middot;{" "}
            <span className="event-detail__countdown" suppressHydrationWarning>{countdown}</span>
            {" "}&middot; deadline{" "}
            {new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: event.timezone,
            }).format(deadlineDate)}
          </p>
          <p className="event-detail__meta" suppressHydrationWarning>
            Organised by {organizerName} &middot; Quorum: {event.threshold}{" "}
            commitments &middot; {tzAbbreviation(event.timezone)}
          </p>
          {costTiers.length > 0 && (
            <div className="cost-tiers-summary">
              <span className="cost-tiers-summary__label">Pricing:</span>
              {costTiers.map((t) => (
                <span key={t.label} className="cost-badge cost-badge--paid">
                  {t.label} &mdash; {formatCents(t.amount)}
                </span>
              ))}
            </div>
          )}
          {costTiers.length === 0 && (
            <div className="cost-tiers-summary">
              <span className="cost-badge">Free</span>
            </div>
          )}

          {event.status === "confirmed" && event.registrationUrl && myCommittedSlotIds.length > 0 && (
            <div className="event-detail__registration">
              <p className="event-detail__registration-msg">This event is confirmed! Register your spot:</p>
              <a
                href={event.registrationUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn--primary"
              >
                Register Now →
              </a>
            </div>
          )}

          {isOrganizer && (
            <div className="event-detail__organizer-actions">
              <Link to={`/events/${event.id}/edit`} className="btn btn--ghost">
                Edit event
              </Link>
              {(event.status === "quorum_reached" || event.status === "confirmed") && (
                <Link to={`/events/${event.id}/manage`} className="btn btn--primary">
                  Manage event
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Cover image */}
        {event.imageKey && (
          <img
            src={event.imageKey.startsWith("https://") ? event.imageKey : `/images/${event.imageKey}`}
            alt={event.title}
            className="event-detail__image"
          />
        )}

        {/* Description */}
        <div className="event-detail__description">
          {event.description.split("\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        {/* ═══ Time Slots — always visible ═══ */}
        <div className="event-detail__slots">
          <h2>{canCommit && committableSlotIds.length > 0 ? "When are you available?" : "Time Slots"}</h2>

          {slots.length === 0 ? (
            <p className="event-detail__no-slots">No time slots added yet.</p>
          ) : (
            <>
              {/* ── Commit form (only for non-organizers with committable slots) ── */}
              {canCommit && committableSlotIds.length > 0 ? (
                <fetcher.Form method="post" className="commit-form">
                  <input type="hidden" name="intent" value="batch_commit" />
                  <input type="hidden" name="slotIds" value={Array.from(checkedSlots).join(",")} />
                  {selectedTier && (
                    <>
                      <input type="hidden" name="tierLabel" value={selectedTier.label} />
                      <input type="hidden" name="tierAmount" value={String(selectedTier.amount)} />
                    </>
                  )}

                  {/* Identity bar */}
                  <div className="commit-identity">
                    {isSignedIn ? (
                      <div className="commit-identity__signed-in">
                        <span className="commit-identity__check">✓</span>
                        <span>Committing as <strong>{userName ?? "you"}</strong></span>
                      </div>
                    ) : (
                      <div className="commit-identity__guest">
                        <div className="commit-identity__fields">
                          <input type="text" name="guestName" placeholder="Your name *" required className="field__input commit-identity__input" />
                          <input type="email" name="guestEmail" placeholder="Email * (only seen by host)" required className="field__input commit-identity__input" />
                          <input type="tel" name="guestPhone" placeholder="Phone (only seen by host)" className="field__input commit-identity__input" />
                        </div>
                        <p className="commit-identity__privacy">Your name is public. Email and phone are only visible to the event host.</p>
                        <a href="/auth/login" className="btn btn--ghost btn--sm commit-identity__signin">
                          Sign in with Google
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Tier selector (if paid event) */}
                  {costTiers.length > 0 && (
                    <div className="commit-tiers">
                      <p className="commit-tiers__label">Select your tier:</p>
                      <div className="commit-tiers__options">
                        {costTiers.map((t) => (
                          <label key={t.label} className={`commit-tier-chip${selectedTierLabel === t.label ? " commit-tier-chip--selected" : ""}`}>
                            <input type="radio" name="tierSelect" value={t.label} checked={selectedTierLabel === t.label} onChange={() => setSelectedTierLabel(t.label)} className="sr-only" />
                            <span className="commit-tier-chip__label">{t.label}</span>
                            <span className="commit-tier-chip__price">{formatCents(t.amount)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {fetcher.data?.error && (
                    <p className="commit-form__error">{fetcher.data.error}</p>
                  )}

                  <p className="commit-form__hint">
                    Select all dates you're available for — you'll be notified when quorum is reached.
                  </p>

                  {/* Slot checkboxes */}
                  <div className="commit-slots">
                    {slots.map((slot) => {
                      const alreadyCommitted = myCommittedSlotIds.includes(slot.id);
                      const locked = slot.status === "confirmed";
                      const canCheck = !alreadyCommitted && slot.status !== "confirmed";
                      const isChecked = checkedSlots.has(slot.id);
                      const isPriceQuorum = event.priceQuorumCents != null;
                      const pledgedCents = pledgedBySlotId[slot.id] ?? 0;
                      const pct = isPriceQuorum
                        ? Math.min(100, (pledgedCents / event.priceQuorumCents!) * 100)
                        : Math.min(100, (slot.commitmentCount / event.threshold) * 100);
                      const progressLabel = isPriceQuorum
                        ? `$${(pledgedCents / 100).toFixed(0)} / $${(event.priceQuorumCents! / 100).toFixed(0)}`
                        : `${slot.commitmentCount} / ${event.threshold}`;

                      return (
                        <label key={slot.id} className={`commit-slot${isChecked ? " commit-slot--checked" : ""}${alreadyCommitted ? " commit-slot--committed" : ""}${locked ? " commit-slot--locked" : ""}`}>
                          <div className="commit-slot__check">
                            {alreadyCommitted ? (
                              <span className="commit-slot__done">✓</span>
                            ) : canCheck ? (
                              <input type="checkbox" checked={isChecked} onChange={() => toggleSlot(slot.id)} className="commit-slot__checkbox" />
                            ) : (
                              <span className="commit-slot__lock">—</span>
                            )}
                          </div>
                          <div className="commit-slot__info">
                            <div className="commit-slot__time">
                              {formatInTimezone(slot.startsAt, event.timezone)}
                              {" – "}
                              {formatTimeOnly(slot.endsAt, event.timezone)}
                            </div>
                            {alreadyCommitted && <span className="commit-slot__badge commit-slot__badge--you">You're in</span>}
                            {slot.status === "quorum_reached" && !alreadyCommitted && <span className="commit-slot__badge commit-slot__badge--quorum">Quorum reached — join now</span>}
                            {locked && !alreadyCommitted && <span className="commit-slot__badge commit-slot__badge--locked">Locked by host</span>}
                          </div>
                          <div className="commit-slot__progress">
                            <div className="slot-card__bar"><div className="slot-card__fill" style={{ width: `${pct}%` }} /></div>
                            <span className="commit-slot__count">{progressLabel}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <button type="submit" className="btn btn--primary commit-form__submit" disabled={pending || !canSubmit}>
                    {pending ? "Committing…" : `Commit to ${checkedSlots.size} slot${checkedSlots.size !== 1 ? "s" : ""}`}
                  </button>
                </fetcher.Form>
              ) : (
                /* ── Read-only slot list (organizer view, or all committed, or deadline passed) ── */
                <div className="commit-slots">
                  {slots.map((slot) => {
                    const alreadyCommitted = myCommittedSlotIds.includes(slot.id);
                    const locked = slot.status === "confirmed";
                    const isPriceQuorum = event.priceQuorumCents != null;
                    const pledgedCents = pledgedBySlotId[slot.id] ?? 0;
                    const pct = isPriceQuorum
                      ? Math.min(100, (pledgedCents / event.priceQuorumCents!) * 100)
                      : Math.min(100, (slot.commitmentCount / event.threshold) * 100);
                    const progressLabel = isPriceQuorum
                      ? `$${(pledgedCents / 100).toFixed(0)} / $${(event.priceQuorumCents! / 100).toFixed(0)}`
                      : `${slot.commitmentCount} / ${event.threshold}`;
                    const slotParticipants = bySlot[slot.id] ?? [];

                    return (
                      <div key={slot.id} className={`commit-slot commit-slot--readonly${alreadyCommitted ? " commit-slot--committed" : ""}${locked ? " commit-slot--locked" : ""}`}>
                        <div className="commit-slot__check">
                          {alreadyCommitted ? <span className="commit-slot__done">✓</span> : <span className="commit-slot__lock">—</span>}
                        </div>
                        <div className="commit-slot__info">
                          <div className="commit-slot__time">
                            {formatInTimezone(slot.startsAt, event.timezone)}
                            {" – "}
                            {formatTimeOnly(slot.endsAt, event.timezone)}
                          </div>
                          {alreadyCommitted && <span className="commit-slot__badge commit-slot__badge--you">You're in</span>}
                          {slot.status === "quorum_reached" && <span className="commit-slot__badge commit-slot__badge--quorum">Quorum reached</span>}
                          {locked && <span className="commit-slot__badge commit-slot__badge--locked">Locked by host</span>}
                          {slotParticipants.length > 0 && (
                            <span className="commit-slot__badge" style={{ color: "var(--color-muted)" }}>
                              {slotParticipants.length} committed
                            </span>
                          )}
                        </div>
                        <div className="commit-slot__progress">
                          <div className="slot-card__bar"><div className="slot-card__fill" style={{ width: `${pct}%` }} /></div>
                          <span className="commit-slot__count">{progressLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Withdraw rows (signed-in users with existing commitments) */}
              {myCommittedSlotIds.length > 0 && (
                <div className="commit-withdrawals">
                  {slots.filter((s) => myCommittedSlotIds.includes(s.id)).map((slot) => {
                    const locked = slot.status === "confirmed";
                    const tier = myTierBySlotId[slot.id];
                    return (
                      <div key={slot.id} className="commit-withdrawal-row">
                        <span className="commit-withdrawal-row__label">
                          ✓{" "}
                          {formatInTimezone(slot.startsAt, event.timezone)}
                          {tier?.tierLabel ? ` — ${tier.tierLabel}` : ""}
                        </span>
                        {locked || deadlinePassed ? (
                          <span className="commit-withdrawal-row__locked">{locked ? "Locked" : "Deadline passed"}</span>
                        ) : (
                          <fetcher.Form method="post" style={{ display: "inline" }}>
                            <input type="hidden" name="intent" value="withdraw" />
                            <input type="hidden" name="slotId" value={slot.id} />
                            <button type="submit" className="btn btn--ghost btn--sm" disabled={pending}>Withdraw</button>
                          </fetcher.Form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Participant lists per slot — always visible */}
              {slots.some((s) => (bySlot[s.id]?.length ?? 0) > 0) && (
                <div className="commit-participants-section">
                  <h3>Who's committed</h3>
                  {slots.map((slot) => {
                    const slotParticipants = bySlot[slot.id] ?? [];
                    if (slotParticipants.length === 0) return null;
                    return (
                      <div key={slot.id} className="commit-participants-slot">
                        <p className="commit-participants-slot__label">
                          {formatInTimezone(slot.startsAt, event.timezone, { weekday: "short", month: "short", day: "numeric" })}
                          {" — "}{slotParticipants.length} committed
                        </p>
                        <ul className="participant-list">
                          {slotParticipants.map((p, i) => (
                            <li key={i} className="participant">
                              {p.avatarUrl ? (
                                <img src={p.avatarUrl} alt={p.name} className="participant__avatar" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="participant__avatar participant__avatar--initials">{p.name[0]?.toUpperCase() ?? "?"}</span>
                              )}
                              {p.userId ? (
                                <a href={`/users/${p.userId}`} className="participant__name">{p.name}</a>
                              ) : (
                                <span className="participant__name">{p.name}<span className="participant__guest-badge">guest</span></span>
                              )}
                              {p.reputationScore !== null && !p.isGuest && (
                                <span className="participant__rep">{Math.round(Number(p.reputationScore))}%</span>
                              )}
                              {p.isGuest && isOrganizer && (p.guestEmail || p.guestPhone) && (
                                <span className="participant__email">
                                  {[p.guestEmail, p.guestPhone].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

