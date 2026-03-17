/**
 * Seed script — populates the DB with sample organiser users + realistic events.
 *
 * Usage:
 *   npm run db:seed
 *
 * Safe to re-run: uses INSERT ... ON CONFLICT DO NOTHING for users,
 * and deletes then re-inserts events/slots so you always get a clean set.
 *
 * Requires DATABASE_URL in .env (same file drizzle-kit uses).
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import { commitments, events, timeSlots, users } from "./schema";

const neonSql = neon(process.env.DATABASE_URL!);
const db = drizzle(neonSql, { schema });

// ─── Sample organisers ────────────────────────────────────────────────────────
// These are fake WorkOS IDs — they won't clash with real auth sessions,
// so you can browse the events but not "sign in as" them.

const SEED_USERS = [
  {
    workosUserId: "seed_user_jazz_org",
    fullName: "Marcus Bell",
    email: "marcus.bell.seed@example.com",
    avatarUrl: null,
  },
  {
    workosUserId: "seed_user_yoga_org",
    fullName: "Priya Nair",
    email: "priya.nair.seed@example.com",
    avatarUrl: null,
  },
  {
    workosUserId: "seed_user_film_org",
    fullName: "Sofia Reyes",
    email: "sofia.reyes.seed@example.com",
    avatarUrl: null,
  },
  {
    workosUserId: "seed_user_hike_org",
    fullName: "James Okafor",
    email: "james.okafor.seed@example.com",
    avatarUrl: null,
  },
];

// Helper: date relative to today
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setSeconds(0, 0);
  return d;
}

function dateAt(daysOffset: number, hour: number, minute = 0): Date {
  const d = daysFromNow(daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  console.log("🌱  Seeding sample data…\n");

  // 1. Upsert seed users
  const upserted = await db
    .insert(users)
    .values(SEED_USERS)
    .onConflictDoUpdate({
      target: users.workosUserId,
      set: { fullName: sql`excluded.full_name` },
    })
    .returning({ id: users.id, workosUserId: users.workosUserId });

  const userIdByWorkosId = Object.fromEntries(
    upserted.map((u) => [u.workosUserId, u.id])
  );

  const marcusId = userIdByWorkosId["seed_user_jazz_org"];
  const priyaId = userIdByWorkosId["seed_user_yoga_org"];
  const sofiaId = userIdByWorkosId["seed_user_film_org"];
  const jamesId = userIdByWorkosId["seed_user_hike_org"];

  console.log("✓  Users upserted:", upserted.map((u) => u.id).join(", "));

  // 2. Remove any previously seeded events (identified by a seed tag in title)
  //    We use a simple convention: seed events have a description ending with [seed]
  const existingSeedEvents = await db
    .select({ id: events.id })
    .from(events)
    .where(
      inArray(events.organizerId, [marcusId, priyaId, sofiaId, jamesId])
    );

  if (existingSeedEvents.length > 0) {
    const ids = existingSeedEvents.map((e) => e.id);
    // cascading delete handles time_slots and commitments
    for (const id of ids) {
      await db.delete(events).where(eq(events.id, id));
    }
    console.log(`✓  Removed ${ids.length} previous seed event(s)`);
  }

  // 3. Insert seed events + time slots
  // costTiersJson: null = free; JSON array of { label, amount (cents) }
  const EVENTS: Array<{
    org: string;
    title: string;
    description: string;
    location: string;
    threshold: number;
    deadlineDays: number;
    visibility: "public" | "private";
    costTiersJson: string | null;
    slots: Array<{ startDays: number; startHour: number; endHour: number; endMinute?: number }>;
  }> = [
    {
      org: marcusId,
      title: "Thursday Night Jazz — Live Sessions",
      description:
        "An intimate evening of live jazz in a brick-walled cellar bar. Featuring local quartet and guest soloists. Bring your ears, bring a friend.\n\nDoors open 30 minutes before start. Standing room + limited seating.",
      location: "Chicago, IL",
      threshold: 20,
      deadlineDays: 18,
      visibility: "public",
      // Tiered: General ($15) and VIP ($30)
      costTiersJson: JSON.stringify([
        { label: "General Admission", amount: 1500 },
        { label: "VIP (front row + drink)", amount: 3000 },
      ]),
      slots: [
        { startDays: 21, startHour: 19, endHour: 22 },
        { startDays: 28, startHour: 19, endHour: 22 },
      ],
    },
    {
      org: priyaId,
      title: "Sunrise Yoga in the Park",
      description:
        "Start your Saturday with an outdoor vinyasa flow. All levels welcome — bring your own mat and a light layer. We'll move, breathe, and catch the morning light together.\n\nSession runs rain-or-shine (light rain only). Check back for weather cancellations.",
      location: "Austin, TX",
      threshold: 12,
      deadlineDays: 10,
      visibility: "public",
      // Free
      costTiersJson: null,
      slots: [
        { startDays: 12, startHour: 7, endHour: 8, endMinute: 30 },
        { startDays: 14, startHour: 7, endHour: 8, endMinute: 30 },
      ],
    },
    {
      org: sofiaId,
      title: "Hidden Gems Film Club: 1970s Italian Cinema",
      description:
        "Monthly screening series focused on forgotten masterworks. This month: two back-to-back films from the 1970s Italian canon, introduced by our host with a 10-minute context set.\n\nPopcorn and soft drinks provided.",
      location: "Brooklyn, NY",
      threshold: 25,
      deadlineDays: 22,
      visibility: "public",
      // Fixed single price: $12
      costTiersJson: JSON.stringify([
        { label: "Admission", amount: 1200 },
      ]),
      slots: [
        { startDays: 25, startHour: 18, endHour: 21, endMinute: 30 },
        { startDays: 32, startHour: 18, endHour: 21, endMinute: 30 },
      ],
    },
    {
      org: jamesId,
      title: "Sunrise Ridge Trail Hike",
      description:
        "A moderate 7-mile loop through the foothills with ~1,200 ft elevation gain. Stunning sunrise views from the ridge at mile 3.5. We'll carpool from the trailhead parking lot.\n\nBring water (2L+), snacks, and sturdy shoes. No pets on this trail.",
      location: "Denver, CO",
      threshold: 8,
      deadlineDays: 14,
      visibility: "public",
      // Free
      costTiersJson: null,
      slots: [
        { startDays: 16, startHour: 5, endHour: 10 },
        { startDays: 23, startHour: 5, endHour: 10 },
      ],
    },
    {
      org: marcusId,
      title: "Jazz Improvisation Workshop",
      description:
        "A hands-on afternoon workshop for intermediate musicians. We'll cover blues scales, chord substitution, and trading fours in small groups. Bring your instrument.\n\nSpace is limited — quorum is intentionally low to keep the group intimate.",
      location: "Chicago, IL",
      threshold: 6,
      deadlineDays: 30,
      visibility: "public",
      // Tiered: Student ($20), General ($35), Supporter ($50)
      costTiersJson: JSON.stringify([
        { label: "Student", amount: 2000 },
        { label: "General", amount: 3500 },
        { label: "Supporter", amount: 5000 },
      ]),
      slots: [
        { startDays: 35, startHour: 13, endHour: 17 },
      ],
    },
    {
      org: priyaId,
      title: "Community Potluck Dinner",
      description:
        "A neighbourhood potluck — bring a dish to share (appetiser, main, or dessert, your choice). We'll provide tables, chairs, plates, and drinks. Meet your neighbours, eat great food.\n\nRSVP with what you're bringing after quorum is confirmed.",
      location: "Austin, TX",
      threshold: 15,
      deadlineDays: 8,
      visibility: "public",
      // Free
      costTiersJson: null,
      slots: [
        { startDays: 10, startHour: 17, endHour: 20, endMinute: 30 },
      ],
    },
  ];

  for (const ev of EVENTS) {
    const deadline = daysFromNow(ev.deadlineDays);

    const [inserted] = await db
      .insert(events)
      .values({
        organizerId: ev.org,
        title: ev.title,
        description: ev.description,
        location: ev.location,
        threshold: ev.threshold,
        deadline,
        visibility: ev.visibility,
        status: "active",
        costTiersJson: ev.costTiersJson,
      })
      .returning({ id: events.id });

    for (const s of ev.slots) {
      await db.insert(timeSlots).values({
        eventId: inserted.id,
        startsAt: dateAt(s.startDays, s.startHour),
        endsAt: dateAt(s.startDays, s.endHour, s.endMinute ?? 0),
      });
    }

    console.log(`✓  Created: "${ev.title}" (id: ${inserted.id})`);
  }

  console.log("\n✅  Seed complete. Visit /events to see your sample data.");
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
