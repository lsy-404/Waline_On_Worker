<!-- markdownlint-disable MD033 MD041 -->

# Waline on Worker

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-brightgreen.svg)](CHANGELOG)

A [Waline](https://waline.js.org/) comment system backend implementation running on **Cloudflare Workers**, utilizing **D1 (SQLite)** for data storage. It implements the vast majority of Waline's core features.

---

## Documentation

[Detailed Documentation](docs/README.md)

## Features

- Fast
- Secure
- Markdown syntax support
- Lightweight and easy to use
- Free deployment
- Fully compatible with the `@waline/client` frontend and `@waline/admin` dashboard


|                    | Waline on Worker                                                       |
| ------------------ | ---------------------------------------------------------------------- |
| **Runtime**        | [Cloudflare Workers](https://workers.cloudflare.com/)                  |
| **Database**       | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)       |
| **Framework**      | [Hono](https://hono.dev/)                                             |
| **Language**       | TypeScript                                                             |

## Feature Status

- [x] Comment CRUD (Threading, counters, recent comments)
- [x] Page view (PV) statistics
- [x] Comment reactions (Upvote / Downvote)
- [x] Sticky comments (Pin to top)
- [x] User registration / Login
- [x] Comment management (Reviewing, deleting)
- [x] Social login + account binding (link social accounts to existing password accounts)
- [x] Two-Factor Authentication (2FA / TOTP)
- [x] Markdown rendering + XSS protection
- [x] Gravatar avatars
- [x] UA parsing (Browser / Operating System)
- [x] RSS subscription
- [x] Data import/export (Compatible with the @waline/admin migration panel)
- [x] **Akismet anti-spam** (four modes: Off / Akismet / LLM / Mix)
- [x] LLM comment moderation (Embedded [waline-plugin-llm-reviewer-next](https://github.com/lsy-404/waline-plugin-llm-reviewer-next) design, supporting natural language safety policies)
- [x] Comment default status control (Independent settings for anonymous and logged-in users)
- [x] Admin dashboard (@waline/admin CDN + Worker settings page)
- [x] IP rate limiting (IPQPS) can be directly configured via Cloudflare security rules
- [x] Additional management panel to set default frontend versions, control default comment statuses, configure spam moderation strategies, and more
- [ ] Email notifications (SMTP)
- [ ] Webhook notifications

## Configuration Priority

> **All secrets follow the same rule: environment variable / `wrangler secret` always takes precedence over the admin UI panel.**
>
> Set a value in the panel for convenience; override it server-side with a secret when you need it locked down. The server-side value wins unconditionally.

## Anti-Spam Configuration

Waline on Worker supports four spam-detection modes, selectable from the Worker Settings page:

| Mode | Description |
| ---- | ----------- |
| **Off** | No spam detection |
| **Akismet** | Uses the Akismet service only |
| **LLM** | Uses an OpenAI-compatible LLM API only |
| **Mix** | Both Akismet and LLM run in parallel; a comment is marked spam if either flags it |

### Akismet Key Placement

The Akismet API key supports **two placement methods** — the environment variable always takes precedence:

1. **Environment variable (recommended for production)** — stored as a Worker secret, never exposed to the frontend:
   ```bash
   wrangler secret put AKISMET_KEY
   ```

2. **Admin UI** — set the key directly on the Worker Settings page (`/ui/worker-setting`). Convenient for quick setup; stored encrypted in D1. The UI value is used only when `AKISMET_KEY` is not set as a secret.

This dual-placement design means you can manage the key however fits your workflow without changing code.

## Recommended deployment: Overture

Deploy directly through the [Overture deployment page](https://overture.voidcarve.com/?src=lsy-404/Waline_On_Worker) without installing Node.js or Wrangler locally. Select a release from this repository and Overture creates or reuses the D1 database, applies the schema, deploys the Worker, and generates `JWT_SECRET` on the first deployment. A custom domain is optional: leave it empty to use the Worker’s `workers.dev` address, or provide one to attach it.

Overture can offer the following Cloudflare authentication methods:

- **OAuth**: when the Overture instance has enabled and configured OAuth, authorize Workers Scripts, D1, and the route and zone permissions needed for an optional custom domain with Cloudflare.
- **Account API Token**: create and paste a token using Overture's prefilled permission template. The token is used only for this deployment and is never stored as an application credential.

Regular updates preserve comment data and the existing `JWT_SECRET`. A full rebuild also preserves D1 data but generates a new `JWT_SECRET`, invalidating current login sessions. Leaving the CORS origins field empty during an update preserves the current `SECURE_DOMAINS`; clear or change it in the Cloudflare Dashboard Worker variables. To retain the ability to provide a custom domain, the OAuth and API Token permission template still lists route and zone access even when you leave the domain empty. Read and accept the package’s complete English and Chinese terms before deployment; they explain account charges, credential handling, and data responsibilities.

## Manual deployment

```bash
git clone https://github.com/lsy-404/Waline_On_Worker.git
cd Waline_On_Worker
pnpm install

# Create D1 database and edit wrangler.toml
pnpm exec wrangler d1 create waline-db
pnpm run db:init
pnpm exec wrangler secret put JWT_SECRET
pnpm run deploy
```

Please refer to the [documentation](docs/README.md) for detailed deployment steps and configuration instructions.

<details>
<summary><strong>What's New</strong></summary>

### v1.1.0

- **Fix: OAuth social account binding** — Logging in with a social provider while already signed in now correctly links the social account to the existing password-based account instead of creating a duplicate. Conflicts (social ID already bound to another account) return a clear `oauth_already_bound` error.
- **Akismet anti-spam** — Native Akismet integration alongside the existing LLM reviewer. Admins choose one of four modes (Off / Akismet / LLM / Mix) from the settings page. The Akismet key can be placed as a `wrangler secret` (server-side, higher priority) or entered directly in the admin UI (stored in D1).
- **Unified spam review pipeline** — Internal refactor consolidates all spam-detection paths into a single `runSpamReview()` function, eliminating redundant DB reads and making future detectors easy to add.
- **Settings batch reads** — All settings lookups in the comment POST path are now a single `getSettings()` batch call instead of multiple sequential `getSetting()` calls.

</details>

## License

[GPL-3.0](LICENSE)
