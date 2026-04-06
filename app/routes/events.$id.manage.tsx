import { useState } from "react";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Form, redirect, useActionData, useFetcher, useLoaderData } from "react-router";
import { requireSession, getSession } from "~/auth.server";
import { formatInTimezone, formatTimeOnly } from "~/components/TimezonePicker";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { attendance, commitments, emailSends, events, timeSlots, users } from "../../db/schema";
import { eventConfirmedEmail, hostUpdateEmail, sendAndLog, sendMail } from "~/email.server";
import { RespondentsTable } from "~/components/RespondentsTable";
import { SendUpdateModal } from "~/components/SendUpdateModal";
import type { Route } from "./+types/events.$id.manage";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader(args: Route.LoaderArgs) {
  const { params, context } = args;
  const db = getDb(getEnv(context));
  const session = await requireSession(args.request, args.context.cloudflare.env);
  const dbUser = { id: session.id };

  // Load event
  const [row] = await db
    .select()
    .from(events)
    .where(eq(events.id, params.id))
    .limit(1);
  if (!row) throw new Response("Not Found", { status: 404 });

  // Only the organizer may access this page
  if (row.organizerId !== dbUser.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  // Load all time slots
  const slots = await db
    .select()
    .from(timeSlots)
    .where(eq(timeSlots.eventId, params.id))
    .orderBy(timeSlots.startsAt);

  // Load committed participants — enriched for respondent table (Phase B)
  // Signed-in users: includes avatar, reputation, tier, commit timestamp
  const signedInRows = await db
    .select({
      commitmentId: commitments.id,
      slotId: commitments.timeSlotId,
      userId: users.id,
      name: users.fullName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      reputationScore: users.reputationScore,
      tierLabel: commitments.tierLabel,
      tierAmount: commitments.tierAmount,
      createdAt: commitments.createdAt,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(commitments.createdAt);

  // Guest participants (userId is null)
  const guestRows = await db
    .select({
      commitmentId: commitments.id,
      slotId: commitments.timeSlotId,
      name: commitments.guestName,
      email: commitments.guestEmail,
      phone: commitments.guestPhone,
      tierLabel: commitments.tierLabel,
      tierAmount: commitments.tierAmount,
      createdAt: commitments.createdAt,
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

  // ── Per-slot participant map (kept for slot confirm/attendance sections) ──
  const participantsBySlot: Record<
    string,
    { commitmentId: string; userId: string | null; name: string; email: string | null; phone?: string | null; isGuest: boolean }[]
  > = {};
  for (const p of signedInRows) {
    (participantsBySlot[p.slotId] ??= []).push({
      commitmentId: p.commitmentId,
      userId: p.userId,
      name: p.name,
      email: p.email,
      isGuest: false,
    });
  }
  for (const p of guestRows) {
    (participantsBySlot[p.slotId] ??= []).push({
      commitmentId: p.commitmentId,
      userId: null,
      name: p.name ?? "Guest",
      email: p.email,
      phone: p.phone,
      isGuest: true,
    });
  }

  // ── Person-centric respondent list (Phase B: unified table) ──
  // Group by userId (signed-in) or by commitmentId cluster for guests
  type SlotInfo = {
    slotId: string;
    commitmentId: string;
    startsAt: string;
    tierLabel: string | null;
    tierAmount: number | null;
    createdAt: string;
    slotStatus: string;
  };
  type Respondent = {
    key: string;
    name: string;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    reputationScore: number | null;
    isGuest: boolean;
    userId: string | null;
    slots: SlotInfo[];
    firstCommitAt: string;
  };

  const slotMap = new Map(slots.map((s) => [s.id, s]));
  const respondentMap = new Map<string, Respondent>();

  for (const p of signedInRows) {
    const slot = slotMap.get(p.slotId);
    const key = p.userId;
    const existing = respondentMap.get(key);
    const slotInfo: SlotInfo = {
      slotId: p.slotId,
      commitmentId: p.commitmentId,
      startsAt: slot?.startsAt ?? "",
      tierLabel: p.tierLabel,
      tierAmount: p.tierAmount,
      createdAt: p.createdAt,
      slotStatus: slot?.status ?? "active",
    };
    if (existing) {
      existing.slots.push(slotInfo);
      if (p.createdAt < existing.firstCommitAt) existing.firstCommitAt = p.createdAt;
    } else {
      respondentMap.set(key, {
        key,
        name: p.name,
        email: p.email,
        phone: null,
        avatarUrl: p.avatarUrl,
        reputationScore: p.reputationScore,
        isGuest: false,
        userId: p.userId,
        slots: [slotInfo],
        firstCommitAt: p.createdAt,
      });
    }
  }

  for (const p of guestRows) {
    const slot = slotMap.get(p.slotId);
    // Group guests by email when available, otherwise per-commitment
    const key = p.email ? `guest:${p.email}` : `guest-c:${p.commitmentId}`;
    const existing = respondentMap.get(key);
    const slotInfo: SlotInfo = {
      slotId: p.slotId,
      commitmentId: p.commitmentId,
      startsAt: slot?.startsAt ?? "",
      tierLabel: p.tierLabel,
      tierAmount: p.tierAmount,
      createdAt: p.createdAt,
      slotStatus: slot?.status ?? "active",
    };
    if (existing) {
      existing.slots.push(slotInfo);
      if (p.createdAt < existing.firstCommitAt) existing.firstCommitAt = p.createdAt;
    } else {
      respondentMap.set(key, {
        key,
        name: p.name ?? "Guest",
        email: p.email,
        phone: p.phone,
        avatarUrl: null,
        reputationScore: null,
        isGuest: true,
        userId: null,
        slots: [slotInfo],
        firstCommitAt: p.createdAt,
      });
    }
  }

  const respondents = Array.from(respondentMap.values());

  // Attendance records for this event — dual-keyed (userId for signed-in, commitmentId for guests)
  const attendanceRows = await db
    .select({
      userId: attendance.userId,
      commitmentId: attendance.commitmentId,
      registered: attendance.registered,
    })
    .from(attendance)
    .where(eq(attendance.eventId, params.id));
  const attendanceByUser: Record<string, boolean> = {};
  const attendanceByCommitment: Record<string, boolean> = {};
  for (const r of attendanceRows) {
    if (r.userId) attendanceByUser[r.userId] = r.registered;
    if (r.commitmentId) attendanceByCommitment[r.commitmentId] = r.registered;
  }

  // Surface flash message from previous confirm action (email send results)
  const url = new URL(args.request.url);
  const confirmFlash = url.searchParams.get("confirmed");
  let flash: { sent: number; failed: number; failedEmails: string[] } | null = null;
  if (confirmFlash) {
    try {
      flash = JSON.parse(decodeURIComponent(confirmFlash));
    } catch { /* ignore malformed */ }
  }

  // ── C6: Email send log (most recent 50) ──
  const emailLog = await db
    .select({
      id: emailSends.id,
      recipientEmail: emailSends.recipientEmail,
      subject: emailSends.subject,
      templateName: emailSends.templateName,
      status: emailSends.status,
      errorMsg: emailSends.errorMsg,
      sentAt: emailSends.sentAt,
    })
    .from(emailSends)
    .where(eq(emailSends.eventId, params.id))
    .orderBy(desc(emailSends.sentAt))
    .limit(50);

  // Host name for Send Update modal
  const hostName = session.fullName ?? "Event host";

  return { event: row, slots, participantsBySlot, respondents, attendanceByUser, attendanceByCommitment, flash, emailLog, hostName };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action(args: Route.ActionArgs) {
  const { params, request, context } = args;
  const env = getEnv(context);
  const db = getDb(env);
  const session = await requireSession(request, env);
  const dbUser = { id: session.id };

  // Load event — must belong to this organizer
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, params.id), eq(events.organizerId, dbUser.id)))
    .limit(1);
  if (!event) throw new Response("Not Found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  const slotId = form.get("slotId") as string;
  const registrationUrl = (form.get("registrationUrl") as string)?.trim();
  const hostMessage = (form.get("hostMessage") as string) || null; // C2

  if (intent === "confirm") {
    if (!slotId) return { error: "Missing slot." };
    if (!registrationUrl) return { error: "Registration URL is required." };

    // Basic URL validation
    try {
      new URL(registrationUrl);
    } catch {
      return { error: "Please enter a valid URL (include https://)." };
    }

    // Verify the slot belongs to this event and is not already confirmed
    const [slot] = await db
      .select()
      .from(timeSlots)
      .where(and(eq(timeSlots.id, slotId), eq(timeSlots.eventId, params.id)))
      .limit(1);
    if (!slot) return { error: "Slot not found." };
    if (slot.status === "confirmed") {
      return { error: "This slot is already confirmed." };
    }

    // Confirm the slot — write registration URL PER-SLOT (B1 fix)
    await db
      .update(timeSlots)
      .set({ status: "confirmed", registrationUrl })
      .where(eq(timeSlots.id, slotId));

    // Bump event status to confirmed. Keep event-level registrationUrl in sync
    // with the MOST RECENT confirmation (backward compat for any callers still
    // reading event.registrationUrl). Per-slot URL is now authoritative.
    await db
      .update(events)
      .set({ status: "confirmed", registrationUrl, updatedAt: new Date().toISOString() })
      .where(eq(events.id, params.id));

    // Email all committed participants on this slot (signed-in + guests)
    const slotDate = formatInTimezone(slot.startsAt, event.timezone ?? "Pacific/Honolulu", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const baseUrl = new URL(request.url).origin;

    // Signed-in user emails
    const signedInEmails = await db
      .select({ email: users.email })
      .from(commitments)
      .innerJoin(users, eq(users.id, commitments.userId))
      .where(
        and(
          eq(commitments.timeSlotId, slotId),
          isNull(commitments.withdrawnAt)
        )
      );

    // Guest emails
    const guestEmails = await db
      .select({ email: commitments.guestEmail })
      .from(commitments)
      .where(
        and(
          eq(commitments.timeSlotId, slotId),
          isNull(commitments.withdrawnAt),
          isNull(commitments.userId),
        )
      );

    const allEmails = [
      ...signedInEmails.map((r) => r.email),
      ...guestEmails.map((r) => r.email).filter(Boolean),
    ] as string[];

    // C2: pass hostMessage to template. C6: sendAndLog for audit trail.
    const tpl = eventConfirmedEmail(
      event.title,
      params.id,
      slotDate,
      registrationUrl,
      baseUrl,
      hostMessage
    );
    const results = await Promise.allSettled(
      allEmails.map((to) =>
        sendAndLog(env, db, params.id, "event_confirmed", { to, ...tpl })
      )
    );
    let sent = 0;
    const failedEmails: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.status === "sent") {
        sent += 1;
      } else {
        failedEmails.push(allEmails[i]);
      }
    });
    const flash = { sent, failed: failedEmails.length, failedEmails };
    const flashParam = encodeURIComponent(JSON.stringify(flash));
    return redirect(`/events/${params.id}/manage?confirmed=${flashParam}`);
  }

  if (intent === "mark_attendance") {
    const targetUserId = (form.get("userId") as string) || null;
    const targetCommitmentId = (form.get("commitmentId") as string) || null;
    const registered = form.get("registered") === "true";
    if (!targetUserId && !targetCommitmentId) {
      return { error: "Missing userId or commitmentId." };
    }

    // Look up existing attendance row by whichever key was provided.
    // userId path = signed-in participants (back-compat)
    // commitmentId path = guests (B5 unlock)
    const existingWhere = targetCommitmentId
      ? and(
          eq(attendance.commitmentId, targetCommitmentId),
          eq(attendance.eventId, params.id)
        )
      : and(
          eq(attendance.userId, targetUserId!),
          eq(attendance.eventId, params.id)
        );
    const [existing] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(existingWhere)
      .limit(1);

    if (existing) {
      await db
        .update(attendance)
        .set({ registered, markedAt: new Date().toISOString() })
        .where(eq(attendance.id, existing.id));
    } else {
      await db.insert(attendance).values({
        userId: targetUserId,
        commitmentId: targetCommitmentId,
        eventId: params.id,
        registered,
        markedAt: new Date().toISOString(),
      });
    }
    // B6: bump event updatedAt
    await db
      .update(events)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(events.id, params.id));
    return { ok: true };
  }

  if (intent === "complete_event") {
    if (event.status !== "confirmed") {
      return { error: "Event must be confirmed before it can be completed." };
    }

    // Mark event as completed
    await db
      .update(events)
      .set({ status: "completed", updatedAt: new Date().toISOString() })
      .where(eq(events.id, params.id));

    // Recalculate reputation for all SIGNED-IN participants who committed.
    // Guest commits (userId null) are skipped — reputation requires a user row.
    const committedUsers = await db
      .selectDistinct({ userId: commitments.userId })
      .from(commitments)
      .where(
        and(
          eq(commitments.eventId, params.id),
          isNull(commitments.withdrawnAt)
        )
      );

    for (const { userId } of committedUsers) {
      if (!userId) continue; // skip guest rows
      // Count distinct confirmed/completed events they committed to
      const [committedRow] = await db
        .select({
          count: sql<number>`count(distinct ${commitments.eventId})`,
        })
        .from(commitments)
        .innerJoin(events, eq(events.id, commitments.eventId))
        .where(
          and(
            eq(commitments.userId, userId),
            isNull(commitments.withdrawnAt),
            inArray(events.status, ["confirmed", "completed"])
          )
        );

      // Count events they registered for
      const [registeredRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(attendance)
        .where(
          and(eq(attendance.userId, userId), eq(attendance.registered, true))
        );

      const committedToConfirmed = Number(committedRow?.count ?? 0);
      const registeredCount = Number(registeredRow?.count ?? 0);
      const newScore =
        committedToConfirmed > 0
          ? Math.round((registeredCount / committedToConfirmed) * 100)
          : 100;

      await db
        .update(users)
        .set({ reputationScore: newScore })
        .where(eq(users.id, userId));
    }

    return redirect(`/events/${params.id}/manage`);
  }

  // ── Remove participant (organizer kicks a duplicate or wrong entry) ────────
  if (intent === "remove_participant") {
    const commitmentId = form.get("commitmentId") as string;
    if (!commitmentId) return { error: "Missing commitment." };

    // Verify the commitment belongs to this event
    const [commitment] = await db
      .select({ id: commitments.id, timeSlotId: commitments.timeSlotId })
      .from(commitments)
      .where(
        and(
          eq(commitments.id, commitmentId),
          eq(commitments.eventId, params.id),
          isNull(commitments.withdrawnAt)
        )
      )
      .limit(1);
    if (!commitment) return { error: "Commitment not found." };

    // Soft-delete the commitment
    await db
      .update(commitments)
      .set({ withdrawnAt: new Date().toISOString() })
      .where(eq(commitments.id, commitment.id));

    // Decrement the slot counter
    const [slot] = await db
      .select({ commitmentCount: timeSlots.commitmentCount, status: timeSlots.status })
      .from(timeSlots)
      .where(eq(timeSlots.id, commitment.timeSlotId))
      .limit(1);
    if (slot) {
      const newCount = Math.max(0, slot.commitmentCount - 1);
      await db
        .update(timeSlots)
        .set({ commitmentCount: newCount })
        .where(eq(timeSlots.id, commitment.timeSlotId));

      // If this drops below threshold and slot was quorum_reached, revert
      if (slot.status === "quorum_reached" && newCount < event.threshold) {
        await db
          .update(timeSlots)
          .set({ status: "active" })
          .where(eq(timeSlots.id, commitment.timeSlotId));
      }
    }

    // B6: bump event updatedAt
    await db
      .update(events)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(events.id, params.id));
    return redirect(`/events/${params.id}/manage`);
  }

  // ── C3: Send Update (ad-hoc email to selected participants) ────────────
  if (intent === "send_update") {
    const recipientEmails = ((form.get("recipientEmails") as string) ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const updateSubject = ((form.get("subject") as string) ?? "").trim();
    const updateBody = ((form.get("body") as string) ?? "").trim();

    if (recipientEmails.length === 0) return { error: "No recipients selected." };
    if (!updateSubject) return { error: "Subject is required." };
    if (!updateBody) return { error: "Message body is required." };

    // Get host name
    const hostUser = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1);
    const hostName = hostUser[0]?.fullName ?? "Event host";
    const baseUrl = new URL(request.url).origin;

    const tpl = hostUpdateEmail(
      event.title,
      params.id,
      updateSubject,
      updateBody,
      hostName,
      baseUrl
    );

    const results = await Promise.allSettled(
      recipientEmails.map((to) =>
        sendAndLog(env, db, params.id, "host_update", { to, ...tpl })
      )
    );

    let sent = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.status === "sent") sent++;
      else failed++;
    }

    return { sent, failed };
  }

  return { error: "Unknown action." };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLOT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  quorum_reached: "Quorum Reached",
  confirmed: "Confirmed",
};

