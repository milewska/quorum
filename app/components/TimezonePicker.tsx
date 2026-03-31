/**
 * Timezone picker — curated list of common US + international IANA timezones.
 * Uses Intl.DateTimeFormat to show current UTC offset for each zone.
 * Default: Pacific/Honolulu (HST).
 */

// Curated list — covers US zones + major international ones.
// Ordered roughly west-to-east.
const TIMEZONES = [
  "Pacific/Honolulu",      // Hawaii
  "America/Anchorage",     // Alaska
  "America/Los_Angeles",   // Pacific
  "America/Denver",        // Mountain
  "America/Chicago",       // Central
  "America/New_York",      // Eastern
  "America/Puerto_Rico",   // Atlantic
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

function formatTzLabel(tz: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(now);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // Friendly name: "Pacific/Honolulu" → "Honolulu"
    const city = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
    return `${city} (${offset})`;
  } catch {
    return tz;
  }
}

interface TimezonePickerProps {
  name: string;
  value: string;
  onChange?: (tz: string) => void;
  className?: string;
}

export function TimezonePicker({
  name,
  value,
  onChange,
  className,
}: TimezonePickerProps) {
  return (
    <select
      name={name}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className={className ?? "field__input"}
    >
      {TIMEZONES.map((tz) => (
        <option key={tz} value={tz}>
          {formatTzLabel(tz)}
        </option>
      ))}
    </select>
  );
}

/**
 * Format a date string in a specific IANA timezone using Intl.DateTimeFormat.
 * No external libraries needed.
 */
export function formatInTimezone(
  dateStr: string | Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const defaults: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  };
  return new Intl.DateTimeFormat("en-US", { ...defaults, ...options }).format(date);
}

export function formatTimeOnly(
  dateStr: string | Date,
  timezone: string,
): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

export function tzAbbreviation(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Convert a timezone-naive datetime-local string (e.g. "2026-04-08T11:00")
 * to a UTC ISO string, interpreting the input as local time in the given IANA timezone.
 *
 * Use this on the server (CF Workers) when saving form values that were entered
 * in the event's timezone but arrive without offset info.
 */
export function localToUTC(localStr: string, timezone: string): string {
  // Treat the naive string as if it were UTC to get a reference timestamp
  const naive = new Date(localStr.endsWith("Z") ? localStr : localStr + "Z");
  // Find what this UTC instant looks like in the target timezone
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(naive);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const h = get("hour") === "24" ? 0 : parseInt(get("hour"));
  const tzMs = Date.UTC(
    parseInt(get("year")),
    parseInt(get("month")) - 1,
    parseInt(get("day")),
    h,
    parseInt(get("minute")),
    parseInt(get("second")),
  );
  // offset = how far the timezone representation is from the naive UTC value
  const offsetMs = tzMs - naive.getTime();
  // Subtract the offset to get the true UTC equivalent
  return new Date(naive.getTime() - offsetMs).toISOString();
}

/**
 * Convert a UTC ISO string to a datetime-local string in a given IANA timezone.
 * Returns "YYYY-MM-DDTHH:mm" suitable for <input type="datetime-local">.
 */
export function utcToLocalStr(utcStr: string | Date, timezone: string): string {
  const date = typeof utcStr === "string" ? new Date(utcStr) : utcStr;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}`;
}
