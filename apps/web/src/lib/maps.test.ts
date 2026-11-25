import { describe, expect, it } from "vitest";
import { placeLinks } from "./maps";

const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("placeLinks", () => {
  it("opens one place and offers directions there", () => {
    const links = placeLinks("Riverside Cinema, 100 River Rd, Springfield")!;
    expect(links.open.startsWith("https://www.google.com/maps/search/")).toBe(true);
    expect(query(links.open)).toEqual({ api: "1", query: "Riverside Cinema, 100 River Rd, Springfield" });
    expect(query(links.directions!)).toEqual({ api: "1", destination: "Riverside Cinema, 100 River Rd, Springfield" });
  });

  it("turns a trip into directions, starting from the home address", () => {
    const links = placeLinks("Home → City Airport", "1 Main St, Somewhere NY")!;
    expect(links.open.startsWith("https://www.google.com/maps/dir/")).toBe(true);
    expect(query(links.open)).toEqual({ api: "1", origin: "1 Main St, Somewhere NY", destination: "City Airport" });
    expect(links.directions).toBeUndefined();
  });

  it("starts a trip from home where the owner is when no home address is saved", () => {
    expect(query(placeLinks("Home -> City Airport")!.open)).toEqual({ api: "1", destination: "City Airport" });
  });

  it("keeps the stops of a longer trip", () => {
    expect(query(placeLinks("Hotel → Theater → Dad's house")!.open)).toEqual({
      api: "1",
      origin: "Hotel",
      destination: "Dad's house",
      waypoints: "Theater",
    });
  });

  it("reads Home alone as the home address", () => {
    expect(query(placeLinks("Home", "1 Main St")!.open)).toEqual({ api: "1", query: "1 Main St" });
    expect(placeLinks("Home")).toBeNull();
  });

  it("leaves out what is not on a map", () => {
    for (const location of ["", "  ", "Zoom", "https://meet.google.com/abc-defg-hij", "Phone call", "TBD", undefined]) {
      expect(placeLinks(location)).toBeNull();
    }
  });
});
