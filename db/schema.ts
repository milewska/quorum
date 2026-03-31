import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// ─── Helpers ─────────────────────────────────────────────────────────────────
// D1 is SQLite — no native UUID, ENUM, TIMESTAMP, or DECIMAL types.
// UUIDs stored as TEXT, enums as TEXT with runtime validation,
// timestamps as TEXT (ISO 8601), decimals as REAL.

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  // Percentage (0–100). Calculated as: registered / committed-to-confirmed * 100
  reputationScore: real("reputation_score").notNull().default(100.0),
  // WorkOS user ID for linking OAuth profiles (kept for future SSO)
  // Also doubles as Google OAuth sub ID after QUOR-1 migration
  workosUserId: text("workos_user_id").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = sqliteTable("events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizerId: text("organizer_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // Free-text city/region for display and LIKE filtering
  location: text("location").notNull(),
  // R2 object key or external image URL
  imageKey: text("image_key"),
  // 'public' | 'private'
  visibility: text("visibility").notNull().default("public"),
  // Minimum number of commitments on a single slot to reach quorum
  threshold: integer("threshold").notNull(),
  // ISO 8601 deadline; max 90 days from creation
  deadline: text("deadline").notNull(),
  // External registration URL — populated when organizer confirms
  registrationUrl: text("registration_url"),
  // JSON array of { label: string, amount: number (cents, 0=free) }. Null = free event.
  costTiersJson: text("cost_tiers_json"),
  // When set, quorum is by total pledged $ instead of headcount. Null = headcount.
  priceQuorumCents: integer("price_quorum_cents"),
  // 'draft' | 'active' | 'quorum_reached' | 'confirmed' | 'completed' | 'expired'
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Time Slots ───────────────────────────────────────────────────────────────

export const timeSlots = sqliteTable("time_slots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  // Denormalized counter — kept in sync via transaction on commit/withdraw
  commitmentCount: integer("commitment_count").notNull().default(0),
  // 'active' | 'quorum_reached' | 'confirmed'
  status: text("status").notNull().default("active"),
});

// ─── Commitments ──────────────────────────────────────────────────────────────

export const commitments = sqliteTable("commitments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  timeSlotId: text("time_slot_id")
    .notNull()
    .references(() => timeSlots.id, { onDelete: "cascade" }),
  // Denormalized for efficient dashboard queries
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  // Soft-delete for withdrawal. Null = active commitment.
  withdrawnAt: text("withdrawn_at"),
  // Which pricing tier the committer chose (null for free events)
  tierLabel: text("tier_label"),
  tierAmount: integer("tier_amount"),
});

// ─── Attendance ───────────────────────────────────────────────────────────────

export const attendance = sqliteTable("attendance", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  // 1 = organizer confirmed this participant registered
  registered: integer("registered", { mode: "boolean" }).notNull().default(false),
  markedAt: text("marked_at"),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  organizedEvents: many(events),
  commitments: many(commitments),
  attendance: many(attendance),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  organizer: one(users, {
    fields: [events.organizerId],
    references: [users.id],
  }),
  timeSlots: many(timeSlots),
  commitments: many(commitments),
  attendance: many(attendance),
}));

export const timeSlotsRelations = relations(timeSlots, ({ one, many }) => ({
  event: one(events, {
    fields: [timeSlots.eventId],
    references: [events.id],
  }),
  commitments: many(commitments),
}));

export const commitmentsRelations = relations(commitments, ({ one }) => ({
  user: one(users, {
    fields: [commitments.userId],
    references: [users.id],
  }),
  timeSlot: one(timeSlots, {
    fields: [commitments.timeSlotId],
    references: [timeSlots.id],
  }),
  event: one(events, {
    fields: [commitments.eventId],
    references: [events.id],
  }),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  user: one(users, {
    fields: [attendance.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [attendance.eventId],
    references: [events.id],
  }),
}));
