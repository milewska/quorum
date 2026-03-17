import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { Form, Link, useLoaderData } from "react-router";
import { getDb } from "../../db";
import { events, timeSlots } from "../../db/schema";
import { getEnv } from "~/env.server";
import { expireOverdueEvents } from "~/expiry.server";
import type { Route } from "./+types/events._index";

type CostTier = { label: string; amount: number };

function priceBadge(costTiersJson: string | null): { text: string; free: boolean } {
  if (!costTiersJson) return { text: "Free", free: true };
  try {
    const tiers: CostTier[] = JSON.parse(costTiersJson);
    if (!tiers.length) return { text: "Free", free: true };
    const amounts = tiers.map((t) => t.amount).filter((a) => a > 0);
    if (!amounts.length) return { text: "Free", free: true };
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const fmt = (cents: number) =>
      (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
    if (tiers.length === 1) return { text: fmt(min), free: false };
    return { text: `From ${fmt(min)}`, free: false };
  } catch {
    return { text: "Free", free: true };
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const sort = url.searchParams.get("sort") ?? "deadline";

  const conditions = [
    eq(events.status, "active"),
    eq(events.visibility, "public"),
    ...(q ? [ilike(events.location, `%${q}%`)] : []),
  ];

  // Max commitment count across all slots for each event (for sort)
  const maxCommitsSq = db
    .select({
      eventId: timeSlots.eventId,
      maxCount: sql<number>`max(${timeSlots.commitmentCount})`.as("max_count"),
    })
    .from(timeSlots)
    .groupBy(timeSlots.eventId)
    .as("max_commits");

  const list = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      deadline: events.deadline,
      threshold: events.threshold,
      imageKey: events.imageKey,
      costTiersJson: events.costTiersJson,
      maxCommitments: sql<number>`coalesce(${maxCommitsSq.maxCount}, 0)`,
    })
    .from(events)
    .leftJoin(maxCommitsSq, eq(maxCommitsSq.eventId, events.id))
    .where(and(...conditions))
    .orderBy(
      sort === "commitments"
        ? desc(sql`coalesce(${maxCommitsSq.maxCount}, 0)`)
        : asc(events.deadline)
    )
    .limit(50);

  // On-load expiry: check all loaded active events
  const activeIds = list.map((e) => e.id);
  if (activeIds.length > 0) {
    const baseUrl = new URL(request.url).origin;
    await expireOverdueEvents(db, getEnv(context), activeIds, baseUrl);
  }

  return { events: list, q, sort };
}

export default function EventsIndex() {
  const { events: list, q, sort } = useLoaderData<typeof loader>();

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Browse Events</h1>
        <Link to="/events/new" className="btn btn--primary">
          Create event
        </Link>
      </div>

      {/* Filter + sort bar */}
      <Form method="get" className="browse-bar">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Filter by location…"
          className="field__input browse-bar__search"
        />
        <select name="sort" defaultValue={sort} className="field__input browse-bar__sort">
          <option value="deadline">Soonest deadline</option>
          <option value="commitments">Most commitments</option>
        </select>
        <button type="submit" className="btn btn--ghost">
          Filter
        </button>
        {(q || sort !== "deadline") && (
          <a href="/events" className="btn btn--ghost">
            Clear
          </a>
        )}
      </Form>

      {list.length === 0 ? (
        <div className="empty-state">
          {q ? (
            <p>No events found in &ldquo;{q}&rdquo;.</p>
          ) : (
            <p>No public events yet. Be the first to create one.</p>
          )}
          <Link to="/events/new" className="btn btn--primary">
            Create event
          </Link>
        </div>
      ) : (
        <ul className="event-grid">
          {list.map((ev) => {
            const pct = Math.min(
              100,
              (ev.maxCommitments / ev.threshold) * 100
            );
            const price = priceBadge(ev.costTiersJson ?? null);
            return (
              <li key={ev.id}>
                <Link to={`/events/${ev.id}`} className="event-card">
                  {ev.imageKey && (
                    <div className="event-card__img-wrap">
                      <img
                        src={ev.imageKey.startsWith("https://") ? ev.imageKey : `/images/${ev.imageKey}`}
                        alt={ev.title}
                        className="event-card__img"
                      />
                    </div>
                  )}
                  <div className="event-card__body">
                    <div className="event-card__title-row">
                      <h2 className="event-card__title">{ev.title}</h2>
                      <span className={`event-card__price-badge${price.free ? " event-card__price-badge--free" : ""}`}>
                        {price.text}
                      </span>
                    </div>
                    <p className="event-card__meta">{ev.location}</p>
                    <p className="event-card__meta">
                      Deadline:{" "}
                      {new Date(ev.deadline).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <div className="event-card__progress">
                      <div className="slot-card__bar">
                        <div
                          className="slot-card__fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="event-card__meta">
                        {ev.maxCommitments} / {ev.threshold} committed
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

