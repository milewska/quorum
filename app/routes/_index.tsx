import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import { asc, eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { events, timeSlots } from "../../db/schema";
import { getEnv } from "~/env.server";
import { formatInTimezone } from "~/components/TimezonePicker";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/_index";

export const meta: MetaFunction = () => [
  { title: "Quorum — Events that happen when enough people say yes" },
  {
    name: "description",
    content:
      "Browse potential events near you and commit to the ones you want to happen. No more ghost RSVPs — Quorum makes events real.",
  },
  { property: "og:title", content: "Quorum — Commitment-driven events" },
  {
    property: "og:description",
    content: "Events that only happen when enough people say yes. Browse, commit, and make it real.",
  },
  { property: "og:url", content: "https://quorum.malamaconsulting.com" },
  { name: "twitter:title", content: "Quorum — Commitment-driven events" },
  {
    name: "twitter:description",
    content: "Events that only happen when enough people say yes.",
  },
];

type CostTier = { label: string; amount: number };

function priceBadge(costTiersJson: string | null): { text: string; free: boolean } {
  if (!costTiersJson) return { text: "Free", free: true };
  try {
    const tiers: CostTier[] = JSON.parse(costTiersJson);
    if (!tiers.length) return { text: "Free", free: true };
    const amounts = tiers.map((t) => t.amount).filter((a) => a > 0);
    if (!amounts.length) return { text: "Free", free: true };
    const min = Math.min(...amounts);
    const fmt = (cents: number) =>
      (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
    return { text: `From ${fmt(min)}`, free: false };
  } catch {
    return { text: "Free", free: true };
  }
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));

  const maxCommitSubquery = sql<number>`coalesce((
    SELECT max(${timeSlots.commitmentCount})
    FROM ${timeSlots}
    WHERE ${timeSlots.eventId} = ${events.id}
  ), 0)`;

  const liveEvents = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      deadline: events.deadline,
      threshold: events.threshold,
      imageKey: events.imageKey,
      costTiersJson: events.costTiersJson,
      timezone: events.timezone,
      maxCommitments: maxCommitSubquery,
    })
    .from(events)
    .where(and(eq(events.status, "active"), eq(events.visibility, "public")))
    .orderBy(asc(events.deadline))
    .limit(6);

  return { liveEvents };
}

const HOW_STEPS = [
  {
    n: "1",
    title: "Organizer posts a potential event",
    body: "Set a title, location, time slot options, and a quorum — the minimum number of people needed for the event to be worth running.",
  },
  {
    n: "2",
    title: "Participants browse and commit",
    body: "Anyone can discover public events and commit to the slots that work for them. A commitment is a real promise, not a vague maybe.",
  },
  {
    n: "3",
    title: "Quorum reached — it's confirmed",
    body: "Once enough people commit, the organizer is notified and confirms the event. Everyone who committed gets the registration link.",
  },
];

const BENEFITS = [
  {
    icon: "✓",
    title: "No wasted planning",
    body: "Organizers only finalize logistics once they know enough people are in.",
  },
  {
    icon: "◉",
    title: "Real commitment, not maybes",
    body: "Commitments replace wishy-washy RSVPs. That signal is what makes quorum meaningful.",
  },
  {
    icon: "⇄",
    title: "Flexible time options",
    body: "Offer multiple time slots and let the crowd vote with their commitments.",
  },
];

