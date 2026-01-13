"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const playwright_1 = require("playwright");
const patchright_1 = require("patchright");
const dotenv_1 = __importDefault(require("dotenv"));
const user_agents_1 = __importDefault(require("user-agents"));
const get_error_1 = require("./helpers/get_error");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3003;
app.use(body_parser_1.default.json());
const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const MAX_CONCURRENT_PAGES = Math.max(1, Number.parseInt((_a = process.env.MAX_CONCURRENT_PAGES) !== null && _a !== void 0 ? _a : '10', 10) || 10);
const HEADLESS = (process.env.HEADLESS || 'true').toLowerCase() !== 'false';
// Use system Chrome with patchright instead of bundled Chromium
const USE_SYSTEM_CHROME = (process.env.USE_SYSTEM_CHROME || 'false').toLowerCase() === 'true';
// Browser profile ID for persistent context (only used with USE_SYSTEM_CHROME)
const BROWSER_PROFILE_ID = process.env.BROWSER_PROFILE_ID || '1';
// Browser profiles directory
const BROWSER_PROFILES_DIR = path.resolve(__dirname, '../../browser-profiles');
// Screenshots folder in project root
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../screenshots');
// Videos folder in project root
const VIDEOS_DIR = path.resolve(__dirname, '../../videos');
// Traces folder in project root
const TRACES_DIR = path.resolve(__dirname, '../../traces');
// Recordings folder in project root (for rrweb JSON files)
const RECORDINGS_DIR = path.resolve(__dirname, '../../recordings');
// Load rrweb script for inline injection (bundled locally to avoid CDN issues)
const RRWEB_SCRIPT_PATH = path.resolve(__dirname, './rrweb.min.js');
let RRWEB_SCRIPT = '';
try {
    RRWEB_SCRIPT = fs.readFileSync(RRWEB_SCRIPT_PATH, 'utf-8');
    console.log(`Loaded rrweb script (${RRWEB_SCRIPT.length} chars)`);
}
catch (e) {
    console.warn(`Warning: Could not load rrweb script from ${RRWEB_SCRIPT_PATH}`);
}
const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;
class Semaphore {
    constructor(permits) {
        this.queue = [];
        this.permits = permits;
    }
    acquire() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.permits > 0) {
                this.permits--;
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                this.queue.push(resolve);
            });
        });
    }
    release() {
        this.permits++;
        if (this.queue.length > 0) {
            const nextResolve = this.queue.shift();
            if (nextResolve) {
                this.permits--;
                nextResolve();
            }
        }
    }
    getAvailablePermits() {
        return this.permits;
    }
    getQueueLength() {
        return this.queue.length;
    }
}
const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);
const AD_SERVING_DOMAINS = [
    'doubleclick.net',
    'adservice.google.com',
    'googlesyndication.com',
    'googletagservices.com',
    'googletagmanager.com',
    'google-analytics.com',
    'adsystem.com',
    'adservice.com',
    'adnxs.com',
    'ads-twitter.com',
    'facebook.net',
    'fbcdn.net',
    'amazon-adsystem.com'
];
// Browser instances - both can run simultaneously
let playwrightBrowser = null;
// Use 'any' type for persistentContext to avoid type conflicts between patchright and playwright
let patchrightContext = null;
// Track current headless state for each browser (to detect when restart is needed)
let playwrightHeadless = null;
let patchrightHeadless = null;
// Determine which engine to use based on request parameter or env
const getEffectiveEngine = (requestEngine) => {
    if (requestEngine) {
        return requestEngine;
    }
    return USE_SYSTEM_CHROME ? "patchright" : "playwright";
};
// Determine headless mode based on request parameter or env
const getEffectiveHeadless = (requestHeadless) => {
    if (requestHeadless !== undefined) {
        return requestHeadless;
    }
    return HEADLESS;
};
// Initialize playwright browser (bundled Chromium)
const initializePlaywrightBrowser = (headless) => __awaiter(void 0, void 0, void 0, function* () {
    // If browser exists but headless mode changed, close it first
    if (playwrightBrowser && playwrightHeadless !== headless) {
        console.log(`Playwright headless mode changed from ${playwrightHeadless} to ${headless}, restarting browser...`);
        try {
            yield playwrightBrowser.close();
        }
        catch (e) {
            // Browser may already be closed
        }
        playwrightBrowser = null;
    }
    if (playwrightBrowser)
        return;
    console.log(`Launching bundled Chromium with headless: ${headless}`);
    playwrightBrowser = yield playwright_1.chromium.launch({
        headless: headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    });
    playwrightHeadless = headless;
    console.log('Bundled Chromium launched successfully');
});
// Initialize patchright browser (system Chrome with persistent context)
const initializePatchrightBrowser = (headless) => __awaiter(void 0, void 0, void 0, function* () {
    // If context exists but headless mode changed, close it first
    if (patchrightContext && patchrightHeadless !== headless) {
        console.log(`Patchright headless mode changed from ${patchrightHeadless} to ${headless}, restarting browser...`);
        try {
            yield patchrightContext.close();
        }
        catch (e) {
            // Context may already be closed
        }
        patchrightContext = null;
    }
    if (patchrightContext)
        return;
    console.log(`Launching system Chrome with patchright (headless: ${headless})`);
    console.log(`Browser profile ID: ${BROWSER_PROFILE_ID}`);
    // Ensure browser profiles directory exists
    if (!fs.existsSync(BROWSER_PROFILES_DIR)) {
        fs.mkdirSync(BROWSER_PROFILES_DIR, { recursive: true });
        console.log(`Created browser-profiles directory: ${BROWSER_PROFILES_DIR}`);
    }
    const userDataDir = path.join(BROWSER_PROFILES_DIR, `browser-${BROWSER_PROFILE_ID}`);
    // Ensure profile directory exists
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
        console.log(`Created new profile directory: browser-${BROWSER_PROFILE_ID}`);
    }
    else {
        console.log(`Using existing profile: browser-${BROWSER_PROFILE_ID}`);
    }
    console.log(`UserDataDir: ${userDataDir}`);
    const launchOptions = {
        channel: "chrome",
        headless: headless,
        viewport: null,
    };
    // Add proxy configuration if available
    if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
        launchOptions.proxy = {
            server: PROXY_SERVER.startsWith('http') ? PROXY_SERVER : `http://${PROXY_SERVER}`,
            username: PROXY_USERNAME,
            password: PROXY_PASSWORD,
        };
        console.log(`Proxy configured: ${PROXY_SERVER}`);
    }
    else if (PROXY_SERVER) {
        launchOptions.proxy = {
            server: PROXY_SERVER.startsWith('http') ? PROXY_SERVER : `http://${PROXY_SERVER}`,
        };
        console.log(`Proxy configured: ${PROXY_SERVER}`);
    }
    else {
        console.log('No proxy configured (direct connection)');
    }
    // Launch persistent context with patchright
    patchrightContext = yield patchright_1.chromium.launchPersistentContext(userDataDir, launchOptions);
    patchrightHeadless = headless;
    // Grant clipboard permissions
    try {
        yield patchrightContext.grantPermissions(['clipboard-read', 'clipboard-write']);
        console.log('Clipboard permissions granted');
    }
    catch (permError) {
        console.warn('Failed to grant clipboard permissions:', permError.message);
    }
    console.log('System Chrome launched successfully with patchright');
});
// Initialize browser for the specified engine
const initializeBrowser = (engine, headless) => __awaiter(void 0, void 0, void 0, function* () {
    if (engine === "patchright") {
        yield initializePatchrightBrowser(headless);
    }
    else {
        yield initializePlaywrightBrowser(headless);
    }
});
const createContext = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (skipTlsVerification = false, engine, videoOptions) {
    // If using patchright with persistent context, return the persistent context
    // Note: Video recording is not supported with persistent context
    if (engine === "patchright" && patchrightContext) {
        if (videoOptions === null || videoOptions === void 0 ? void 0 : videoOptions.enabled) {
            console.warn('⚠️ Video recording is not supported with patchright persistent context');
        }
        return patchrightContext;
    }
    // Standard playwright mode: create a new context
    if (!playwrightBrowser) {
        throw new Error('Playwright browser not initialized');
    }
    const userAgent = new user_agents_1.default().toString();
    const viewport = { width: 1280, height: 800 };
    const contextOptions = {
        userAgent,
        viewport,
        ignoreHTTPSErrors: skipTlsVerification,
    };
    // Add video recording options if enabled
    if (videoOptions === null || videoOptions === void 0 ? void 0 : videoOptions.enabled) {
        // Ensure videos directory exists
        if (!fs.existsSync(VIDEOS_DIR)) {
            fs.mkdirSync(VIDEOS_DIR, { recursive: true });
            console.log(`Created videos directory: ${VIDEOS_DIR}`);
        }
        contextOptions.recordVideo = {
            dir: VIDEOS_DIR,
            size: {
                width: videoOptions.width || 1280,
                height: videoOptions.height || 720,
            },
        };
        console.log(`  🎬 Video recording enabled (${contextOptions.recordVideo.size.width}x${contextOptions.recordVideo.size.height})`);
    }
    if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
        contextOptions.proxy = {
            server: PROXY_SERVER,
            username: PROXY_USERNAME,
            password: PROXY_PASSWORD,
        };
    }
    else if (PROXY_SERVER) {
        contextOptions.proxy = {
            server: PROXY_SERVER,
        };
    }
    const newContext = yield playwrightBrowser.newContext(contextOptions);
    if (BLOCK_MEDIA) {
        yield newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', (route, request) => __awaiter(void 0, void 0, void 0, function* () {
            yield route.abort();
        }));
    }
    // Intercept all requests to avoid loading ads
    yield newContext.route('**/*', (route, request) => {
        const requestUrl = new URL(request.url());
        const hostname = requestUrl.hostname;
        if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
            console.log(hostname);
            return route.abort();
        }
        return route.continue();
    });
    return newContext;
});
const shutdownBrowser = () => __awaiter(void 0, void 0, void 0, function* () {
    if (patchrightContext) {
        try {
            yield patchrightContext.close();
        }
        catch (e) {
            // Context may already be closed
        }
        patchrightContext = null;
    }
    if (playwrightBrowser) {
        try {
            yield playwrightBrowser.close();
        }
        catch (e) {
            // Browser may already be closed
        }
        playwrightBrowser = null;
    }
});
// Check if the browser/context is still valid for the given engine and headless mode
const isContextValid = (engine, headless) => __awaiter(void 0, void 0, void 0, function* () {
    if (engine === "playwright") {
        // Check if browser exists and headless mode matches
        return playwrightBrowser !== null && playwrightHeadless === headless;
    }
    // patchright mode
    if (!patchrightContext) {
        return false;
    }
    // Check if headless mode matches
    if (patchrightHeadless !== headless) {
        return false;
    }
    try {
        // Try to get pages - if context is closed, this will throw
        yield patchrightContext.pages();
        return true;
    }
    catch (e) {
        console.log('Patchright context is no longer valid, will reinitialize...');
        patchrightContext = null;
        return false;
    }
});
// Ensure browser is initialized and valid for the given engine and headless mode
const ensureBrowserReady = (engine, headless) => __awaiter(void 0, void 0, void 0, function* () {
    const isValid = yield isContextValid(engine, headless);
    if (!isValid) {
        console.log(`Initializing browser with engine: ${engine}, headless: ${headless}...`);
        yield initializeBrowser(engine, headless);
    }
});
// Check if actions contain a record action
const hasRecordAction = (actions) => {
    if (!actions)
        return false;
    return actions.some(action => action.type === 'record');
};
// Get record mode from actions (default: video)
const getRecordMode = (actions) => {
    if (!actions)
        return undefined;
    const recordAction = actions.find(action => action.type === 'record');
    if (!recordAction || recordAction.type !== 'record')
        return undefined;
    return recordAction.mode || 'video'; // default to video mode
};
// Extract video recording options from actions (for mode: video)
const getVideoOptions = (actions) => {
    if (!actions)
        return undefined;
    const recordAction = actions.find(action => action.type === 'record');
    if (!recordAction || recordAction.type !== 'record')
        return undefined;
    // Only return video options if mode is video (or not specified, defaulting to video)
    const mode = recordAction.mode || 'video';
    if (mode !== 'video')
        return undefined;
    return {
        enabled: true,
        width: recordAction.width,
        height: recordAction.height,
    };
};
// Extract trace options from actions (for mode: trace)
const getTraceOptions = (actions) => {
    if (!actions)
        return undefined;
    const recordAction = actions.find(action => action.type === 'record');
    if (!recordAction || recordAction.type !== 'record')
        return undefined;
    // Only return trace options if mode is trace
    if (recordAction.mode !== 'trace')
        return undefined;
    return {
        enabled: true,
        screenshots: recordAction.screenshots !== false, // default true
        snapshots: recordAction.snapshots !== false, // default true
    };
};
const isValidUrl = (urlString) => {
    try {
        new URL(urlString);
        return true;
    }
    catch (_) {
        return false;
    }
};
// Simple mode: use Jina Reader to get markdown content without browser
const scrapeWithJinaReader = (url, timeout) => __awaiter(void 0, void 0, void 0, function* () {
    // Construct Jina Reader URL: https://r.jina.ai/{url_without_protocol}
    // Remove protocol (http:// or https://) from the URL
    const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
    const jinaUrl = `https://r.jina.ai/${urlWithoutProtocol}`;
    console.log(`Simple mode: fetching from Jina Reader: ${jinaUrl}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = yield fetch(jinaUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Accept': 'text/plain',
            },
        });
        clearTimeout(timeoutId);
        const content = yield response.text();
        const contentType = response.headers.get('content-type') || 'text/plain';
        return {
            content,
            status: response.status,
            contentType,
        };
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Jina Reader request timed out after ${timeout}ms`);
        }
        throw error;
    }
});
const scrapePage = (page, url, waitUntil, waitAfterLoad, timeout, checkSelector) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    console.log(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
    const response = yield page.goto(url, { waitUntil, timeout });
    if (waitAfterLoad > 0) {
        yield page.waitForTimeout(waitAfterLoad);
    }
    if (checkSelector) {
        try {
            yield page.waitForSelector(checkSelector, { timeout });
        }
        catch (error) {
            throw new Error('Required selector not found');
        }
    }
    let headers = null, content = yield page.content();
    let ct = undefined;
    if (response) {
        headers = yield response.allHeaders();
        ct = (_a = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")) === null || _a === void 0 ? void 0 : _a[1];
        if (ct && (ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/plain"))) {
            content = (yield response.body()).toString("utf8"); // TODO: determine real encoding
        }
    }
    return {
        content,
        status: response ? response.status() : null,
        headers,
        contentType: ct,
    };
});
// Take a screenshot, save to file, and return base64
const takeScreenshot = (page_1, ...args_1) => __awaiter(void 0, [page_1, ...args_1], void 0, function* (page, fullPage = false) {
    const screenshot = yield page.screenshot({
        fullPage,
        type: 'png',
    });
    // Ensure screenshots directory exists
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    // Save screenshot to file
    fs.writeFileSync(filepath, screenshot);
    console.log(`  📸 Screenshot saved: ${filepath}`);
    return screenshot.toString('base64');
});
// Execute actions on the page
const executeActions = (page, actions) => __awaiter(void 0, void 0, void 0, function* () {
    const results = {
        screenshots: [],
        scrapes: [],
        javascriptReturns: [],
        pdfs: [],
        recordings: [],
    };
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        console.log(`Executing action ${i + 1}/${actions.length}: ${action.type}`);
        try {
            switch (action.type) {
                case 'wait': {
                    if (action.milliseconds !== undefined && action.selector !== undefined) {
                        console.warn('⚠️ Wait action has both milliseconds and selector. Using milliseconds.');
                    }
                    if (action.milliseconds !== undefined) {
                        yield page.waitForTimeout(action.milliseconds);
                        console.log(`  → Waited ${action.milliseconds}ms`);
                    }
                    else if (action.selector !== undefined) {
                        yield page.waitForSelector(action.selector, { timeout: 30000 });
                        console.log(`  → Waited for selector: ${action.selector}`);
                    }
                    else {
                        console.warn('⚠️ Wait action missing both milliseconds and selector');
                    }
                    break;
                }
                case 'click': {
                    if (action.all) {
                        const elements = yield page.locator(action.selector).all();
                        console.log(`  → Clicking ${elements.length} elements matching: ${action.selector}`);
                        for (const element of elements) {
                            yield element.click();
                        }
                    }
                    else {
                        yield page.click(action.selector);
                        console.log(`  → Clicked: ${action.selector}`);
                    }
                    break;
                }
                case 'screenshot': {
                    const screenshot = yield takeScreenshot(page, action.fullPage);
                    results.screenshots.push(screenshot);
                    console.log(`  → Screenshot taken (fullPage: ${action.fullPage || false})`);
                    break;
                }
                case 'write': {
                    yield page.keyboard.type(action.text);
                    console.log(`  → Typed text: "${action.text.substring(0, 50)}${action.text.length > 50 ? '...' : ''}"`);
                    break;
                }
                case 'press': {
                    yield page.keyboard.press(action.key);
                    console.log(`  → Pressed key: ${action.key}`);
                    break;
                }
                case 'scroll': {
                    const direction = action.direction || 'down';
                    const scrollAmount = 500;
                    if (action.selector) {
                        // Scroll within a specific element
                        yield page.locator(action.selector).evaluate((el, args) => {
                            if (args.dir === 'down') {
                                el.scrollTop += args.amount;
                            }
                            else {
                                el.scrollTop -= args.amount;
                            }
                        }, { dir: direction, amount: scrollAmount });
                        console.log(`  → Scrolled ${direction} within: ${action.selector}`);
                    }
                    else {
                        // Scroll the entire page
                        yield page.evaluate((args) => {
                            if (args.dir === 'down') {
                                window.scrollBy(0, args.amount);
                            }
                            else {
                                window.scrollBy(0, -args.amount);
                            }
                        }, { dir: direction, amount: scrollAmount });
                        console.log(`  → Scrolled ${direction}`);
                    }
                    break;
                }
                case 'scrape': {
                    const html = yield page.content();
                    const url = page.url();
                    results.scrapes.push({ url, html });
                    console.log(`  → Scraped page content (${html.length} chars)`);
                    break;
                }
                case 'executeJavascript': {
                    const result = yield page.evaluate(action.script);
                    const valueType = typeof result;
                    results.javascriptReturns.push({ type: valueType, value: result });
                    console.log(`  → Executed JavaScript, returned: ${valueType}`);
                    break;
                }
                case 'pdf': {
                    const pdfOptions = {};
                    if (action.landscape !== undefined) {
                        pdfOptions.landscape = action.landscape;
                    }
                    if (action.scale !== undefined) {
                        pdfOptions.scale = action.scale;
                    }
                    if (action.format !== undefined) {
                        pdfOptions.format = action.format;
                    }
                    else {
                        pdfOptions.format = 'Letter';
                    }
                    const pdfBuffer = yield page.pdf(pdfOptions);
                    const pdfBase64 = pdfBuffer.toString('base64');
                    results.pdfs.push(pdfBase64);
                    console.log(`  → Generated PDF (format: ${pdfOptions.format}, landscape: ${pdfOptions.landscape || false})`);
                    break;
                }
                case 'record': {
                    // Recording is handled at context/page level
                    // This action serves as a marker that recording should be active
                    const mode = action.mode || 'video';
                    if (mode === 'video') {
                        const size = action.width && action.height ? `${action.width}x${action.height}` : '1280x720 (default)';
                        console.log(`  → Video recording active (size: ${size})`);
                    }
                    else if (mode === 'trace') {
                        const opts = [];
                        if (action.screenshots !== false)
                            opts.push('screenshots');
                        if (action.snapshots !== false)
                            opts.push('snapshots');
                        console.log(`  → Trace recording active (${opts.join(', ')})`);
                    }
                    else if (mode === 'rrweb') {
                        console.log(`  → rrweb recording active (DOM mutations as JSON)`);
                    }
                    break;
                }
                default: {
                    console.warn(`⚠️ Unknown action type: ${action.type}`);
                }
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`  ❌ Action failed: ${errorMsg}`);
            // Continue with next action even if this one failed
        }
    }
    return results;
});
app.get('/health', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.status(200).json({
            status: 'healthy',
            engines: {
                playwright: playwrightBrowser !== null ? { status: 'running', headless: playwrightHeadless } : { status: 'stopped' },
                patchright: patchrightContext !== null ? { status: 'running', headless: patchrightHeadless } : { status: 'stopped' },
            },
            defaults: {
                engine: USE_SYSTEM_CHROME ? 'patchright' : 'playwright',
                headless: HEADLESS,
            },
            maxConcurrentPages: MAX_CONCURRENT_PAGES,
            activePages: MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits()
        });
    }
    catch (error) {
        console.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
}));
app.post('/scrape', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url, wait_after_load = 0, timeout = 15000, headers, check_selector, skip_tls_verification = false, actions, screenshot, full_page_screenshot, browser_engine, headless: requestHeadless, simple_mode = false } = req.body;
    // Determine which engine and headless mode to use
    const engine = getEffectiveEngine(browser_engine);
    const headless = getEffectiveHeadless(requestHeadless);
    // Check if recording is requested and get mode
    const isRecording = hasRecordAction(actions);
    const recordMode = getRecordMode(actions);
    const videoOptions = getVideoOptions(actions);
    const traceOptions = getTraceOptions(actions);
    console.log(`================= Scrape Request =================`);
    console.log(`URL: ${url}`);
    console.log(`Simple Mode: ${simple_mode}`);
    console.log(`Wait After Load: ${wait_after_load}`);
    console.log(`Timeout: ${timeout}`);
    console.log(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
    console.log(`Check Selector: ${check_selector ? check_selector : 'None'}`);
    console.log(`Skip TLS Verification: ${skip_tls_verification}`);
    console.log(`Screenshot: ${screenshot || false}`);
    console.log(`Full Page Screenshot: ${full_page_screenshot || false}`);
    console.log(`Browser Engine: ${engine}${browser_engine ? ' (from request)' : ' (from env)'}`);
    console.log(`Headless: ${headless}${requestHeadless !== undefined ? ' (from request)' : ' (from env)'}`);
    console.log(`Actions: ${actions ? actions.length : 0} actions`);
    console.log(`Recording: ${isRecording ? recordMode : 'none'}`);
    console.log(`==================================================`);
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    // Simple mode: use Jina Reader instead of browser (no actions supported)
    if (simple_mode) {
        try {
            const result = yield scrapeWithJinaReader(url, timeout);
            const pageError = result.status !== 200 ? (0, get_error_1.getError)(result.status) : undefined;
            if (!pageError) {
                console.log(`✅ Simple mode scrape successful!`);
            }
            else {
                console.log(`🚨 Simple mode scrape failed with status code: ${result.status} ${pageError}`);
            }
            return res.json(Object.assign({ content: result.content, pageStatusCode: result.status, contentType: result.contentType }, (pageError && { pageError })));
        }
        catch (error) {
            console.error('Simple mode scrape error:', error);
            return res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred while fetching the page.' });
        }
    }
    if (!PROXY_SERVER) {
        console.warn('⚠️ WARNING: No proxy server provided. Your IP address may be blocked.');
    }
    // Ensure browser is initialized and still valid (handles closed browser case)
    yield ensureBrowserReady(engine, headless);
    yield pageSemaphore.acquire();
    let requestContext = null;
    let page = null;
    let videoPath = null;
    let tracePath = null;
    // Store rrweb events in Node.js memory (survives page navigations)
    const rrwebEvents = [];
    try {
        // Create context with video recording if requested (mode: video)
        requestContext = yield createContext(skip_tls_verification, engine, videoOptions);
        // Start tracing if requested (mode: trace, must be done before creating page)
        if (recordMode === 'trace' && traceOptions && requestContext) {
            // Ensure traces directory exists
            if (!fs.existsSync(TRACES_DIR)) {
                fs.mkdirSync(TRACES_DIR, { recursive: true });
                console.log(`Created traces directory: ${TRACES_DIR}`);
            }
            yield requestContext.tracing.start({
                screenshots: traceOptions.screenshots,
                snapshots: traceOptions.snapshots,
            });
            console.log(`  📊 Tracing started (screenshots: ${traceOptions.screenshots}, snapshots: ${traceOptions.snapshots})`);
        }
        page = yield requestContext.newPage();
        if (headers) {
            yield page.setExtraHTTPHeaders(headers);
        }
        const result = yield scrapePage(page, url, 'load', wait_after_load, timeout, check_selector);
        const pageError = result.status !== 200 ? (0, get_error_1.getError)(result.status) : undefined;
        // Inject rrweb AFTER page loads
        // Note: rrweb recording is NOT supported with patchright due to CSP restrictions
        if (recordMode === 'rrweb') {
            if (engine === 'patchright') {
                console.warn(`  ⚠️ rrweb recording is NOT supported with patchright persistent context. Use browser_engine: "playwright" for recording.`);
            }
            else {
                try {
                    // Listen for console messages to capture rrweb events
                    page.on('console', (msg) => {
                        const text = msg.text();
                        if (text.startsWith('__RRWEB_EVENT__:')) {
                            try {
                                const eventJson = text.substring('__RRWEB_EVENT__:'.length);
                                const event = JSON.parse(eventJson);
                                rrwebEvents.push(event);
                            }
                            catch (e) {
                                // Ignore parse errors
                            }
                        }
                    });
                    // Inject bundled rrweb script
                    yield page.addScriptTag({ content: RRWEB_SCRIPT });
                    console.log(`  🎥 rrweb library injected (bundled)`);
                    // Wait a moment for script to execute
                    yield page.waitForTimeout(100);
                    // Start recording
                    const recordingStarted = yield page.evaluate(() => {
                        const rrwebLib = window.rrweb;
                        if (rrwebLib && typeof rrwebLib.record === 'function') {
                            rrwebLib.record({
                                emit: function (event) {
                                    console.log('__RRWEB_EVENT__:' + JSON.stringify(event));
                                },
                                checkoutEveryNms: 5 * 60 * 1000
                            });
                            window.__rrwebReady = true;
                            return true;
                        }
                        return false;
                    });
                    if (recordingStarted) {
                        console.log(`  🎥 rrweb recording started and streaming events to Node.js`);
                    }
                    else {
                        console.warn(`  ⚠️ rrweb recording failed to start`);
                    }
                }
                catch (e) {
                    console.warn(`  ⚠️ rrweb injection failed:`, e);
                }
            }
        }
        // Execute actions if provided
        let actionResults;
        if (actions && actions.length > 0) {
            console.log(`Executing ${actions.length} actions...`);
            actionResults = yield executeActions(page, actions);
        }
        // Take screenshot if requested
        let screenshotData;
        if (screenshot || full_page_screenshot) {
            console.log(`Taking screenshot...`);
            screenshotData = yield takeScreenshot(page, full_page_screenshot || false);
            // If there are action screenshots, the main screenshot goes first
            if (actionResults && actionResults.screenshots.length > 0) {
                actionResults.screenshots.unshift(screenshotData);
            }
        }
        // If screenshot requested but no actions, include it in response
        if (screenshotData && !actionResults) {
            actionResults = {
                screenshots: [screenshotData],
                scrapes: [],
                javascriptReturns: [],
                pdfs: [],
                recordings: [],
            };
        }
        // Handle video recording (mode: video) - must close page first to finalize video
        if (recordMode === 'video' && page) {
            // Get video object before closing page
            const video = page.video();
            if (video) {
                // Close page to finalize video
                yield page.close();
                page = null;
                // Get the video path
                videoPath = yield video.path();
                console.log(`  🎬 Video saved: ${videoPath}`);
                // Return file path instead of base64
                if (videoPath && fs.existsSync(videoPath)) {
                    // Initialize actionResults if needed
                    if (!actionResults) {
                        actionResults = {
                            screenshots: [],
                            scrapes: [],
                            javascriptReturns: [],
                            pdfs: [],
                            recordings: [],
                        };
                    }
                    actionResults.recordings.push(videoPath);
                    console.log(`  🎬 Video path returned: ${videoPath}`);
                }
            }
        }
        // Handle tracing (mode: trace) - stop tracing and save to file
        if (recordMode === 'trace' && requestContext) {
            // Generate trace filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            tracePath = path.join(TRACES_DIR, `trace-${timestamp}.zip`);
            // Stop tracing and save to file
            yield requestContext.tracing.stop({ path: tracePath });
            console.log(`  📊 Trace saved: ${tracePath}`);
            // Return file path instead of base64
            if (tracePath && fs.existsSync(tracePath)) {
                // Initialize actionResults if needed
                if (!actionResults) {
                    actionResults = {
                        screenshots: [],
                        scrapes: [],
                        javascriptReturns: [],
                        pdfs: [],
                        recordings: [],
                    };
                }
                actionResults.recordings.push(tracePath);
                console.log(`  📊 Trace path returned: ${tracePath}`);
            }
        }
        // Handle rrweb recording (mode: rrweb) - events are already in Node.js memory
        if (recordMode === 'rrweb') {
            try {
                // Events are already collected in rrwebEvents array via exposeFunction
                // This works even across page navigations!
                if (rrwebEvents && rrwebEvents.length > 0) {
                    // Ensure recordings directory exists
                    if (!fs.existsSync(RECORDINGS_DIR)) {
                        fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
                        console.log(`Created recordings directory: ${RECORDINGS_DIR}`);
                    }
                    // Save events to JSON file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const rrwebPath = path.join(RECORDINGS_DIR, `rrweb-${timestamp}.json`);
                    const eventsJson = JSON.stringify(rrwebEvents, null, 2);
                    fs.writeFileSync(rrwebPath, eventsJson);
                    console.log(`  🎥 rrweb events saved: ${rrwebPath}`);
                    // Initialize actionResults if needed
                    if (!actionResults) {
                        actionResults = {
                            screenshots: [],
                            scrapes: [],
                            javascriptReturns: [],
                            pdfs: [],
                            recordings: [],
                        };
                    }
                    actionResults.recordings.push(rrwebPath);
                    console.log(`  🎥 rrweb path returned: ${rrwebPath} (${rrwebEvents.length} events)`);
                }
                else {
                    console.warn(`  ⚠️ No rrweb events captured`);
                }
            }
            catch (rrwebError) {
                console.error(`  ❌ Failed to save rrweb events:`, rrwebError);
            }
        }
        if (!pageError) {
            console.log(`✅ Scrape successful!`);
        }
        else {
            console.log(`🚨 Scrape failed with status code: ${result.status} ${pageError}`);
        }
        res.json(Object.assign(Object.assign(Object.assign({ content: result.content, pageStatusCode: result.status, contentType: result.contentType }, (screenshotData && { screenshot: screenshotData })), (actionResults && (actionResults.screenshots.length > 0 ||
            actionResults.scrapes.length > 0 ||
            actionResults.javascriptReturns.length > 0 ||
            actionResults.pdfs.length > 0 ||
            actionResults.recordings.length > 0) && {
            actions: {
                screenshots: actionResults.screenshots,
                scrapes: actionResults.scrapes,
                javascriptReturns: actionResults.javascriptReturns,
                pdfs: actionResults.pdfs,
                recordings: actionResults.recordings,
            }
        })), (pageError && { pageError })));
    }
    catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: 'An error occurred while fetching the page.' });
    }
    finally {
        if (page)
            yield page.close();
        // Don't close the context in patchright mode (persistent context)
        // For video recording, we must close the context to finalize the video
        if (engine === "playwright" && requestContext) {
            yield requestContext.close();
        }
        pageSemaphore.release();
    }
}));
app.listen(port, () => {
    const defaultEngine = getEffectiveEngine();
    const defaultHeadless = getEffectiveHeadless();
    initializeBrowser(defaultEngine, defaultHeadless).then(() => {
        console.log(`Server is running on port ${port}`);
    });
});
if (require.main === module) {
    process.on('SIGINT', () => {
        shutdownBrowser().then(() => {
            console.log('Browser closed');
            process.exit(0);
        });
    });
}
