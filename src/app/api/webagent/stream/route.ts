import { NextRequest } from "next/server";

import { getRunSession, pullEvent } from "@/server/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE：把某个 run 的事件流持续推给前端。
 * 前端 EventSource 连 /api/webagent/stream?runId=xxx。
 */
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return new Response("missing runId", { status: 400 });
  }
  const session = getRunSession(runId);
  if (!session) {
    return new Response("unknown runId", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        // 持续从 run-store 拉事件，直到 run 结束（pullEvent 返回 null）。
        for (;;) {
          const ev = await pullEvent(session);
          if (ev === null) break;
          send(ev);
          if (ev.kind === "done" || ev.kind === "error") {
            // 终态事件后再给一点时间确保 flush，然后收尾。
            break;
          }
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        send({ kind: "_eof" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
