<!-- markdownlint-disable MD033 MD041 -->

# Waline on Worker

For international audience: [English Documentation](README_EN.md)

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-brightgreen.svg)](CHANGELOG)

一个运行在 **Cloudflare Workers** 上的 [Waline](https://waline.js.org/) 评论系统后端实现，使用 **D1 (SQLite)** 作为数据存储。实现了 Waline 的绝大多数功能。

---

## 文档

[详细文档](docs/README.md)

## 特性

- 快速
- 安全
- Markdown 语法支持
- 轻量易用
- 免费部署
- 完全兼容 `@waline/client` 前端和 `@waline/admin` 管理面板

|                    | Waline on Worker                                                       |
| ------------------ | ---------------------------------------------------------------------- |
| **运行时**         | [Cloudflare Workers](https://workers.cloudflare.com/)                  |
| **数据库**         | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)       |
| **框架**           | [Hono](https://hono.dev/)                                             |
| **语言**           | TypeScript                                                             |

## 功能状态

- [x] 评论 CRUD（线程化、计数、最近评论）
- [x] 文章浏览量统计
- [x] 评论反应（赞踩）
- [x] 置顶评论
- [x] 用户注册 / 登录
- [x] 评论管理（审核、删除）
- [x] 社交登录 + 账号绑定（社交账号可关联至已有密码账号）
- [x] 两步验证 (2FA / TOTP)
- [x] Markdown 渲染 + XSS 防护
- [x] Gravatar 头像
- [x] UA 解析（浏览器 / 操作系统）
- [x] RSS 订阅
- [x] 数据导入导出（兼容 @waline/admin 迁移面板）
- [x] **Akismet 反垃圾评论**（四档：关 / Akismet / LLM / Mix）
- [x] LLM 评论审查（内嵌 [waline-plugin-llm-reviewer-next](https://github.com/lsy-404/waline-plugin-llm-reviewer-next) 设计，支持自然语言安全策略）
- [x] 评论默认状态控制（匿名 / 登录用户独立设置）
- [x] 管理面板（@waline/admin CDN + Worker 设置页）
- [x] IP 频率限制 (IPQPS) 可直接配置 Cloudflare 安全规则实现
- [x] 附加管理面板，能够设置前端默认版本，控制评论默认状态，配置反垃圾策略等功能
- [ ] 邮件通知（SMTP）
- [ ] Webhook 通知

## 配置优先级

> **所有密钥均遵循同一规则：环境变量 / `wrangler secret` 的优先级始终高于管理面板。**
>
> 面板配置适合快速上手；需要锁定时在服务端设置 Secret 即可，服务端值无条件优先。

## 反垃圾配置

在 Worker 设置页中选择反垃圾模式：

| 模式 | 说明 |
| ---- | ---- |
| **关** | 不启用任何检测 |
| **Akismet** | 仅使用 Akismet 服务 |
| **LLM** | 仅使用 LLM 大模型审查 |
| **Mix** | Akismet 与 LLM 并行，任一判定为垃圾则标记 |

### Akismet 密钥放置方案

Akismet API Key 支持**两种放置方式**，环境变量优先级始终高于前端配置：

1. **环境变量（生产推荐）** — 作为 Worker Secret 存储，不会暴露给前端：
   ```bash
   wrangler secret put AKISMET_KEY
   ```

2. **管理面板** — 在 Worker 设置页（`/ui/worker-setting`）直接填写，加密存储于 D1。仅在未设置 `AKISMET_KEY` 环境变量时生效。

两种方案可按需选用，无需修改代码。

## 推荐部署：Overture

使用 [Overture 部署入口](https://overture.voidcarve.com/?src=lsy-404/Waline_On_Worker) 可以直接部署，无需本地安装 Node.js 或 Wrangler。选择本仓库的发布版本后，Overture 会创建或复用 D1 数据库、写入 schema、部署 Worker，并在首次部署时生成 `JWT_SECRET`。自定义域名是可选项：留空会使用 Worker 的 `workers.dev` 地址；填写时才会绑定该域名。

Overture 可提供以下 Cloudflare 认证方式：

- **OAuth**：在所用 Overture 实例已启用并配置 OAuth 时，可在 Cloudflare 授权 Workers Scripts、D1 以及可选自定义域名所需的路由与区域权限。
- **Account API Token**：使用 Overture 预填权限模板创建并粘贴 API Token；该 Token 只用于本次部署，不会作为应用凭据保存。

普通更新保留评论数据和已有 `JWT_SECRET`。完整重建也保留 D1 数据，但会生成新的 `JWT_SECRET`，使现有登录会话失效。更新时将 CORS 源地址留空会保留当前 `SECURE_DOMAINS`；如需清空它，请在 Cloudflare Dashboard 的 Worker 变量中修改。为了保留填写自定义域名的能力，OAuth 和 API Token 权限模板仍会列出路由与区域权限，即使本次留空域名。部署前请阅读并接受包内提供的中英文条款，其中说明了账户费用、凭证与数据责任。

## 手动部署

```bash
git clone https://github.com/lsy-404/Waline_On_Worker.git
cd Waline_On_Worker
pnpm install

# 创建 D1 数据库并编辑 wrangler.toml
pnpm exec wrangler d1 create waline-db
pnpm run db:init
pnpm exec wrangler secret put JWT_SECRET
pnpm run deploy
```

详细部署步骤和配置说明请参阅[文档](docs/README.md)。

<details>
<summary><strong>更新日志</strong></summary>

### v1.1.0

- **修复：OAuth 社交账号绑定** — 已登录用户通过社交方式登录时，现在会正确将社交账号关联至当前密码账号，而非创建新账号。若社交 ID 已绑定其他账号，将返回明确的 `oauth_already_bound` 错误。
- **Akismet 反垃圾评论** — 原生支持 Akismet，与 LLM 审查并列。管理员在设置页选择四档模式（关 / Akismet / LLM / Mix）。Akismet 密钥可通过 `wrangler secret`（服务端，优先）或管理面板（存储于 D1）两种方式配置。
- **统一反垃圾流水线** — 内部重构，所有反垃圾检测路径合并至单一 `runSpamReview()` 函数，消除冗余 DB 查询。
- **设置批量读取** — 评论提交路径中的设置查询统一为单次 `getSettings()` 批量调用，不再多次串行查询。

</details>

## 许可证

[GPL-3.0](LICENSE)
