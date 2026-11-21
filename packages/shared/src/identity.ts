/**
 * One spelling for each email address, phone number and web address, so the
 * same one written two ways is recognised as the same.
 */

export class IdentityError extends Error {
  constructor(
    readonly kind: "email" | "phone" | "url",
    readonly input: string,
  ) {
    super(`"${input}" is not a usable ${kind === "url" ? "web address" : kind === "phone" ? "phone number" : "email address"}.`);
    this.name = "IdentityError";
  }
}

/** Trimmed and lowercased. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IdentityError("email", input);
  return email;
}

/**
 * Digits with a leading "+". A ten-digit number with no country code is taken
 * to be North American, since that is where the owner is.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new IdentityError("phone", input);
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid)$/i;

/**
 * A web address without the parts that do not change what it points to: the
 * fragment, tracking parameters and a trailing slash.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new IdentityError("url", input);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) {
    throw new IdentityError("url", input);
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.searchParams.toString();
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`;
}
