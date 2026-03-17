import { useState } from "react";

export type SlotInput = { startsAt: string; endsAt: string };

// Grid range: 8:00 AM – 10:00 PM
const DAY_START_HOUR = 8;
const DAY_END_HOUR   = 22;
const TOTAL_ROWS     = (DAY_END_HOUR - DAY_START_HOUR) * 2; // 28 half-hour rows

const COL_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// [label, number of 30-min blocks]
const DURATION_OPTIONS: [string, number][] = [
  ["30 min", 1],
  ["1 hr",   2],
  ["1.5 hr", 3],
  ["2 hr",   4],
  ["2.5 hr", 5],
  ["3 hr",   6],
  ["3.5 hr", 7],
  ["4 hr",   8],
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function getWeekStart(d: Date): Date {
  const date = new Date(d);
  const dow = date.getDay();
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

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cellToSlot(
  weekStart: Date,
  col: number,
  row: number,
  durationBlocks: number,
): SlotInput {
  const start = addDays(weekStart, col);
  const mins = rowToMinutes(row);
  start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  const end = new Date(start.getTime() + durationBlocks * 30 * 60 * 1000);
  return { startsAt: toLocalISO(start), endsAt: toLocalISO(end) };
}

type CellPos = "single" | "start" | "mid" | "end";
type CellInfo = { startsAt: string; position: CellPos };

/**
 * Returns a map of "col-row" -> CellInfo for every row spanned by any slot.
 * Slots that start before DAY_START_HOUR or end after DAY_END_HOUR are clamped.
 */
function buildCellMap(slots: SlotInput[], weekStart: Date): Map<string, CellInfo> {
  const map = new Map<string, CellInfo>();
  for (const slot of slots) {
    const s = new Date(slot.startsAt);
    const e = new Date(slot.endsAt);
    for (let col = 0; col < 7; col++) {
      const day = addDays(weekStart, col);
      if (
        day.getFullYear() === s.getFullYear() &&
        day.getMonth()    === s.getMonth()    &&
        day.getDate()     === s.getDate()
      ) {
        const startMins = s.getHours() * 60 + s.getMinutes();
        const endMins   = e.getHours() * 60 + e.getMinutes();
        const startRow  = (startMins - DAY_START_HOUR * 60) / 30;
        const endRow    = Math.min((endMins - DAY_START_HOUR * 60) / 30, TOTAL_ROWS);
        if (!Number.isInteger(startRow) || startRow < 0 || startRow >= TOTAL_ROWS) break;
        const span = endRow - startRow;
        for (let r = startRow; r < endRow; r++) {
          const position: CellPos =
            span === 1 ? "single"
            : r === startRow    ? "start"
            : r === endRow - 1  ? "end"
            : "mid";
          map.set(`${col}-${r}`, { startsAt: slot.startsAt, position });
        }
        break;
      }
    }
  }
  return map;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SlotPickerProps {
  slots: SlotInput[];
  onChange: (slots: SlotInput[]) => void;
}

export function SlotPicker({ slots, onChange }: SlotPickerProps) {
  const [weekStart, setWeekStart]       = useState(() => getWeekStart(new Date()));
  const [durationBlocks, setDuration]   = useState(2); // default 1 hr
  const [hoverCell, setHoverCell]       = useState<{ col: number; row: number } | null>(null);

  const days    = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const cellMap = buildCellMap(slots, weekStart);

  const weekLabel = `${
    days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })
  } – ${
    days[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }`;

  // Rows that would be highlighted by the hover preview
  const previewKeys = new Set<string>();
  if (hoverCell) {
    const { col, row } = hoverCell;
    if (!cellMap.has(`${col}-${row}`)) {
      const clampedEnd = Math.min(row + durationBlocks, TOTAL_ROWS);
      for (let r = row; r < clampedEnd; r++) {
        previewKeys.add(`${col}-${r}`);
      }
    }
  }

  function handleCellClick(col: number, row: number) {
    const info = cellMap.get(`${col}-${row}`);
    if (info) {
      // Remove the slot that owns this cell
      onChange(slots.filter((s) => s.startsAt !== info.startsAt));
    } else {
      // Add a new slot — clamp so it doesn't spill past grid end
      const actualBlocks = Math.min(durationBlocks, TOTAL_ROWS - row);
      const { startsAt, endsAt } = cellToSlot(weekStart, col, row, actualBlocks);
      // Avoid duplicate start times
      if (!slots.some((s) => s.startsAt === startsAt)) {
        onChange([...slots, { startsAt, endsAt }]);
      }
    }
  }

  const sortedSlots = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="slot-picker">
      {/* Duration + week nav row */}
      <div className="slot-picker__toolbar">
        <div className="slot-picker__duration">
          <label className="slot-picker__duration-label" htmlFor="sp-duration">
            Event length
          </label>
          <select
            id="sp-duration"
            className="field__input slot-picker__duration-select"
            value={durationBlocks}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {DURATION_OPTIONS.map(([label, blocks]) => (
              <option key={blocks} value={blocks}>{label}</option>
            ))}
          </select>
        </div>

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
      </div>

      {/* Grid */}
      <div
        className="slot-picker__grid-wrap"
        onMouseLeave={() => setHoverCell(null)}
      >
        {/* Column headers */}
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
                const info    = cellMap.get(`${col}-${row}`);
                const preview = previewKeys.has(`${col}-${row}`);
                const hoverPos: CellPos | null = preview ? (
                  previewKeys.size === 1           ? "single"
                  : row === hoverCell!.row          ? "start"
                  : row === hoverCell!.row + durationBlocks - 1 ? "end"
                  // clamp case
                  : row === TOTAL_ROWS - 1         ? "end"
                  : "mid"
                ) : null;

                const pos = info?.position ?? hoverPos;
                const cls = [
                  "slot-picker__cell",
                  info    ? `slot-picker__cell--${info.position}` : "",
                  preview ? `slot-picker__cell--preview slot-picker__cell--preview-${hoverPos}` : "",
                ].filter(Boolean).join(" ");

                return (
                  <div
                    key={col}
                    className={cls}
                    onClick={() => handleCellClick(col, row)}
                    onMouseEnter={() => setHoverCell({ col, row })}
                    role="button"
                    tabIndex={0}
                    aria-label={`${
                      info ? "Remove" : "Add"
                    } slot at ${formatRowLabel(row)} on ${COL_LABELS[col]}`}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        handleCellClick(col, row);
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
            {sortedSlots.length} start time{sortedSlots.length !== 1 ? "s" : ""} selected
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
                  onClick={() => onChange(slots.filter((sl) => sl.startsAt !== s.startsAt))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="slot-picker__empty">
          Choose an event length, then click a start time on the grid.
        </p>
      )}
    </div>
  );
}

