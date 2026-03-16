import {
  boolean,
  decimal,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const visibilityEnum = pgEnum("visibility", ["public", "private"]);

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "active",
  "quorum_reached",
  "confirmed",
  "completed",
  "expired",
]);

export const slotStatusEnum = pgEnum("slot_status", [
  "active",
  "quorum_reached",
  "confirmed",
]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  // Percentage (0–100). Calculated as: registered / committed-to-confirmed-events * 100
  reputationScore: decimal("reputation_score", { precision: 5, scale: 2 })
    .notNull()
    .default("100.00"),
  // WorkOS user ID for linking OAuth profiles
  workosUserId: text("workos_user_id").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizerId: uuid("organizer_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // Free-text city/region for display and ILIKE filtering
  location: text("location").notNull(),
  // R2 object key (not full URL — constructed at render time)
  imageKey: text("image_key"),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  // Minimum number of commitments on a single slot to reach quorum
  threshold: integer("threshold").notNull(),
  // Organizer-set deadline; server enforces max 90 days from creation
  deadline: timestamp("deadline").notNull(),
  // Populated when organizer confirms; points to external registration page
  registrationUrl: text("registration_url"),
  status: eventStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Time Slots ───────────────────────────────────────────────────────────────

export const timeSlots = pgTable("time_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  // Denormalized counter — kept in sync via transaction on commit/withdraw
  commitmentCount: integer("commitment_count").notNull().default(0),
  status: slotStatusEnum("status").notNull().default("active"),
});

// ─── Commitments ──────────────────────────────────────────────────────────────

export const commitments = pgTable("commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  timeSlotId: uuid("time_slot_id")
    .notNull()
    .references(() => timeSlots.id, { onDelete: "cascade" }),
  // Denormalized for efficient dashboard queries
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Soft-delete for withdrawal. Null = active commitment.
  withdrawnAt: timestamp("withdrawn_at"),
});

// ─── Attendance ───────────────────────────────────────────────────────────────

export const attendance = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  // True = organizer confirmed this participant registered for the event
  registered: boolean("registered").notNull().default(false),
  markedAt: timestamp("marked_at"),
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
