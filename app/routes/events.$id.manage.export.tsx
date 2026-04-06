import { and, eq, isNull } from "drizzle-orm";
import { requireSession } from "~/auth.server";
import { formatInTimezone } from "~/components/TimezonePicker";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { commitments, events, timeSlots, users } from "../../db/schema";
import type { Route } from "./+types/events.$id.manage.export";

/**
 * CSV export of all committed respondents for an event.
 * GET /events/:id/manage/export → downloads respondents.csv
 * Organizer-only (same auth as manage page).
 */
export async function loader(args: Route.LoaderArgs) {
  const { params, context } = args;
  const env = getEnv(context);
  const db = getDb(env);
  const session = await requireSession(args.request, env);

  // Verify organizer
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, params.id), eq(events.organizerId, session.id)))
    .limit(1);
  if (!event) throw new Response("Not Found", { status: 404 });

  // Build slot lookup
  const slots = await db
    .select()
    .from(timeSlots)
    .where(eq(timeSlots.eventId, params.id))
    .orderBy(timeSlots.startsAt);
  const slotMap = new Map(slots.map((s) => [s.id, s]));

  // Signed-in commitments
  const signedInRows = await db
    .select({
      slotId: commitments.timeSlotId,
      name: users.fullName,
      email: users.email,
      reputationScore: users.reputationScore,
      tierLabel: commitments.tierLabel,
      tierAmount: commitments.tierAmount,
      createdAt: commitments.createdAt,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(eq(commitments.eventId, params.id), isNull(commitments.withdrawnAt))
    )
    .orderBy(commitments.createdAt);

  // Guest commitments
  const guestRows = await db
    .select({
      slotId: commitments.timeSlotId,
      name: commitments.guestName,
      email: commitments.guestEmail,
      phone: commitments.guestPhone,
      tierLabel: commitments.tierLabel,
      tierAmount: commitments.tierAmount,
      createdAt: commitments.createdAt,
    })
    .from(commitments)
    .where(
      and(
        eq(commitments.eventId, params.id),
        isNull(commitments.withdrawnAt),
        isNull(commitments.userId),
      )
    )
    .orderBy(commitments.createdAt);

  const tz = event.timezone ?? "Pacific/Honolulu";

  // CSV header
  const header = ["Name", "Email", "Phone", "Type", "Slot", "Slot Status", "Tier", "Amount", "Reputation", "Committed At"];

  // CSV rows — one row per commitment (not per person) for maximum data fidelity
  const rows: string[][] = [];

  for (const r of signedInRows) {
    const slot = slotMap.get(r.slotId);
    const slotLabel = slot ? formatInTimezone(slot.startsAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    rows.push([
      r.name,
      r.email,
      "",
      "Signed-in",
      slotLabel,
      slot?.status ?? "",
      r.tierLabel ?? "",
      r.tierAmount != null ? (r.tierAmount / 100).toFixed(2) : "",
      r.reputationScore != null ? String(Math.round(Number(r.reputationScore))) + "%" : "",
      r.createdAt,
    ]);
  }

  for (const r of guestRows) {
    const slot = slotMap.get(r.slotId);
    const slotLabel = slot ? formatInTimezone(slot.startsAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    rows.push([
      r.name ?? "Guest",
      r.email ?? "",
      r.phone ?? "",
      "Guest",
      slotLabel,
      slot?.status ?? "",
      r.tierLabel ?? "",
      r.tierAmount != null ? (r.tierAmount / 100).toFixed(2) : "",
      "",
      r.createdAt,
    ]);
  }

  // RFC 4180 CSV encoding
  function csvEscape(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");

  const filename = `${event.title.replace(/[^a-zA-Z0-9_-]/g, "_")}_respondents.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
