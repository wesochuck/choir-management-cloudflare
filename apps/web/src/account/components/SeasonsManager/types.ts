import type {
  DuesRecord,
  OrganizationProfile,
  Season,
  SeasonCreateRequest,
} from "@choir/contracts";
import {
  datePartInTimeZone,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
} from "@choir/domain";
import { AuthApiError } from "../../../auth/api";

export type SeasonState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly seasons: readonly Season[]; readonly status: "ready" };

export type DuesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly dues: readonly DuesRecord[]; readonly status: "ready" };

export type ProfilesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly profiles: readonly OrganizationProfile[]; readonly status: "ready" };

export interface SeasonForm {
  readonly duesAmount: string;
  readonly endsAt: string;
  readonly name: string;
  readonly startsAt: string;
}

export function emptySeasonForm(timezone: string): SeasonForm {
  const startsAt = datePartInTimeZone(new Date(), timezone);
  const endDate = new Date(`${startsAt}T12:00:00.000Z`);
  endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
  const endsAt = datePartInTimeZone(endDate, timezone);
  return {
    duesAmount: "0.00",
    endsAt,
    name: "",
    startsAt,
  };
}

export function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

export function dateOnly(value: string, timezone: string): string {
  return utcToZonedLocalDateTime(value, timezone)?.slice(0, 10) ?? value.slice(0, 10);
}

export function seasonPayload(form: SeasonForm, timezone: string): SeasonCreateRequest {
  const amount = Number(form.duesAmount);
  const startsAt = zonedLocalDateTimeToUtc(`${form.startsAt}T00:00`, timezone);
  const endsAt = zonedLocalDateTimeToUtc(`${form.endsAt}T23:59`, timezone);
  if (!startsAt || !endsAt) throw new Error("Choose valid dates for the Organization timezone.");
  return {
    duesAmountCents: Math.round(amount * 100),
    endsAt,
    name: form.name.trim(),
    startsAt,
  };
}

export function seasonFormFor(season: Season | null, timezone: string): SeasonForm {
  return season
    ? {
        duesAmount: (season.duesAmountCents / 100).toFixed(2),
        endsAt: dateOnly(season.endsAt, timezone),
        name: season.name,
        startsAt: dateOnly(season.startsAt, timezone),
      }
    : emptySeasonForm(timezone);
}

export function seasonDateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeZone: timezone }).format(
    new Date(value),
  );
}

export function apiError(error: unknown, fallback: string): string {
  return error instanceof AuthApiError ? error.message : fallback;
}

export function defaultDuesSeasonId(seasons: readonly Season[]): string | null {
  const active = seasons.find((season) => season.isActive);
  if (active) return active.id;
  return (
    seasons.reduce<Season | null>(
      (latest, season) =>
        !latest || season.startsAt.localeCompare(latest.startsAt) > 0 ? season : latest,
      null,
    )?.id ?? null
  );
}
