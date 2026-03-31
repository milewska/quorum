import { and, desc, eq, isNull } from "drizzle-orm";
import { useFetcher, useLoaderData } from "react-router";
import { requireSession } from "~/auth.server";
import { formatInTimezone, formatTimeOnly } from "~/components/TimezonePicker";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { commitments, events, timeSlots, users } from "../../db/schema";
import type { Route } from "./+types/dashboard";

export async function loader(args: Route.LoaderArgs) {
  const db = getDb(getEnv(args.context));
  const session = await requireSession(args.request, args.context.cloudflare.env);
  const dbUser = { id: session.id };

  // Events this user organised
  const myEvents = await db
    .select()
    .from(events)
    .where(eq(events.organizerId, dbUser.id))
    .orderBy(desc(events.createdAt));

  // Commitments this user made (active only — not withdrawn)
  const myCommitments = await db
    .select({
      commitmentId: commitments.id,
      eventId: commitments.eventId,
      eventTitle: events.title,
      eventLocation: events.location,
      eventStatus: events.status,
      eventTimezone: events.timezone,
      slotId: timeSlots.id,
      slotStatus: timeSlots.status,
      startsAt: timeSlots.startsAt,
      endsAt: timeSlots.endsAt,
      createdAt: commitments.createdAt,
    })
    .from(commitments)
    .innerJoin(events, eq(events.id, commitments.eventId))
    .innerJoin(timeSlots, eq(timeSlots.id, commitments.timeSlotId))
    .where(
      and(eq(commitments.userId, dbUser.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(desc(commitments.createdAt));

  return { myEvents, myCommitments };
}

// ─── Withdraw action (inline from dashboard) ──────────────────────────────────

export async function action(args: Route.ActionArgs) {
  const db = getDb(getEnv(args.context));
  const session = await requireSession(args.request, args.context.cloudflare.env);
  const dbUser = { id: session.id };

  const form = await args.request.formData();
  const commitmentId = form.get("commitmentId") as string;
  if (!commitmentId) throw new Response("Missing commitmentId", { status: 400 });

  // Fetch the commitment — must belong to this user
  const [commitment] = await db
    .select({ id: commitments.id, timeSlotId: commitments.timeSlotId })
    .from(commitments)
    .where(
      and(
        eq(commitments.id, commitmentId),
        eq(commitments.userId, dbUser.id),
        isNull(commitments.withdrawnAt)
      )
    )
    .limit(1);
  if (!commitment) throw new Response("Commitment not found", { status: 404 });

  // Check slot is still withdrawable
  const [slot] = await db
    .select({ status: timeSlots.status, commitmentCount: timeSlots.commitmentCount })
    .from(timeSlots)
    .where(eq(timeSlots.id, commitment.timeSlotId))
    .limit(1);
  if (!slot) throw new Response("Slot not found", { status: 404 });
  if (slot.status === "quorum_reached" || slot.status === "confirmed") {
    throw new Response("Cannot withdraw after quorum is reached", { status: 403 });
  }

  await db
    .update(commitments)
    .set({ withdrawnAt: new Date().toISOString() })
    .where(eq(commitments.id, commitment.id));
  await db
    .update(timeSlots)
    .set({ commitmentCount: Math.max(0, slot.commitmentCount - 1) })
    .where(eq(timeSlots.id, commitment.timeSlotId));

  return { ok: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  quorum_reached: "Quorum Reached",
  confirmed: "Confirmed",
  completed: "Completed",
  expired: "Expired",
};

const SLOT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  quorum_reached: "Quorum Reached",
  confirmed: "Confirmed",
};

function fmt(date: string | Date, tz?: string) {
  return formatInTimezone(date, tz ?? "Pacific/Honolulu");
}
function fmtTimeOnly(date: string | Date, tz?: string) {
  return formatTimeOnly(date, tz ?? "Pacific/Honolulu");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { myEvents, myCommitments } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <section className="page-section">
      <h1 className="dash__title">Dashboard</h1>

      {/* ── Organiser section ─────────────────────────────────────── */}
      <div className="dash-section">
        <div className="dash-section__header">
          <h2 className="dash-section__title">Events you're organising</h2>
          <a href="/events/new" className="btn btn--primary btn--sm">
            + New event
          </a>
        </div>

        {myEvents.length === 0 ? (
          <p className="dash-empty">
            You haven't created any events yet.{" "}
            <a href="/events/new">Create your first one →</a>
          </p>
        ) : (
          <ul className="dash-list">
            {myEvents.map((ev) => (
              <li key={ev.id} className="dash-row">
                <div className="dash-row__primary">
                  <a href={`/events/${ev.id}`} className="dash-row__title">
                    {ev.title}
                  </a>
                  <span className="dash-row__meta">{ev.location}</span>
                </div>
                <div className="dash-row__secondary">
                  <span className={`badge badge--${ev.status}`}>
                    {EVENT_STATUS_LABEL[ev.status] ?? ev.status}
                  </span>
                  <span className="dash-row__date">
                    deadline{" "}
                    {new Date(ev.deadline).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="dash-row__actions">
                  <a href={`/events/${ev.id}`} className="btn btn--ghost btn--sm">
                    View
                  </a>
                  {(ev.status === "draft" || ev.status === "active") && (
                    <a
                      href={`/events/${ev.id}/edit`}
                      className="btn btn--ghost btn--sm"
                    >
                      Edit
                    </a>
                  )}
                  {(ev.status === "quorum_reached" || ev.status === "confirmed") && (
                    <a
                      href={`/events/${ev.id}/manage`}
                      className="btn btn--primary btn--sm"
                    >
                      Manage
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Participant section ───────────────────────────────────── */}
      <div className="dash-section">
        <div className="dash-section__header">
          <h2 className="dash-section__title">Your commitments</h2>
        </div>

        {myCommitments.length === 0 ? (
          <p className="dash-empty">
            You haven't committed to any events yet.{" "}
            <a href="/events">Browse events →</a>
          </p>
        ) : (
          <ul className="dash-list">
            {myCommitments.map((c) => {
              const locked =
                c.slotStatus === "quorum_reached" ||
                c.slotStatus === "confirmed";
              const pending =
                fetcher.state !== "idle" &&
                fetcher.formData?.get("commitmentId") === c.commitmentId;
              return (
                <li key={c.commitmentId} className="dash-row">
                  <div className="dash-row__primary">
                    <a
                      href={`/events/${c.eventId}`}
                      className="dash-row__title"
                    >
                      {c.eventTitle}
                    </a>
                    <span className="dash-row__meta">
                      {c.eventLocation} &middot; {fmt(c.startsAt, c.eventTimezone)} &ndash;{" "}
                      {fmtTimeOnly(c.endsAt, c.eventTimezone)}
                    </span>
                  </div>
                  <div className="dash-row__secondary">
                    <span className={`badge badge--${c.eventStatus}`}>
                      {EVENT_STATUS_LABEL[c.eventStatus] ?? c.eventStatus}
                    </span>
                    {c.slotStatus !== "active" && (
                      <span className={`badge badge--${c.slotStatus}`}>
                        Slot: {SLOT_STATUS_LABEL[c.slotStatus] ?? c.slotStatus}
                      </span>
                    )}
                  </div>
                  <div className="dash-row__actions">
                    <a
                      href={`/events/${c.eventId}`}
                      className="btn btn--ghost btn--sm"
                    >
                      View
                    </a>
                    {!locked && (
                      <fetcher.Form method="post">
                        <input
                          type="hidden"
                          name="commitmentId"
                          value={c.commitmentId}
                        />
                        <button
                          type="submit"
                          className="btn btn--ghost btn--sm dash-row__withdraw"
                          disabled={pending}
                        >
                          {pending ? "Withdrawing…" : "Withdraw"}
                        </button>
                      </fetcher.Form>
                    )}
                    {locked && (
                      <span className="dash-row__locked">Locked</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
