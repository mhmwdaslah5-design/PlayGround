import { mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const url = process.env.CAPTURE_URL;
const outputDir = process.env.CAPTURE_DIR;
if (!url || !outputDir) {
  console.error("Set CAPTURE_URL and CAPTURE_DIR.");
  process.exit(1);
}
mkdirSync(outputDir, { recursive: true });

const runtime = join(process.env.HOME || "/home/runner", ".local/share/omgithub-playwright");
const require = createRequire(join(runtime, "package.json"));

const timing = (label, started) => {
  console.log(`[timing] ${label} ${Date.now() - started}ms`);
};

class TransientError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 75;
  }
}

let chromium;
let config;
try {
  ({ chromium } = require("playwright"));
  config = JSON.parse(
    readFileSync(join(runtime, process.platform === "darwin" ? "metal.json" : "linux.json"), "utf8"),
  );
  if (process.platform === "linux") {
    process.env.DISPLAY ||= `:${readFileSync(join(runtime, "display"), "utf8").trim()}`;
  }
} catch (error) {
  console.error(`Browser runtime unavailable: ${error.message}`);
  process.exit(75);
}

const viewports = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
];
const outputs = [];
let browser;
let exitCode = 0;

const launchStarted = Date.now();
try {
  browser = await chromium
    .launch({ ...config.browser.launchOptions, timeout: 30000 })
    .catch((error) => {
      throw new TransientError(`Could not launch browser: ${error.message}`);
  });
  timing("browser launch", launchStarted);
} catch (error) {
  console.error(error.message || error);
  process.exit(error.exitCode || 75);
}

try {
  for (const [name, width, height] of viewports) {
    const pageStarted = Date.now();
    const page = await browser.newPage({ viewport: { width, height } }).catch((error) => {
      throw new TransientError(`Could not open ${name} page: ${error.message}`);
    });
    page.setDefaultTimeout(30000);

    try {
      const gotoStarted = Date.now();
      const response = await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch((error) => {
        throw new TransientError(`Could not navigate to ${url}: ${error.message}`);
      });
      timing(`${name} navigation`, gotoStarted);
      if (!response) throw new TransientError(`No HTTP response from ${url}`);
      if (!response.ok()) {
        const status = response.status();
        const transient = [408, 429, 500, 502, 503, 504].includes(status);
        throw Object.assign(new Error(`HTTP ${status} loading preview`), { exitCode: transient ? 75 : 1 });
      }

      const renderStarted = Date.now();
      await page.locator("#game").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForFunction(() => window.__GA_READY === true, undefined, { timeout: 30000 }).catch((error) => {
        throw Object.assign(new Error(`Game did not finish its first render: ${error.message}`), { exitCode: 1 });
      });
      await page.waitForFunction(() => document.fonts.status === "loaded", undefined, { timeout: 15000 }).catch(() => {});
      timing(`${name} first render`, renderStarted);

      const start = page.locator("#start-btn");
      if ((await start.count()) && (await start.isVisible())) {
        const clickStarted = Date.now();
        await start.click({ timeout: 5000, noWaitAfter: true }).catch((error) => {
          throw Object.assign(new Error(`Start control was not actionable: ${error.message}`), { exitCode: 1 });
        });
        await page
          .waitForFunction(() => window.__GA?.state?.mode === "playing", undefined, { timeout: 10000 })
          .catch((error) => {
            throw Object.assign(new Error(`Gameplay did not start: ${error.message}`), { exitCode: 1 });
          });
        timing(`${name} start gameplay`, clickStarted);
      }

      await page.waitForTimeout(260);
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(520);
      await page.keyboard.up("ArrowRight");
      await page.keyboard.press("Space");
      await page.waitForTimeout(950);

      const canvasStats = await page.evaluate(() => {
        const canvas = document.getElementById("game");
        if (!canvas) return { error: "missing canvas" };
        const context = canvas.getContext("2d");
        if (!context) return { error: "missing 2d context" };
        const width = canvas.width;
        const height = canvas.height;
        if (!width || !height) return { error: "empty canvas" };
        const data = context.getImageData(0, 0, width, height).data;
        const colors = new Set();
        let min = 255;
        let max = 0;
        let sum = 0;
        let samples = 0;
        const step = Math.max(4, Math.floor((width * height) / 9000)) * 4;
        for (let i = 0; i < data.length; i += step) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = (r + g + b) / 3;
          min = Math.min(min, lum);
          max = Math.max(max, lum);
          sum += lum;
          samples += 1;
          colors.add((r >> 4) << 8 | (g >> 4) << 4 | b >> 4);
        }
        return {
          width,
          height,
          min,
          max,
          mean: sum / samples,
          unique: colors.size,
          stage: document.getElementById("hud-stage")?.textContent || "",
          mode: window.__GA?.state?.mode || "",
          level: window.__GA?.state?.level?.n || 0,
          frames: window.__GA_FRAMES || 0,
        };
      });
      console.log(`${name} canvas: ${JSON.stringify(canvasStats)}`);
      if (canvasStats.error) throw Object.assign(new Error(`${name} ${canvasStats.error}`), { exitCode: 1 });
      if (canvasStats.frames < 3) throw Object.assign(new Error(`${name} animation loop did not run`), { exitCode: 1 });
      if (canvasStats.max - canvasStats.min < 28 || canvasStats.unique < 18) {
        throw Object.assign(new Error(`${name} canvas looks blank or flat`), { exitCode: 1 });
      }
      if (!canvasStats.stage.includes("المرحلة")) {
        throw Object.assign(new Error(`${name} HUD stage label did not render`), { exitCode: 1 });
      }

      const shotStarted = Date.now();
      const fileName = `final-${name}.png`;
      const filePath = join(outputDir, fileName);
      await page.screenshot({ path: filePath, timeout: 30000 }).catch((error) => {
        const transient = error.name === "TimeoutError" || !browser.isConnected();
        throw Object.assign(new Error(`Could not capture ${name}: ${error.message}`), {
          exitCode: transient ? 75 : 1,
        });
      });
      const bytes = statSync(filePath).size;
      if (bytes < 5000) throw Object.assign(new Error(`${name} screenshot is too small (${bytes} bytes)`), { exitCode: 1 });
      outputs.push({ name, filePath, bytes });
      timing(`${name} capture`, shotStarted);
      timing(`${name} total`, pageStarted);
    } finally {
      await page.close().catch(() => {});
    }
  }
  console.log(`Captured ${outputs.map((item) => `${item.name} (${item.bytes} bytes)`).join(", ")}`);
} catch (error) {
  console.error(error.stack || error.message || error);
  exitCode = error.exitCode || 1;
} finally {
  await browser?.close().catch((error) => {
    console.error(`Browser close failed: ${error.message}`);
    if (!exitCode) exitCode = 75;
  });
}

process.exit(exitCode);
