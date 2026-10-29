"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent 正式回答的 Markdown 渲染。
 *
 * - react-markdown 不用 dangerouslySetInnerHTML，默认安全（不渲染原始 HTML）。
 * - remark-gfm 支持表格 / 删除线 / 任务列表 / 自动链接。
 * - 关键：markdown 会把单个换行折叠成空格，只有空行才成段落 —— 这天然
 *   修掉了模型流式输出里「每个短语一行」造成的大量空行问题。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 链接新开标签页，避免把当前会话顶掉。
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
