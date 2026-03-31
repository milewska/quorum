import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Form, redirect, useActionData, useFetcher, useLoaderData } from "react-router";
import { requireSession } from "~/auth.server";
import { formatInTimezone, formatTimeOnly } from "~/components/TimezonePicker";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { attendance, commitments, events, timeSlots, users } from "../../db/schema";
import { eventConfirmedEmail, sendMail } from "~/email.server";
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

  // Load committed participants per slot (with userId for attendance tracking)
  const participantRows = await db
    .select({
      slotId: commitments.timeSlotId,
      userId: users.id,
      name: users.fullName,
      email: users.email,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(commitments.createdAt);

  const participantsBySlot: Record<
    string,
    { userId: string; name: string; email: string }[]
  > = {};
  for (const p of participantRows) {
    (participantsBySlot[p.slotId] ??= []).push({
      userId: p.userId,
      name: p.name,
      email: p.email,
    });
  }

  // Attendance records for this event (userId -> registered)
  const attendanceRows = await db
    .select({ userId: attendance.userId, registered: attendance.registered })
    .from(attendance)
    .where(eq(attendance.eventId, params.id));
  const attendanceMap: Record<string, boolean> = Object.fromEntries(
    attendanceRows.map((r) => [r.userId, r.registered])
  );

  return { event: row, slots, participantsBySlot, attendanceMap };
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

  if (intent === "confirm") {
    if (!slotId) return { error: "Missing slot." };
    if (!registrationUrl) return { error: "Registration URL is required." };

    // Basic URL validation
    try {
      new URL(registrationUrl);
    } catch {
      return { error: "Please enter a valid URL (include https://)." };
    }

    // Verify the slot belongs to this event and is quorum_reached
    const [slot] = await db
      .select()
      .from(timeSlots)
      .where(and(eq(timeSlots.id, slotId), eq(timeSlots.eventId, params.id)))
      .limit(1);
    if (!slot) return { error: "Slot not found." };
    if (slot.status !== "quorum_reached") {
      return { error: "This slot has not reached quorum yet." };
    }

    // Confirm the slot
    await db
      .update(timeSlots)
      .set({ status: "confirmed" })
      .where(eq(timeSlots.id, slotId));

    // Confirm the event and store registration URL
    await db
      .update(events)
      .set({ status: "confirmed", registrationUrl, updatedAt: new Date().toISOString() })
      .where(eq(events.id, params.id));

    // Email all committed participants on this slot
    const slotDate = formatInTimezone(slot.startsAt, event.timezone ?? "Pacific/Honolulu", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const baseUrl = new URL(request.url).origin;

    try {
      const participantRows = await db
        .select({ email: users.email })
        .from(commitments)
        .innerJoin(users, eq(users.id, commitments.userId))
        .where(
          and(
            eq(commitments.timeSlotId, slotId),
            isNull(commitments.withdrawnAt)
          )
        );
      for (const p of participantRows) {
        const tpl = eventConfirmedEmail(
          event.title,
          params.id,
          slotDate,
          registrationUrl,
          baseUrl
        );
        await sendMail(env, { to: p.email, ...tpl });
      }
    } catch (e) {
      console.error("Email send failed after confirmation:", e);
    }

    return redirect(`/events/${params.id}/manage`);
  }

  if (intent === "mark_attendance") {
    const targetUserId = form.get("userId") as string;
    const registered = form.get("registered") === "true";
    if (!targetUserId) return { error: "Missing userId." };

    const [existing] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(
        and(
          eq(attendance.userId, targetUserId),
          eq(attendance.eventId, params.id)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(attendance)
        .set({ registered, markedAt: new Date().toISOString() })
        .where(eq(attendance.id, existing.id));
    } else {
      await db.insert(attendance).values({
        userId: targetUserId,
        eventId: params.id,
        registered,
        markedAt: new Date().toISOString(),
      });
    }
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

    // Recalculate reputation for all participants who committed to this event
    const committedUsers = await db
      .selectDistinct({ userId: commitments.userId })
      .from(commitments)
      .where(
        and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
      );

    for (const { userId } of committedUsers) {
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
  const { event, slots, participantsBySlot, attendanceMap } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const attendanceFetcher = useFetcher();

  const quorumSlots = slots.filter((s) => s.status === "quorum_reached");
  const confirmedSlots = slots.filter((s) => s.status === "confirmed");
  const activeSlots = slots.filter((s) => s.status === "active");

  // Optimistic attendance state
  const optimisticAttendance: Record<string, boolean> = { ...attendanceMap };
  if (
    attendanceFetcher.state !== "idle" &&
    attendanceFetcher.formData?.get("intent") === "mark_attendance"
  ) {
    const uid = attendanceFetcher.formData.get("userId") as string;
    const reg = attendanceFetcher.formData.get("registered") === "true";
    if (uid) optimisticAttendance[uid] = reg;
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
          </div>
        </div>

        {actionData && "error" in actionData && (
          <p className="manage-event__error">{actionData.error}</p>
        )}

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
                        {participants.map((p, i) => (
                          <li key={i}>{p.name}</li>
                        ))}
                      </ul>
                    )}

                    <Form method="post" className="manage-confirm-form">
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
                          defaultValue={event.registrationUrl ?? ""}
                          className="manage-confirm-form__input"
                        />
                      </div>
                      <button type="submit" className="btn btn--primary">
                        Confirm this slot →
                      </button>
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
                    {event.registrationUrl && (
                      <p className="manage-slot-card__reg-url">
                        Registration:{" "}
                        <a
                          href={event.registrationUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {event.registrationUrl}
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
                            const checked =
                              optimisticAttendance[p.userId] ?? false;
                            return (
                              <li
                                key={p.userId}
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
                                  <input
                                    type="hidden"
                                    name="userId"
                                    value={p.userId}
                                  />
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

        {/* Active slots (still gathering commitments) */}
        {activeSlots.length > 0 && (
          <div className="manage-section">
            <h2 className="manage-section__title">
              ⏳ Gathering commitments ({activeSlots.length})
            </h2>
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
                        {participants.map((p, i) => (
                          <li key={i}>{p.name}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {slots.length === 0 && (
          <p className="manage-event__empty">No time slots have been added to this event.</p>
        )}
      </div>
    </section>
  );
}
