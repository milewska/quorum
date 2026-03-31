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
