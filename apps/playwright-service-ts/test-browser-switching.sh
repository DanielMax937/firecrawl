#!/bin/bash

# Browser Switching Test Script for playwright-service-ts
# Tests headless and browser_engine parameter switching

BASE_URL="${1:-http://localhost:3003}"
PASS=0
FAIL=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASS++))
}

log_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAIL++))
}

log_info() {
    echo -e "${YELLOW}→${NC} $1"
}

check_status() {
    local response="$1"
    local expected="$2"
    local test_name="$3"

    local status=$(echo "$response" | jq -r '.pageStatusCode // .status // "null"')
    if [ "$status" == "$expected" ] || [ "$status" == "200" ]; then
        log_pass "$test_name"
        return 0
    else
        log_fail "$test_name (got: $status, expected: $expected)"
        return 1
    fi
}

echo "========================================"
echo "Browser Switching Test Suite"
echo "Base URL: $BASE_URL"
echo "========================================"
echo ""

# Test 1: Health Check
echo "=== Test 1: Initial Health Check ==="
HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
    log_pass "Health check - service is healthy"
    echo "$HEALTH" | jq '.engines, .defaults'
else
    log_fail "Health check - service not healthy"
    echo "$HEALTH"
fi
echo ""

# Test 2: Default scrape (no overrides)
echo "=== Test 2: Default Scrape (no overrides) ==="
log_info "Scraping with default settings..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}')
check_status "$RESPONSE" "200" "Default scrape"
echo ""

# Test 3: Playwright + headless=false
echo "=== Test 3: Playwright + headless=false ==="
log_info "Switching to visible browser mode..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "playwright", "headless": false}')
check_status "$RESPONSE" "200" "Playwright non-headless"

# Verify health shows headless: false
HEALTH=$(curl -s "$BASE_URL/health")
PW_HEADLESS=$(echo "$HEALTH" | jq -r '.engines.playwright.headless // "null"')
if [ "$PW_HEADLESS" == "false" ]; then
    log_pass "Health shows playwright headless=false"
else
    log_fail "Health shows playwright headless=$PW_HEADLESS (expected: false)"
fi
echo ""

# Test 4: Playwright + headless=true (switch back)
echo "=== Test 4: Playwright + headless=true (switch back) ==="
log_info "Switching back to headless mode..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "playwright", "headless": true}')
check_status "$RESPONSE" "200" "Playwright headless"

# Verify health shows headless: true
HEALTH=$(curl -s "$BASE_URL/health")
PW_HEADLESS=$(echo "$HEALTH" | jq -r '.engines.playwright.headless // "null"')
if [ "$PW_HEADLESS" == "true" ]; then
    log_pass "Health shows playwright headless=true"
else
    log_fail "Health shows playwright headless=$PW_HEADLESS (expected: true)"
fi
echo ""

# Test 5: Patchright + headless=true
echo "=== Test 5: Patchright + headless=true ==="
log_info "Launching system Chrome (patchright) in headless mode..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "patchright", "headless": true}')
check_status "$RESPONSE" "200" "Patchright headless"

# Verify both engines are running
HEALTH=$(curl -s "$BASE_URL/health")
PW_STATUS=$(echo "$HEALTH" | jq -r '.engines.playwright.status // "stopped"')
PR_STATUS=$(echo "$HEALTH" | jq -r '.engines.patchright.status // "stopped"')
if [ "$PW_STATUS" == "running" ] && [ "$PR_STATUS" == "running" ]; then
    log_pass "Both engines running simultaneously"
else
    log_fail "Expected both engines running (playwright: $PW_STATUS, patchright: $PR_STATUS)"
fi
echo ""

# Test 6: Patchright + headless=false (switch)
echo "=== Test 6: Patchright + headless=false ==="
log_info "Switching patchright to visible mode..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "patchright", "headless": false}')
check_status "$RESPONSE" "200" "Patchright non-headless"

