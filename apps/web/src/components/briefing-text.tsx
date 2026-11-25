import { MarkdownText } from "./markdown";

/**
 * A note a pass wrote (the briefing, the weekly review), shown as Markdown with
 * its section headings in bold and room between the bullets. A heading sits
 * close to its list, and sections have more room between them than bullets do.
 *
 * Newer notes mark a heading as a **bold** line. Older ones end a short line
 * with a colon, as in "Still ahead today:", so such a line is made bold too
 * and loses the colon.
 */

/** A short line that ends with a colon and is not a bullet, a heading or already bold. */
const LABEL = /^(?![-*•#>\s]|\*\*)(.{1,48}?):\s*$/;

export function boldLabels(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const label = LABEL.exec(line.trimEnd());
      return label ? `**${label[1].trim()}**` : line;
    })
    .join("\n");
}

export function BriefingText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <MarkdownText
      text={boldLabels(text)}
      className={`text-base leading-7 [&_ul]:space-y-3 [&_p:has(+ul)]:mb-1.5 [&_ul]:mt-1.5 [&_ul:not(:last-child)]:mb-7 ${className}`}
    />
  );
}
