import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page } from 'playwright';
import dotenv from 'dotenv';
import UserAgent from 'user-agents';
import { getError } from './helpers/get_error';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(bodyParser.json());

const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const MAX_CONCURRENT_PAGES = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT_PAGES ?? '10', 10) || 10);
const HEADLESS = (process.env.HEADLESS || 'true').toLowerCase() !== 'false';

// Screenshots folder in project root
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../screenshots');

const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;

class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        this.permits--;
        nextResolve();
      }
    }
  }

  getAvailablePermits(): number {
    return this.permits;
  }

  getQueueLength(): number {
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

// Action type definitions
type Action =
  | { type: "wait"; milliseconds?: number; selector?: string }
  | { type: "click"; selector: string; all?: boolean }
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "write"; text: string }
  | { type: "press"; key: string }
  | { type: "scroll"; direction?: "up" | "down"; selector?: string }
  | { type: "scrape" }
  | { type: "executeJavascript"; script: string }
  | { type: "pdf"; landscape?: boolean; scale?: number; format?: string };

type PdfFormat = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "Letter" | "Legal" | "Tabloid" | "Ledger";

interface ScrapeActionContent {
  url: string;
  html: string;
}

interface JavascriptReturnValue {
  type: string;
  value: unknown;
}

interface ActionResults {
  screenshots: string[];
  scrapes: ScrapeActionContent[];
  javascriptReturns: JavascriptReturnValue[];
  pdfs: string[];
}

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
  actions?: Action[];
  screenshot?: boolean;
  full_page_screenshot?: boolean;
}

let browser: Browser;

const initializeBrowser = async () => {
  console.log(`Launching browser with headless: ${HEADLESS}`);
  browser = await chromium.launch({
    headless: HEADLESS,
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
};

const createContext = async (skipTlsVerification: boolean = false) => {
  const userAgent = new UserAgent().toString();
  const viewport = { width: 1280, height: 800 };

  const contextOptions: any = {
    userAgent,
    viewport,
    ignoreHTTPSErrors: skipTlsVerification,
  };

  if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
      username: PROXY_USERNAME,
      password: PROXY_PASSWORD,
    };
  } else if (PROXY_SERVER) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
    };
  }

  const newContext = await browser.newContext(contextOptions);

  if (BLOCK_MEDIA) {
    await newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', async (route: Route, request: PlaywrightRequest) => {
      await route.abort();
    });
  }

  // Intercept all requests to avoid loading ads
  await newContext.route('**/*', (route: Route, request: PlaywrightRequest) => {
    const requestUrl = new URL(request.url());
    const hostname = requestUrl.hostname;

    if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
      console.log(hostname);
      return route.abort();
    }
    return route.continue();
  });

  return newContext;
};

const shutdownBrowser = async () => {
  if (browser) {
    await browser.close();
  }
};

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

