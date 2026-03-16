import { and, desc, eq } from "drizzle-orm";
import { Link, useLoaderData } from "react-router";
import { getDb } from "../../db";
import { events } from "../../db/schema";
import { getEnv } from "~/env.server";
import type { Route } from "./+types/events._index";

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const list = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      deadline: events.deadline,
      threshold: events.threshold,
      imageKey: events.imageKey,
    })
    .from(events)
    .where(and(eq(events.status, "active"), eq(events.visibility, "public")))
    .orderBy(desc(events.createdAt))
    .limit(50);
  return { events: list };
}

export default function EventsIndex() {
  const { events: list } = useLoaderData<typeof loader>();

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Browse Events</h1>
        <Link to="/events/new" className="btn btn--primary">
          Create event
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <p>No public events yet. Be the first to create one.</p>
          <Link to="/events/new" className="btn btn--primary">
            Create event
          </Link>
        </div>
      ) : (
        <ul className="event-grid">
          {list.map((ev) => (
            <li key={ev.id}>
              <Link to={`/events/${ev.id}`} className="event-card">
                {ev.imageKey && (
                  <div className="event-card__img-wrap">
                    <img
                      src={`/images/${ev.imageKey}`}
                      alt={ev.title}
                      className="event-card__img"
                    />
                  </div>
                )}
                <div className="event-card__body">
                  <h2 className="event-card__title">{ev.title}</h2>
                  <p className="event-card__meta">{ev.location}</p>
                  <p className="event-card__meta">
                    Deadline:{" "}
                    {new Date(ev.deadline).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <p className="event-card__meta">
                    Needs {ev.threshold} commitments
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
