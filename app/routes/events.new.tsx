import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import { requireSession } from "~/auth.server";
import { getEnv } from "~/env.server";
import { getDb } from "../../db";
import { events, timeSlots } from "../../db/schema";
import type { Route } from "./+types/events.new";
import { SlotPicker } from "~/components/SlotPicker";
import { CostTierEditor } from "~/components/CostTierEditor";
import type { CostTier } from "~/components/CostTierEditor";
import type { SlotInput } from "~/components/SlotPicker";
import { TimezonePicker } from "~/components/TimezonePicker";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Local-time "YYYY-MM-DDTHH:mm" → Date */
function parseLocalISO(s: string): Date {
  return new Date(s); // browsers parse without-tz as local time
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireSession(request, context.cloudflare.env);
  return null;
}

type Errors = Record<string, string>;

export async function action(args: Route.ActionArgs) {
  const session = await requireSession(args.request, args.context.cloudflare.env);
  const env = getEnv(args.context);
  const db = getDb(env);

  const fd = await args.request.formData();
  const intent = (fd.get("intent") as string) ?? "draft";
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

  // priceQuorumCents: only valid when paid tiers exist and a positive $ amount was entered
  let priceQuorumCents: number | null = null;
  if (priceQuorumStr && costTiers.length > 0) {
    const dollars = parseFloat(priceQuorumStr);
    if (!isNaN(dollars) && dollars > 0) priceQuorumCents = Math.round(dollars * 100);
  }

  // ── Validate ──────────────────────────────────────────────────────────────
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
  else if (deadline <= now)
    errors.deadline = "Deadline must be in the future.";
  else if (deadline > maxDate)
    errors.deadline = "Deadline must be within 90 days.";

  if (intent === "publish" && slots.length === 0)
    errors.slots = "Add at least one time slot before publishing.";

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const start = new Date(s.startsAt);
    const end = new Date(s.endsAt);
    if (isNaN(start.getTime())) {
      errors.slots = `Slot ${i + 1}: invalid start time.`;
      break;
    }
    if (isNaN(end.getTime())) {
      errors.slots = `Slot ${i + 1}: invalid end time.`;
      break;
    }
    if (end <= start) {
      errors.slots = `Slot ${i + 1}: end must be after start.`;
      break;
    }
  }

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

  if (Object.keys(errors).length > 0) {
    return {
      errors,
      values: {
        title,
        description,
        location,
        visibility,
        thresholdStr,
        deadlineStr,
        slots,
        costTiers,
        priceQuorumStr,
        timezone,
      },
    };
  }

  // ── Image → R2 ────────────────────────────────────────────────────────────
  let imageKey: string | null = null;
  if (imageFile && imageFile.size > 0) {
    const ext = imageFile.name.split(".").pop()?.toLowerCase() ?? "bin";
    imageKey = `events/${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(imageKey, await imageFile.arrayBuffer(), {
      httpMetadata: {
        contentType: imageFile.type || "application/octet-stream",
      },
    });
  }

  // ── Insert event ──────────────────────────────────────────────────────────
  const status = intent === "publish" ? "active" : "draft";
  const [created] = await db
    .insert(events)
    .values({
      organizerId: session.id,
      title,
      description,
      location,
      visibility,
      threshold,
      deadline: deadline.toISOString(),
      imageKey,
      costTiersJson: costTiers.length > 0 ? JSON.stringify(costTiers) : null,
      priceQuorumCents,
      timezone,
      status: status as "active" | "draft",
    })
    .returning({ id: events.id });

  // ── Insert slots ──────────────────────────────────────────────────────────
  if (slots.length > 0) {
    await db.insert(timeSlots).values(
      slots.map((s) => ({
        eventId: created.id,
        startsAt: new Date(s.startsAt).toISOString(),
        endsAt: new Date(s.endsAt).toISOString(),
      }))
    );
  }

  return redirect(
    intent === "publish"
      ? `/events/${created.id}`
      : `/events/${created.id}/edit`
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewEvent() {
  const data = useActionData<typeof action>();
  const errors: Errors = data?.errors ?? {};
  const vals = data?.values;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [slots, setSlots] = useState<SlotInput[]>(vals?.slots ?? []);
  const [timezone, setTimezone] = useState(vals?.timezone ?? "Pacific/Honolulu");
  const [costTiers, setCostTiers] = useState<CostTier[]>(vals?.costTiers ?? []);
  const [priceQuorumEnabled, setPriceQuorumEnabled] = useState(
    !!(vals?.priceQuorumStr)
  );
  const [priceQuorumDollars, setPriceQuorumDollars] = useState(
    vals?.priceQuorumStr ?? ""
  );

  return (
    <section className="page-section">
      <div className="form-page">
        <h1 className="form-page__title">Create Event</h1>

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
                defaultValue={vals?.title}
                placeholder="e.g. Jazz Night at The Forum"
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
                defaultValue={vals?.description}
                placeholder="What will happen? Describe the experience."
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
                  defaultValue={vals?.location}
                  placeholder="e.g. Chicago, IL"
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
                  defaultValue={vals?.thresholdStr ?? "20"}
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
                  defaultValue={vals?.deadlineStr ?? nowPlus(30)}
                  min={nowPlus(1)}
                  max={nowPlus(90)}
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
                    defaultChecked={vals?.visibility !== "private"}
                  />
                  Public — listed for everyone
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    defaultChecked={vals?.visibility === "private"}
                  />
                  Private — share link only
                </label>
              </div>
            </div>
          </fieldset>

          {/* ── Cover Image ── */}
          <fieldset className="form-section">
            <legend className="form-section__legend">Cover Image (optional)</legend>
            <div className="field">
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
            <Link to="/events" className="btn btn--ghost">
              Cancel
            </Link>
            <button
              type="submit"
              name="intent"
              value="draft"
              className="btn btn--ghost"
              disabled={busy}
            >
              Save as draft
            </button>
            <button
              type="submit"
              name="intent"
              value="publish"
              className="btn btn--primary"
              disabled={busy}
            >
              {busy ? "Publishing…" : "Publish"}
            </button>
          </div>
        </Form>
      </div>
    </section>
  );
}
