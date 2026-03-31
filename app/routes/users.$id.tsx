import { and, eq, isNull } from "drizzle-orm";
import { useLoaderData } from "react-router";
import { getDb } from "../../db";
import { commitments, events, users } from "../../db/schema";
import { getEnv } from "~/env.server";
import type { Route } from "./+types/users.$id";

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));

  const [user] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      reputationScore: users.reputationScore,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, params.id))
    .limit(1);

  if (!user) throw new Response("Not Found", { status: 404 });

  // Public events this user committed to (active commitment, public event)
  const committedEvents = await db
    .select({
      eventId: events.id,
      title: events.title,
      location: events.location,
      status: events.status,
    })
    .from(commitments)
    .innerJoin(events, eq(events.id, commitments.eventId))
    .where(
      and(
        eq(commitments.userId, user.id),
        isNull(commitments.withdrawnAt),
        eq(events.visibility, "public")
      )
    )
    .orderBy(commitments.createdAt);

  return { user, committedEvents };
}

const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  quorum_reached: "Quorum Reached",
  confirmed: "Confirmed",
  completed: "Completed",
  expired: "Expired",
};

export default function UserProfile() {
  const { user, committedEvents } = useLoaderData<typeof loader>();
  const rep = Math.round(Number(user.reputationScore));

  return (
    <section className="page-section">
      <div className="user-profile">
        {/* Avatar + name */}
        <div className="user-profile__header">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.fullName}
              className="user-profile__avatar"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="user-profile__avatar user-profile__avatar--initials">
              {user.fullName[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          <div className="user-profile__info">
            <h1 className="user-profile__name">{user.fullName}</h1>
            <p className="user-profile__meta">
              Member since{" "}
              {new Date(user.createdAt).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Reputation */}
        <div className="user-profile__stats">
          <div className="user-stat">
            <span className="user-stat__value">{rep}%</span>
            <span className="user-stat__label">Reputation</span>
          </div>
          <div className="user-stat">
            <span className="user-stat__value">{committedEvents.length}</span>
            <span className="user-stat__label">Events committed to</span>
          </div>
        </div>

        {/* Reputation explanation */}
        <p className="user-profile__rep-desc">
          Reputation is the percentage of confirmed events this person
          registered for after committing.
        </p>

        {/* Event list */}
        {committedEvents.length > 0 && (
          <div className="user-profile__events">
            <h2 className="user-profile__events-title">Committed events</h2>
            <ul className="user-event-list">
              {committedEvents.map((ev) => (
                <li key={ev.eventId} className="user-event-row">
                  <a
                    href={`/events/${ev.eventId}`}
                    className="user-event-row__title"
                  >
                    {ev.title}
                  </a>
                  <span className="user-event-row__meta">{ev.location}</span>
                  <span className={`badge badge--${ev.status}`}>
                    {EVENT_STATUS_LABEL[ev.status] ?? ev.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