export default function Index() {
  const auth = useRouteLoaderData<typeof rootLoader>("root");
  const { liveEvents } = useLoaderData<typeof loader>();
  const isSignedIn = Boolean(auth?.user);
  const createHref = isSignedIn ? "/events/new" : "/auth/login";

  return (
    <div className="home-page">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hp-hero">
        <div className="hp-inner">
          <span className="hp-pill">Commitment-first events</span>
          <h1 className="hp-hero__headline">
            Events that only happen when{" "}
            <span className="hp-gradient-text">enough people say yes.</span>
          </h1>
          <p className="hp-hero__sub">
            Browse potential events, make a real commitment, and watch quorum
            reach. Organizers confirm only when the crowd actually shows up.
          </p>
          <div className="hp-cta-row">
            <a href="/events" className="btn btn--primary btn--lg">
              Browse events
            </a>
            <a href={createHref} className="btn btn--outline btn--lg">
              Create an event
            </a>
          </div>

          {/* decorative mock event card */}
          <div className="hp-mock-wrap">
            <div className="hp-mock-card">
              <div className="hp-mock-card__top">
                <span className="hp-mock-card__title">Dragon Gathering Kaua'i</span>
                <span className="badge badge--quorum_reached">Quorum Reached</span>
              </div>
              <p className="hp-mock-card__meta">
                Kaua'i, HI &nbsp;·&nbsp; Commitment-driven
              </p>
              <div className="hp-mock-bar-row">
                <div className="hp-mock-bar">
                  <div className="hp-mock-bar__fill" style={{ width: "100%" }} />
                </div>
                <span className="hp-mock-card__count">16 / 4 committed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live Events ─────────────────────────────────────────────── */}
      {liveEvents.length > 0 && (
        <section className="hp-section">
          <div className="hp-inner hp-live-events">
            <div className="hp-live-events__header">
              <h2 className="hp-live-events__title">Happening now</h2>
              <Link to="/events" className="btn btn--ghost">
                View all →
              </Link>
            </div>
            <div className="hp-live-events__grid">
              {liveEvents.map((ev) => {
                const pct = Math.min(100, (ev.maxCommitments / ev.threshold) * 100);
                const price = priceBadge(ev.costTiersJson ?? null);
                return (
                  <Link key={ev.id} to={`/events/${ev.id}`} className="event-card">
                    {ev.imageKey && (
                      <div className="event-card__img-wrap">
                        <img
                          src={ev.imageKey.startsWith("https://") ? ev.imageKey : `/images/${ev.imageKey}`}
                          alt={ev.title}
                          className="event-card__img"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="event-card__body">
                      <div className="event-card__title-row">
                        <h3 className="event-card__title">{ev.title}</h3>
                        <span className={`event-card__price-badge${price.free ? " event-card__price-badge--free" : ""}`}>
                          {price.text}
                        </span>
                      </div>
                      <p className="event-card__meta">{ev.location}</p>
                      <p className="event-card__meta">
                        Deadline:{" "}
                        {formatInTimezone(ev.deadline, ev.timezone ?? "Pacific/Honolulu", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                      <div className="event-card__progress">
                        <div className="slot-card__bar">
                          <div className="slot-card__fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="event-card__meta">
                          {ev.maxCommitments} / {ev.threshold} committed
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="hp-section">
        <div className="hp-inner">
          <h2 className="hp-section__title">How Quorum works</h2>
          <p className="hp-section__sub">
            Three steps from idea to confirmed event.
          </p>
          <ol className="hp-steps">
            {HOW_STEPS.map((s) => (
              <li key={s.n} className="hp-step">
                <span className="hp-step__n">{s.n}</span>
                <h3 className="hp-step__title">{s.title}</h3>
                <p className="hp-step__body">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Why Quorum ───────────────────────────────────────────────── */}
      <section className="hp-section hp-section--tinted">
        <div className="hp-inner">
          <h2 className="hp-section__title">Why Quorum</h2>
          <p className="hp-section__sub">
            Built for people who hate showing up to an empty room.
          </p>
          <div className="hp-benefits">
            {BENEFITS.map((b) => (
              <div key={b.title} className="hp-benefit">
                <span className="hp-benefit__icon">{b.icon}</span>
                <h3 className="hp-benefit__title">{b.title}</h3>
                <p className="hp-benefit__body">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="hp-cta-banner">
        <div className="hp-inner">
          <h2 className="hp-cta-banner__title">
            Ready to make something happen?
          </h2>
          <p className="hp-cta-banner__sub">
            Post a potential event in minutes. No logistics until quorum is
            reached.
          </p>
          <div className="hp-cta-row">
            <a href="/events" className="btn btn--primary btn--lg">
              See what's happening
            </a>
            <a href={createHref} className="btn btn--white btn--lg">
              Start planning
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