const scrapePage = async (page: Page, url: string, waitUntil: 'load' | 'networkidle', waitAfterLoad: number, timeout: number, checkSelector: string | undefined) => {
  console.log(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
  const response = await page.goto(url, { waitUntil, timeout });

  if (waitAfterLoad > 0) {
    await page.waitForTimeout(waitAfterLoad);
  }

  if (checkSelector) {
    try {
      await page.waitForSelector(checkSelector, { timeout });
    } catch (error) {
      throw new Error('Required selector not found');
    }
  }

  let headers = null, content = await page.content();
  let ct: string | undefined = undefined;
  if (response) {
    headers = await response.allHeaders();
    ct = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
    if (ct && (ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/plain"))) {
      content = (await response.body()).toString("utf8"); // TODO: determine real encoding
    }
  }

  return {
    content,
    status: response ? response.status() : null,
    headers,
    contentType: ct,
  };
};

// Take a screenshot, save to file, and return base64
const takeScreenshot = async (page: Page, fullPage: boolean = false): Promise<string> => {
  const screenshot = await page.screenshot({
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
};

// Execute actions on the page
const executeActions = async (page: Page, actions: Action[]): Promise<ActionResults> => {
  const results: ActionResults = {
    screenshots: [],
    scrapes: [],
    javascriptReturns: [],
    pdfs: [],
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
            await page.waitForTimeout(action.milliseconds);
            console.log(`  → Waited ${action.milliseconds}ms`);
          } else if (action.selector !== undefined) {
            await page.waitForSelector(action.selector, { timeout: 30000 });
            console.log(`  → Waited for selector: ${action.selector}`);
          } else {
            console.warn('⚠️ Wait action missing both milliseconds and selector');
          }
          break;
        }

        case 'click': {
          if (action.all) {
            const elements = await page.locator(action.selector).all();
            console.log(`  → Clicking ${elements.length} elements matching: ${action.selector}`);
            for (const element of elements) {
              await element.click();
            }
          } else {
            await page.click(action.selector);
            console.log(`  → Clicked: ${action.selector}`);
          }
          break;
        }

        case 'screenshot': {
          const screenshot = await takeScreenshot(page, action.fullPage);
          results.screenshots.push(screenshot);
          console.log(`  → Screenshot taken (fullPage: ${action.fullPage || false})`);
          break;
        }

        case 'write': {
          await page.keyboard.type(action.text);
          console.log(`  → Typed text: "${action.text.substring(0, 50)}${action.text.length > 50 ? '...' : ''}"`);
          break;
        }

        case 'press': {
          await page.keyboard.press(action.key);
          console.log(`  → Pressed key: ${action.key}`);
          break;
        }

        case 'scroll': {
          const direction = action.direction || 'down';
          const scrollAmount = 500;

          if (action.selector) {
            // Scroll within a specific element
            await page.locator(action.selector).evaluate((el: Element, args: { dir: string; amount: number }) => {
              if (args.dir === 'down') {
                el.scrollTop += args.amount;
              } else {
                el.scrollTop -= args.amount;
              }
            }, { dir: direction, amount: scrollAmount });
            console.log(`  → Scrolled ${direction} within: ${action.selector}`);
          } else {
            // Scroll the entire page
            await page.evaluate((args: { dir: string; amount: number }) => {
              if (args.dir === 'down') {
                window.scrollBy(0, args.amount);
              } else {
                window.scrollBy(0, -args.amount);
              }
            }, { dir: direction, amount: scrollAmount });
            console.log(`  → Scrolled ${direction}`);
          }
          break;
        }

        case 'scrape': {
          const html = await page.content();
          const url = page.url();
          results.scrapes.push({ url, html });
          console.log(`  → Scraped page content (${html.length} chars)`);
          break;
        }

        case 'executeJavascript': {
          const result = await page.evaluate(action.script);
          const valueType = typeof result;
          results.javascriptReturns.push({ type: valueType, value: result });
          console.log(`  → Executed JavaScript, returned: ${valueType}`);
          break;
        }

        case 'pdf': {
          const pdfOptions: {
            landscape?: boolean;
            scale?: number;
            format?: PdfFormat;
          } = {};

          if (action.landscape !== undefined) {
            pdfOptions.landscape = action.landscape;
          }
          if (action.scale !== undefined) {
            pdfOptions.scale = action.scale;
          }
          if (action.format !== undefined) {
            pdfOptions.format = action.format as PdfFormat;
          } else {
            pdfOptions.format = 'Letter';
          }

          const pdfBuffer = await page.pdf(pdfOptions);
          const pdfBase64 = pdfBuffer.toString('base64');
          results.pdfs.push(pdfBase64);
          console.log(`  → Generated PDF (format: ${pdfOptions.format}, landscape: ${pdfOptions.landscape || false})`);
          break;
        }

        default: {
          console.warn(`⚠️ Unknown action type: ${(action as any).type}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Action failed: ${errorMsg}`);
      // Continue with next action even if this one failed
    }
  }

  return results;
};

app.get('/health', async (req: Request, res: Response) => {
  try {
    if (!browser) {
      await initializeBrowser();
    }

    const testContext = await createContext();
    const testPage = await testContext.newPage();
    await testPage.close();
    await testContext.close();

    res.status(200).json({
      status: 'healthy',
      maxConcurrentPages: MAX_CONCURRENT_PAGES,
      activePages: MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

app.post('/scrape', async (req: Request, res: Response) => {
  const {
    url,
    wait_after_load = 0,
    timeout = 15000,
    headers,
    check_selector,
    skip_tls_verification = false,
    actions,
    screenshot,
    full_page_screenshot
  }: UrlModel = req.body;

  console.log(`================= Scrape Request =================`);
  console.log(`URL: ${url}`);
  console.log(`Wait After Load: ${wait_after_load}`);
  console.log(`Timeout: ${timeout}`);
  console.log(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
  console.log(`Check Selector: ${check_selector ? check_selector : 'None'}`);
  console.log(`Skip TLS Verification: ${skip_tls_verification}`);
  console.log(`Screenshot: ${screenshot || false}`);
  console.log(`Full Page Screenshot: ${full_page_screenshot || false}`);
  console.log(`Actions: ${actions ? actions.length : 0} actions`);
  console.log(`==================================================`);

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!PROXY_SERVER) {
    console.warn('⚠️ WARNING: No proxy server provided. Your IP address may be blocked.');
  }

  if (!browser) {
    await initializeBrowser();
  }

  await pageSemaphore.acquire();

  let requestContext: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    requestContext = await createContext(skip_tls_verification);
    page = await requestContext.newPage();

    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    const result = await scrapePage(page, url, 'load', wait_after_load, timeout, check_selector);
    const pageError = result.status !== 200 ? getError(result.status) : undefined;

    // Execute actions if provided
    let actionResults: ActionResults | undefined;
    if (actions && actions.length > 0) {
      console.log(`Executing ${actions.length} actions...`);
      actionResults = await executeActions(page, actions);
    }

    // Take screenshot if requested
    let screenshotData: string | undefined;
    if (screenshot || full_page_screenshot) {
      console.log(`Taking screenshot...`);
      screenshotData = await takeScreenshot(page, full_page_screenshot || false);
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
      };
    }

    if (!pageError) {
      console.log(`✅ Scrape successful!`);
    } else {
      console.log(`🚨 Scrape failed with status code: ${result.status} ${pageError}`);
    }

    res.json({
      content: result.content,
      pageStatusCode: result.status,
      contentType: result.contentType,
      ...(screenshotData && { screenshot: screenshotData }),
      ...(actionResults && (actionResults.screenshots.length > 0 ||
                           actionResults.scrapes.length > 0 ||
                           actionResults.javascriptReturns.length > 0 ||
                           actionResults.pdfs.length > 0) && {
        actions: {
          screenshots: actionResults.screenshots,
          scrapes: actionResults.scrapes,
          javascriptReturns: actionResults.javascriptReturns,
          pdfs: actionResults.pdfs,
        }
      }),
      ...(pageError && { pageError })
    });

  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'An error occurred while fetching the page.' });
  } finally {
    if (page) await page.close();
    if (requestContext) await requestContext.close();
    pageSemaphore.release();
  }
});

app.listen(port, () => {
  initializeBrowser().then(() => {
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
