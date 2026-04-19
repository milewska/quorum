import { useState, useMemo } from "react";
import { formatInTimezone } from "~/components/TimezonePicker";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SlotInfo = {
  slotId: string;
  commitmentId: string;
  startsAt: string;
  tierLabel: string | null;
  tierAmount: number | null;
  createdAt: string;
  slotStatus: string;
};

export type Respondent = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  reputationScore: number | null;
  isGuest: boolean;
  userId: string | null;
  slots: SlotInfo[];
  firstCommitAt: string;
};

type SortField = "name" | "firstCommitAt" | "slotCount" | "tierAmount" | "reputation";
type SortDir = "asc" | "desc";

interface Props {
  respondents: Respondent[];
  eventId: string;
  timezone: string;
  slotOptions: { id: string; startsAt: string }[];
  /** C4: callback when user clicks "Email selected". Passes selected emails. */
  onEmailSelected?: (emails: string[]) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtShort(date: string, tz: string): string {
  return formatInTimezone(date, tz, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const STATUS_CHIP: Record<string, string> = {
  active: "active",
  quorum_reached: "quorum",
  confirmed: "confirmed",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function RespondentsTable({ respondents, eventId, timezone, slotOptions, onEmailSelected }: Props) {
  const [sortField, setSortField] = useState<SortField>("firstCommitAt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [filterSlot, setFilterSlot] = useState<string>("all");
  const [filterType, setFilterType] = useState<"all" | "signed-in" | "guest">("all");
  // C4: bulk-select
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // ── Filter + Search + Sort ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = respondents;

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q) ||
          r.phone?.toLowerCase().includes(q)
      );
    }

    // Slot filter
    if (filterSlot !== "all") {
      list = list.filter((r) => r.slots.some((s) => s.slotId === filterSlot));
    }

    // Type filter
    if (filterType === "signed-in") list = list.filter((r) => !r.isGuest);
    if (filterType === "guest") list = list.filter((r) => r.isGuest);

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortField) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "firstCommitAt":
          return dir * a.firstCommitAt.localeCompare(b.firstCommitAt);
        case "slotCount":
          return dir * (a.slots.length - b.slots.length);
        case "tierAmount": {
          const aMax = Math.max(0, ...a.slots.map((s) => s.tierAmount ?? 0));
          const bMax = Math.max(0, ...b.slots.map((s) => s.tierAmount ?? 0));
          return dir * (aMax - bMax);
        }
        case "reputation":
          return dir * ((a.reputationScore ?? 0) - (b.reputationScore ?? 0));
        default:
          return 0;
      }
    });

    return list;
  }, [respondents, search, filterSlot, filterType, sortField, sortDir]);

  const totalPledged = respondents.reduce(
    (sum, r) => sum + r.slots.reduce((s, sl) => s + (sl.tierAmount ?? 0), 0),
    0
  );

  // C4: bulk-select helpers
  const emailableFiltered = filtered.filter((r) => r.email);
  const allFilteredSelected = emailableFiltered.length > 0 && emailableFiltered.every((r) => selectedKeys.has(r.key));
  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(emailableFiltered.map((r) => r.key)));
    }
  }
  function toggleSelectOne(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const selectedEmails = filtered
    .filter((r) => selectedKeys.has(r.key) && r.email)
    .map((r) => r.email!);

  if (respondents.length === 0) {
    return (
      <div className="respondents-section">
        <h2 className="respondents-section__title">Respondents</h2>
        <p className="respondents-section__empty">No commitments yet.</p>
      </div>
    );
  }

  return (
    <div className="respondents-section">
      <div className="respondents-header">
        <h2 className="respondents-section__title">
          Respondents ({respondents.length})
        </h2>
        <div className="respondents-header__stats">
          <span className="respondents-stat">
            {respondents.filter((r) => !r.isGuest).length} signed-in
          </span>
          <span className="respondents-stat">
            {respondents.filter((r) => r.isGuest).length} guest{respondents.filter((r) => r.isGuest).length !== 1 ? "s" : ""}
          </span>
          {totalPledged > 0 && (
            <span className="respondents-stat">
              {formatCents(totalPledged)} pledged
            </span>
          )}
        </div>
        {onEmailSelected && selectedEmails.length > 0 && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => onEmailSelected(selectedEmails)}
          >
            Email {selectedEmails.length} selected
          </button>
        )}
        <a
          href={`/events/${eventId}/manage/export`}
          className="btn btn--ghost btn--sm"
          download
        >
          Export CSV
        </a>
      </div>

      {/* ── Controls ── */}
      <div className="respondents-controls">
        <div className="respondents-controls-row">
          <input
            type="search"
            className="respondents-search"
            placeholder="Search name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="respondents-filter"
            value={filterSlot}
            onChange={(e) => setFilterSlot(e.target.value)}
          >
            <option value="all">All slots</option>
            {slotOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {fmtShort(s.startsAt, timezone)}
              </option>
            ))}
          </select>
          <select
            className="respondents-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
          >
            <option value="all">All types</option>
            <option value="signed-in">Signed-in only</option>
            <option value="guest">Guests only</option>
          </select>
          {(search || filterSlot !== "all" || filterType !== "all") && (
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => { setSearch(""); setFilterSlot("all"); setFilterType("all"); }}
            >
              Clear
            </button>
          )}
        </div>
        {(search || filterSlot !== "all" || filterType !== "all") && (
          <p className="respondents-filter-count">
            Showing {filtered.length} of {respondents.length}
          </p>
        )}
      </div>

      {/* ── Table ── */}
      <div className="respondents-table-wrap">
        <table className="respondents-table">
          <thead>
            <tr>
              {onEmailSelected && (
                <th className="respondents-th respondents-th--check">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    title="Select all"
                  />
                </th>
              )}
              <th className="respondents-th respondents-th--sortable" onClick={() => toggleSort("name")}>
                Name{sortIndicator("name")}
              </th>
              <th className="respondents-th">Contact</th>
              <th className="respondents-th respondents-th--sortable" onClick={() => toggleSort("slotCount")}>
                Slots{sortIndicator("slotCount")}
              </th>
              <th className="respondents-th respondents-th--sortable" onClick={() => toggleSort("tierAmount")}>
                Tier{sortIndicator("tierAmount")}
              </th>
              <th className="respondents-th respondents-th--sortable" onClick={() => toggleSort("firstCommitAt")}>
                Committed{sortIndicator("firstCommitAt")}
              </th>
              <th className="respondents-th respondents-th--sortable" onClick={() => toggleSort("reputation")}>
                Rep{sortIndicator("reputation")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const maxTier = Math.max(0, ...r.slots.map((s) => s.tierAmount ?? 0));
              const tierLabel = r.slots.find((s) => s.tierLabel)?.tierLabel ?? null;
              return (
                <tr key={r.key} className={`respondents-row${selectedKeys.has(r.key) ? " respondents-row--selected" : ""}`}>
                  {/* Checkbox */}
                  {onEmailSelected && (
                    <td className="respondents-td respondents-td--check">
                      {r.email ? (
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(r.key)}
                          onChange={() => toggleSelectOne(r.key)}
                        />
                      ) : (
                        <span title="No email">—</span>
                      )}
                    </td>
                  )}
                  {/* Name + avatar */}
                  <td className="respondents-td respondents-td--name">
                    <div className="respondents-name-cell">
                      {r.avatarUrl ? (
                        <img
                          src={r.avatarUrl}
                          alt=""
                          className="respondents-avatar"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="respondents-avatar respondents-avatar--initials">
                          {r.name[0]?.toUpperCase() ?? "?"}
                        </span>
                      )}
                      <span className="respondents-name">
                        {r.userId ? (
                          <a href={`/users/${r.userId}`} className="respondents-name-link">
                            {r.name}
                          </a>
                        ) : (
                          r.name
                        )}
                        {r.isGuest && (
                          <span className="respondents-badge respondents-badge--guest">guest</span>
                        )}
                      </span>
                    </div>
                  </td>

                  {/* Contact */}
                  <td className="respondents-td respondents-td--contact">
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                      {r.email && (
                        <a href={`mailto:${r.email}`} className="respondents-contact-link" title={r.email}>
                          {r.email.length > 28 ? r.email.slice(0, 26) + "…" : r.email}
                        </a>
                      )}
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="respondents-contact-link respondents-contact-link--phone">
                          {r.phone}
                        </a>
                      )}
                    </div>
                  </td>

                  {/* Slots */}
                  <td className="respondents-td respondents-td--slots">
                    <div className="respondents-slot-chips">
                      {r.slots.map((s) => (
                        <span
                          key={s.commitmentId}
                          className={`respondents-slot-chip respondents-slot-chip--${STATUS_CHIP[s.slotStatus] ?? "active"}`}
                          title={`${fmtShort(s.startsAt, timezone)} — ${s.slotStatus}`}
                        >
                          {fmtShort(s.startsAt, timezone)}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Tier */}
                  <td className="respondents-td respondents-td--tier">
                    {tierLabel ? (
                      <span className="respondents-tier-chip">
                        {tierLabel}
                        {maxTier > 0 && ` — ${formatCents(maxTier)}`}
                      </span>
                    ) : (
                      <span className="respondents-tier-free">Free</span>
                    )}
                  </td>

                  {/* Committed date */}
                  <td className="respondents-td respondents-td--date">
                    {fmtDate(r.firstCommitAt)}
                  </td>

                  {/* Reputation */}
                  <td className="respondents-td respondents-td--rep">
                    {r.reputationScore !== null ? (
                      <span className="respondents-rep">{Math.round(Number(r.reputationScore))}%</span>
                    ) : (
                      <span className="respondents-rep respondents-rep--na">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="respondents-section__empty">No respondents match your filters.</p>
      )}
    </div>
  );
}
