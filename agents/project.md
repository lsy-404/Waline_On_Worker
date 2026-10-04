# Waline_On_Worker 项目索引
> 最后更新：2026-10-03

## 项目目标
将兼容 Waline API 的评论服务运行在 Cloudflare Workers 与 D1 上，并提供可审查的 Overture 安装包。

## 技术栈
- Cloudflare Workers、D1、Hono、TypeScript
- Overture release assets：`overture.json` 与 `overture.tar.gz`

## 模块结构
- `src/`：Worker 路由与运行时实现
- `schema.sql`：幂等 D1 schema
- `scripts/`：Overture package 构建器
- `test/`：独立的 package、部署流程与新增 API 集成测试
- `tests/`：现有 Workers/D1 单元和 API 集成测试
