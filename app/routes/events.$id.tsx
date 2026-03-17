import { and, eq, isNull } from "drizzle-orm";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { getOptionalUser, requireUser } from "~/auth.server";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { commitments, events, timeSlots, users } from "../../db/schema";
import type { Route } from "./+types/events.$id";

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

  const authUser = await getOptionalUser(args);
  let dbUserId: string | null = null;
  let isOrganizer = false;
  if (authUser) {
    const [dbUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.workosUserId, authUser.id))
      .limit(1);
    if (dbUser) {
      dbUserId = dbUser.id;
      isOrganizer = dbUser.id === row?.event.organizerId;
    }
  }

  if (!row || (row.event.status === "draft" && !isOrganizer)) {
    throw new Response("Not Found", { status: 404 });
  }

  const slots = await db
    .select()
    .from(timeSlots)
    .where(eq(timeSlots.eventId, params.id))
    .orderBy(timeSlots.startsAt);

  // Committed participants (non-withdrawn), grouped by slot client-side
  const participants = await db
    .select({
      slotId: commitments.timeSlotId,
      name: users.fullName,
      avatarUrl: users.avatarUrl,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(commitments.createdAt);

  // Current user's active commitments (slot IDs they've committed to)
  const myCommittedSlotIds: string[] = dbUserId
    ? (
        await db
          .select({ timeSlotId: commitments.timeSlotId })
          .from(commitments)
          .where(
            and(
              eq(commitments.userId, dbUserId),
              eq(commitments.eventId, params.id),
              isNull(commitments.withdrawnAt)
            )
          )
      ).map((r) => r.timeSlotId)
    : [];

  return {
    event: row.event,
    organizerName: row.organizerName,
    slots,
    participants,
    isOrganizer,
    isSignedIn: authUser !== null,
    myCommittedSlotIds,
  };
}

// ─── Action (commit / withdraw) ───────────────────────────────────────────────

export async function action(args: Route.ActionArgs) {
  const { params, request, context } = args;
  const db = getDb(getEnv(context));
  const auth = await requireUser(args);
  const workosId = auth.user.id;

  // Resolve DB user
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workosUserId, workosId))
    .limit(1);
  if (!dbUser) throw new Response("User not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  const slotId = form.get("slotId") as string;
  if (!slotId) throw new Response("Missing slotId", { status: 400 });

  // Verify the slot belongs to this event
  const [slot] = await db
    .select()
    .from(timeSlots)
    .where(and(eq(timeSlots.id, slotId), eq(timeSlots.eventId, params.id)))
    .limit(1);
  if (!slot) throw new Response("Slot not found", { status: 404 });

  // Verify the user is not the organizer
  const [eventRow] = await db
    .select({ organizerId: events.organizerId })
    .from(events)
    .where(eq(events.id, params.id))
    .limit(1);
  if (!eventRow) throw new Response("Event not found", { status: 404 });
  if (eventRow.organizerId === dbUser.id) {
    throw new Response("Organizers cannot commit to their own event", {
      status: 403,
    });
  }

  if (intent === "commit") {
    // Check for an existing active commitment
    const [existing] = await db
      .select({ id: commitments.id })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, dbUser.id),
          eq(commitments.timeSlotId, slotId),
          isNull(commitments.withdrawnAt)
        )
      )
      .limit(1);
    if (!existing) {
      // Insert commitment and increment counter
      await db.insert(commitments).values({
        userId: dbUser.id,
        timeSlotId: slotId,
        eventId: params.id,
      });
      await db
        .update(timeSlots)
        .set({ commitmentCount: slot.commitmentCount + 1 })
        .where(eq(timeSlots.id, slotId));
    }
  } else if (intent === "withdraw") {
    // Only allow withdrawal if slot is not quorum_reached / confirmed
    if (slot.status === "quorum_reached" || slot.status === "confirmed") {
      throw new Response("Cannot withdraw after quorum is reached", {
        status: 403,
      });
    }
    // Find active commitment
    const [existing] = await db
      .select({ id: commitments.id })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, dbUser.id),
          eq(commitments.timeSlotId, slotId),
          isNull(commitments.withdrawnAt)
        )
      )
      .limit(1);
    if (existing) {
      await db
        .update(commitments)
        .set({ withdrawnAt: new Date() })
        .where(eq(commitments.id, existing.id));
      await db
        .update(timeSlots)
        .set({
          commitmentCount: Math.max(0, slot.commitmentCount - 1),
        })
        .where(eq(timeSlots.id, slotId));
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

// ─── Commit / Withdraw button ─────────────────────────────────────────────────

function CommitButton({
  slotId,
  slotStatus,
  committed,
  isSignedIn,
  isOrganizer,
  deadlinePassed,
}: {
  slotId: string;
  slotStatus: string;
  committed: boolean;
  isSignedIn: boolean;
  isOrganizer: boolean;
  deadlinePassed: boolean;
}) {
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  if (isOrganizer) return null;

  if (!isSignedIn) {
    return (
      <a href="/auth/login" className="btn btn--primary btn--sm">
        Sign in to commit
      </a>
    );
  }

  const locked =
    slotStatus === "quorum_reached" || slotStatus === "confirmed";

  if (committed) {
    return (
      <div className="slot-card__commit-row">
        <span className="slot-card__committed-badge">✓ Committed</span>
        {locked || deadlinePassed ? (
          <span className="slot-card__locked-note">
            {locked ? "Withdrawal locked — quorum reached" : "Deadline passed"}
          </span>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="withdraw" />
            <input type="hidden" name="slotId" value={slotId} />
            <button
              type="submit"
              className="btn btn--ghost btn--sm"
              disabled={pending}
            >
              {pending ? "Withdrawing…" : "Withdraw"}
            </button>
          </fetcher.Form>
        )}
      </div>
    );
  }

  if (deadlinePassed || locked) return null;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="commit" />
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        className="btn btn--primary btn--sm"
        disabled={pending}
      >
        {pending ? "Committing…" : "Commit to this slot"}
      </button>
    </fetcher.Form>
  );
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
    myCommittedSlotIds,
  } = useLoaderData<typeof loader>();

  const deadlineDate = new Date(event.deadline);
  const countdown = deadlineCountdown(deadlineDate);
  const deadlinePassed = deadlineDate.getTime() <= Date.now();

  // Group participants by slot id
  const bySlot = participants.reduce<Record<string, typeof participants>>(
    (acc, p) => {
      (acc[p.slotId] ??= []).push(p);
      return acc;
    },
    {}
  );

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
            <span className="event-detail__countdown">{countdown}</span>
            {" "}&middot; deadline{" "}
            {deadlineDate.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <p className="event-detail__meta">
            Organised by {organizerName} &middot; Quorum: {event.threshold}{" "}
            commitments
          </p>

          {isOrganizer && (
            <Link to={`/events/${event.id}/edit`} className="btn btn--ghost">
              Edit event
            </Link>
          )}
        </div>

        {/* Cover image */}
        {event.imageKey && (
          <img
            src={`/images/${event.imageKey}`}
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

        {/* Time slots */}
        <div className="event-detail__slots">
          <h2>Time Slots</h2>
          {slots.length === 0 ? (
            <p className="event-detail__no-slots">No time slots added yet.</p>
          ) : (
            <ul className="slot-list">
              {slots.map((slot) => {
                const pct = Math.min(
                  100,
                  (slot.commitmentCount / event.threshold) * 100
                );
                const slotParticipants = bySlot[slot.id] ?? [];
                const committed = myCommittedSlotIds.includes(slot.id);
                return (
                  <li key={slot.id} className="slot-card">
                    <div className="slot-card__time">
                      <span>
                        {new Date(slot.startsAt).toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="slot-card__dash">&ndash;</span>
                      <span>
                        {new Date(slot.endsAt).toLocaleString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      {slot.status !== "active" && (
                        <span className={`badge badge--${slot.status}`}>
                          {STATUS_LABEL[slot.status] ?? slot.status}
                        </span>
                      )}
                    </div>

                    <div className="slot-card__progress">
                      <div className="slot-card__bar">
                        <div
                          className="slot-card__fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="slot-card__count">
                        {slot.commitmentCount} / {event.threshold} committed
                      </span>
                    </div>

                    <CommitButton
                      slotId={slot.id}
                      slotStatus={slot.status}
                      committed={committed}
                      isSignedIn={isSignedIn}
                      isOrganizer={isOrganizer}
                      deadlinePassed={deadlinePassed}
                    />

                    {slotParticipants.length > 0 && (
                      <div className="slot-card__participants">
                        <ul className="participant-list">
                          {slotParticipants.map((p, i) => (
                            <li key={i} className="participant">
                              {p.avatarUrl ? (
                                <img
                                  src={p.avatarUrl}
                                  alt={p.name}
                                  className="participant__avatar"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="participant__avatar participant__avatar--initials">
                                  {p.name[0]?.toUpperCase() ?? "?"}
                                </span>
                              )}
                              <span className="participant__name">{p.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

