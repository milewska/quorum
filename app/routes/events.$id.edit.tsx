import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import { requireSession } from "~/auth.server";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { commitments, events, timeSlots, users } from "../../db/schema";
import type { Route } from "./+types/events.$id.edit";
import { SlotPicker } from "~/components/SlotPicker";
import { CostTierEditor } from "~/components/CostTierEditor";
import type { CostTier } from "~/components/CostTierEditor";
import type { SlotInput } from "~/components/SlotPicker";
import { TimezonePicker, localToUTC, utcToLocalStr } from "~/components/TimezonePicker";

// ─── Server ───────────────────────────────────────────────────────────────────

export async function loader(args: Route.LoaderArgs) {
  const session = await requireSession(args.request, args.context.cloudflare.env);
  const { params, context } = args;
  const db = getDb(getEnv(context));

  const dbUser = { id: session.id };

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

type Errors = Record<string, string>;

export async function action(args: Route.ActionArgs) {
  const session = await requireSession(args.request, args.context.cloudflare.env);
  const { params, context } = args;
  const env = getEnv(context);
  const db = getDb(env);

  // Verify ownership
  const dbUser = { id: session.id };

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

  // ── Delete ────────────────────────────────────────────────────────────────
  if (intent === "delete") {
    await db.delete(commitments).where(eq(commitments.eventId, params.id));
    await db.delete(timeSlots).where(eq(timeSlots.eventId, params.id));
    await db.delete(events).where(eq(events.id, params.id));
    return redirect("/events");
  }

  const title = ((fd.get("title") as string) ?? "").trim();
  const description = ((fd.get("description") as string) ?? "").trim();
  const location = ((fd.get("location") as string) ?? "").trim();
  const visibility =
    (fd.get("visibility") as string) === "private" ? "private" : "public";
  const thresholdStr = (fd.get("threshold") as string) ?? "";
  const deadlineStr = (fd.get("deadline") as string) ?? "";
  const slotsStr = (fd.get("slots") as string) ?? "[]";
  const costTiersStr = (fd.get("costTiers") as string) ?? "[]";
  const priceQuorumStr = (fd.get("priceQuorumCents") as string) ?? "";
  const timezone = ((fd.get("timezone") as string) ?? "Pacific/Honolulu").trim();
  const imageFile = fd.get("image") as File | null;

  let slots: SlotInput[] = [];
  try { slots = JSON.parse(slotsStr); } catch {}

  let costTiers: CostTier[] = [];
  try { costTiers = JSON.parse(costTiersStr); } catch {}

  let priceQuorumCents: number | null = null;
  if (priceQuorumStr && costTiers.length > 0) {
    const dollars = parseFloat(priceQuorumStr);
    if (!isNaN(dollars) && dollars > 0) priceQuorumCents = Math.round(dollars * 100);
  }

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

  // Validate cost tiers
  for (let i = 0; i < costTiers.length; i++) {
    if (!costTiers[i].label.trim()) {
      errors.costTiers = `Tier ${i + 1}: label is required.`;
      break;
    }
    if (costTiers[i].amount < 0) {
      errors.costTiers = `Tier ${i + 1}: amount cannot be negative.`;
      break;
    }
  }
  if (priceQuorumStr && costTiers.length === 0)
    errors.costTiers = "Price quorum requires at least one paid tier.";
  if (priceQuorumStr && priceQuorumCents === null)
    errors.priceQuorum = "Enter a valid target amount greater than $0.";

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
      values: { title, description, location, visibility, thresholdStr, deadlineStr, slots, costTiers, priceQuorumStr, timezone },
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
      deadline: localToUTC(deadlineStr, timezone),
      imageKey,
      costTiersJson: costTiers.length > 0 ? JSON.stringify(costTiers) : null,
      priceQuorumCents,
      timezone,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(events.id, params.id));

  // ── Upsert slots (preserve existing slots + their commitments) ───────────
  // Load current slots from DB
  const existingSlots = await db
    .select({ id: timeSlots.id, startsAt: timeSlots.startsAt, endsAt: timeSlots.endsAt })
    .from(timeSlots)
    .where(eq(timeSlots.eventId, params.id));

  // Convert incoming slots to UTC for comparison
  const incomingSlots = slots.map((s) => ({
    startsAt: localToUTC(s.startsAt, timezone),
    endsAt: localToUTC(s.endsAt, timezone),
  }));

  // Match existing slots by start+end time (timestamp comparison — resilient to format differences)
  // This preserves the slot ID + all attached commitments for unchanged slots.
  const matchedExistingIds = new Set<string>();
  const newSlots: { startsAt: string; endsAt: string }[] = [];

  for (const incoming of incomingSlots) {
    const inStart = new Date(incoming.startsAt).getTime();
    const inEnd = new Date(incoming.endsAt).getTime();
    const match = existingSlots.find(
      (ex) =>
        !matchedExistingIds.has(ex.id) &&
        new Date(ex.startsAt).getTime() === inStart &&
        new Date(ex.endsAt).getTime() === inEnd
    );
    if (match) {
      matchedExistingIds.add(match.id);
    } else {
      newSlots.push(incoming);
    }
  }

  // Delete only slots that were removed by the organizer (not in incoming set)
  const slotsToDelete = existingSlots.filter((ex) => !matchedExistingIds.has(ex.id));
  for (const slot of slotsToDelete) {
    // This will cascade-delete commitments only for REMOVED slots
    await db.delete(timeSlots).where(eq(timeSlots.id, slot.id));
  }

  // Insert only genuinely new slots
  if (newSlots.length > 0) {
    await db.insert(timeSlots).values(
      newSlots.map((s) => ({
        eventId: params.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      }))
    );
  }

  return redirect(`/events/${params.id}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Removed old toDatetimeLocal — replaced by utcToLocalStr from TimezonePicker

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditEvent() {
  const { event, slots: dbSlots } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const errors: Errors = data?.errors ?? {};
  const vals = data?.values;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const tz = vals?.timezone ?? event.timezone ?? "Pacific/Honolulu";
  const initialSlots: SlotInput[] =
    vals?.slots ??
    dbSlots.map((s) => ({
      startsAt: utcToLocalStr(s.startsAt, tz),
      endsAt: utcToLocalStr(s.endsAt, tz),
    }));

  const [slots, setSlots] = useState<SlotInput[]>(
    initialSlots.length > 0 ? initialSlots : []
  );

  const [timezone, setTimezone] = useState(
    vals?.timezone ?? event.timezone ?? "Pacific/Honolulu"
  );

  const initialTiers: CostTier[] =
    vals?.costTiers ??
    (event.costTiersJson ? (JSON.parse(event.costTiersJson) as CostTier[]) : []);

  const [costTiers, setCostTiers] = useState<CostTier[]>(initialTiers);

  const initialPriceQuorumStr =
    vals?.priceQuorumStr ??
    (event.priceQuorumCents != null ? String(event.priceQuorumCents / 100) : "");
  const [priceQuorumEnabled, setPriceQuorumEnabled] = useState(
    event.priceQuorumCents != null || !!(vals?.priceQuorumStr)
  );
  const [priceQuorumDollars, setPriceQuorumDollars] = useState(initialPriceQuorumStr);

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
          <input type="hidden" name="costTiers" value={JSON.stringify(costTiers)} />
          <input type="hidden" name="timezone" value={timezone} />

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
                  defaultValue={vals?.deadlineStr ?? utcToLocalStr(event.deadline, tz)}
                  required
                />
                {errors.deadline && (
                  <p className="field__error">{errors.deadline}</p>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="timezone">
                  Timezone
                </label>
                <TimezonePicker
                  name="tz-display"
                  value={timezone}
                  onChange={setTimezone}
                />
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
                src={event.imageKey.startsWith("https://") ? event.imageKey : `/images/${event.imageKey}`}
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
            <SlotPicker slots={slots} onChange={setSlots} />
          </fieldset>

          {/* ── Pricing ── */}
          <fieldset className="form-section">
            <legend className="form-section__legend">Pricing</legend>
            {errors.costTiers && <p className="field__error">{errors.costTiers}</p>}
            <CostTierEditor
              tiers={costTiers}
              onChange={(t) => {
                setCostTiers(t);
                if (t.length === 0) setPriceQuorumEnabled(false);
              }}
            />
            {costTiers.length > 0 && (
              <div className="price-quorum-toggle">
                <label className="radio-option">
                  <input
                    type="checkbox"
                    checked={priceQuorumEnabled}
                    onChange={(e) => {
                      setPriceQuorumEnabled(e.target.checked);
                      if (!e.target.checked) setPriceQuorumDollars("");
                    }}
                  />
                  Use price quorum — set a revenue target instead of a headcount
                </label>
                {priceQuorumEnabled && (
                  <div className="price-quorum-input">
                    <label className="field__label" htmlFor="priceQuorumCents">
                      Target amount
                    </label>
                    <div className="tier-row__amount-wrap">
                      <span className="tier-row__currency">$</span>
                      <input
                        id="priceQuorumCents"
                        name="priceQuorumCents"
                        type="number"
                        min={1}
                        step="0.01"
                        className="field__input tier-row__amount-input"
                        placeholder="e.g. 500.00"
                        value={priceQuorumDollars}
                        onChange={(e) => setPriceQuorumDollars(e.target.value)}
                      />
                    </div>
                    {errors.priceQuorum && (
                      <p className="field__error">{errors.priceQuorum}</p>
                    )}
                    <p className="field__hint">
                      Quorum is reached when total pledged amount meets this target.
                      The headcount threshold above is ignored.
                    </p>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          {/* ── Actions ── */}
          <div className="form-actions">
            <button
              type="submit"
              name="intent"
              value="delete"
              className="btn btn--danger"
              disabled={busy}
              onClick={(e) => {
                if (!window.confirm("Delete this event? This cannot be undone.")) {
                  e.preventDefault();
                }
              }}
            >
              Delete event
            </button>
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
