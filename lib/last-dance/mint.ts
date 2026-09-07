export const LAST_DANCE_OPENSEA_URL = "https://opensea.io/collection/bunnyhoodxyz/overview";
export const LAST_DANCE_GTD_MINT_OPENS_AT = "2026-09-09T15:30:00.000Z";

export function lastDanceMintShareLine(value: string | null | undefined) {
  const parsed = new Date(value || LAST_DANCE_GTD_MINT_OPENS_AT);
  const mintDate = Number.isFinite(parsed.getTime())
    ? parsed
    : new Date(LAST_DANCE_GTD_MINT_OPENS_AT);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(mintDate);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(mintDate);
  return `GTD mint · ${date} · ${time} UTC`;
}
