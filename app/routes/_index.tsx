import { useRouteLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { loader as rootLoader } from "../root";

export const meta: MetaFunction = () => [
  { title: "Quorum — Events that happen when enough people say yes" },
  {
    name: "description",
    content:
      "Browse potential events near you and commit to the ones you want to happen. Quorum makes events real.",
  },
];

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
    title: "Quorum reached → it's confirmed",
    body: "Once enough people commit, the organizer is notified and confirms the event. Everyone who committed gets the registration link.",
  },
];

const BENEFITS = [
  {
    icon: "✓",
    title: "No wasted planning",
    body: "Organizers only finalize logistics once they know enough people are in. Never spend time organizing an event that doesn't fill.",
  },
  {
    icon: "◉",
    title: "Real commitment, not maybes",
    body: "Commitments replace wishy-washy RSVPs. That signal is what makes quorum meaningful and the crowd reliable.",
  },
  {
    icon: "⇄",
    title: "Flexible time options",
    body: "Offer multiple time slots and let the crowd vote with their commitments. The slot that hits quorum first wins.",
  },
];

export default function Index() {
  const auth = useRouteLoaderData<typeof rootLoader>("root");
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
                <span className="hp-mock-card__title">Thursday Night Jazz</span>
                <span className="badge badge--active">Active</span>
              </div>
              <p className="hp-mock-card__meta">
                Fri Apr 4 · 7 – 10 PM &nbsp;·&nbsp; Chicago, IL
              </p>
              <div className="hp-mock-bar-row">
                <div className="hp-mock-bar">
                  <div className="hp-mock-bar__fill" style={{ width: "72%" }} />
                </div>
                <span className="hp-mock-card__count">18 / 25 committed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

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
