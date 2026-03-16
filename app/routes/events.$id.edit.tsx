import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import { requireUser } from "~/auth.server";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { events, timeSlots, users } from "../../db/schema";
import type { Route } from "./+types/events.$id.edit";

// ─── Server ───────────────────────────────────────────────────────────────────

export async function loader(args: Route.LoaderArgs) {
  const { user } = await requireUser(args);
  const { params, context } = args;
  const db = getDb(getEnv(context));

  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workosUserId, user.id))
    .limit(1);

  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, params.id))
    .limit(1);

  if (!event) throw new Response("Not Found", { status: 404 });
  if (event.organizerId !== dbUser?.id)
    throw new Response("Forbidden", { status: 403 });

  const slots = await db
    .select({ id: timeSlots.id, startsAt: timeSlots.startsAt, endsAt: timeSlots.endsAt })
    .from(timeSlots)
    .where(eq(timeSlots.eventId, params.id))
    .orderBy(timeSlots.startsAt);

  return { event, slots };
}

type SlotInput = { startsAt: string; endsAt: string };
type Errors = Record<string, string>;

export async function action(args: Route.ActionArgs) {
  const { user } = await requireUser(args);
  const { params, context } = args;
  const env = getEnv(context);
  const db = getDb(env);

  // Verify ownership
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workosUserId, user.id))
    .limit(1);

  const [existing] = await db
    .select({ id: events.id, organizerId: events.organizerId, imageKey: events.imageKey, status: events.status })
    .from(events)
    .where(eq(events.id, params.id))
    .limit(1);

  if (!existing) throw new Response("Not Found", { status: 404 });
  if (existing.organizerId !== dbUser?.id)
    throw new Response("Forbidden", { status: 403 });

  const fd = await args.request.formData();
  const intent = (fd.get("intent") as string) ?? "save";
  const title = ((fd.get("title") as string) ?? "").trim();
  const description = ((fd.get("description") as string) ?? "").trim();
  const location = ((fd.get("location") as string) ?? "").trim();
  const visibility =
    (fd.get("visibility") as string) === "private" ? "private" : "public";
  const thresholdStr = (fd.get("threshold") as string) ?? "";
  const deadlineStr = (fd.get("deadline") as string) ?? "";
  const slotsStr = (fd.get("slots") as string) ?? "[]";
  const imageFile = fd.get("image") as File | null;

  let slots: SlotInput[] = [];
  try {
    slots = JSON.parse(slotsStr);
  } catch {}

  const errors: Errors = {};
  if (!title) errors.title = "Title is required.";
  else if (title.length > 200) errors.title = "Max 200 characters.";
  if (!description) errors.description = "Description is required.";
  if (!location) errors.location = "Location is required.";

  const threshold = parseInt(thresholdStr, 10);
  if (!thresholdStr || isNaN(threshold) || threshold < 1)
    errors.threshold = "Must be at least 1.";
  else if (threshold > 100_000) errors.threshold = "Max 100,000.";

  const now = new Date();
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 90);
  const deadline = new Date(deadlineStr);
  if (!deadlineStr || isNaN(deadline.getTime()))
    errors.deadline = "Deadline is required.";
  else if (deadline > maxDate)
    errors.deadline = "Deadline must be within 90 days of today.";

  if (intent === "publish" && slots.length === 0)
    errors.slots = "Add at least one time slot before publishing.";

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const start = new Date(s.startsAt);
    const end = new Date(s.endsAt);
    if (isNaN(start.getTime())) { errors.slots = `Slot ${i + 1}: invalid start time.`; break; }
    if (isNaN(end.getTime())) { errors.slots = `Slot ${i + 1}: invalid end time.`; break; }
    if (end <= start) { errors.slots = `Slot ${i + 1}: end must be after start.`; break; }
  }

  if (Object.keys(errors).length > 0) {
    return {
      errors,
      values: { title, description, location, visibility, thresholdStr, deadlineStr, slots },
    };
  }

  // ── Image → R2 (only if a new file is uploaded) ───────────────────────────
  let imageKey = existing.imageKey;
  if (imageFile && imageFile.size > 0) {
    const ext = imageFile.name.split(".").pop()?.toLowerCase() ?? "bin";
    imageKey = `events/${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(imageKey, await imageFile.arrayBuffer(), {
      httpMetadata: { contentType: imageFile.type || "application/octet-stream" },
    });
  }

  // ── Update event ──────────────────────────────────────────────────────────
  const newStatus =
    intent === "publish"
      ? "active"
      : (existing.status as "draft" | "active");

  await db
    .update(events)
    .set({
      title,
      description,
      location,
      visibility,
      threshold,
      deadline,
      imageKey,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(events.id, params.id));

  // ── Replace slots ─────────────────────────────────────────────────────────
  await db.delete(timeSlots).where(eq(timeSlots.eventId, params.id));
  if (slots.length > 0) {
    await db.insert(timeSlots).values(
      slots.map((s) => ({
        eventId: params.id,
        startsAt: new Date(s.startsAt),
        endsAt: new Date(s.endsAt),
      }))
    );
  }

  return redirect(`/events/${params.id}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDatetimeLocal(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 16);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditEvent() {
  const { event, slots: dbSlots } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const errors: Errors = data?.errors ?? {};
  const vals = data?.values;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const initialSlots: SlotInput[] =
    vals?.slots ??
    dbSlots.map((s) => ({
      startsAt: toDatetimeLocal(s.startsAt),
      endsAt: toDatetimeLocal(s.endsAt),
    }));

  const [slots, setSlots] = useState<SlotInput[]>(
    initialSlots.length > 0 ? initialSlots : [{ startsAt: "", endsAt: "" }]
  );

  const addSlot = () =>
    setSlots((prev) => [...prev, { startsAt: "", endsAt: "" }]);
  const removeSlot = (i: number) =>
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  const updateSlot = (i: number, field: keyof SlotInput, value: string) =>
    setSlots((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    );

  const isDraft = event.status === "draft";

  return (
    <section className="page-section">
      <div className="form-page">
        <div className="form-page__header">
          <h1 className="form-page__title">Edit Event</h1>
          <Link to={`/events/${event.id}`} className="btn btn--ghost">
            View event
          </Link>
        </div>

        <Form method="post" encType="multipart/form-data" className="event-form">
          <input type="hidden" name="slots" value={JSON.stringify(slots)} />

          {/* ── Details ── */}
          <fieldset className="form-section">
            <legend className="form-section__legend">Details</legend>

            <div className="field">
              <label className="field__label" htmlFor="title">
                Title <span className="field__req">*</span>
              </label>
              <input
                id="title"
                name="title"
                type="text"
                className={`field__input${errors.title ? " field__input--error" : ""}`}
                defaultValue={vals?.title ?? event.title}
                maxLength={200}
                required
              />
              {errors.title && <p className="field__error">{errors.title}</p>}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="description">
                Description <span className="field__req">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                className={`field__input field__textarea${errors.description ? " field__input--error" : ""}`}
                defaultValue={vals?.description ?? event.description}
                rows={5}
                required
              />
              {errors.description && (
                <p className="field__error">{errors.description}</p>
              )}
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field__label" htmlFor="location">
                  Location <span className="field__req">*</span>
                </label>
                <input
                  id="location"
                  name="location"
                  type="text"
                  className={`field__input${errors.location ? " field__input--error" : ""}`}
                  defaultValue={vals?.location ?? event.location}
                  required
                />
                {errors.location && (
                  <p className="field__error">{errors.location}</p>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="threshold">
                  Quorum threshold <span className="field__req">*</span>
                </label>
                <input
                  id="threshold"
                  name="threshold"
                  type="number"
                  min={1}
                  max={100000}
                  className={`field__input${errors.threshold ? " field__input--error" : ""}`}
                  defaultValue={vals?.thresholdStr ?? String(event.threshold)}
                  required
                />
                {errors.threshold && (
                  <p className="field__error">{errors.threshold}</p>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="deadline">
                  Commitment deadline <span className="field__req">*</span>
                </label>
                <input
                  id="deadline"
                  name="deadline"
                  type="datetime-local"
                  className={`field__input${errors.deadline ? " field__input--error" : ""}`}
                  defaultValue={vals?.deadlineStr ?? toDatetimeLocal(event.deadline)}
                  required
                />
                {errors.deadline && (
                  <p className="field__error">{errors.deadline}</p>
                )}
              </div>
            </div>

            <div className="field">
              <span className="field__label">Visibility</span>
              <div className="radio-group">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    defaultChecked={(vals?.visibility ?? event.visibility) !== "private"}
                  />
                  Public — listed for everyone
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    defaultChecked={(vals?.visibility ?? event.visibility) === "private"}
                  />
                  Private — share link only
                </label>
              </div>
            </div>
          </fieldset>

          {/* ── Cover Image ── */}
          <fieldset className="form-section">
            <legend className="form-section__legend">Cover Image</legend>
            {event.imageKey && (
              <img
                src={`/images/${event.imageKey}`}
                alt="Current cover"
                className="field__img-preview"
              />
            )}
            <div className="field">
              <label className="field__label">
                {event.imageKey ? "Replace image (optional)" : "Upload image (optional)"}
              </label>
              <input
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="field__file"
              />
            </div>
          </fieldset>

          {/* ── Time Slots ── */}
          <fieldset className="form-section">
            <legend className="form-section__legend">Time Slots</legend>
            {errors.slots && <p className="field__error">{errors.slots}</p>}
            {slots.map((slot, i) => (
              <div key={i} className="slot-row">
                <div className="field">
                  <label className="field__label">Start</label>
                  <input
                    type="datetime-local"
                    className="field__input"
                    value={slot.startsAt}
                    onChange={(e) => updateSlot(i, "startsAt", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field__label">End</label>
                  <input
                    type="datetime-local"
                    className="field__input"
                    value={slot.endsAt}
                    onChange={(e) => updateSlot(i, "endsAt", e.target.value)}
                  />
                </div>
                {slots.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => removeSlot(i)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addSlot}
            >
              + Add time slot
            </button>
          </fieldset>

          {/* ── Actions ── */}
          <div className="form-actions">
            <Link to={`/events/${event.id}`} className="btn btn--ghost">
              Cancel
            </Link>
            <button
              type="submit"
              name="intent"
              value="save"
              className="btn btn--ghost"
              disabled={busy}
            >
              Save changes
            </button>
            {isDraft && (
              <button
                type="submit"
                name="intent"
                value="publish"
                className="btn btn--primary"
                disabled={busy}
              >
                {busy ? "Publishing…" : "Publish"}
              </button>
            )}
            {!isDraft && (
              <button
                type="submit"
                name="intent"
                value="save"
                className="btn btn--primary"
                disabled={busy}
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            )}
          </div>
        </Form>
      </div>
    </section>
  );
}
