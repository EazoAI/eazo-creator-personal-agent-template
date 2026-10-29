// UI 由 layout 里常驻的 ChatRoot（ChatApp）渲染，会话 id 从 URL 派生。
// 这个 page 只是让 "/c/<id>" 路由存在；不渲染任何内容。
export const dynamic = "force-dynamic";

export default function ChatSessionPage() {
  return <></>;
}
