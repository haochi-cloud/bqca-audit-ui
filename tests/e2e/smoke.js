// Headless browser smoke test against a running instance (local or proxied).
// Loads every screen, opens the first conversation it finds, and fails on any
// console error or failed /api call. Screenshots go to ./shots.
//
//   cd tests/e2e && npm install
//   BASE=http://127.0.0.1:8080 CHROME_PATH=/usr/bin/google-chrome npm test
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE || "http://127.0.0.1:8080";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const RANGE = process.env.RANGE || "365d";
const OUT = `${__dirname}/shots`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1500, height: 1000 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on("response", (r) => r.url().includes("/api/") && r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));

  const shot = async (name, path, action) => {
    await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 120000 });
    await sleep(3000);
    if (action) { await action(); await sleep(4000); }
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log("ok", name);
  };

  await shot("01_overview", `/?range=${RANGE}`);
  await shot("02_conversations", `/conversations?range=${RANGE}`);
  await shot("03_conversation_panel", `/conversations?range=${RANGE}`, async () => {
    const row = await page.$("tbody tr");
    if (row) await row.click();
  });
  await shot("04_threads", `/conversations?range=${RANGE}&mode=thread&sort=turns`);
  await shot("05_users", `/users?range=${RANGE}`);
  await shot("06_agents", `/agents?range=${RANGE}`);

  // Open the first conversation as a full page and visit every tab.
  const list = await page.evaluate(async (range) => {
    const end = new Date();
    const start = new Date(end - (parseInt(range, 10) || 365) * 864e5);
    const r = await fetch(`/api/conversations?limit=1&start=${start.toISOString()}&end=${end.toISOString()}`);
    return r.json();
  }, RANGE);
  const c = list.rows && list.rows[0];
  if (c) {
    const qs = new URLSearchParams({ table: c.source_table, sessions: c.session_ids.join(","), start: c.start_ts, end: c.end_ts });
    for (const tab of ["Transcript", "Timeline", "Raw events"]) {
      await shot(`07_detail_${tab.split(" ")[0].toLowerCase()}`, `/conversation/view?${qs}`, async () => {
        const [b] = await page.$$(`xpath/.//button[starts-with(normalize-space(.), '${tab}')]`);
        if (b) await b.click();
      });
    }
  } else {
    console.log("warn: no conversations in range; skipped detail checks");
  }

  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await shot("08_overview_light", `/?range=${RANGE}`);
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.setViewport({ width: 420, height: 900 });
  await shot("09_mobile", `/conversations?range=${RANGE}`);

  await browser.close();
  if (errors.length) {
    console.error("FAILED:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("PASS: no console or API errors");
})().catch((e) => { console.error(e); process.exit(1); });