# Verify health shows patchright headless: false
HEALTH=$(curl -s "$BASE_URL/health")
PR_HEADLESS=$(echo "$HEALTH" | jq -r '.engines.patchright.headless // "null"')
if [ "$PR_HEADLESS" == "false" ]; then
    log_pass "Health shows patchright headless=false"
else
    log_fail "Health shows patchright headless=$PR_HEADLESS (expected: false)"
fi
echo ""

# Test 7: Mixed - different headless modes for each engine
echo "=== Test 7: Mixed headless modes ==="
log_info "Setting playwright=headless, patchright=visible..."

# Set playwright to headless
curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "playwright", "headless": true}' > /dev/null

# Set patchright to non-headless
curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "patchright", "headless": false}' > /dev/null

HEALTH=$(curl -s "$BASE_URL/health")
PW_HEADLESS=$(echo "$HEALTH" | jq -r '.engines.playwright.headless // "null"')
PR_HEADLESS=$(echo "$HEALTH" | jq -r '.engines.patchright.headless // "null"')

if [ "$PW_HEADLESS" == "true" ] && [ "$PR_HEADLESS" == "false" ]; then
    log_pass "Mixed headless modes work (playwright=true, patchright=false)"
else
    log_fail "Mixed modes failed (playwright=$PW_HEADLESS, patchright=$PR_HEADLESS)"
fi
echo ""

# Test 8: Screenshot with engine switching
echo "=== Test 8: Screenshot with different engines ==="
log_info "Taking screenshot with playwright..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "playwright", "headless": true, "screenshot": true}')
SCREENSHOT_LEN=$(echo "$RESPONSE" | jq -r '.screenshot | length // 0')
if [ "$SCREENSHOT_LEN" -gt 1000 ]; then
    log_pass "Playwright screenshot works (length: $SCREENSHOT_LEN)"
else
    log_fail "Playwright screenshot failed (length: $SCREENSHOT_LEN)"
fi

log_info "Taking screenshot with patchright..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "browser_engine": "patchright", "headless": true, "screenshot": true}')
SCREENSHOT_LEN=$(echo "$RESPONSE" | jq -r '.screenshot | length // 0')
if [ "$SCREENSHOT_LEN" -gt 1000 ]; then
    log_pass "Patchright screenshot works (length: $SCREENSHOT_LEN)"
else
    log_fail "Patchright screenshot failed (length: $SCREENSHOT_LEN)"
fi
echo ""

# Test 9: Actions with engine switching
echo "=== Test 9: Actions with different engines ==="
log_info "Executing actions with playwright..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "wait", "milliseconds": 500},
      {"type": "screenshot"}
    ]
  }')
ACTIONS_SCREENSHOTS=$(echo "$RESPONSE" | jq -r '.actions.screenshots | length // 0')
if [ "$ACTIONS_SCREENSHOTS" -gt 0 ]; then
    log_pass "Playwright actions work (screenshots: $ACTIONS_SCREENSHOTS)"
else
    log_fail "Playwright actions failed"
fi

log_info "Executing actions with patchright..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "patchright",
    "headless": true,
    "actions": [
      {"type": "wait", "milliseconds": 500},
      {"type": "screenshot"}
    ]
  }')
ACTIONS_SCREENSHOTS=$(echo "$RESPONSE" | jq -r '.actions.screenshots | length // 0')
if [ "$ACTIONS_SCREENSHOTS" -gt 0 ]; then
    log_pass "Patchright actions work (screenshots: $ACTIONS_SCREENSHOTS)"
else
    log_fail "Patchright actions failed"
fi
echo ""

# Test 10: Rapid switching (same engine, different headless)
echo "=== Test 10: Rapid headless switching ==="
log_info "Rapidly switching headless mode..."
for i in {1..4}; do
    HEADLESS=$([[ $((i % 2)) -eq 0 ]] && echo "true" || echo "false")
    RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
      -H 'Content-Type: application/json' \
      -d "{\"url\": \"https://example.com\", \"headless\": $HEADLESS}")
    STATUS=$(echo "$RESPONSE" | jq -r '.pageStatusCode // "error"')
    if [ "$STATUS" == "200" ]; then
        log_pass "Rapid switch $i (headless=$HEADLESS)"
    else
        log_fail "Rapid switch $i (headless=$HEADLESS) - status: $STATUS"
    fi
