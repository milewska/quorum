/**
 * Checks whether any active events have passed their deadline without reaching
 * quorum and marks them as expired, sending notification emails.
 *
 * Call this from loader functions (on-load expiry detection, since Cloudflare
 * Pages doesn't natively support cron triggers without Workers Cron).
 *
 * @param db        Drizzle DB instance
 * @param env       Cloudflare env with RESEND_API_KEY + BASE_URL
 * @param eventIds  Specific event IDs to check (pass [] to skip)
 * @param baseUrl   Origin URL for email links
 */

import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import {
  eventExpiredOrganizerEmail,
  eventExpiredParticipantEmail,
  sendMail,
} from "./email.server";

export async function expireOverdueEvents(
  db: ReturnType<typeof getDb>,
  env: Env,
  eventIds: string[],
  baseUrl: string
): Promise<void> {
  if (eventIds.length === 0) return;

  const now = new Date();
  const nowISO = now.toISOString();

  // Find events in the given set that are still "active" and past deadline
  const overdueEvents = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      deadline: schema.events.deadline,
      organizerEmail: schema.users.email,
    })
    .from(schema.events)
    .innerJoin(schema.users, eq(schema.users.id, schema.events.organizerId))
    .where(
      and(
        inArray(schema.events.id, eventIds),
        eq(schema.events.status, "active"),
        lt(schema.events.deadline, nowISO)
      )
    );

  for (const ev of overdueEvents) {
    // Mark expired
    await db
      .update(schema.events)
      .set({ status: "expired", updatedAt: nowISO })
      .where(eq(schema.events.id, ev.id));

    // Notify organizer + committed participants (fire-and-forget)
    try {
      const orgTpl = eventExpiredOrganizerEmail(ev.title, ev.id, baseUrl);
      await sendMail(env, { to: ev.organizerEmail, ...orgTpl });

      const participants = await db
        .select({ email: schema.users.email })
        .from(schema.commitments)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.commitments.userId)
        )
        .where(
          and(
            eq(schema.commitments.eventId, ev.id),
            isNull(schema.commitments.withdrawnAt)
          )
        );

      for (const p of participants) {
        const tpl = eventExpiredParticipantEmail(ev.title, ev.id, baseUrl);
        await sendMail(env, { to: p.email, ...tpl });
      }
    } catch (e) {
      console.error(`Expiry emails failed for event ${ev.id}:`, e);
    }
  }
}
