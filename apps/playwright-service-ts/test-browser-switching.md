# Browser Switching Test Cases

Test cases for verifying `headless` and `browser_engine` parameter switching in playwright-service-ts.

## Prerequisites

```bash
# Start the service with default settings
cd apps/playwright-service-ts
pnpm dev
```

Base URL: `http://localhost:3003`

---

## Test Case 1: Default Behavior - No Parameters

**Purpose:** Verify service uses environment defaults when no parameters provided

### Request 1.1: Health check
```bash
curl http://localhost:3003/health
```

**Request Parameters:** None

**Expected Response:**
```json
{
  "status": "healthy",
  "engines": {
    "playwright": { "status": "running", "headless": true },
    "patchright": { "status": "stopped" }
  },
  "defaults": {
    "engine": "playwright",
    "headless": true
  },
  "maxConcurrentPages": 10,
  "activePages": 0
}
```

### Request 1.2: Simple scrape with no overrides
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com"
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | (not set) | uses env default |
| headless | (not set) | uses env default |

**Expected Console Log:**
```
Browser Engine: playwright (from env)
Headless: true (from env)
```

---

## Test Case 2: Playwright with headless=false

**Purpose:** Verify switching to visible browser mode triggers restart

### Request 2.1: Switch to non-headless
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": false
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | false | request |

**Expected Console Log:**
```
Playwright headless mode changed from true to false, restarting browser...
Launching bundled Chromium with headless: false
Browser Engine: playwright (from request)
Headless: false (from request)
```

### Request 2.2: Verify health after switch
```bash
curl http://localhost:3003/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "engines": {
    "playwright": { "status": "running", "headless": false },
    "patchright": { "status": "stopped" }
  }
}
```

---

## Test Case 3: Playwright Switch Back to headless=true

**Purpose:** Verify switching back to headless mode works

### Request 3.1: Switch back to headless
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |

**Expected Console Log:**
```
Playwright headless mode changed from false to true, restarting browser...
Launching bundled Chromium with headless: true
Browser Engine: playwright (from request)
Headless: true (from request)
```

---

## Test Case 4: Switch to Patchright Engine

**Purpose:** Verify engine switching launches system Chrome

### Request 4.1: First request with playwright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |

### Request 4.2: Switch to patchright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | true | request |

**Expected Console Log:**
```
Launching system Chrome with patchright (headless: true)
Browser profile ID: 1
Browser Engine: patchright (from request)
Headless: true (from request)
```

### Request 4.3: Verify both engines running
```bash
curl http://localhost:3003/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "engines": {
    "playwright": { "status": "running", "headless": true },
    "patchright": { "status": "running", "headless": true }
  }
}
```

---

## Test Case 5: Mixed - Non-Headless Patchright, Then Headless Playwright

**Purpose:** Verify both engines can run with different headless modes

### Request 5.1: Patchright with headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": false
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | false | request |

**Expected Console Log:**
```
Launching system Chrome with patchright (headless: false)
Browser Engine: patchright (from request)
Headless: false (from request)
```

### Request 5.2: Playwright with headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |

### Request 5.3: Verify mixed state
```bash
curl http://localhost:3003/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "engines": {
    "playwright": { "status": "running", "headless": true },
    "patchright": { "status": "running", "headless": false }
  }
}
```

---

## Test Case 6: Rapid Headless Switching (Same Engine)

**Purpose:** Verify rapid mode changes work correctly

### Request 6.1: headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |

### Request 6.2: headless=false (triggers restart)
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": false
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | false | request |

**Expected:** Browser restarts

### Request 6.3: headless=true (triggers restart)
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |

**Expected:** Browser restarts

### Request 6.4: headless=true (NO restart - same mode)
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |

**Expected:** No restart message (reuses existing browser)

---

## Test Case 7: Patchright Headless Mode Switching

**Purpose:** Verify patchright handles headless switching

### Request 7.1: Patchright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | true | request |

### Request 7.2: Patchright headless=false (triggers restart)
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": false
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | false | request |

**Expected Console Log:**
```
Patchright headless mode changed from true to false, restarting browser...
Launching system Chrome with patchright (headless: false)
```

---

## Test Case 8: Screenshot with Engine/Headless Switching

**Purpose:** Verify screenshots work after switching

### Request 8.1: Screenshot with playwright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "screenshot": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| screenshot | true | request |

**Expected Response:** Contains `screenshot` field with base64 string

### Request 8.2: Screenshot with playwright headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": false,
    "screenshot": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | false | request |
| screenshot | true | request |

### Request 8.3: Screenshot with patchright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true,
    "screenshot": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | true | request |
| screenshot | true | request |

### Request 8.4: Full page screenshot with patchright headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": false,
    "full_page_screenshot": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | false | request |
| full_page_screenshot | true | request |

---

