# Waline on Worker 详细文档

For international audience: [English Documentation](README_EN.md)

## 推荐部署：Overture

打开 [Overture 部署入口](https://overture.voidcarve.com/?src=lsy-404/Waline_On_Worker)，选择本仓库的发布版本即可部署。它会创建或复用 D1 数据库、写入 schema、部署 Worker，并在首次部署时生成 `JWT_SECRET`。自定义域名可选：留空将使用 Worker 的 `workers.dev` 地址；填写时才会绑定域名。

可选择 **OAuth**（仅当所用 Overture 实例已启用并配置 OAuth 时可用，授权 Workers Scripts、D1 以及可选自定义域名所需的路由与区域权限）或 **Account API Token**（按预填权限模板创建并粘贴 Token）。Token 仅用于当前部署，不会作为应用凭据保存。普通更新会保留评论数据和 `JWT_SECRET`；完整重建会保留 D1 数据但生成新密钥，现有登录会话会失效。更新时留空 CORS 源地址会保留当前 `SECURE_DOMAINS`，可在 Cloudflare Dashboard 的 Worker 变量中清空或修改。为了保留填写自定义域名的能力，OAuth 和 API Token 权限模板仍会列出路由与区域权限，即使本次留空域名。部署前请阅读并接受包内的完整中英文条款，其中明确账户费用、凭证与数据责任。

## 手动部署

### 前提条件

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Cloudflare 账号](https://dash.cloudflare.com/)
- 已安装并登录 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 一键部署

```bash
# 克隆仓库
git clone https://github.com/lsy-404/Waline_On_Worker.git
cd Waline_On_Worker

# 运行部署脚本
# Linux / macOS
chmod +x deploy.sh
./deploy.sh

# Windows (PowerShell)
.\deploy.ps1
```

### 手动部署

```bash
# 1. 安装依赖
pnpm install

# 2. 创建 D1 数据库
pnpm exec wrangler d1 create waline-db

# 3. 编辑 wrangler.toml，填入上一步返回的 database_id

# 4. 初始化数据库 Schema
pnpm run db:init

# 5. 设置 JWT 密钥
pnpm exec wrangler secret put JWT_SECRET
# 输入一个随机字符串作为密钥

# 6. 部署
pnpm run deploy
```

### 本地开发

```bash
# 初始化本地数据库
pnpm run db:init:local

# 启动开发服务器
pnpm run dev
```

## API 端点

### 评论

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/comment?path=` | 获取评论列表（线程化） | - |
| `GET` | `/api/comment?type=recent` | 最近评论 | - |
| `GET` | `/api/comment?type=count&url=` | 评论计数 | - |
| `GET` | `/api/comment?type=list` | 管理员评论列表 | Admin |
| `GET` | `/api/comment/rss` | RSS 订阅源 | - |
| `POST` | `/api/comment` | 创建评论 | - |
| `PUT` | `/api/comment/:id` | 更新/点赞评论 | Admin/Like |
| `DELETE` | `/api/comment/:id` | 删除评论（级联） | Admin |

### 文章

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/article?url=` | 获取浏览量 | - |
| `POST` | `/api/article` | 增加浏览量/反应 | - |

### 用户

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/user` | 注册用户 | - |
| `GET` | `/api/user` | 用户列表 | -/Admin |
| `PUT` | `/api/user/:id` | 更新用户 | Self/Admin |
| `DELETE` | `/api/user/:id` | 删除/封禁用户 | Admin |

### 认证

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/token` | 登录 | - |
| `GET` | `/api/token` | 获取当前用户信息 | Bearer |
| `DELETE` | `/api/token` | 登出 | - |
| `POST` | `/api/token/2fa` | 两步验证 | Bearer |

### OAuth

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/oauth?type=<provider>` | 发起 OAuth 登录 | - |

支持的 OAuth 提供方（`type` 参数值）：`github`、`twitter`、`facebook`、`weibo`、`qq`

OAuth 流程通过外部 OAuth 代理服务（默认 `https://oauth.lithub.cc`）实现，可通过环境变量 `OAUTH_URL` 自定义。

### 数据管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/db` | 导出所有数据 (Waline JSON 格式) | Admin |
| `POST` | `/api/db?table=` | 导入单条数据 | Admin |
| `PUT` | `/api/db?table=&objectId=` | 更新已导入数据 | Admin |
| `DELETE` | `/api/db?table=` | 清空指定表 | Admin |

### 设置

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/settings` | 获取设置 | Admin |
| `PUT` | `/api/settings` | 更新设置 | Admin |

### 管理面板

| 路径 | 说明 |
|------|------|
| `/ui` | @waline/admin 管理面板 |
| `/ui/worker-setting` | Worker 自定义设置页 |

> 首位注册的用户自动成为管理员。

## 数据导入导出

本项目实现了与 `@waline/admin` 管理面板完全兼容的 `/api/db` 端点，支持标准 Waline JSON 格式的数据导入导出。

### 使用管理面板导入导出

1. 访问管理面板 `/ui` 并登录管理员账户
2. 进入 **导入导出** 页面
3. **导出**：点击导出按钮，下载 `waline.json` 文件
4. **导入**：选择之前导出的 `waline.json` 文件，点击导入

### 使用 Wrangler CLI 直接导入

对于大量数据，推荐使用 Wrangler 直接操作 D1 数据库：

```bash
# 导出为 SQL
pnpm exec wrangler d1 export <database-name> --remote --output=backup.sql

# 从 SQL 导入
pnpm exec wrangler d1 execute <database-name> --remote --file=backup.sql
```

> [!WARNING]
> **大量数据导入的已知限制**
>
> 通过管理面板导入大量数据时（数百条以上），可能会因 Cloudflare Workers 的请求超时或 D1 的并发限制导致 **500 错误**。建议：
>
> 1. **分片导入**：将导出的 JSON 数据手动拆分为每片约 **500 条记录**，分批导入
> 2. **使用 Wrangler CLI**：对于大规模数据迁移，直接使用 `wrangler d1 execute --file` 导入 SQL 文件更为可靠
> 3. **使用迁移脚本**：参考 `migrate.ts` / `migrate-d1.ts` 进行程序化迁移

## 配置

### 环境变量 (wrangler.toml `[vars]`)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SITE_NAME` | 站点名称 | `Waline` |
| `SITE_URL` | 站点 URL | - |
| `SECURE_DOMAINS` | 允许的域名（逗号分隔） | - |
| `DISABLE_USERAGENT` | 设置为非空且非 `false`/`0` 时隐藏评论中的浏览器和操作系统；支持环境变量别名 `DISABLE_AGENT` | 关闭 |
| `AVATAR_PROXY` | 配置代理服务 URL 后，客户端通过该服务加载头像；未配置或为 `false`/`0` 时直连 | 未配置 |
| `LEVELS` | 评论等级阈值，逗号分隔的非负整数严格递增序列；未设置、为空、`false`/`0` 或非法时关闭 | 关闭 |
| `DISABLE_REGION` | 设置为 `true` 或其他非空且非 `false`/`0` 的值时隐藏公开地区；管理员仍可见 | 关闭 |

显示配置说明：

- `DISABLE_USERAGENT` 未设置、为空、`false` 或 `0`（不区分大小写）时保留浏览器和操作系统显示；其他值隐藏它们。同时设置官方变量和 `DISABLE_AGENT` 时，以官方变量的显式值为准。管理员仍可查看原始 UA。
- `AVATAR_PROXY` 未设置、为空、`false` 或 `0` 时，Gravatar 和自定义头像均直接访问原地址；配置代理服务 URL 后，客户端会访问该服务，并在 `?url=` 参数中传递编码后的自定义头像 URL。Worker 只生成代理 URL，不转发图片。此设置适用于评论、用户资料和登录相关头像。
- `LEVELS` 未设置、为空、`false` 或 `0` 时关闭。示例：`0,10,20,50,100,200`。阈值按公开且已通过审核的评论数计算，并跨页面累计；登录用户按 `user_id` 归属，匿名评论按邮箱归属，没有邮箱时等级为 0。响应中的整数 `level` 字段由客户端的 `locale.levelN` 文案显示。
- 新评论提交时，Worker 只使用 Cloudflare 的 [`request.cf` 国家、地区和城市信息](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)；不采信请求正文或地理位置请求头，也不使用阅读者的位置。公开评论的 `addr` 显示国家代码和省区，管理员通过 `type=list` 可额外取得城市。Cloudflare 未提供数据（例如本地/预览请求）或旧评论没有地区记录时，不返回地区 `addr`；旧评论不会补查。`DISABLE_REGION` 未设置、为空、`false` 或 `0` 时保留公开地区显示；设为 `true` 或其他非空值时隐藏公开 `addr`，管理员仍可见地区。
- 地区数据保存在 `wl_CommentRegion` 表中，随评论删除通过外键级联删除。管理面板 Comment JSON 导出/导入会携带可选的 `cfRegion: { country, region, city }`，可用于地区数据备份。
- 已有部署升级时，先幂等重放 `schema.sql` 创建地区表，再部署 Worker，按以下顺序执行：
  ```bash
  pnpm exec wrangler d1 execute <database-name> --remote --file=./schema.sql
  pnpm run deploy
  ```

### 功能支持范围与平台边界

评论显示变量 `DISABLE_REGION`、`DISABLE_USERAGENT`（及别名 `DISABLE_AGENT`）、`AVATAR_PROXY` 和 `LEVELS` 均已接入。

以下上游变量和能力目前尚未实现或接入，设置它们不会启用对应功能（`LOGIN` 是变量名，不代表项目没有现有登录功能）：`LOGIN`、`SERVER_URL`、`GRAVATAR_STR`、`COMMENT_AUDIT`、`MARKDOWN_*`、`SMTP_*`、`SENDER_*`、`DISABLE_AUTHOR_NOTIFY`、`WEBHOOK`、服务端 `TURNSTILE_SECRET` / `RECAPTCHA_V3_SECRET` 验证，以及 `IPQPS` 环境变量限流。项目已有自定义 `AUDIT`，不能用上游 `COMMENT_AUDIT` 变量替代。Captcha 前端 key 目前只注入管理面板，尚未形成完整的机器人验证。这些集成都可以后续实现，并非 Workers 做不到。

此后端固定使用 D1；上游 Waline 的 `MONGO_*`、`MYSQL_*`、`PG_*` / `POSTGRES_*`、`LEAN_*`、`GITHUB_*`、`TCB_*` 等存储驱动变量不会切换本项目的数据存储。这是当前后端选择，不代表 Workers 无法连接其他数据库。

实际限制和保证范围：

- 地区只取新评论请求的 Cloudflare `request.cf` 信息，不能为没有记录的旧评论回溯补值；Cloudflare 未提供位置数据的请求无法显示可靠的国家、省区或城市，本实现也不提供精确坐标。[`request.cf` 文档](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)
- 匿名等级按邮箱关联，邮箱不是经过认证的身份，因此等级不保证对应真实或唯一的自然人。
- 头像代理只按 `?url=` 生成供客户端使用的第三方代理服务 URL；本项目不转发图片，也不能保证外部服务持续可用。
- Workers 的 `/tmp` 文件系统不跨请求持久化，不能把传统 `SQLITE_PATH` 或宿主文件路径直接当作持久数据库文件。[Node.js 文件系统文档](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- Workers 默认禁用 TCP 25 端口；这不代表所有 SMTP 或邮件发送都不可用，需按邮件服务支持的连接方式配置。[TCP sockets 文档](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

### Secrets (通过 `wrangler secret put` 设置)

| Secret | 说明 | 必需 |
|--------|------|------|
| `JWT_SECRET` | JWT 签名密钥 | ✅ |

### Worker 设置 (通过管理面板 `/ui/worker-setting` 配置)

| 设置 | 说明 | 默认值 |
|------|------|--------|
| `waline_client_version` | @waline/client CDN 版本号 | - |
| `comment_default_status` | 匿名评论默认状态 (approved/waiting/spam) | `approved` |
| `user_comment_default_status` | 登录用户评论默认状态 | `approved` |
| `worker_display` | 管理面板显示 Worker 扩展菜单 | - |
| `llm_mode` | LLM 审查模式 (off/anonymous/all) | `off` |
| `llm_skip_admin` | 管理员评论跳过 LLM 审查 | - |
| `llm_endpoint` | LLM API 端点 URL | - |
| `llm_api_key` | LLM API 密钥 | - |
| `llm_model` | LLM 模型名称 | - |
| `llm_prompt` | LLM 审查提示词 | - |

### OAuth 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OAUTH_URL` | OAuth 代理服务地址 | `https://oauth.lithub.cc` |

OAuth 登录通过外部代理服务处理 Client ID/Secret，无需在 Worker 中配置各平台密钥。支持 GitHub、Twitter、Facebook、Weibo、QQ 五个平台。

## 前端对接

在你的网站中使用 `@waline/client`：

```html
<script src="https://unpkg.com/@waline/client@v3/dist/waline.js"></script>
<link rel="stylesheet" href="https://unpkg.com/@waline/client@v3/dist/waline.css" />
<div id="waline"></div>
<script>
  Waline.init({
    el: '#waline',
    serverURL: 'https://your-worker-name.your-subdomain.workers.dev',
  });
</script>
```

## 项目结构

```
├── src/
│   ├── index.ts               # Workers 入口 (Hono + CORS + auth + version)
│   ├── env.ts                 # 类型定义
│   ├── router/
│   │   ├── comment.ts         # 评论 CRUD + LLM 审查
│   │   ├── article.ts         # 浏览量/反应计数器
│   │   ├── user.ts            # 用户管理
│   │   ├── token.ts           # JWT 登录 + 2FA
│   │   ├── oauth.ts           # OAuth 登录 (GitHub/Twitter/Facebook/Google/Weibo/QQ)
│   │   ├── settings.ts        # Worker 设置管理 (API Key 脱敏返回)
│   │   └── db.ts              # 数据导入导出
│   ├── middleware/
│   │   └── auth.ts            # JWT 鉴权中间件
│   ├── ui/
│   │   ├── admin-panel.ts     # @waline/admin 管理面板
│   │   ├── custom-admin.ts    # Worker 自定义设置页
│   │   └── waline-page.ts     # Waline 评论页
│   └── utils/
│       ├── password.ts        # PBKDF2 密码哈希
│       ├── avatar.ts          # Gravatar 头像
│       ├── ua.ts              # UA 解析
│       ├── markdown.ts        # Markdown 渲染
│       ├── llm-review.ts      # LLM 评论审查
│       └── totp.ts            # TOTP 两步验证
├── schema.sql                 # D1 数据库 Schema
├── migrate.ts                 # LeanCloud 数据迁移
├── migrate-d1.ts              # D1 间数据迁移
├── wrangler.toml              # Workers 配置
└── deploy.sh / deploy.ps1     # 部署脚本
```
