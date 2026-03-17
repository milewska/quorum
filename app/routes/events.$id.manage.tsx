import { and, eq, isNull } from "drizzle-orm";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { requireUser } from "~/auth.server";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { commitments, events, timeSlots, users } from "../../db/schema";
import { eventConfirmedEmail, sendMail } from "~/email.server";
import type { Route } from "./+types/events.$id.manage";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader(args: Route.LoaderArgs) {
  const { params, context } = args;
  const db = getDb(getEnv(context));
  const auth = await requireUser(args);

  // Resolve DB user
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workosUserId, auth.user.id))
    .limit(1);
  if (!dbUser) throw new Response("User not found", { status: 404 });

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

  // Load committed participant counts per slot (for display)
  const participantRows = await db
    .select({
      slotId: commitments.timeSlotId,
      name: users.fullName,
      email: users.email,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(commitments.createdAt);

  const participantsBySlot: Record<string, { name: string; email: string }[]> =
    {};
  for (const p of participantRows) {
    (participantsBySlot[p.slotId] ??= []).push({
      name: p.name,
      email: p.email,
    });
  }

  return { event: row, slots, participantsBySlot };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action(args: Route.ActionArgs) {
  const { params, request, context } = args;
  const env = getEnv(context);
  const db = getDb(env);
  const auth = await requireUser(args);

  // Resolve DB user
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workosUserId, auth.user.id))
    .limit(1);
  if (!dbUser) throw new Response("User not found", { status: 404 });

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
      .set({ status: "confirmed", registrationUrl, updatedAt: new Date() })
      .where(eq(events.id, params.id));

    // Email all committed participants on this slot
    const slotDate = new Date(slot.startsAt).toLocaleDateString("en-US", {
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

  return { error: "Unknown action." };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLOT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  quorum_reached: "Quorum Reached",
  confirmed: "Confirmed",
};

function fmt(date: string | Date) {
  return new Date(date).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManageEvent() {
  const { event, slots, participantsBySlot } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const quorumSlots = slots.filter((s) => s.status === "quorum_reached");
  const confirmedSlots = slots.filter((s) => s.status === "confirmed");
  const activeSlots = slots.filter((s) => s.status === "active");

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
                      <strong>{fmt(slot.startsAt)}</strong>
                      <span className="manage-slot-card__dash">&ndash;</span>
                      <span>
                        {new Date(slot.endsAt).toLocaleString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
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
            <ul className="manage-slot-list">
              {confirmedSlots.map((slot) => {
                const participants = participantsBySlot[slot.id] ?? [];
                return (
                  <li key={slot.id} className="manage-slot-card manage-slot-card--confirmed">
                    <div className="manage-slot-card__time">
                      <strong>{fmt(slot.startsAt)}</strong>
                      <span className="manage-slot-card__dash">&ndash;</span>
                      <span>
                        {new Date(slot.endsAt).toLocaleString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
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
                      <strong>{fmt(slot.startsAt)}</strong>
                      <span className="manage-slot-card__dash">&ndash;</span>
                      <span>
                        {new Date(slot.endsAt).toLocaleString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
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
