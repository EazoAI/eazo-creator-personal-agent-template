# eazo-creator-personal-agent-template

Personal agent demo —— 直接用 [Qoni WebAgent](https://docs.qoni.ai/webagent/getting-started/what-is-webagent) SDK 快速体验云端浏览器 Agent 能力。

一句话让云端浏览器 Agent 替你办事：对话 + 实时浏览器画面 + 需要你出手时的 HITL 卡片（登录 / 接管 / 问询 / 确认 / 填表）。

> 这是**快速体验 demo**。它直接调 `@qoniai/qoni`，用自带的 Next.js 后端持**超级 Key**发令牌；认证已接入 `@eazo/sdk` 的 `requireAuth`（真实 Eazo 登录态）。暂未接入积分计费、GUMem 记忆、`@eazo/sdk` 的 `webAgent` 封装。生产形态见 `eazo-creator/docs/qoni-webagent-integration-design.md`。

## 架构

```
浏览器 (前端)
  │  @eazo/sdk EazoProvider 管理登录态；auth.login() 登录
  │  request() 注入 x-eazo-session 头
  │  POST /api/webagent/start { prompt }      —— 起任务，拿 runId
  │  GET  /api/webagent/stream?runId=…  (SSE) —— 收 对话/画面/卡片 事件
  │  POST /api/webagent/interaction           —— 回传 HITL 卡片操作
  ▼
Next.js 服务端 (唯一持超级 AK/SK 的地方)
  │  requireAuth(req) 解 x-eazo-session → 可信 user.id（Eazo GenAuth 池真实用户）
  │  webAgentGrant(userId) 换令牌(14d, 按用户缓存)
  │  new Qoni({ webAgentHost }).doAnything.run({ token, prompt })  —— 无 Key 客户端
  │  run.wait({ onEvent, onInteraction })  → 事件灌进 run-store → SSE 推前端
  ▼
Qoni WebAgent (webAgentHost)
```

**安全**：超级 Key 只在服务端 `.env.local`；令牌和实时画面 url 都不下发前端——所有跑任务调用在服务端完成，前端只收归一后的语义事件。`user_id` 只来自 `requireAuth` 解出的登录态，绝不信前端/env 传值。

## 跑起来

1. 装依赖：
   ```bash
   bun install   # 或 npm install
   ```
2. 配凭证（**切勿提交**）：
   ```bash
   cp .env.example .env.local
   # 填入 Qoni 团队交接文档里的 EAZO_QONI_ACCESS_KEY / EAZO_QONI_SECRET_KEY（超级 Key）
   # 填入 Eazo 平台发放的 EAZO_PRIVATE_KEY（requireAuth 解登录态用）
   # 填入 EAZO_APP_ID / NEXT_PUBLIC_EAZO_APP_ID（本地先随便填非空值；接入时用真实 app id）
   ```
3. 同步本地 @eazo/sdk（不走 npm，避免慢网络）：
   ```bash
   bun run sdk:sync
   ```
4. 启动：
   ```bash
   bun run dev   # http://localhost:3200
   ```
5. 先用 Eazo 账号登录（右上角），再在左侧发一句话；需要登录/验证码时按卡片提示操作。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `src/server/qoni.ts` | 唯一持超级 Key 的地方：建客户端、`requireAuth` 解登录用户、发/缓存令牌 |
| `src/lib/request.ts` | 前端 fetch 包装：注入 `x-eazo-session` 登录态头 |
| `src/server/run-store.ts` | 活跃 run 注册表：事件队列 + HITL handle 查询 |
| `src/server/event-map.ts` | Qoni RunEvent / InteractionHandle → 前端事件 / 卡片 投影 |
| `src/app/api/webagent/*` | start（起任务，requireAuth）/ stream（SSE）/ interaction（回传卡片操作，requireAuth） |
| `src/app/page.tsx` | 登录 gate + 对话 + 实时画面 + 卡片 主界面 |
| `src/app/hitl-card.tsx` | 5 类 HITL 卡片渲染 |
| `src/shared/muse-events.ts` | 前后端共享的事件契约 |

## 已覆盖 / 未覆盖

- ✅ 真实认证：`@eazo/sdk` 登录态 + 后端 `requireAuth`，`user_id` 只来自已验证会话。
- ✅ DoAnything 全链路：流式回答、实时画面、5 类 HITL 卡片。
- ⬜ WebSearch / DeepResearch / Track（令牌已申请对应 products，UI 未做）。
- ⬜ GUMem 记忆、Eazo 积分计费、`@eazo/sdk` 的 `webAgent` 封装、生产级 run-store（当前是进程内 Map）。
