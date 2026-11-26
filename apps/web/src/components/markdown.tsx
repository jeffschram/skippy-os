"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A chat reply written in Markdown: paragraphs, lists, bold and italics,
 * links, inline code, and the odd heading or table. Raw HTML in the text is
 * shown as text, never run. Web addresses written out in full become links
 * too, and so does a bare site name such as riversidecinema.com. Every link
 * opens in a new tab.
 */

/** A site name with a common ending, not part of an email address or a longer word. */
const SITE = /(?<![@\w.-])((?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|app|co|us|uk|ca|info|biz|me|tv|ai))(\/[^\s)\]]*[^\s)\].,;:!?])?(?![\w@-])/gi;

type Node = { type: string; value?: string; url?: string; children?: Node[] };

/** Turns bare site names in the text into links, leaving links, code and anything already linked alone. */
function remarkSiteNames() {
  const walk = (node: Node) => {
    if (!node.children || node.type === "link" || node.type === "linkReference" || node.type === "inlineCode" || node.type === "code") return;
    node.children = node.children.flatMap((child): Node[] => {
      if (child.type !== "text" || !child.value) {
        walk(child);
        return [child];
      }
      const pieces: Node[] = [];
      let last = 0;
      for (const match of child.value.matchAll(SITE)) {
        const at = match.index ?? 0;
        if (at > last) pieces.push({ type: "text", value: child.value.slice(last, at) });
        pieces.push({ type: "link", url: `https://${match[0]}`, children: [{ type: "text", value: match[0] }] });
        last = at + match[0].length;
      }
      if (pieces.length === 0) return [child];
      if (last < child.value.length) pieces.push({ type: "text", value: child.value.slice(last) });
      return pieces;
    });
  };
  return (tree: Node) => walk(tree);
}

const components: Components = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  h1: ({ children }) => <p className="mt-4 mb-2 font-semibold text-foreground first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-4 mb-2 font-semibold text-foreground first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-4 mb-2 font-semibold text-foreground first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mt-3 mb-1 font-medium text-foreground first:mt-0">{children}</p>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-foreground/20 pl-3 text-foreground/70">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md bg-foreground/5 p-3 text-sm [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  hr: () => <hr className="my-4 border-foreground/15" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-foreground/20 px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-foreground/10 px-2 py-1 align-top">{children}</td>,
};

/** Headings as headings, for a longer piece written to be read as a page, such as a project's description. */
const pageComponents: Components = {
  ...components,
  h1: ({ children }) => <h2 className="mt-6 mb-2 text-xl font-semibold text-foreground first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-6 mb-2 text-lg font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-2 font-semibold text-foreground first:mt-0">{children}</h4>,
  li: ({ children, className }) => <li className={className?.includes("task-list-item") ? "-ml-5 list-none" : undefined}>{children}</li>,
  input: ({ checked }) => <input type="checkbox" checked={checked} readOnly disabled className="mr-2 align-[-0.1em]" />,
};

export function MarkdownText({ text, className, page = false }: { text: string; className?: string; page?: boolean }) {
  return (
    <div className={`break-words ${className ?? ""}`}>
      <Markdown remarkPlugins={[remarkGfm, remarkSiteNames]} components={page ? pageComponents : components}>
        {text}
      </Markdown>
    </div>
  );
}
