import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { boldLabels, BriefingText } from "./briefing-text";

const html = (text: string) => renderToStaticMarkup(createElement(BriefingText, { text }));

describe("a briefing", () => {
  it("makes an older note's 'Heading:' lines bold headings over their lists", () => {
    const out = html("Still ahead today:\n- Due tonight: settle a movie.\n- Bowling is not settled.\n\nTomorrow:\n- Flight at 5:16pm.");
    expect(out).toContain("<strong");
    expect(out).toMatch(/>Still ahead today<\/strong>/);
    expect(out).toMatch(/>Tomorrow<\/strong>/);
    expect(out).not.toContain("Still ahead today:");
    // The colon inside a bullet is left alone.
    expect(out).toContain("Due tonight: settle a movie.");
    expect(out.match(/<li>/g)).toHaveLength(3);
  });

  it("leaves a newer note's bold labels, bullets and sentences as they are", () => {
    const text = "**Since yesterday**\n- Three tasks done.\n\n**Worth knowing**\n- Check-in is open.";
    expect(boldLabels(text)).toBe(text);
    expect(boldLabels("A long sentence that happens to end with a colon and goes on for quite a while:")).toContain("A long");
    expect(boldLabels("A long sentence that happens to end with a colon and goes on for quite a while:")).not.toContain("**");
    expect(boldLabels("- A bullet:")).toBe("- A bullet:");
  });
});
