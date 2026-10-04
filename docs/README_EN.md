# Waline on Worker - Detailed Documentation

## Recommended deployment: Overture

Open the [Overture deployment page](https://overture.voidcarve.com/?src=lsy-404/Waline_On_Worker), then select a release from this repository. It creates or reuses D1, applies the schema, deploys the Worker, and generates `JWT_SECRET` for a first deployment. A custom domain is optional: leave it empty for the Worker’s `workers.dev` address, or provide one to attach it.

Choose **OAuth**, only when the Overture instance has enabled and configured it, to authorize Workers Scripts, D1, and the route and zone permissions needed for an optional custom domain; otherwise use an **Account API Token** created and pasted from Overture's prefilled permission template. The token is used only for this deployment and never becomes an application credential. Regular updates retain comment data and `JWT_SECRET`; a full rebuild retains D1 data but creates a new secret and invalidates login sessions. An empty CORS origins field during an update preserves `SECURE_DOMAINS`; clear or change it in the Cloudflare Dashboard Worker variables. To retain the ability to provide a custom domain, the OAuth and API Token permission template still lists route and zone access even when you leave the domain empty. Read and accept the package’s complete English and Chinese terms before deployment; they explain account charges, credential handling, and data responsibilities.

## Manual deployment

### Prerequisites

* Node.js >= 18
* pnpm
* Cloudflare account
* Wrangler CLI installed and logged in

### One-Click Deployment

```bash
# Clone the repository
git clone https://github.com/lsy-404/Waline_On_Worker.git
cd Waline_On_Worker

# Run deployment script

# Linux / macOS
chmod +x deploy.sh
./deploy.sh

# Windows (PowerShell)
.\deploy.ps1
```

### Manual Deployment

```bash
# 1. Install dependencies
pnpm install

# 2. Create a D1 database
pnpm exec wrangler d1 create waline-db

# 3. Edit wrangler.toml and fill in the database_id
# returned from the previous step

# 4. Initialize the database schema
pnpm run db:init

# 5. Set JWT secret
pnpm exec wrangler secret put JWT_SECRET
# Enter a random string as the secret

# 6. Deploy
pnpm run deploy
```

### Local Development

```bash
# Initialize local database
pnpm run db:init:local

# Start development server
pnpm run dev
```

---

# API Endpoints

## Comments

| Method | Path                           | Description                   | Authentication |
| ------ | ------------------------------ | ----------------------------- | -------------- |
| GET    | `/api/comment?path=`           | Get comment list (threaded)   | None           |
| GET    | `/api/comment?type=recent`     | Recent comments               | None           |
| GET    | `/api/comment?type=count&url=` | Comment count                 | None           |
| GET    | `/api/comment?type=list`       | Admin comment list            | Admin          |
| GET    | `/api/comment/rss`             | RSS feed                      | None           |
| POST   | `/api/comment`                 | Create comment                | None           |
| PUT    | `/api/comment/:id`             | Update comment / like comment | Admin / Like   |
| DELETE | `/api/comment/:id`             | Delete comment (cascading)    | Admin          |

## Articles

| Method | Path                | Description                     | Authentication |
| ------ | ------------------- | ------------------------------- | -------------- |
| GET    | `/api/article?url=` | Get page views                  | None           |
| POST   | `/api/article`      | Increase page views / reactions | None           |

## Users

| Method | Path            | Description        | Authentication |
| ------ | --------------- | ------------------ | -------------- |
| POST   | `/api/user`     | Register user      | None           |
| GET    | `/api/user`     | User list          | None / Admin   |
| PUT    | `/api/user/:id` | Update user        | Self / Admin   |
| DELETE | `/api/user/:id` | Delete or ban user | Admin          |

## Authentication

| Method | Path             | Description               | Authentication |
| ------ | ---------------- | ------------------------- | -------------- |
| POST   | `/api/token`     | Login                     | None           |
| GET    | `/api/token`     | Get current user info     | Bearer Token   |
| DELETE | `/api/token`     | Logout                    | None           |
| POST   | `/api/token/2fa` | Two-factor authentication | Bearer Token   |

## OAuth

| Method | Path                         | Description       | Authentication |
| ------ | ---------------------------- | ----------------- | -------------- |
| GET    | `/api/oauth?type=<provider>` | Start OAuth login | None           |

Supported OAuth providers (`type` parameter):

* github
* twitter
* facebook
* weibo
* qq

OAuth login is handled through an external OAuth proxy service (default: `https://oauth.lithub.cc`), which can be customized via the `OAUTH_URL` environment variable.

## Data Management

| Method | Path                       | Description                          | Authentication |
| ------ | -------------------------- | ------------------------------------ | -------------- |
| GET    | `/api/db`                  | Export all data (Waline JSON format) | Admin          |
| POST   | `/api/db?table=`           | Import a single record               | Admin          |
| PUT    | `/api/db?table=&objectId=` | Update imported data                 | Admin          |
| DELETE | `/api/db?table=`           | Clear specified table                | Admin          |

## Settings

| Method | Path            | Description     | Authentication |
| ------ | --------------- | --------------- | -------------- |
| GET    | `/api/settings` | Get settings    | Admin          |
| PUT    | `/api/settings` | Update settings | Admin          |

## Admin Panel

| Path                 | Description                 |
| -------------------- | --------------------------- |
| `/ui`                | @waline/admin dashboard     |
| `/ui/worker-setting` | Worker custom settings page |

> The first registered user automatically becomes an administrator.

---

# Data Import & Export

This project provides a `/api/db` endpoint fully compatible with the `@waline/admin` dashboard, supporting standard Waline JSON import/export.

## Importing & Exporting via Admin Panel

1. Visit `/ui` and log in as an administrator.
2. Open the **Import/Export** page.
3. **Export:** Click Export to download `waline.json`.
4. **Import:** Select a previously exported `waline.json` file and import it.

## Importing via Wrangler CLI

For large datasets, direct D1 database operations are recommended:

```bash
# Export to SQL
pnpm exec wrangler d1 export <database-name> --remote --output=backup.sql

# Import from SQL
pnpm exec wrangler d1 execute <database-name> --remote --file=backup.sql
```

### Warning: Large Data Imports

When importing hundreds of records or more through the admin panel, Cloudflare Workers request timeouts or D1 concurrency limits may cause **500 errors**.

Recommended solutions:

1. **Chunked imports** – Split JSON into batches of around 500 records.
2. **Use Wrangler CLI** – More reliable for large migrations.
3. **Use migration scripts** – See `migrate.ts` or `migrate-d1.ts`.

---

# Configuration

## Environment Variables (`wrangler.toml [vars]`)

| Variable       | Description                       | Default |
| -------------- | --------------------------------- | ------- |
| SITE_NAME      | Site name                         | Waline  |
| SITE_URL       | Site URL                          | None    |
| SECURE_DOMAINS | Allowed domains (comma-separated) | None    |

## Secrets (via `wrangler secret put`)

| Secret     | Description        | Required |
| ---------- | ------------------ | -------- |
| JWT_SECRET | JWT signing secret | Yes      |

## Worker Settings (configured via `/ui/worker-setting`)

| Setting                     | Description                                                   | Default  |
| --------------------------- | ------------------------------------------------------------- | -------- |
| waline_client_version       | @waline/client CDN version                                    | None     |
| comment_default_status      | Default status for anonymous comments (approved/waiting/spam) | approved |
| user_comment_default_status | Default status for logged-in user comments                    | approved |
| worker_display              | Show Worker extension menu in admin panel                     | None     |
| llm_mode                    | LLM moderation mode (off/anonymous/all)                       | off      |
| llm_skip_admin              | Skip LLM moderation for admin comments                        | None     |
| llm_endpoint                | LLM API endpoint URL                                          | None     |
| llm_api_key                 | LLM API key                                                   | None     |
| llm_model                   | LLM model name                                                | None     |
| llm_prompt                  | LLM moderation prompt                                         | None     |

## OAuth Configuration

| Variable  | Description             | Default                   |
| --------- | ----------------------- | ------------------------- |
| OAUTH_URL | OAuth proxy service URL | `https://oauth.lithub.cc` |

OAuth login uses an external proxy service to handle Client IDs and Secrets, so platform credentials do not need to be configured inside the Worker.

Supported providers:

* GitHub
* Twitter
* Facebook
* Weibo
* QQ

---

# Front-End Integration

Use `@waline/client` in your website:

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

---

# Project Structure

```text
src/
├── index.ts               # Workers entry (Hono + CORS + auth + version)
├── env.ts                 # Type definitions
├── router/
│   ├── comment.ts         # Comment CRUD + LLM moderation
│   ├── article.ts         # Page views/reaction counters
│   ├── user.ts            # User management
│   ├── token.ts           # JWT login + 2FA
│   ├── oauth.ts           # OAuth login
│   │                      # (GitHub/Twitter/Facebook/Google/Weibo/QQ)
│   ├── settings.ts        # Worker settings management
│   │                      # (API keys returned masked)
│   └── db.ts              # Data import/export
├── middleware/
│   └── auth.ts            # JWT authentication middleware
├── ui/
│   ├── admin-panel.ts     # @waline/admin dashboard
│   ├── custom-admin.ts    # Custom Worker settings page
│   └── waline-page.ts     # Waline comments page
└── utils/
    ├── password.ts        # PBKDF2 password hashing
    ├── avatar.ts          # Gravatar avatars
    ├── ua.ts              # User-Agent parsing
    ├── markdown.ts        # Markdown rendering
    ├── llm-review.ts      # LLM comment moderation
    └── totp.ts            # TOTP two-factor authentication

schema.sql                 # D1 database schema
migrate.ts                 # LeanCloud migration
migrate-d1.ts              # D1-to-D1 migration
wrangler.toml              # Workers configuration
deploy.sh / deploy.ps1     # Deployment scripts
```

### Summary

This project is a Cloudflare Workers + D1 implementation of **Waline**, providing:

* Comment system
* Admin dashboard
* JWT authentication
* Two-factor authentication (2FA)
* OAuth login
* Data import/export compatibility with Waline
* LLM-powered comment moderation
* Cloudflare D1 storage
* One-click deployment support
* Full compatibility with `@waline/client` and `@waline/admin`
