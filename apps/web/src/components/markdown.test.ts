import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown";

const html = (text: string) => renderToStaticMarkup(createElement(MarkdownText, { text }));

describe("a chat reply in Markdown", () => {
  it("links a bare site name, a full address and a Markdown link, and opens each in a new tab", () => {
    const out = html("Celebration Cinema (celebrationcinema.com, read just now). See https://example.org/a?b=1 or [the times](https://www.celebrationcinema.com/showtimes).");
    expect(out).toContain('<a href="https://celebrationcinema.com" target="_blank" rel="noreferrer"');
    expect(out).toContain('href="https://example.org/a?b=1"');
    expect(out).toContain('href="https://www.celebrationcinema.com/showtimes"');
    expect(out).toContain(">the times</a>");
  });

  it("makes an email address a mail link, not a site, and leaves file names, times and code alone", () => {
    const out = html("Write to me@example.com about notes.pdf at 10:35a, using `site.com` in code.");
    expect(out).toContain('href="mailto:me@example.com"');
    expect(out).not.toContain("https://example.com");
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("shows lists and bold, and shows raw HTML as text", () => {
    const out = html("**Friday**\n\n- 10:35a\n- 1:30\n\n<script>alert(1)</script>");
    expect(out).toContain("<strong");
    expect(out).toContain("<li>10:35a</li>");
    expect(out).not.toContain("<script>");
  });
});
