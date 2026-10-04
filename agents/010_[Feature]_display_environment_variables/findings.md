# 调研与决策

- issue #9 请求 DISABLE_REGION、DISABLE_AGENT、AVATAR_PROXY、LEVELS。官方 UA 变量是 DISABLE_USERAGENT；按请求同时接受 DISABLE_AGENT，显式的官方值优先。
- 官方显示变量说明：https://waline.js.org/en/reference/server/env.html；上游头像代理使用 ?url= 编码参数，等级按公开评论数与逗号阈值生成整数 level。
- 当前 DISABLE_USERAGENT、DISABLE_REGION 仅有类型声明。评论响应总是解析 UA，头像没有代理，等级没有实现。
- 当前没有地区解析与存储；已向用户询问是否纳入新增地区功能，独立推进其他变量。
- 普通评论、回复、最近评论、写入响应与管理员列表共用 formatComment；写入响应目前未加载用户资料。需统一配置和批量统计，避免逐条查询。
- AVATAR_PROXY 默认保留项目的直连头像行为，false/0 禁用；自定义头像、Gravatar 和所有用户响应使用同一代理函数。
- LEVELS 缺省、false/0 或无效阈值时关闭。启用时按 user_id（登录用户）或 mail（匿名用户）统计 approved 评论，跨页面计数，边界取最高满足的阈值索引。匿名无邮箱不合并为同一人。
- 原始检出 git status 遇到失效的 waline 子模块路径；使用 --ignore-submodules=all 确认外层干净，保留原目录，独立工作区不依赖子模块。
- 使用最新 origin/main f162285；现有 pnpm 工作区的提交已经通过远端 PR 合入，未混入其变更。

- 地区范围：可选问题未收到答复后沿用说明过的默认范围，不新增地区解析/数据表。公开响应从不输出 addr/ip；文档明确 DISABLE_REGION 当前不改变行为，不能宣传为已实现的地区开关。
- 头像代理服务可以带既有查询参数；URLSearchParams 保留参数并正确编码头像。不重复代理已由相同服务代理的头像；非法或非 HTTP(S) 代理地址不影响已有直连头像。
- 干净工作区测试报 Could not read file wrangler.toml -> 使用仓库内 test/wrangler.toml 指定本地 D1 测试绑定 -> 无需本机配置即可运行。
- tsc 报缺失 cloudflare:test 与 schema.sql?raw 类型 -> 载入现有 @cloudflare/vitest-pool-workers/types 并补 /test 的 raw 模块声明 -> 类型检查通过。
- root 格式化结果可能 null 导致 TS18047 -> 建图前过滤 null -> 通过。
- Biome 初次报两个测试 forEach 回调返回值错误 -> 改成 void 回调 -> 无错误；保留原 RSS 路径的既有 non-null 警告，不扩展无关修改。
- 最新官方 Workers types 5.20261004.1 已下载到临时目录核对 D1 prepare/bind/all/first API；项目保留锁定依赖，不为新增字符串变量扩展类型生成重构。
- 文档子 agent 在专用 worktree 本地提交；主 agent 修正文案中把 AVATAR_PROXY=true 和 Worker 转发图片的错误说法，最终审阅提交 940d5bb 后 cherry-pick 为 3dd7134。
- main 未启用旧式 branch protection，但 active ruleset Main Protect 生效，要求 PR、1 个批准与 code-owner 审核；不得直接推送 main 或绕过规则。

## 地区范围跟进（2026-10-04）

- 用户提出使用 CF 识别实现地区；在原 PR 中补齐地区显示，原来的不实现地区范围已被该补充要求替代。
- 官方 Request 文档证实 request.cf 的 country、region、city 来源于访问者 IP，可为空，Dashboard/Playground 预览不提供 cf：https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties 。
- 在提交评论时获取 cf 并持久化，不能在 GET 时用读取者的 cf 给所有评论定位。不读取客户端请求体或可伪造地理请求头。
- 新增独立 wl_CommentRegion 表，以 comment_id 主键和 ON DELETE CASCADE 引用评论。幂等 schema 重放能为现有数据库创建表，不修改既有评论列，不加旧接口兼容层/自动运行时 migration。
- 新评论与地区在同一 D1 batch 事务写入；公开 addr 输出国家代码和省区，管理员列表可加城市，与上游一致，管理员可在 DISABLE_REGION=true 时仍查看。缺失地区不输出 addr。
- 原有评论无法从未来的 request.cf 恢复作者位置，保持无地区；不会把阅读者位置或空值伪造成作者位置。
- Waline 管理面板备份中的 Comment.cfRegion 承载可选结构化元数据，导入和更新时恢复；删除评论和清空表通过外键联动删除地区。

- 独立地区表选择理由：直接新增 wl_Comment 列需要为已经存在的表额外 ALTER/migration 分支；独立表可由现有部署流程的 CREATE IF NOT EXISTS 无损创建，且不破坏 Waline SQLite 主表格式。
- 补齐 raw cf 信息的可信边界：仅评论 POST 的 c.req.raw.cf 写入；公开请求体 cfRegion/addr 与 CF-IPCountry/CF-Region/CF-IPCity 头均不作为位置来源。管理员 DB import 则允许导入备份 cfRegion。
- 验证管理面板迁移代码：packages/admin/src/pages/migration/index.jsx 复制 Comment 对象并调整关系字段，保留 cfRegion 字段，因此扩展元数据能穿过现有导入路径。
- D1 事务插入使用同批次 last_insert_rowid() 绑定元数据，响应按第一条结果的 meta.last_row_id 取评论，避免跨请求从连接读取最后插入ID。故障触发器验证元数据失败时父评论同事务回滚。
- 测试18个地区用例全部通过：来源持久化、阅读者位置不覆盖、根/回复/最近/写入/更新、公开隐私与管理员城市、关闭/启用值、未知CF字段/旧评论、schema重放、备份、删除、错误回滚。
- 打包运行时也注入不同作者/阅读者 cf，确认发布包内实现保存作者位置；本次仍未在生产边缘部署或声称已部署。
