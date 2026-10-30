"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer for the agent's final replies.
 *
 * - react-markdown does not use dangerouslySetInnerHTML (safe by default; raw HTML is not rendered).
 * - remark-gfm adds tables / strikethrough / task lists / autolinks.
 * - Bonus: markdown collapses single newlines into spaces and only blank lines
 *   become paragraphs — which naturally cleans up the model's streaming habit
 *   of emitting one phrase per line.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open links in a new tab so the current session is not replaced.
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
