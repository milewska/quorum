import { useState } from "react";

export type SlotInput = { startsAt: string; endsAt: string };

// Grid range: 8:00 AM – 10:00 PM (28 30-min rows)
const DAY_START_HOUR = 8;
const DAY_END_HOUR   = 22;
const TOTAL_ROWS     = (DAY_END_HOUR - DAY_START_HOUR) * 2; // 28

const COL_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Utilities ────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function getWeekStart(d: Date): Date {
  const date = new Date(d);
  const dow = date.getDay(); // 0 = Sun, 1 = Mon…
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function rowToMinutes(row: number): number {
  return DAY_START_HOUR * 60 + row * 30;
}

function formatRowLabel(row: number): string {
  const mins = rowToMinutes(row);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${pad(m)} ${ampm}`;
}

/** "YYYY-MM-DDTHH:mm" in LOCAL time – same format as datetime-local inputs */
function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cellToSlot(weekStart: Date, col: number, row: number): SlotInput {
  const start = addDays(weekStart, col);
  const mins = rowToMinutes(row);
  start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { startsAt: toLocalISO(start), endsAt: toLocalISO(end) };
}

function slotsToKeys(slots: SlotInput[], weekStart: Date): Set<string> {
  const keys = new Set<string>();
  for (const slot of slots) {
    const s = new Date(slot.startsAt);
    for (let col = 0; col < 7; col++) {
      const day = addDays(weekStart, col);
      if (
        day.getFullYear() === s.getFullYear() &&
        day.getMonth()    === s.getMonth()    &&
        day.getDate()     === s.getDate()
      ) {
        const slotMins = s.getHours() * 60 + s.getMinutes();
        const row = (slotMins - DAY_START_HOUR * 60) / 30;
        if (Number.isInteger(row) && row >= 0 && row < TOTAL_ROWS) {
          keys.add(`${col}-${row}`);
        }
        break;
      }
    }
  }
  return keys;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SlotPickerProps {
  slots: SlotInput[];
  onChange: (slots: SlotInput[]) => void;
}

export function SlotPicker({ slots, onChange }: SlotPickerProps) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState<"add" | "remove">("add");

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const selectedKeys = slotsToKeys(slots, weekStart);

  const weekLabel = `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  function toggleCell(col: number, row: number, forcedMode?: "add" | "remove") {
    const key = `${col}-${row}`;
    const { startsAt, endsAt } = cellToSlot(weekStart, col, row);
    const mode = forcedMode ?? (selectedKeys.has(key) ? "remove" : "add");
    if (mode === "remove") {
      onChange(slots.filter((s) => s.startsAt !== startsAt));
    } else {
      // Avoid duplicates
      if (!slots.some((s) => s.startsAt === startsAt)) {
        onChange([...slots, { startsAt, endsAt }]);
      }
    }
  }

  function handleMouseDown(col: number, row: number) {
    const key = `${col}-${row}`;
    const mode = selectedKeys.has(key) ? "remove" : "add";
    setDragging(true);
    setDragMode(mode);
    toggleCell(col, row, mode);
  }

  function handleMouseEnter(col: number, row: number) {
    if (!dragging) return;
    toggleCell(col, row, dragMode);
  }

  function stopDrag() {
    setDragging(false);
  }

  const sortedSlots = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="slot-picker" onMouseUp={stopDrag} onMouseLeave={stopDrag}>
      {/* Week navigation */}
      <div className="slot-picker__nav">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          ← Prev
        </button>
        <span className="slot-picker__week-label">{weekLabel}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          Next →
        </button>
      </div>

      {/* Grid */}
      <div
        className="slot-picker__grid-wrap"
        // Prevent text selection while dragging
        onMouseDown={(e) => { if (e.buttons === 1) e.preventDefault(); }}
      >
        {/* Column headers — sticky */}
        <div className="slot-picker__header-row">
          <div className="slot-picker__gutter" />
          {days.map((d, col) => (
            <div key={col} className="slot-picker__col-header">
              <span className="slot-picker__col-day">{COL_LABELS[col]}</span>
              <span className="slot-picker__col-date">
                {d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable rows */}
        <div className="slot-picker__scroll">
          {Array.from({ length: TOTAL_ROWS }, (_, row) => (
            <div key={row} className="slot-picker__row">
              <div className="slot-picker__time-label">
                {row % 2 === 0 ? formatRowLabel(row) : ""}
              </div>
              {Array.from({ length: 7 }, (_, col) => {
                const selected = selectedKeys.has(`${col}-${row}`);
                return (
                  <div
                    key={col}
                    className={`slot-picker__cell${selected ? " slot-picker__cell--on" : ""}`}
                    onMouseDown={() => handleMouseDown(col, row)}
                    onMouseEnter={() => handleMouseEnter(col, row)}
                    role="checkbox"
                    aria-checked={selected}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        toggleCell(col, row);
                      }
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selected slots summary */}
      {sortedSlots.length > 0 ? (
        <div className="slot-picker__summary">
          <p className="slot-picker__summary-hd">
            {sortedSlots.length} slot{sortedSlots.length !== 1 ? "s" : ""} selected
          </p>
          <ul className="slot-picker__summary-list">
            {sortedSlots.map((s, i) => (
              <li key={i} className="slot-picker__chip">
                <span>
                  {new Date(s.startsAt).toLocaleString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" – "}
                  {new Date(s.endsAt).toLocaleString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  type="button"
                  className="slot-picker__chip-remove"
                  aria-label="Remove slot"
                  onClick={() => {
                    const original = slots.findIndex((sl) => sl.startsAt === s.startsAt);
                    onChange(slots.filter((_, idx) => idx !== original));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="slot-picker__empty">
          Click or drag cells to add 30-minute time slots. Adjacent cells create longer blocks.
        </p>
      )}
    </div>
  );
}
