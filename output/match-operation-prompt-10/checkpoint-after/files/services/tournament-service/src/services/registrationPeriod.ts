import type { RegistrationPeriod } from "../models/tournament";

const BUSINESS_TIME_ZONE_OFFSET = "+07:00";

function startInstant(value: string): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(dateOnly ? `${value}T00:00:00${BUSINESS_TIME_ZONE_OFFSET}` : value).getTime();
}

function endInstantInclusive(value: string): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(dateOnly ? `${value}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}` : value).getTime();
}

/** Convert date-only form values to the Vietnam local calendar boundaries before storing them. */
export function toRegistrationTimestamp(value: string, boundary: "start" | "end"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
  return `${value}T${time}${BUSINESS_TIME_ZONE_OFFSET}`;
}

/** Date-only registration periods use the Vietnam local calendar and include the full final day. */
export function isWithinAnyRegistrationPeriod(
  periods: RegistrationPeriod[] | undefined,
  now: number,
): boolean {
  return periods?.some((period) => {
    const start = startInstant(period.startDate);
    const end = endInstantInclusive(period.endDate);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  }) ?? false;
}

/** Review requests are new registration actions and must be inside the same active window. */
export function isRegistrationReviewEligible(
  status: string,
  periods: RegistrationPeriod[] | undefined,
  now: number,
): boolean {
  return status === "OPEN_REGISTRATION" && isWithinAnyRegistrationPeriod(periods, now);
}
