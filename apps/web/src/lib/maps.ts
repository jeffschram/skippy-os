/**
 * Google Maps links for the places written on events and tasks. A place is
 * either one spot ("Westchester County HPN", a street address) or a trip
 * written with arrows ("Home → Westchester County Airport (HPN)"). "Home"
 * stands for the owner's home address from Settings; with none saved, a trip
 * from home starts wherever the owner is.
 */

const MAPS = "https://www.google.com/maps";
const ARROW = /\s*(?:→|⟶|➔|->|=>)\s*/;
const HOME = /^(?:home|my house|the house)$/i;
// Places that are not on a map: a call, a meeting link, nothing settled yet.
const NOT_A_PLACE = /^(?:online|virtual|remote|phone|phone call|video call|zoom|google meet|teams|facetime|tbd|tba|n\/a)\b|^https?:\/\/|\b(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com)\b/i;

export type PlaceLinks = {
  /** Opens the place, or the route for a trip. */
  open: string;
  /** Directions there from wherever the owner is. Only for one place: a trip's open link is already directions. */
  directions?: string;
};

const encode = (value: string) => encodeURIComponent(value);

/** The links for a place, or null when it is not somewhere on a map. */
export function placeLinks(location: string | undefined, home?: string): PlaceLinks | null {
  const text = location?.trim();
  if (!text || NOT_A_PLACE.test(text)) return null;
  const homeAddress = home?.trim() || undefined;
  const stops = text.split(ARROW).map((stop) => stop.trim()).filter(Boolean);

  if (stops.length >= 2) {
    // Home with no address saved: leave the start out, so Google Maps starts where the owner is.
    const resolve = (stop: string) => (HOME.test(stop) ? homeAddress : stop);
    const origin = resolve(stops[0]!);
    const destination = resolve(stops.at(-1)!);
    if (!destination) return { open: search(text) };
    const waypoints = stops.slice(1, -1).map(resolve).filter((stop): stop is string => Boolean(stop));
    const params = [
      ...(origin ? [`origin=${encode(origin)}`] : []),
      `destination=${encode(destination)}`,
      ...(waypoints.length > 0 ? [`waypoints=${encode(waypoints.join("|"))}`] : []),
    ];
    return { open: `${MAPS}/dir/?api=1&${params.join("&")}` };
  }

  const place = HOME.test(text) ? homeAddress : text;
  if (!place) return null;
  return { open: search(place), directions: `${MAPS}/dir/?api=1&destination=${encode(place)}` };
}

function search(place: string): string {
  return `${MAPS}/search/?api=1&query=${encode(place)}`;
}
