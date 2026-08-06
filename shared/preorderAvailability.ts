export const PREORDER_AVAILABILITY_TYPES = ["all", "weekdays", "date_range"] as const;
export type PreorderAvailabilityType = (typeof PREORDER_AVAILABILITY_TYPES)[number];

export type PreorderAvailability = {
  type: PreorderAvailabilityType;
  weekdays?: number[];
  startDate?: string;
  endDate?: string;
};

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function normalizePreorderAvailability(value: unknown): PreorderAvailability {
  if (!value || typeof value !== "object") {
    return { type: "all", weekdays: ALL_WEEKDAYS };
  }

  const raw = value as Record<string, unknown>;
  const type = PREORDER_AVAILABILITY_TYPES.includes(raw.type as PreorderAvailabilityType)
    ? raw.type as PreorderAvailabilityType
    : "all";
  const weekdays = Array.isArray(raw.weekdays)
    ? raw.weekdays
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .filter((day, index, days) => days.indexOf(day) === index)
      .sort((a, b) => a - b)
    : ALL_WEEKDAYS;

  return {
    type,
    weekdays,
    startDate: typeof raw.startDate === "string" ? raw.startDate : "",
    endDate: typeof raw.endDate === "string" ? raw.endDate : "",
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
  return Boolean(rule.startDate || rule.endDate);
}