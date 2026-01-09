# Firecrawl Local Development FAQ

A comprehensive guide for setting up and understanding Firecrawl for local development without Docker.

---

## Table of Contents

1. [Setup & Installation](#setup--installation)
2. [Database Setup](#database-setup)
3. [Running the Application](#running-the-application)
4. [Services & Dependencies](#services--dependencies)
5. [Queue System](#queue-system)
6. [RabbitMQ](#rabbitmq)
7. [Playwright Service](#playwright-service)
8. [Engine Selection](#engine-selection)
9. [Authentication](#authentication)
10. [V2 API Reference](#v2-api-reference)
11. [V1 API Reference (Legacy)](#v1-api-reference-legacy)
12. [Troubleshooting](#troubleshooting)

---

## Setup & Installation

### What are the system dependencies needed?

| Dependency | Installation |
|------------|--------------|
| **Node.js** (v18+) | https://nodejs.org/ |
| **pnpm** (v9+) | `npm install -g pnpm@latest` |
| **Redis** | `brew install redis` (macOS) |
| **PostgreSQL** | `brew install postgresql@15` (macOS) |

### What should my `.env` file contain?

Create `apps/api/.env`:

```bash
# Required
PORT=3002
HOST=0.0.0.0
NUM_WORKERS_PER_QUEUE=8

# Redis (local)
REDIS_URL=redis://localhost:6379
REDIS_RATE_LIMIT_URL=redis://localhost:6379

# Playwright service (local)
PLAYWRIGHT_MICROSERVICE_URL=http://localhost:3000/scrape

# PostgreSQL (local)
NUQ_DATABASE_URL=postgres://YOUR_USERNAME@localhost:5432/firecrawl

# Disable Supabase auth for local dev
USE_DB_AUTHENTICATION=false

# Queue admin panel key
BULL_AUTH_KEY=localdev

# Optional
LOGGING_LEVEL=DEBUG
# OPENAI_API_KEY=sk-...  # For AI features
# LLAMAPARSE_API_KEY=... # For PDF parsing
```

### How do I find my PostgreSQL username?

Run `whoami` in terminal - that's typically your PostgreSQL username on macOS with Homebrew.

---

## Database Setup

### How do I initialize the database?

```bash
# Create the database
createdb firecrawl

# Initialize the schema (without pg_cron for local dev)
grep -v 'pg_cron\|cron.schedule' apps/nuq-postgres/nuq.sql | psql -d firecrawl
```

### Why do I get `pg_cron` errors when initializing the database?

The `pg_cron` extension is not installed in standard Homebrew PostgreSQL. It's used for scheduled cleanup tasks (not critical for development).

**Solution:** Skip pg_cron by filtering it out:
```bash
grep -v 'pg_cron\|cron.schedule' apps/nuq-postgres/nuq.sql | psql -d firecrawl
```

### How do I verify the database is set up correctly?

```bash
# Check connection
psql -d firecrawl -c "SELECT current_user, current_database();"

# Check schema exists
psql -d firecrawl -c "\dn"

# Check tables exist
psql -d firecrawl -c "\dt nuq.*"

# Test connection string
psql "postgres://YOUR_USERNAME@localhost:5432/firecrawl" -c "SELECT 1;"
```

---

## Running the Application

### Do I need to run `pnpm build` before starting?

| Command | Build needed? |
|---------|---------------|
| `pnpm dev` | **No** - uses tsx to run TypeScript directly |
| `pnpm start` | **Auto-builds** - runs `tsc` first |
| `pnpm server` | **Watch mode** - auto-rebuilds on file changes |

**Recommendation:** Use `pnpm dev` for development.

### Is there a performance difference between `pnpm dev` and `pnpm start`?

**No significant runtime performance difference.** The only difference is startup time:

| Aspect | `pnpm dev` | `pnpm start` |
|--------|------------|--------------|
| Startup time | Faster | Slower (compiles first) |
| Runtime performance | Same | Same |
| Memory usage | Slightly higher | Slightly lower |

### How do I start the application for local development?

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start the API (PostgreSQL should already be running)
cd apps/api
pnpm dev
```

### How do I test if the API is working?

```bash
# Health check
curl http://localhost:3002/test

# Test scrape
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

---

## Services & Dependencies

### What services does Firecrawl need?

| Service | Required? | Purpose |
|---------|-----------|---------|
| **Redis** | **Yes** | Job queue (BullMQ), caching, rate limiting |
| **PostgreSQL** | **Yes** | Job storage for NuQ queue system |
| **RabbitMQ** | Optional | Message broker for worker coordination |
| **Playwright** | Optional | Browser automation for JS-heavy sites |

### When do I need the Playwright service?

- **Without Playwright:** Simple HTTP fetch works for static HTML sites
- **With Playwright:** Needed for JavaScript-rendered pages (SPAs, React apps)

### How do I configure the Playwright service?

Add to `apps/api/.env`:
```bash
PLAYWRIGHT_MICROSERVICE_URL=http://localhost:3000/scrape
```

Then start the Playwright service:
```bash
cd apps/playwright-service-ts
pnpm install
pnpm dev
```

---

## Queue System

### What queue systems does Firecrawl use?

Firecrawl uses **three components** for job management:

| System | Storage | Purpose | View Method |
|--------|---------|---------|-------------|
| **NuQ** | PostgreSQL | Main scrape/crawl jobs (source of truth) | SQL queries |
| **BullMQ** | Redis | Auxiliary tasks (billing, LLM, etc.) | Bull Board UI |
| **RabbitMQ** | RabbitMQ | Prefetch cache for faster job distribution | `rabbitmqctl` |

### How do I view the job queue?

**Bull Board UI** (auxiliary queues only):
```
http://localhost:3002/admin/localdev/queues
```

**Main scrape queue** (PostgreSQL):
```bash
# View pending jobs
psql -d firecrawl -c "SELECT id, status, data->>'url' as url FROM nuq.queue_scrape WHERE status='queued' LIMIT 20;"

# Count by status
psql -d firecrawl -c "SELECT status, COUNT(*) FROM nuq.queue_scrape GROUP BY status;"

# View failed jobs with errors
psql -d firecrawl -c "SELECT data->>'url', failedreason FROM nuq.queue_scrape WHERE status='failed';"
```

### What is my concurrency limit for self-hosted?

**No artificial limit!** For self-hosted (`USE_DB_AUTHENTICATION=false`), concurrency limits are bypassed. Your only limits are hardware resources.

### How does `NUQ_WORKER_COUNT` work?

`NUQ_WORKER_COUNT` (default: 5) controls how many parallel worker processes handle jobs:

```
Queue: 100 jobs waiting
         │
         ▼
┌─────────────────────────────────────┐
│  5 Workers (NUQ_WORKER_COUNT=5)     │
│  Worker 0: processing Job 1         │
│  Worker 1: processing Job 2         │
│  Worker 2: processing Job 3         │
│  Worker 3: processing Job 4         │
│  Worker 4: processing Job 5         │
│                                     │
│  Queue: 95 jobs waiting             │
└─────────────────────────────────────┘
```

To increase parallelism:
```bash
# In apps/api/.env
NUQ_WORKER_COUNT=10
```

---

## RabbitMQ

### Before run pnpm dev
rabbitmqctl delete_queue nuq.queue_scrape.prefetch
rabbitmqctl delete_queue nuq.queue_crawl_finished.prefetch

Prevention Tips
To avoid corrupted queues in local RabbitMQ:
# Always stop RabbitMQ gracefully
brew services stop rabbitmq

# Or
rabbitmqctl stop

# Never force kill the process
# Avoid: kill -9 <rabbitmq_pid>

### Why does Firecrawl use RabbitMQ?

RabbitMQ is used as a **prefetch cache** to speed up job distribution. It's **optional** - the system falls back to PostgreSQL if RabbitMQ is unavailable.

**Without RabbitMQ (PostgreSQL only):**
```
Worker 1: "Give me a job" → PostgreSQL query → 5-10ms
Worker 2: "Give me a job" → PostgreSQL query → 5-10ms
Worker 3: "Give me a job" → PostgreSQL query → 5-10ms
```

**With RabbitMQ (Prefetch):**
```
Prefetch Worker: Query PostgreSQL for 500 jobs → Push to RabbitMQ
Worker 1: Get job from RabbitMQ → ~1ms
Worker 2: Get job from RabbitMQ → ~1ms
Worker 3: Get job from RabbitMQ → ~1ms
```

### Is RabbitMQ required for local development?

**No, it's optional.** If you don't set `NUQ_RABBITMQ_URL`, the harness will try to start a Docker container. To use local RabbitMQ:

```bash
# Install and start RabbitMQ
brew install rabbitmq
brew services start rabbitmq

# Add to apps/api/.env
NUQ_RABBITMQ_URL=amqp://localhost:5672
```

### What is the relationship between RabbitMQ and PostgreSQL?

```
┌─────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (NuQ) - SOURCE OF TRUTH                                  │
│  All jobs stored here permanently                                    │
│  Status: queued → active → completed/failed                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Prefetch (copy jobs for fast access)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RabbitMQ - TEMPORARY CACHE                                          │
│  Jobs expire in 15 seconds                                           │
│  Can be deleted anytime - will be refilled from PostgreSQL          │
└─────────────────────────────────────────────────────────────────────┘
```

**Key point:** Deleting RabbitMQ queues causes **no data loss** - jobs are still in PostgreSQL.

### Why do I get `noproc` errors with local RabbitMQ?

The error:
```
INTERNAL_ERROR - Cannot get a message from queue 'nuq.queue_scrape.prefetch': noproc
```

This means **corrupted quorum queues**. RabbitMQ uses quorum queues which can become corrupted if:
- RabbitMQ was stopped improperly (crash, force kill)
- The Raft process died but queue metadata remains

**Why Docker works but local doesn't:**

| Docker | Local Homebrew |
|--------|----------------|
| Fresh container each start | Persists data in `/opt/homebrew/var/lib/rabbitmq` |
| No stale queue data | **Corrupted queues persist** |
| Clean state every time | Must manually delete corrupted queues |

### How do I fix corrupted RabbitMQ queues?

```bash
# Delete all Firecrawl queues (safe - no data loss!)
rabbitmqctl delete_queue nuq.queue_scrape.prefetch
rabbitmqctl delete_queue nuq.queue_crawl_finished.prefetch
rabbitmqctl delete_queue extract.jobs
rabbitmqctl delete_queue extract.dlq

# Or delete all queues at once
rabbitmqctl list_queues name | tail -n +2 | xargs -I {} rabbitmqctl delete_queue {}

# Restart the API - queues will be recreated
pnpm dev
```

### How do I prevent RabbitMQ queue corruption?

Always stop RabbitMQ gracefully:
```bash
# Good - graceful shutdown
brew services stop rabbitmq
# or
rabbitmqctl stop

# Bad - can cause corruption
kill -9 <rabbitmq_pid>
```

### Could Redis replace RabbitMQ?

**Yes, technically.** For this specific use case (15-second prefetch cache):

| Aspect | RabbitMQ | Redis |
|--------|----------|-------|
| Already in stack? | No (extra service) | **Yes** |
| Speed | ~1ms | ~1ms |
| Complexity | Higher (Erlang, quorum queues) | **Lower** |
| Failure handling | Complex (noproc errors) | **Simpler** |

Redis would be simpler since:
- Jobs expire in 15 seconds anyway
- PostgreSQL is the source of truth
- No need for quorum queue durability
- One less service to manage

However, Firecrawl chose RabbitMQ for stronger message guarantees and future scalability.

### RabbitMQ useful commands

```bash
# Check if RabbitMQ is running
rabbitmqctl status

# List all queues
rabbitmqctl list_queues name type messages

# Delete a specific queue
rabbitmqctl delete_queue <queue_name>

# Restart RabbitMQ
brew services restart rabbitmq
```

---

## Playwright Service

### Does each task use the same browser instance?

**Yes, one browser instance is shared.** But each request gets:
- **New Context** (isolated cookies, localStorage)
- **New Page** (new tab)

This is the recommended Playwright pattern - efficient and isolated.

### Why not create a new browser for each request?

| Approach | Memory | Startup Time |
|----------|--------|--------------|
| 1 Browser + 21 Pages | ~720MB | Fast (~50ms/page) |
| 21 Browser Instances | ~6.3GB | Slow (~1-2s each) |

One browser with multiple contexts is **much more efficient**.

### What happens if I submit more URLs than `MAX_CONCURRENT_PAGES`?

Requests **wait in a queue** (no error). Example with `MAX_CONCURRENT_PAGES=20`:

- URLs 1-20: Start immediately
- URL 21+: Wait until a slot frees up

### How do I control headless mode?

We added a `HEADLESS` environment variable:

```bash
# Headless (default) - no browser window
pnpm dev

# Non-headless - browser window visible (for debugging)
HEADLESS=false pnpm dev
```

### How do I use system Chrome instead of bundled Chromium?

You can use your system Chrome with patchright for better anti-detection and persistent login sessions.

**Option 1: Configure in `.env` file (recommended)**

Edit `apps/playwright-service-ts/.env`:
```bash
HEADLESS=false
PORT=3100
USE_SYSTEM_CHROME=true
BROWSER_PROFILE_ID=1
```

Then just run:
```bash
pnpm dev
```

**Option 2: Use environment variables**
```bash
USE_SYSTEM_CHROME=true BROWSER_PROFILE_ID=1 pnpm dev
```

**Environment Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `USE_SYSTEM_CHROME` | `false` | Use system Chrome with patchright instead of bundled Chromium |
| `BROWSER_PROFILE_ID` | `1` | Profile ID for persistent context (creates `browser-profiles/browser-{id}/`) |

**Benefits of system Chrome mode:**
- Persistent login sessions across restarts
- Better anti-detection (uses patchright)
- Reuses existing Chrome cookies and extensions
- Profile data saved in `browser-profiles/` directory
- Auto-reinitializes browser if closed manually

**Example with proxy:**
```bash
USE_SYSTEM_CHROME=true \
BROWSER_PROFILE_ID=1 \
PROXY_SERVER=proxy.example.com:8080 \
PROXY_USERNAME=user \
PROXY_PASSWORD=pass \
HEADLESS=false \
pnpm dev
```

### What features does the local Playwright service support?

| Feature | Supported |
|---------|-----------|
| JS rendering | ✅ |
| Wait after load | ✅ |
| Wait for selector | ✅ |
| Custom headers | ✅ |
| Skip TLS verification | ✅ |
| Screenshots | ✅ |
| Browser actions | ✅ |
| PDF generation | ✅ |

### What browser actions are supported?

The local Playwright service supports the following actions:

| Action | Description | Example |
|--------|-------------|---------|
| `wait` | Wait for time or selector | `{"type": "wait", "milliseconds": 1000}` or `{"type": "wait", "selector": "#element"}` |
| `click` | Click element(s) | `{"type": "click", "selector": "button", "all": false}` |
| `screenshot` | Take screenshot | `{"type": "screenshot", "fullPage": true}` |
| `write` | Type text | `{"type": "write", "text": "hello"}` |
| `press` | Press keyboard key | `{"type": "press", "key": "Enter"}` |
| `scroll` | Scroll page/element | `{"type": "scroll", "direction": "down", "selector": "#container"}` |
| `scrape` | Capture HTML at this point | `{"type": "scrape"}` |
| `executeJavascript` | Run custom JS | `{"type": "executeJavascript", "script": "document.title"}` |
| `pdf` | Generate PDF | `{"type": "pdf", "format": "A4", "landscape": false}` |

### How do I use actions in a scrape request?

```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "waitFor": 1000,
    "actions": [
      {"type": "wait", "milliseconds": 500},
      {"type": "scroll", "direction": "down"},
      {"type": "screenshot", "fullPage": true}
    ]
  }'
```

### How do I take a screenshot?

**Option 1: Using formats**
```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "screenshot"],
    "waitFor": 1000
  }'
```

**Option 2: Using actions (for multiple screenshots)**
```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "waitFor": 1000,
    "actions": [
      {"type": "screenshot"},
      {"type": "scroll", "direction": "down"},
      {"type": "screenshot", "fullPage": true}
    ]
  }'
```

Screenshots are returned as base64-encoded strings in the response.

### How do I generate a PDF?

```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "waitFor": 1000,
    "actions": [
      {"type": "pdf", "format": "A4", "landscape": false, "scale": 1}
    ]
  }'
```

**PDF Options:**
| Option | Type | Default | Values |
|--------|------|---------|--------|
| `format` | string | "Letter" | A0, A1, A2, A3, A4, A5, A6, Letter, Legal, Tabloid, Ledger |
| `landscape` | boolean | false | true/false |
| `scale` | number | 1 | 0.1 to 2 |

PDFs are returned as base64-encoded strings in `data.actions.pdfs[]`.

---

## Engine Selection

### How does Firecrawl decide which engine to use?

Firecrawl uses a **feature-based scoring system**:

1. Build feature flags from request options
2. Calculate which engines support those features
3. Sort by support score, then quality
4. Try engines in order (waterfall)

### What engines are available locally?

| Engine | Quality | Features |
|--------|---------|----------|
| `playwright` | 20 | JS rendering, waitFor, actions, screenshots |
| `fetch` | 5 | Simple HTTP, fast |

### How do I force Playwright to be used?

Add `waitFor` or `actions` to your request:
```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "waitFor": 1000}'
```

Or use screenshot format:
```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown", "screenshot"]}'
```

### Example: How is the engine selected for a simple URL?

Request: `{"url": "https://news.ycombinator.com"}`

1. **Feature flags:** Empty (no special options)
2. **Priority threshold:** 0
3. **Qualifying engines:** `playwright` (quality 20), `fetch` (quality 5)
4. **Selected order:** `playwright` first, `fetch` as fallback

---

## Authentication

### Do I need an API key for local development?

**No!** When `USE_DB_AUTHENTICATION=false` is set in your `.env` file, authentication is completely bypassed.

### How does authentication bypass work?

When `USE_DB_AUTHENTICATION=false`, the API returns a mock authentication object with:
- Unlimited credits (`99999999`)
- No rate limits
- No concurrency limits
- `team_id: "bypass"`

You'll see this log message (which is normal):
```
You're bypassing authentication
```

### How do I make API calls locally?

**Option 1: No Authorization header (recommended)**
```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

**Option 2: Any dummy Authorization header (also works)**
```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H 'Authorization: Bearer any-value-works' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

### What about the hosted Firecrawl API?

For the hosted API at `api.firecrawl.dev`, you need a real API key:
```bash
curl -X POST https://api.firecrawl.dev/v2/scrape \
  -H 'Authorization: Bearer fc-YOUR_REAL_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

Get your API key at https://firecrawl.dev

---

## V2 API Reference

V2 is the latest and recommended API version. All endpoints are prefixed with `/v2/`.

### API Endpoints Summary

| Endpoint | Method | Purpose | Credits |
|----------|--------|---------|---------|
| `/v2/scrape` | POST | Scrape single URL | 1+ |
| `/v2/scrape/:jobId` | GET | Get scrape status | 0 |
| `/v2/batch/scrape` | POST | Scrape multiple URLs | 1 per URL |
| `/v2/batch/scrape/:jobId` | GET | Get batch status | 0 |
| `/v2/batch/scrape/:jobId` | DELETE | Cancel batch | 0 |
| `/v2/crawl` | POST | Crawl website | 1 per page |
| `/v2/crawl/:jobId` | GET | Get crawl status | 0 |
| `/v2/crawl/:jobId` | DELETE | Cancel crawl | 0 |
| `/v2/crawl/:jobId/errors` | GET | Get crawl errors | 0 |
| `/v2/crawl/ongoing` | GET | List active crawls | 0 |
| `/v2/map` | POST | Discover URLs | 1 |
| `/v2/search` | POST | Web search + scrape | 2 per 10 results |
| `/v2/extract` | POST | AI data extraction | 20+ |
| `/v2/extract/:jobId` | GET | Get extract status | 0 |
| `/v2/agent` | POST | AI agent | Variable |
| `/v2/agent/:jobId` | GET | Get agent status | 0 |
| `/v2/agent/:jobId` | DELETE | Cancel agent | 0 |
| `/v2/concurrency-check` | GET | Check concurrency | 0 |
| `/v2/team/credit-usage` | GET | Credit usage | 0 |
| `/v2/team/queue-status` | GET | Queue status | 0 |

---

### POST /v2/scrape - Single URL Scraping

**Purpose:** Scrape a single URL and extract content in various formats (markdown, HTML, JSON, screenshots, etc.). This is the core scraping endpoint.

**Key Features:**
- Multiple output formats (markdown, html, rawHtml, links, images, screenshot, json, summary)
- Browser actions (click, scroll, wait, type)
- Location/geo targeting
- Proxy options (basic, stealth, auto)

#### Basic Example

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "links"]
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "markdown": "# Example Domain\n\nThis domain is for use in illustrative examples...",
    "links": ["https://www.iana.org/domains/example"],
    "metadata": {
      "title": "Example Domain",
      "statusCode": 200,
      "sourceURL": "https://example.com"
    }
  }
}
```

#### Advanced Example with JSON Extraction

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://news.ycombinator.com",
    "formats": [
      "markdown",
      {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "topStories": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": {"type": "string"},
                  "url": {"type": "string"},
                  "points": {"type": "number"}
                }
              }
            }
          }
        },
        "prompt": "Extract the top 5 stories with their titles, URLs, and points"
      }
    ],
    "timeout": 60000
  }'
```

#### Example with Browser Actions

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/login",
    "formats": ["markdown", {"type": "screenshot", "fullPage": true}],
    "actions": [
      {"type": "wait", "milliseconds": 2000},
      {"type": "click", "selector": "#username"},
      {"type": "write", "text": "myuser"},
      {"type": "click", "selector": "#password"},
      {"type": "write", "text": "mypass"},
      {"type": "click", "selector": "#submit"},
      {"type": "wait", "milliseconds": 3000},
      {"type": "screenshot", "fullPage": true}
    ],
    "waitFor": 5000
  }'
```

#### Available Formats

| Format | Description |
|--------|-------------|
| `markdown` | Clean markdown content (default) |
| `html` | Processed HTML |
| `rawHtml` | Original HTML |
| `links` | Array of links found |
| `images` | Array of images found |
| `screenshot` | Screenshot of the page |
| `json` | AI-extracted structured data |
| `summary` | AI-generated summary |

#### Available Actions

| Action | Description |
|--------|-------------|
| `wait` | Wait for milliseconds or selector |
| `click` | Click an element |
| `write` | Type text |
| `press` | Press a key |
| `scroll` | Scroll up/down |
| `screenshot` | Take a screenshot |
| `scrape` | Capture content at this point |
| `executeJavascript` | Run custom JS |
| `pdf` | Generate a PDF |

**Note:** All actions are supported in local development with the Playwright service.

---

### GET /v2/scrape/:jobId - Scrape Status

**Purpose:** Check the status of an async scrape job.

```bash
curl http://localhost:3002/v2/scrape/01234567-89ab-cdef-0123-456789abcdef
```

**Response:**
```json
{
  "success": true,
  "status": "completed",
  "data": {
    "markdown": "# Page Content...",
    "metadata": {
      "title": "Page Title",
      "statusCode": 200
    }
  }
}
```

---

### POST /v2/batch/scrape - Batch Scraping

**Purpose:** Scrape multiple URLs in parallel. Returns a job ID to poll for results. Ideal for scraping lists of pages efficiently.

#### Basic Example

```bash
curl -X POST http://localhost:3002/v2/batch/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": [
      "https://example.com/page1",
      "https://example.com/page2",
      "https://example.com/page3"
    ],
    "formats": ["markdown", "links"]
  }'
```

**Response:**
```json
{
  "success": true,
  "id": "batch-job-123",
  "url": "http://localhost:3002/v2/batch/scrape/batch-job-123"
}
```

#### Example with Webhook

```bash
curl -X POST http://localhost:3002/v2/batch/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": [
      "https://example.com/page1",
      "https://example.com/page2"
    ],
    "formats": ["markdown"],
    "webhook": {
      "url": "https://your-server.com/webhook",
      "events": ["batch_scrape.completed"]
    }
  }'
```

---

### GET /v2/batch/scrape/:jobId - Batch Status

**Purpose:** Get the status and results of a batch scrape job.

```bash
curl http://localhost:3002/v2/batch/scrape/batch-job-123
```

**Response:**
```json
{
  "success": true,
  "status": "scraping",
  "completed": 2,
  "total": 3,
  "creditsUsed": 2,
  "expiresAt": "2024-01-15T12:00:00Z",
  "data": [
    {"url": "https://example.com/page1", "markdown": "..."},
    {"url": "https://example.com/page2", "markdown": "..."}
  ]
}
```

---

### DELETE /v2/batch/scrape/:jobId - Cancel Batch

**Purpose:** Cancel an ongoing batch scrape job.

```bash
curl -X DELETE http://localhost:3002/v2/batch/scrape/batch-job-123
```

**Response:**
```json
{
  "success": true
}
```

---

### POST /v2/crawl - Website Crawling

**Purpose:** Crawl an entire website starting from a URL. Discovers and scrapes linked pages automatically. Supports path filtering, depth limits, and sitemap parsing.

#### Basic Example

```bash
curl -X POST http://localhost:3002/v2/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://docs.example.com",
    "limit": 100,
    "scrapeOptions": {
      "formats": ["markdown"]
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "id": "crawl-job-456",
  "url": "http://localhost:3002/v2/crawl/crawl-job-456"
}
```

#### Advanced Example with Path Filtering

```bash
curl -X POST http://localhost:3002/v2/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://docs.example.com",
    "limit": 500,
    "includePaths": ["/docs/*", "/api/*"],
    "excludePaths": ["/blog/*", "/changelog/*"],
    "maxDiscoveryDepth": 3,
    "allowSubdomains": false,
    "scrapeOptions": {
      "formats": ["markdown", "links"],
      "onlyMainContent": true
    },
    "webhook": {
      "url": "https://your-server.com/crawl-complete",
      "events": ["crawl.completed"]
    }
  }'
```

#### Natural Language Crawl with Prompt

```bash
curl -X POST http://localhost:3002/v2/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://docs.example.com",
    "prompt": "Crawl only the API reference documentation pages, skip tutorials and blog posts",
    "limit": 200
  }'
```

**Response (includes AI-generated options):**
```json
{
  "success": true,
  "id": "crawl-job-789",
  "promptGeneratedOptions": {
    "includePaths": ["/api/*", "/reference/*"],
    "excludePaths": ["/tutorials/*", "/blog/*"]
  }
}
```

#### Crawler Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | 10000 | Max pages to crawl |
| `includePaths` | string[] | [] | Regex patterns to include |
| `excludePaths` | string[] | [] | Regex patterns to exclude |
| `maxDiscoveryDepth` | number | - | Max link depth |
| `allowSubdomains` | boolean | false | Include subdomains |
| `allowExternalLinks` | boolean | false | Follow external links |
| `ignoreRobotsTxt` | boolean | false | Ignore robots.txt |
| `sitemap` | string | "include" | "skip", "include", or "only" |
| `deduplicateSimilarURLs` | boolean | true | Skip similar URLs |

---

### GET /v2/crawl/:jobId - Crawl Status

**Purpose:** Get the status and results of a crawl job. Supports pagination for large crawls.

```bash
curl http://localhost:3002/v2/crawl/crawl-job-456
```

**Response:**
```json
{
  "success": true,
  "status": "scraping",
  "completed": 45,
  "total": 100,
  "creditsUsed": 45,
  "expiresAt": "2024-01-15T12:00:00Z",
  "data": [
    {"url": "https://docs.example.com/intro", "markdown": "..."},
    {"url": "https://docs.example.com/getting-started", "markdown": "..."}
  ],
  "next": "http://localhost:3002/v2/crawl/crawl-job-456?skip=10"
}
```

---

### DELETE /v2/crawl/:jobId - Cancel Crawl

**Purpose:** Cancel an ongoing crawl job.

```bash
curl -X DELETE http://localhost:3002/v2/crawl/crawl-job-456
```

**Response:**
```json
{
  "success": true
}
```

---

### GET /v2/crawl/:jobId/errors - Crawl Errors

**Purpose:** Get detailed error information for failed URLs in a crawl.

```bash
curl http://localhost:3002/v2/crawl/crawl-job-456/errors
```

**Response:**
```json
{
  "errors": [
    {
      "id": "scrape-123",
      "url": "https://docs.example.com/broken-page",
      "code": "SCRAPE_TIMEOUT",
      "error": "Page load timed out after 30000ms"
    }
  ],
  "robotsBlocked": [
    "https://docs.example.com/admin/secret"
  ]
}
```

---

### GET /v2/crawl/ongoing - List Active Crawls

**Purpose:** List all currently running crawls for your team.

```bash
curl http://localhost:3002/v2/crawl/ongoing
```

**Response:**
```json
{
  "success": true,
  "crawls": [
    {
      "id": "crawl-job-456",
      "url": "https://docs.example.com",
      "created_at": "2024-01-14T10:00:00Z",
      "options": {
        "limit": 100,
        "includePaths": ["/docs/*"]
      }
    }
  ]
}
```

---

### POST /v2/map - Website Mapping

**Purpose:** Quickly discover all URLs on a website without scraping content. Returns a list of URLs found via sitemap and link discovery. Much faster than crawling (~10x).

#### Basic Example

```bash
curl -X POST http://localhost:3002/v2/map \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "limit": 1000
  }'
```

**Response:**
```json
{
  "success": true,
  "links": [
    {"url": "https://example.com/", "title": "Home"},
    {"url": "https://example.com/about", "title": "About Us"},
    {"url": "https://example.com/products", "title": "Products"},
    {"url": "https://example.com/contact", "title": "Contact"}
  ]
}
```

#### Example with Search Filter

```bash
curl -X POST http://localhost:3002/v2/map \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://docs.example.com",
    "search": "authentication",
    "limit": 50,
    "includeSubdomains": true
  }'
```

#### Map Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | 5000 | Max URLs to return (max 100000) |
| `search` | string | - | Filter results by relevance |
| `includeSubdomains` | boolean | true | Include subdomains |
| `sitemap` | string | "include" | "skip", "include", or "only" |
| `timeout` | number | - | Timeout in ms |

---

### POST /v2/search - Web Search + Scrape

**Purpose:** Search the web and optionally scrape the results. Combines SERP results with Firecrawl's scraping capabilities.

**Note:** Requires search provider configuration (e.g., `SEARXNG_ENDPOINT` in `.env`).

#### Basic Search (No Scraping)

```bash
curl -X POST http://localhost:3002/v2/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "best practices for API design",
    "limit": 5
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "web": [
      {
        "url": "https://example.com/api-design",
        "title": "API Design Best Practices",
        "description": "Learn the fundamentals..."
      }
    ]
  },
  "creditsUsed": 1,
  "id": "search-job-123"
}
```

#### Search with Scraping

```bash
curl -X POST http://localhost:3002/v2/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "TypeScript generics tutorial",
    "limit": 3,
    "sources": ["web", "news"],
    "scrapeOptions": {
      "formats": ["markdown"]
    }
  }'
```

**Response (includes full markdown content):**
```json
{
  "success": true,
  "data": {
    "web": [
      {
        "url": "https://example.com/typescript-generics",
        "title": "TypeScript Generics Guide",
        "description": "...",
        "markdown": "# TypeScript Generics\n\nGenerics allow you to..."
      }
    ],
    "news": [...]
  },
  "creditsUsed": 4,
  "id": "search-job-456"
}
```

#### Async Search Scraping

```bash
curl -X POST http://localhost:3002/v2/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "machine learning frameworks 2024",
    "limit": 10,
    "asyncScraping": true,
    "scrapeOptions": {
      "formats": ["markdown", "links"]
    }
  }'
```

**Response (returns job IDs for each scrape):**
```json
{
  "success": true,
  "data": {...},
  "scrapeIds": {
    "web": ["job-1", "job-2", "job-3"]
  },
  "creditsUsed": 2,
  "id": "search-job-789"
}
```

#### Search Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `query` | string | required | Search query |
| `limit` | number | 10 | Max results (max 100) |
| `sources` | string[] | ["web"] | "web", "images", "news" |
| `lang` | string | "en" | Language code |
| `country` | string | "us" | Country code |
| `asyncScraping` | boolean | false | Return job IDs instead of waiting |
| `scrapeOptions` | object | - | Options for scraping results |

---

### POST /v2/extract - AI Data Extraction

**Purpose:** Extract structured data from one or more URLs using AI. Supports custom schemas and prompts. The AI navigates and finds relevant information.

**Note:** Requires `OPENAI_API_KEY` in `.env`.

#### Basic Example

```bash
curl -X POST http://localhost:3002/v2/extract \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://shop.example.com/products"],
    "schema": {
      "type": "object",
      "properties": {
        "products": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "price": {"type": "number"},
              "currency": {"type": "string"},
              "inStock": {"type": "boolean"}
            },
            "required": ["name", "price"]
          }
        }
      }
    },
    "prompt": "Extract all products with their prices and availability"
  }'
```

**Response:**
```json
{
  "success": true,
  "id": "extract-job-789"
}
```

#### Example with Web Search

```bash
curl -X POST http://localhost:3002/v2/extract \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Find the pricing information for Anthropic Claude API",
    "enableWebSearch": true,
    "schema": {
      "type": "object",
      "properties": {
        "models": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "inputPrice": {"type": "string"},
              "outputPrice": {"type": "string"}
            }
          }
        }
      }
    }
  }'
```

#### Extract Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `urls` | string[] | - | URLs to extract from (max 10) |
| `prompt` | string | - | Extraction instructions |
| `schema` | object | - | JSON schema for output |
| `enableWebSearch` | boolean | false | Let AI search for pages |
| `includeSubdomains` | boolean | true | Include subdomains |
| `limit` | number | - | Max pages to process |

---

### GET /v2/extract/:jobId - Extract Status

**Purpose:** Check the status of an extraction job.

```bash
curl http://localhost:3002/v2/extract/extract-job-789
```

**Response:**
```json
{
  "success": true,
  "status": "completed",
  "data": {
    "products": [
      {"name": "Widget Pro", "price": 29.99, "currency": "USD", "inStock": true},
      {"name": "Gadget Plus", "price": 49.99, "currency": "USD", "inStock": false}
    ]
  },
  "creditsUsed": 25
}
```

---

### POST /v2/agent - AI Agent

**Purpose:** Advanced AI agent that can browse, search, and extract data autonomously. More powerful than extract - can follow links, handle multi-step tasks.

**Note:** Requires `EXTRACT_V3_BETA_URL` configuration.

#### Example

```bash
curl -X POST http://localhost:3002/v2/agent \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Find the latest quarterly revenue for Apple, Microsoft, and Google from their investor relations pages",
    "schema": {
      "type": "object",
      "properties": {
        "companies": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "quarter": {"type": "string"},
              "revenue": {"type": "string"},
              "source": {"type": "string"}
            }
          }
        }
      }
    },
    "maxCredits": 100
  }'
```

**Response:**
```json
{
  "success": true,
  "id": "agent-job-abc"
}
```

#### Agent Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prompt` | string | required | Task description |
| `urls` | string[] | - | Starting URLs |
| `schema` | object | - | JSON schema for output |
| `maxCredits` | number | - | Credit limit for this job |

---

### GET /v2/agent/:jobId - Agent Status

**Purpose:** Check the status of an agent job.

```bash
curl http://localhost:3002/v2/agent/agent-job-abc
```

**Response:**
```json
{
  "success": true,
  "status": "completed",
  "data": {
    "companies": [
      {"name": "Apple", "quarter": "Q4 2024", "revenue": "$119.6B", "source": "https://investor.apple.com/..."},
      {"name": "Microsoft", "quarter": "Q2 FY25", "revenue": "$69.6B", "source": "https://microsoft.com/investor/..."}
    ]
  },
  "creditsUsed": 45,
  "expiresAt": "2024-01-15T12:00:00Z"
}
```

---

### DELETE /v2/agent/:jobId - Cancel Agent

**Purpose:** Cancel an ongoing agent job.

```bash
curl -X DELETE http://localhost:3002/v2/agent/agent-job-abc
```

**Response:**
```json
{
  "success": true
}
```

---

### GET /v2/concurrency-check - Concurrency Status

**Purpose:** Check your current concurrency usage (how many parallel jobs are running).

```bash
curl http://localhost:3002/v2/concurrency-check
```

**Response:**
```json
{
  "success": true,
  "concurrency": 3,
  "maxConcurrency": 10
}
```

---

### GET /v2/team/credit-usage - Credit Usage

**Purpose:** Check your team's current credit usage and remaining balance.

```bash
curl http://localhost:3002/v2/team/credit-usage
```

**Response (local dev with bypass):**
```json
{
  "success": true,
  "creditsUsed": 0,
  "creditsRemaining": 99999999,
  "creditsLimit": 99999999
}
```

---

### GET /v2/team/credit-usage/historical - Historical Usage

**Purpose:** Get historical credit usage data over time.

```bash
curl http://localhost:3002/v2/team/credit-usage/historical
```

---

### GET /v2/team/queue-status - Queue Status

**Purpose:** Check the status of your team's job queue.

```bash
curl http://localhost:3002/v2/team/queue-status
```

**Response:**
```json
{
  "success": true,
  "queuedJobs": 5,
  "activeJobs": 2,
  "completedJobs": 150
}
```

---

## V1 API Reference (Legacy)

V1 APIs are still supported but V2 is recommended for new projects.

### Core Scraping APIs

#### POST /v1/scrape - Scrape a single URL

```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "html"],
    "waitFor": 1000
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "markdown": "# Example Domain\n\nThis domain is for use in illustrative examples...",
    "html": "<html>...</html>",
    "metadata": {
      "title": "Example Domain",
      "sourceURL": "https://example.com"
    }
  }
}
```

#### GET /v1/scrape/:jobId - Get scrape job status

```bash
curl http://localhost:3002/v1/scrape/job-id-here
```

#### POST /v1/batch/scrape - Scrape multiple URLs

```bash
curl -X POST http://localhost:3002/v1/batch/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": [
      "https://example.com",
      "https://example.org"
    ],
    "formats": ["markdown"]
  }'
```

**Response:**
```json
{
  "success": true,
  "id": "batch-job-id",
  "url": "http://localhost:3002/v1/batch/scrape/batch-job-id"
}
```

### Crawling APIs

#### POST /v1/crawl - Start a crawl job

```bash
curl -X POST http://localhost:3002/v1/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "limit": 10,
    "maxDepth": 2
  }'
```

**Response:**
```json
{
  "success": true,
  "id": "crawl-job-id",
  "url": "http://localhost:3002/v1/crawl/crawl-job-id"
}
```

#### GET /v1/crawl/:jobId - Get crawl status

```bash
curl http://localhost:3002/v1/crawl/crawl-job-id
```

**Response:**
```json
{
  "success": true,
  "status": "completed",
  "completed": 10,
  "total": 10,
  "data": [
    {
      "markdown": "...",
      "metadata": {"title": "...", "sourceURL": "..."}
    }
  ]
}
```

#### DELETE /v1/crawl/:jobId - Cancel a crawl

```bash
curl -X DELETE http://localhost:3002/v1/crawl/crawl-job-id
```

#### GET /v1/crawl/:jobId/errors - Get crawl errors

```bash
curl http://localhost:3002/v1/crawl/crawl-job-id/errors
```

#### GET /v1/crawl/active - List active crawls

```bash
curl http://localhost:3002/v1/crawl/active
```

### Map API

#### POST /v1/map - Get all links from a URL

```bash
curl -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "links": [
    "https://example.com/page1",
    "https://example.com/page2",
    "https://example.com/about"
  ]
}
```

### Search API

#### POST /v1/search - Search and scrape results

```bash
curl -X POST http://localhost:3002/v1/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "firecrawl web scraping",
    "limit": 5
  }'
```

**Note:** Requires search provider configuration (e.g., `SEARXNG_ENDPOINT`).

### Extract API (LLM-powered)

#### POST /v1/extract - Extract structured data

```bash
curl -X POST http://localhost:3002/v1/extract \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com"],
    "prompt": "Extract the main heading and description",
    "schema": {
      "type": "object",
      "properties": {
        "heading": {"type": "string"},
        "description": {"type": "string"}
      }
    }
  }'
```

**Note:** Requires `OPENAI_API_KEY` in `.env`.

#### GET /v1/extract/:jobId - Get extract status

```bash
curl http://localhost:3002/v1/extract/extract-job-id
```

### LLMs.txt Generation

#### POST /v1/llmstxt - Generate LLMs.txt

```bash
curl -X POST http://localhost:3002/v1/llmstxt \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com"
  }'
```

#### GET /v1/llmstxt/:jobId - Get generation status

```bash
curl http://localhost:3002/v1/llmstxt/llmstxt-job-id
```

### Deep Research (v1)

#### POST /v1/deep-research - Start deep research

```bash
curl -X POST http://localhost:3002/v1/deep-research \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What is web scraping?",
    "maxDepth": 3
  }'
```

#### GET /v1/deep-research/:jobId - Get research status

```bash
curl http://localhost:3002/v1/deep-research/research-job-id
```

### Agent API (v2 only)

#### POST /v2/agent - Start an agent task

```bash
curl -X POST http://localhost:3002/v2/agent \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "prompt": "Find all product prices on this page"
  }'
```

#### GET /v2/agent/:jobId - Get agent status

```bash
curl http://localhost:3002/v2/agent/agent-job-id
```

#### DELETE /v2/agent/:jobId - Cancel agent

```bash
curl -X DELETE http://localhost:3002/v2/agent/agent-job-id
```

### Team/Account APIs

#### GET /v1/team/credit-usage - Get credit usage

```bash
curl http://localhost:3002/v1/team/credit-usage
```

#### GET /v1/team/queue-status - Get queue status

```bash
curl http://localhost:3002/v1/team/queue-status
```

#### GET /v1/concurrency-check - Check concurrency limits

```bash
curl http://localhost:3002/v1/concurrency-check
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Supabase client is not configured" | Normal warning - ignore it |
| "You're bypassing authentication" | Normal for self-hosted mode |
| Redis connection refused | Ensure `redis-server` is running |
| PostgreSQL connection error | Check `NUQ_DATABASE_URL` and database exists |
| pnpm lockfile incompatible | Upgrade pnpm: `npm install -g pnpm@latest` |
| TypeScript build errors | Clean reinstall: `rm -rf node_modules && pnpm install` |
| RabbitMQ `noproc` error | Delete corrupted queues (see RabbitMQ section) |
| RabbitMQ connection to `rabbitmq:5672` | Set `NUQ_RABBITMQ_URL=amqp://localhost:5672` in `.env` |

### Useful Commands

```bash
# Check Redis
redis-cli ping

# Check PostgreSQL
psql -d firecrawl -c "SELECT 1;"

# View queue status
psql -d firecrawl -c "SELECT status, COUNT(*) FROM nuq.queue_scrape GROUP BY status;"

# Check pnpm version
pnpm --version  # Should be 9+

# Check RabbitMQ
rabbitmqctl status

# List RabbitMQ queues
rabbitmqctl list_queues name type messages

# Fix corrupted RabbitMQ queues
rabbitmqctl list_queues name | tail -n +2 | xargs -I {} rabbitmqctl delete_queue {}

# Restart RabbitMQ
brew services restart rabbitmq
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Firecrawl API                                │
│                      (localhost:3002)                                │
└─────────────────────────────────────────────────────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│      Redis      │     │   PostgreSQL    │     │  Playwright Service │
│ (localhost:6379)│     │ (localhost:5432)│     │  (localhost:3000)   │
│                 │     │                 │     │                     │
│ - BullMQ queues │     │ - NuQ job queue │     │  - JS rendering     │
│ - Rate limiting │     │ - Job results   │     │  - Browser pool     │
│ - Caching       │     │ - Crawl state   │     │                     │
└─────────────────┘     └─────────────────┘     └─────────────────────┘
                                   │
                                   ▼
                        ┌─────────────────┐
                        │    RabbitMQ     │
                        │ (localhost:5672)│
                        │                 │
                        │ - Prefetch cache│
                        │ - Fast job dist │
                        │ - (Optional)    │
                        └─────────────────┘
```

### Data Flow

```
1. Job Created → PostgreSQL (source of truth)
2. Prefetch Worker → Copies jobs to RabbitMQ (15s TTL)
3. NuQ Workers → Get jobs from RabbitMQ (fast) or PostgreSQL (fallback)
4. Job Completed → Updated in PostgreSQL
```

---

*Generated from local development Q&A session*