function fmt(date: string | Date, tz?: string) {
  return formatInTimezone(date, tz ?? "Pacific/Honolulu");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManageEvent() {
  const { event, slots, participantsBySlot, respondents, attendanceByUser, attendanceByCommitment, flash, emailLog, hostName } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const attendanceFetcher = useFetcher();

  // C3/C4: Send Update modal state
  const [showSendModal, setShowSendModal] = useState(false);
  const [preSelectedEmails, setPreSelectedEmails] = useState<string[] | undefined>(undefined);

  // All recipients with emails (for modal)
  const allRecipients = respondents
    .filter((r: any) => r.email)
    .map((r: any) => ({ email: r.email as string, name: r.name as string }));

  function openSendModal(preSelected?: string[]) {
    setPreSelectedEmails(preSelected);
    setShowSendModal(true);
  }

  const quorumSlots = slots.filter((s) => s.status === "quorum_reached");
  const confirmedSlots = slots.filter((s) => s.status === "confirmed");
  const activeSlots = slots.filter((s) => s.status === "active");

  // Optimistic attendance state — dual-keyed (userId for signed-in, commitmentId for guests)
  const optimisticByUser: Record<string, boolean> = { ...attendanceByUser };
  const optimisticByCommitment: Record<string, boolean> = { ...attendanceByCommitment };
  if (
    attendanceFetcher.state !== "idle" &&
    attendanceFetcher.formData?.get("intent") === "mark_attendance"
  ) {
    const uid = attendanceFetcher.formData.get("userId") as string | null;
    const cid = attendanceFetcher.formData.get("commitmentId") as string | null;
    const reg = attendanceFetcher.formData.get("registered") === "true";
    if (uid) optimisticByUser[uid] = reg;
    if (cid) optimisticByCommitment[cid] = reg;
  }

  return (
    <section className="page-section">
      <div className="manage-event">
        {/* Header */}
        <div className="manage-event__header">
          <div>
            <span className={`badge badge--${event.status}`}>
              {event.status === "quorum_reached"
                ? "Quorum Reached"
                : event.status === "confirmed"
                ? "Confirmed"
                : event.status}
            </span>
            <h1 className="manage-event__title">{event.title}</h1>
            <p className="manage-event__sub">
              {event.location} &middot; Threshold: {event.threshold} commitments
            </p>
          </div>
          <div className="manage-event__header-actions">
            <a href={`/events/${event.id}`} className="btn btn--ghost btn--sm">
              View public page
            </a>
            <a
              href={`/events/${event.id}/edit`}
              className="btn btn--ghost btn--sm"
            >
              Edit event
            </a>
            {allRecipients.length > 0 && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => openSendModal()}
              >
                Send Update
              </button>
            )}
          </div>
        </div>

        {actionData && "error" in actionData && (
          <p className="manage-event__error">{actionData.error}</p>
        )}

        {/* B2: Flash message — email send results after confirm */}
        {flash && (
          <div
            className={
              flash.failed > 0
                ? "manage-event__flash manage-event__flash--warn"
                : "manage-event__flash manage-event__flash--ok"
            }
            role="status"
          >
            {flash.failed === 0 ? (
              <>✅ Confirmed. Emailed all {flash.sent} participant{flash.sent !== 1 ? "s" : ""}.</>
            ) : (
              <>
                ⚠ Confirmed, but {flash.failed} of {flash.sent + flash.failed} email
                {flash.sent + flash.failed !== 1 ? "s" : ""} failed to send.
                {flash.failedEmails.length > 0 && (
                  <> Failed: {flash.failedEmails.join(", ")}</>
                )}
                {" "}Check your Resend logs or resend manually.
              </>
            )}
          </div>
        )}

        {/* ═══ Unified Respondents Table (Phase B) ═══ */}
        <RespondentsTable
          respondents={respondents}
          eventId={event.id}
          timezone={event.timezone}
          slotOptions={slots.map((s) => ({ id: s.id, startsAt: s.startsAt }))}
          onEmailSelected={(emails) => openSendModal(emails)}
        />

        {/* Slots needing confirmation */}
        {quorumSlots.length > 0 && (
          <div className="manage-section">
            <h2 className="manage-section__title">
              🎯 Ready to confirm ({quorumSlots.length})
            </h2>
            <p className="manage-section__desc">
              These slots have reached quorum. Enter a registration URL and
              confirm each one to notify participants.
            </p>
            <ul className="manage-slot-list">
              {quorumSlots.map((slot) => {
                const participants = participantsBySlot[slot.id] ?? [];
                return (
                  <li key={slot.id} className="manage-slot-card manage-slot-card--quorum">
                    <div className="manage-slot-card__time">
                      <strong>{fmt(slot.startsAt, event.timezone)}</strong>
                      <span className="manage-slot-card__dash">&ndash;</span>
                      <span>
                        {formatTimeOnly(slot.endsAt, event.timezone)}
                      </span>
                      <span className="badge badge--quorum_reached">
                        {slot.commitmentCount} committed
                      </span>
                    </div>

                    {participants.length > 0 && (
                      <ul className="manage-participant-list">
                        {participants.map((p) => (
                          <li key={p.commitmentId} className="manage-participant-item">
                            <span className="manage-participant-name">
                              {p.name}
                              {p.isGuest && <span className="manage-participant-badge">guest</span>}
                            </span>
                            {p.email && <span className="manage-participant-contact">{p.email}</span>}
                            {p.isGuest && p.phone && <span className="manage-participant-contact">{p.phone}</span>}
                            <Form method="post" style={{ display: "inline" }} onSubmit={(e) => {
                              if (!window.confirm(`Remove ${p.name} from this slot?`)) e.preventDefault();
                            }}>
                              <input type="hidden" name="intent" value="remove_participant" />
                              <input type="hidden" name="commitmentId" value={p.commitmentId} />
                              <button type="submit" className="btn btn--ghost btn--xs manage-participant-remove">Remove</button>
                            </Form>
                          </li>
                        ))}
                      </ul>
                    )}

                    <Form
                      method="post"
                      className="manage-confirm-form"
                      onSubmit={(e) => {
                        const count = participants.length;
                        if (
                          !window.confirm(
                            `Confirm this slot and email ${count} participant${count !== 1 ? "s" : ""}? This will notify everyone who committed.`
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="confirm" />
                      <input type="hidden" name="slotId" value={slot.id} />
                      <div className="manage-confirm-form__field">
                        <label
                          htmlFor={`reg-${slot.id}`}
                          className="manage-confirm-form__label"
                        >
                          Registration URL
                        </label>
                        <input
                          id={`reg-${slot.id}`}
                          type="url"
                          name="registrationUrl"
                          placeholder="https://..."
                          required
                          defaultValue={slot.registrationUrl ?? event.registrationUrl ?? ""}
                          className="manage-confirm-form__input"
                        />
                      </div>
                      <div className="manage-confirm-form__field">
                        <label htmlFor={`msg-${slot.id}`} className="manage-confirm-form__label">
                          Note to participants (optional)
                        </label>
                        <textarea
                          id={`msg-${slot.id}`}
                          name="hostMessage"
                          className="manage-confirm-form__input"
                          rows={2}
                          placeholder="e.g. Parking is available at the back entrance..."
                        />
                      </div>
                      <button type="submit" className="btn btn--primary">
                        Confirm this slot →
                      </button>
                      <p className="manage-confirm-form__hint">
                        This will email all committed participants with the registration link.
                      </p>
                    </Form>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Already confirmed slots */}
        {confirmedSlots.length > 0 && (
          <div className="manage-section">
            <h2 className="manage-section__title">
              ✅ Confirmed ({confirmedSlots.length})
            </h2>
            <p className="manage-section__desc">
              Mark which participants actually registered. This updates their
              reputation score when you complete the event.
            </p>
            <ul className="manage-slot-list">
              {confirmedSlots.map((slot) => {
                const participants = participantsBySlot[slot.id] ?? [];
                return (
                  <li
                    key={slot.id}
                    className="manage-slot-card manage-slot-card--confirmed"
                  >
                    <div className="manage-slot-card__time">
                      <strong>{fmt(slot.startsAt, event.timezone)}</strong>
                      <span className="manage-slot-card__dash">&ndash;</span>
                      <span>
                        {formatTimeOnly(slot.endsAt, event.timezone)}
                      </span>
                      <span className="badge badge--confirmed">
                        {slot.commitmentCount} committed
                      </span>
                    </div>
                    {(slot.registrationUrl ?? event.registrationUrl) && (
                      <p className="manage-slot-card__reg-url">
                        Registration:{" "}
                        <a
                          href={slot.registrationUrl ?? event.registrationUrl!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {slot.registrationUrl ?? event.registrationUrl}
                        </a>
                      </p>
                    )}
                    {participants.length > 0 && (
                      <div className="manage-attendance">
                        <p className="manage-attendance__label">
                          Attendance — check participants who registered:
                        </p>
                        <ul className="manage-attendance-list">
                          {participants.map((p) => {
                            // B5: Attendance toggle works for BOTH signed-in (keyed by userId)
                            // and guests (keyed by commitmentId).
                            const checked = p.isGuest
                              ? (optimisticByCommitment[p.commitmentId] ?? false)
                              : (optimisticByUser[p.userId!] ?? false);
                            return (
                              <li
                                key={p.commitmentId}
                                className="manage-attendance-item"
                              >
                                <attendanceFetcher.Form
                                  method="post"
                                  className="manage-attendance-form"
                                >
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="mark_attendance"
                                  />
                                  {p.isGuest ? (
                                    <input
                                      type="hidden"
                                      name="commitmentId"
                                      value={p.commitmentId}
                                    />
                                  ) : (
                                    <input
                                      type="hidden"
                                      name="userId"
                                      value={p.userId!}
                                    />
                                  )}
                                  <input
                                    type="hidden"
                                    name="registered"
                                    value={String(!checked)}
                                  />
                                  <button
                                    type="submit"
                                    className={`manage-attendance-btn${checked ? " manage-attendance-btn--checked" : ""}`}
                                    title={
                                      checked
                                        ? "Mark as not registered"
                                        : "Mark as registered"
                                    }
                                  >
                                    {checked ? "✓" : "○"}
                                  </button>
                                </attendanceFetcher.Form>
                                <span className="manage-attendance-name">
                                  {p.name}
                                  {p.isGuest && <span className="manage-participant-badge">guest</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Complete Event */}
            {event.status === "confirmed" && (
              <Form method="post" className="manage-complete-form">
                <input type="hidden" name="intent" value="complete_event" />
                <p className="manage-complete-form__desc">
                  Once you've marked attendance, complete the event to lock in
                  reputation scores for all participants.
                </p>
                <button type="submit" className="btn btn--success">
                  Complete Event
                </button>
              </Form>
            )}
            {event.status === "completed" && (
              <p className="manage-complete-done">
                🎊 Event completed — reputation scores have been updated.
              </p>
            )}
          </div>
        )}

        {/* Active slots — host can confirm ANY slot, not just quorum-reached */}
        {activeSlots.length > 0 && (
          <div className="manage-section">
            <h2 className="manage-section__title">
              ⏳ Gathering commitments ({activeSlots.length})
            </h2>
            <p className="manage-section__desc">
              You can confirm any slot — quorum is a minimum, not a requirement to proceed.
            </p>
            <ul className="manage-slot-list">
              {activeSlots.map((slot) => {
                const participants = participantsBySlot[slot.id] ?? [];
                return (
                  <li key={slot.id} className="manage-slot-card">
                    <div className="manage-slot-card__time">
                      <strong>{fmt(slot.startsAt, event.timezone)}</strong>
                      <span className="manage-slot-card__dash">&ndash;</span>
                      <span>
                        {formatTimeOnly(slot.endsAt, event.timezone)}
                      </span>
                      <span className="badge badge--active">
                        {slot.commitmentCount} / {event.threshold} committed
                      </span>
                    </div>
                    {participants.length > 0 && (
                      <ul className="manage-participant-list">
                        {participants.map((p) => (
                          <li key={p.commitmentId} className="manage-participant-item">
                            <span className="manage-participant-name">
                              {p.name}
                              {p.isGuest && <span className="manage-participant-badge">guest</span>}
                            </span>
                            {p.email && <span className="manage-participant-contact">{p.email}</span>}
                            {p.isGuest && p.phone && <span className="manage-participant-contact">{p.phone}</span>}
                            <Form method="post" style={{ display: "inline" }} onSubmit={(e) => {
                              if (!window.confirm(`Remove ${p.name} from this slot?`)) e.preventDefault();
                            }}>
                              <input type="hidden" name="intent" value="remove_participant" />
                              <input type="hidden" name="commitmentId" value={p.commitmentId} />
                              <button type="submit" className="btn btn--ghost btn--xs manage-participant-remove">Remove</button>
                            </Form>
                          </li>
                        ))}
                      </ul>
                    )}

                    <Form
                      method="post"
                      className="manage-confirm-form"
                      onSubmit={(e) => {
                        const count = participants.length;
                        if (
                          !window.confirm(
                            `Confirm this slot and email ${count} participant${count !== 1 ? "s" : ""}? This will notify everyone who committed.`
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="confirm" />
                      <input type="hidden" name="slotId" value={slot.id} />
                      <div className="manage-confirm-form__field">
                        <label
                          htmlFor={`reg-active-${slot.id}`}
                          className="manage-confirm-form__label"
                        >
                          Registration URL
                        </label>
                        <input
                          id={`reg-active-${slot.id}`}
                          type="url"
                          name="registrationUrl"
                          placeholder="https://..."
                          required
                          defaultValue={slot.registrationUrl ?? event.registrationUrl ?? ""}
                          className="manage-confirm-form__input"
                        />
                      </div>
                      <button type="submit" className="btn btn--primary btn--sm">
                        Confirm this date
                      </button>
                      <p className="manage-confirm-form__hint">
                        This will email all committed participants with the registration link.
                      </p>
                    </Form>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {slots.length === 0 && (
          <p className="manage-event__empty">No time slots have been added to this event.</p>
        )}

        {/* ═══ C6: Email Send Log ═══ */}
        {emailLog.length > 0 && (
          <div className="manage-section">
            <h2 className="manage-section__title">
              Communication Log ({emailLog.length})
            </h2>
            <div className="email-log-wrap">
              <table className="email-log-table">
                <thead>
                  <tr>
                    <th className="email-log-th">Recipient</th>
                    <th className="email-log-th">Subject</th>
                    <th className="email-log-th">Type</th>
                    <th className="email-log-th">Status</th>
                    <th className="email-log-th">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {emailLog.map((row: any) => (
                    <tr key={row.id} className="email-log-row">
                      <td className="email-log-td">{row.recipientEmail}</td>
                      <td className="email-log-td email-log-td--subject">{row.subject}</td>
                      <td className="email-log-td">
                        <span className="email-log-type">{row.templateName.replace(/_/g, " ")}</span>
                      </td>
                      <td className="email-log-td">
                        <span className={`email-log-status email-log-status--${row.status}`}>
                          {row.status === "sent" ? "Sent" : "Failed"}
                        </span>
                        {row.errorMsg && (
                          <span className="email-log-error" title={row.errorMsg}>!</span>
                        )}
                      </td>
                      <td className="email-log-td email-log-td--date">
                        {new Date(row.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* C3/C4: Send Update Modal */}
      {showSendModal && (
        <SendUpdateModal
          eventId={event.id}
          eventTitle={event.title}
          allRecipients={allRecipients}
          preSelected={preSelectedEmails}
          hostName={hostName}
          onClose={() => setShowSendModal(false)}
        />
      )}
    </section>
  );
}
