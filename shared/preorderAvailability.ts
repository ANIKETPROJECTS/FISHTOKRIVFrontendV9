export const PREORDER_AVAILABILITY_TYPES = ["all", "weekdays", "date_range", "date_range_and_weekdays"] as const;
export type PreorderAvailabilityType = (typeof PREORDER_AVAILABILITY_TYPES)[number];

export type PreorderAvailability = {
  type: PreorderAvailabilityType;
  weekdays?: number[];
  startDate?: string;
  endDate?: string;
  timeslotIdsByWeekday?: Record<string, string[]>;
};

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function normalizePreorderAvailability(value: unknown): PreorderAvailability {
  if (!value || typeof value !== "object") {
    return { type: "all", weekdays: ALL_WEEKDAYS };
  }

  const raw = value as Record<string, unknown>;
  const weekdays = Array.isArray(raw.weekdays)
    ? raw.weekdays
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .filter((day, index, days) => days.indexOf(day) === index)
      .sort((a, b) => a - b)
    : ALL_WEEKDAYS;
  const startDate = typeof raw.startDate === "string" ? raw.startDate : "";
  const endDate = typeof raw.endDate === "string" ? raw.endDate : "";
  const timeslotIdsByWeekday = raw.timeslotIdsByWeekday && typeof raw.timeslotIdsByWeekday === "object"
    ? Object.fromEntries(
      Object.entries(raw.timeslotIdsByWeekday as Record<string, unknown>).map(([day, ids]) => [
        day,
        Array.isArray(ids) ? ids.map(String) : [],
      ]),
    )
    : undefined;
  const rawType = PREORDER_AVAILABILITY_TYPES.includes(raw.type as PreorderAvailabilityType)
    ? raw.type as PreorderAvailabilityType
    : null;

  // The external admin editor has stored constrained schedules with
  // type:"all" while still persisting weekdays/startDate/endDate. Infer the
  // effective rule from those fields so the storefront does not reopen every
  // date. Explicit constrained fields always take precedence over that legacy
  // type value.
  const hasDateRange = Boolean(startDate || endDate);
  const hasWeekdayRestriction = weekdays.length < ALL_WEEKDAYS.length;
  const type: PreorderAvailabilityType = hasDateRange
    ? (hasWeekdayRestriction ? "date_range_and_weekdays" : "date_range")
    : hasWeekdayRestriction
      ? "weekdays"
      : rawType ?? "all";

  return {
    type,
    weekdays,
    startDate,
    endDate,
    timeslotIdsByWeekday,
  };
}

/** Date keys are deliberately treated as calendar dates, not UTC timestamps. */
export function isPreorderDateAvailable(
  dateKey: string,
  availability: unknown,
): boolean {
  const rule = normalizePreorderAvailability(availability);
  if (rule.type === "all") return true;

  if (rule.type === "weekdays") {
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    return (rule.weekdays ?? ALL_WEEKDAYS).includes(weekday);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  if (rule.startDate && dateKey < rule.startDate) return false;
  if (rule.endDate && dateKey > rule.endDate) return false;
  if (!rule.startDate && !rule.endDate) return false;

  // The admin editor can constrain a date range to selected weekdays.
  // Both conditions must match for date_range_and_weekdays.
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return rule.type === "date_range"
    || (rule.weekdays ?? ALL_WEEKDAYS).includes(weekday);
}

/**
 * A preorder cart has one shared delivery date. Therefore a date is eligible
 * only when every product in the cart allows that date.
 */
export function isPreorderDateAvailableForAll(
  dateKey: string,
  availabilities: unknown[],
): boolean {
  return availabilities.length > 0
    && availabilities.every((availability) => isPreorderDateAvailable(dateKey, availability));
}