## Test Case 9: Actions with Engine/Headless Switching

**Purpose:** Verify actions work after switching

### Request 9.1: Actions with playwright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "wait", "milliseconds": 500},
      {"type": "screenshot", "fullPage": false},
      {"type": "scroll", "direction": "down"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [wait, screenshot, scroll] | request |

**Expected Response:**
```json
{
  "content": "...",
  "pageStatusCode": 200,
  "actions": {
    "screenshots": ["base64..."],
    "scrapes": [],
    "javascriptReturns": [],
    "pdfs": []
  }
}
```

### Request 9.2: Actions with patchright headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": false,
    "actions": [
      {"type": "wait", "milliseconds": 1000},
      {"type": "click", "selector": "a"},
      {"type": "screenshot", "fullPage": true},
      {"type": "scrape"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | false | request |
| actions | [wait, click, screenshot, scrape] | request |

### Request 9.3: JavaScript execution with playwright headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": false,
    "actions": [
      {"type": "executeJavascript", "script": "document.title"},
      {"type": "executeJavascript", "script": "window.location.href"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | false | request |
| actions | [executeJavascript x2] | request |

**Expected Response:**
```json
{
  "actions": {
    "javascriptReturns": [
      {"type": "string", "value": "Example Domain"},
      {"type": "string", "value": "https://example.com/"}
    ]
  }
}
```

---

## Test Case 10: PDF Generation with Switching

**Purpose:** Verify PDF generation works after switching

### Request 10.1: PDF with playwright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "pdf", "format": "A4", "landscape": false}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [pdf] | request |

**Expected Response:**
```json
{
  "actions": {
    "pdfs": ["base64..."]
  }
}
```

### Request 10.2: PDF with patchright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true,
    "actions": [
      {"type": "pdf", "format": "Letter", "landscape": true, "scale": 0.8}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | true | request |
| actions | [pdf with options] | request |

---

## Test Case 11: All Parameters Combined

**Purpose:** Verify all parameters work together

### Request 11.1: Full parameter request with playwright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": false,
    "wait_after_load": 2000,
    "timeout": 30000,
    "headers": {"User-Agent": "TestBot/1.0"},
    "skip_tls_verification": false,
    "screenshot": true,
    "actions": [
      {"type": "wait", "milliseconds": 500},
      {"type": "scroll", "direction": "down"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | false | request |
| wait_after_load | 2000 | request |
| timeout | 30000 | request |
| headers | {"User-Agent": "TestBot/1.0"} | request |
| skip_tls_verification | false | request |
| screenshot | true | request |
| actions | [wait, scroll] | request |

### Request 11.2: Full parameter request with patchright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true,
    "wait_after_load": 1000,
    "timeout": 20000,
    "headers": {"Accept-Language": "en-US"},
    "skip_tls_verification": true,
    "full_page_screenshot": true,
    "actions": [
      {"type": "wait", "selector": "body"},
      {"type": "screenshot"},
      {"type": "scrape"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | true | request |
| wait_after_load | 1000 | request |
| timeout | 20000 | request |
| headers | {"Accept-Language": "en-US"} | request |
| skip_tls_verification | true | request |
| full_page_screenshot | true | request |
| actions | [wait, screenshot, scrape] | request |

---

## Test Case 12: Only headless Override (No engine)

**Purpose:** Verify headless can be overridden without specifying engine

### Request 12.1: Only headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "headless": false
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | (not set) | uses env default |
| headless | false | request |

**Expected Console Log:**
```
Browser Engine: playwright (from env)
Headless: false (from request)
```

### Request 12.2: Only headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | (not set) | uses env default |
| headless | true | request |

---

## Test Case 13: Only engine Override (No headless)

**Purpose:** Verify engine can be overridden without specifying headless

### Request 13.1: Only browser_engine=patchright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright"
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | (not set) | uses env default |

**Expected Console Log:**
```
Browser Engine: patchright (from request)
Headless: true (from env)
```

### Request 13.2: Only browser_engine=playwright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright"
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | (not set) | uses env default |

---

## Test Case 14: Concurrent Requests with Different Settings

**Purpose:** Verify concurrent requests don't cause race conditions

### Request 14.1: Run in parallel
```bash
# Run all these in parallel (use & in bash)
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true
  }' &

curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://httpbin.org/html",
    "browser_engine": "patchright",
    "headless": false
  }' &

curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.org",
    "browser_engine": "playwright",
    "headless": true
  }' &

wait
```

**Request Parameters (Request 1):**
| Parameter | Value |
|-----------|-------|
| url | "https://example.com" |
| browser_engine | "playwright" |
| headless | true |

**Request Parameters (Request 2):**
| Parameter | Value |
|-----------|-------|
| url | "https://httpbin.org/html" |
| browser_engine | "patchright" |
| headless | false |

**Request Parameters (Request 3):**
| Parameter | Value |
|-----------|-------|
| url | "https://example.org" |
| browser_engine | "playwright" |
| headless | true |

**Expected:** All requests complete successfully without errors

---

## Test Case 15: Recording Mode - Video

**Purpose:** Verify video recording captures browser session as .webm file

### Request 15.1: Video recording with playwright
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "video", "width": 1280, "height": 720},
      {"type": "wait", "milliseconds": 1000},
      {"type": "scroll", "direction": "down"},
      {"type": "screenshot"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [record(video), wait, scroll, screenshot] | request |

**Expected Response:**
```json
{
  "content": "...",
  "pageStatusCode": 200,
  "actions": {
    "screenshots": ["base64..."],
    "scrapes": [],
    "javascriptReturns": [],
    "pdfs": [],
    "recordings": ["base64-webm-video..."]
  }
}
```

**Expected Console Log:**
```
🎬 Video recording enabled (1280x720)
🎬 Video saved: /path/to/videos/video-timestamp.webm
🎬 Video converted to base64 (... chars)
```

**Note:** Video recording only works with `playwright` engine (not patchright persistent context).

### Request 15.2: Video recording with default dimensions
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "video"},
      {"type": "wait", "milliseconds": 500}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [record(video, default size), wait] | request |

**Expected:** Video recorded at default 1280x720 resolution

---

## Test Case 16: Recording Mode - Trace

**Purpose:** Verify trace recording captures DOM snapshots, network, and console logs

### Request 16.1: Trace recording with screenshots and snapshots
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "trace", "screenshots": true, "snapshots": true},
      {"type": "wait", "milliseconds": 1000},
      {"type": "click", "selector": "a"},
      {"type": "scroll", "direction": "down"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [record(trace), wait, click, scroll] | request |

**Expected Response:**
```json
{
  "content": "...",
  "pageStatusCode": 200,
  "actions": {
    "screenshots": [],
    "scrapes": [],
    "javascriptReturns": [],
    "pdfs": [],
    "recordings": ["base64-zip-trace..."]
  }
}
```

**Expected Console Log:**
```
📊 Tracing started (screenshots: true, snapshots: true)
📊 Trace saved: /path/to/traces/trace-timestamp.zip
📊 Trace converted to base64 (... chars)
```

**Viewing the trace:**
```bash
# Decode and save the trace
echo "base64-content" | base64 -d > trace.zip

# View in Playwright Trace Viewer
npx playwright show-trace trace.zip
```

### Request 16.2: Trace recording without screenshots
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "trace", "screenshots": false, "snapshots": true},
      {"type": "wait", "milliseconds": 500}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [record(trace, no screenshots), wait] | request |

**Expected:** Smaller trace file without screenshot data

---

## Test Case 17: Recording Mode - rrweb

**Purpose:** Verify rrweb recording captures DOM mutations as JSON events

### Request 17.1: rrweb recording
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "rrweb"},
      {"type": "wait", "milliseconds": 2000},
      {"type": "scroll", "direction": "down"},
      {"type": "scroll", "direction": "up"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [record(rrweb), wait, scroll x2] | request |

**Expected Response:**
```json
{
  "content": "...",
  "pageStatusCode": 200,
  "actions": {
    "screenshots": [],
    "scrapes": [],
    "javascriptReturns": [],
    "pdfs": [],
    "recordings": ["base64-json-events..."]
  }
}
```

**Expected Console Log:**
```
🎥 rrweb script injection prepared
🎥 rrweb events collected: N events (... chars base64)
```

**Decoding rrweb events:**
```bash
# Decode the base64 JSON
echo "base64-content" | base64 -d > events.json

# The JSON contains an array of rrweb events that can be replayed
# using rrweb-player library
```

### Request 17.2: rrweb with patchright engine
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "rrweb"},
      {"type": "wait", "milliseconds": 1500}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "patchright" | request |
| headless | true | request |
| actions | [record(rrweb), wait] | request |

**Expected:** rrweb works with both engines (unlike video mode)

---

## Test Case 18: Recording Mode Comparison

**Purpose:** Compare output sizes and use cases for each recording mode

### Request 18.1: Same page with video mode
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://news.ycombinator.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "video"},
      {"type": "wait", "milliseconds": 2000},
      {"type": "scroll", "direction": "down"}
    ]
  }'
```

### Request 18.2: Same page with trace mode
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://news.ycombinator.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "trace"},
      {"type": "wait", "milliseconds": 2000},
      {"type": "scroll", "direction": "down"}
    ]
  }'
```

### Request 18.3: Same page with rrweb mode
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://news.ycombinator.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "rrweb"},
      {"type": "wait", "milliseconds": 2000},
      {"type": "scroll", "direction": "down"}
    ]
  }'
```

**Comparison:**
| Mode | Output Format | Typical Size | Best For |
|------|---------------|--------------|----------|
| video | .webm (base64) | Large (MBs) | Visual debugging, demos |
| trace | .zip (base64) | Medium (100s KB) | Debugging with network/console |
| rrweb | JSON (base64) | Small (10s KB) | Lightweight replay, storage |

---

## Test Case 19: Recording with Other Actions

**Purpose:** Verify recording works alongside other actions

### Request 19.1: Recording + screenshot + scrape
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "rrweb"},
      {"type": "wait", "milliseconds": 1000},
      {"type": "screenshot", "fullPage": true},
      {"type": "scroll", "direction": "down"},
      {"type": "scrape"},
      {"type": "executeJavascript", "script": "document.title"}
    ]
  }'
```

**Request Parameters:**
| Parameter | Value | Source |
|-----------|-------|--------|
| url | "https://example.com" | request |
| browser_engine | "playwright" | request |
| headless | true | request |
| actions | [record, wait, screenshot, scroll, scrape, js] | request |

**Expected Response:**
```json
{
  "actions": {
    "screenshots": ["base64-screenshot..."],
    "scrapes": [{"url": "...", "html": "..."}],
    "javascriptReturns": [{"type": "string", "value": "Example Domain"}],
    "pdfs": [],
    "recordings": ["base64-rrweb-events..."]
  }
}
```

---

## Test Case 20: Error Handling - Invalid URL with Different Settings

**Purpose:** Verify error handling works with different engine/headless combinations

### Request 20.1: Invalid URL with playwright headless=true
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "not-a-valid-url",
    "browser_engine": "playwright",
    "headless": true
  }'
```

**Request Parameters:**
| Parameter | Value |
|-----------|-------|
| url | "not-a-valid-url" |
| browser_engine | "playwright" |
| headless | true |

**Expected Response:**
```json
{
  "error": "Invalid URL"
}
```

### Request 20.2: Invalid URL with patchright headless=false
```bash
curl -X POST http://localhost:3003/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "invalid",
    "browser_engine": "patchright",
    "headless": false
  }'
```

**Request Parameters:**
| Parameter | Value |
|-----------|-------|
| url | "invalid" |
| browser_engine | "patchright" |
| headless | false |

**Expected Response:**
```json
{
  "error": "Invalid URL"
}
```

---

## Summary Table: All Test Requests

| Test | URL | browser_engine | headless | Other Params |
|------|-----|----------------|----------|--------------|
| 1.1 | - | - | - | Health check |
| 1.2 | example.com | (default) | (default) | - |
| 2.1 | example.com | playwright | false | - |
| 3.1 | example.com | playwright | true | - |
| 4.1 | example.com | playwright | true | - |
| 4.2 | example.com | patchright | true | - |
| 5.1 | example.com | patchright | false | - |
| 5.2 | example.com | playwright | true | - |
| 6.1-6.4 | example.com | playwright | true/false/true/true | Rapid switch |
| 7.1 | example.com | patchright | true | - |
| 7.2 | example.com | patchright | false | - |
| 8.1 | example.com | playwright | true | screenshot=true |
| 8.2 | example.com | playwright | false | screenshot=true |
| 8.3 | example.com | patchright | true | screenshot=true |
| 8.4 | example.com | patchright | false | full_page_screenshot=true |
| 9.1 | example.com | playwright | true | actions=[wait,screenshot,scroll] |
| 9.2 | example.com | patchright | false | actions=[wait,click,screenshot,scrape] |
| 9.3 | example.com | playwright | false | actions=[executeJavascript x2] |
| 10.1 | example.com | playwright | true | actions=[pdf] |
| 10.2 | example.com | patchright | true | actions=[pdf with options] |
| 11.1 | example.com | playwright | false | All params |
| 11.2 | example.com | patchright | true | All params |
| 12.1 | example.com | (default) | false | - |
| 12.2 | example.com | (default) | true | - |
| 13.1 | example.com | patchright | (default) | - |
| 13.2 | example.com | playwright | (default) | - |
| 14.1 | multiple | mixed | mixed | Concurrent |
| 15.1 | example.com | playwright | true | record(video) |
| 15.2 | example.com | playwright | true | record(video, default) |
| 16.1 | example.com | playwright | true | record(trace) |
| 16.2 | example.com | playwright | true | record(trace, no screenshots) |
| 17.1 | example.com | playwright | true | record(rrweb) |
| 17.2 | example.com | patchright | true | record(rrweb) |
| 18.1-18.3 | news.ycombinator.com | playwright | true | record mode comparison |
| 19.1 | example.com | playwright | true | record + screenshot + scrape |
| 20.1 | invalid | playwright | true | Error test |
| 20.2 | invalid | patchright | false | Error test |
