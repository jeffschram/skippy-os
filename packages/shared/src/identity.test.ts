import { describe, expect, it } from "vitest";
import { IdentityError, normalizeEmail, normalizePhone, normalizeUrl } from "./identity";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Sam.Lee@Example.COM ")).toBe("sam.lee@example.com");
  });
  it("refuses text that is not an address", () => {
    expect(() => normalizeEmail("sam at example")).toThrow(IdentityError);
  });
});

describe("normalizePhone", () => {
  it("reads the same number written three ways as one", () => {
    expect(normalizePhone("(212) 555-0142")).toBe("+12125550142");
    expect(normalizePhone("1-212-555-0142")).toBe("+12125550142");
    expect(normalizePhone("+1 212 555 0142")).toBe("+12125550142");
  });
  it("keeps a country code that was given", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("refuses text with too few digits", () => {
    expect(() => normalizePhone("call me")).toThrow(IdentityError);
  });
});

describe("normalizeUrl", () => {
  it("drops the fragment, tracking parameters and a trailing slash", () => {
    expect(normalizeUrl("https://Example.com/Guide/?utm_source=news&page=2#top")).toBe(
      "https://example.com/Guide?page=2",
    );
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });
  it("assumes https when no scheme is given", () => {
    expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
  });
  it("refuses anything that is not a web address", () => {
    expect(() => normalizeUrl("mailto:sam@example.com")).toThrow(IdentityError);
    expect(() => normalizeUrl("not a link")).toThrow(IdentityError);
  });
});
