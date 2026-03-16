import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Quorum — Events that happen when enough people say yes" },
  {
    name: "description",
    content:
      "Browse potential events near you and commit to the ones you want to happen. Quorum makes events real.",
  },
];

export default function Index() {
  return (
    <section className="home">
      <h1 className="home__headline">
        Events only happen when enough people say yes.
      </h1>
      <p className="home__sub">
        Browse potential events. Make a commitment. Reach quorum. Make it real.
      </p>
      <div className="home__cta">
        <a href="/events" className="btn btn--primary">
          Browse events
        </a>
      </div>
    </section>
  );
}