done
echo ""

# Test 11: Recording mode - rrweb (lightweight, works with both engines)
echo "=== Test 11: Recording mode - rrweb ==="
log_info "Testing rrweb recording with playwright..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "rrweb"},
      {"type": "wait", "milliseconds": 1500},
      {"type": "scroll", "direction": "down"}
    ]
  }')
RECORDINGS_LEN=$(echo "$RESPONSE" | jq -r '.actions.recordings[0] | length // 0')
if [ "$RECORDINGS_LEN" -gt 100 ]; then
    log_pass "rrweb recording works (base64 length: $RECORDINGS_LEN)"
else
    log_fail "rrweb recording failed (base64 length: $RECORDINGS_LEN)"
fi
echo ""

# Test 12: Recording mode - trace
echo "=== Test 12: Recording mode - trace ==="
log_info "Testing trace recording..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "trace", "screenshots": true, "snapshots": true},
      {"type": "wait", "milliseconds": 1000},
      {"type": "scroll", "direction": "down"}
    ]
  }')
RECORDINGS_LEN=$(echo "$RESPONSE" | jq -r '.actions.recordings[0] | length // 0')
if [ "$RECORDINGS_LEN" -gt 1000 ]; then
    log_pass "Trace recording works (base64 length: $RECORDINGS_LEN)"
else
    log_fail "Trace recording failed (base64 length: $RECORDINGS_LEN)"
fi
echo ""

# Test 13: Recording mode - video (only works with playwright, not patchright)
echo "=== Test 13: Recording mode - video ==="
log_info "Testing video recording with playwright..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "video", "width": 1280, "height": 720},
      {"type": "wait", "milliseconds": 1500},
      {"type": "scroll", "direction": "down"}
    ]
  }')
RECORDINGS_LEN=$(echo "$RESPONSE" | jq -r '.actions.recordings[0] | length // 0')
if [ "$RECORDINGS_LEN" -gt 1000 ]; then
    log_pass "Video recording works (base64 length: $RECORDINGS_LEN)"
else
    log_fail "Video recording failed (base64 length: $RECORDINGS_LEN)"
fi
echo ""

# Test 14: Recording with other actions
echo "=== Test 14: Recording with other actions ==="
log_info "Testing recording combined with screenshot and scrape..."
RESPONSE=$(curl -s -X POST "$BASE_URL/scrape" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "browser_engine": "playwright",
    "headless": true,
    "actions": [
      {"type": "record", "mode": "rrweb"},
      {"type": "wait", "milliseconds": 1000},
      {"type": "screenshot"},
      {"type": "scrape"},
      {"type": "executeJavascript", "script": "document.title"}
    ]
  }')
RECORDINGS_LEN=$(echo "$RESPONSE" | jq -r '.actions.recordings[0] | length // 0')
SCREENSHOTS_COUNT=$(echo "$RESPONSE" | jq -r '.actions.screenshots | length // 0')
SCRAPES_COUNT=$(echo "$RESPONSE" | jq -r '.actions.scrapes | length // 0')
JS_COUNT=$(echo "$RESPONSE" | jq -r '.actions.javascriptReturns | length // 0')

if [ "$RECORDINGS_LEN" -gt 100 ] && [ "$SCREENSHOTS_COUNT" -gt 0 ] && [ "$SCRAPES_COUNT" -gt 0 ] && [ "$JS_COUNT" -gt 0 ]; then
    log_pass "Recording with other actions works (recordings: $RECORDINGS_LEN, screenshots: $SCREENSHOTS_COUNT, scrapes: $SCRAPES_COUNT, js: $JS_COUNT)"
else
    log_fail "Recording with other actions failed"
fi
echo ""

# Final health check
echo "=== Final Health Check ==="
curl -s "$BASE_URL/health" | jq
echo ""

# Summary
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
TOTAL=$((PASS + FAIL))
echo "Total: $TOTAL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
