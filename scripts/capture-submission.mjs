import assert from "node:assert/strict";
import { mkdir, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { dashboardConfig } from "../src/shared/config.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "screenshots", "submission");
const screenshotNames = [
  "01-dense-all-120.png",
  "02-dense-60s-later.png",
  "03-compact-density.png",
  "04-wide-1920.png",
  "05-laptop-1280.png",
  "06-failed-and-stuck-groups.png",
  "07-inspector-failed-row.png",
  "08-reprovision-before.png",
  "09-reprovision-after.png",
  "10-filter-chips-failed.png",
  "11-ai-filter-chips.png",
  "12-ai-model-unavailable.png",
  "13-ai-no-match.png",
  "14-state-loading.png",
  "15-state-empty.png",
  "16-state-error.png",
  "17-keyboard-focus.png",
  "18-tests-passing.png",
];

async function unusedPorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      servers.push(server);
    }
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not reserve a screenshot port.");
      return address.port;
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  }
}

async function waitFor(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Service did not start: ${url}`);
}

async function newPage(browser, url, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

async function waitForRows(page) {
  await page.getByRole("table", { name: "Lab environments" }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".environment-table .learner-button").length === 120,
  );
}

async function getSummary(apiUrl) {
  const response = await fetch(`${apiUrl}/api/session-summary`);
  if (!response.ok) throw new Error(`Could not read the session summary (${response.status}).`);
  return response.json();
}

async function getRows(apiUrl) {
  const response = await fetch(`${apiUrl}/api/environments?pageSize=120`);
  if (!response.ok) throw new Error(`Could not read seeded environments (${response.status}).`);
  return response.json();
}

async function waitForLiveWorkload(page, apiUrl) {
  await waitForRows(page);
  const [rows, summary] = await Promise.all([getRows(apiUrl), getSummary(apiUrl)]);
  assert.equal(rows.items.length, 120, "The fresh seed should contain 120 environments.");
  assert.ok(summary.failed > 0, "The workload should include failed environments.");
  return summary;
}

async function save(page, name) {
  await page.screenshot({ path: path.join(output, name) });
}

const [apiPort, webPort] = await unusedPorts(2);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const env = {
  ...process.env,
  API_PORT: String(apiPort),
  CORS_ORIGINS: webUrl,
  AI_FILTER_PROVIDER: "gemini",
  AI_FILTER_API_KEY: "submission-invalid-key",
  AI_FILTER_MODEL: "gemini-2.0-flash-lite",
  AI_FILTER_BASE_URL: "",
  AI_FILTER_TIMEOUT_MS: "5000",
  AI_FILTER_FAILURE_THRESHOLD: "10",
};
const api = spawn(process.execPath, ["src/server/index.ts"], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: "ignore",
});
const web = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(webPort)], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: "ignore",
});
let browser;
let apiStopped = false;

try {
  await Promise.all([waitFor(`${apiUrl}/api/session-summary`), waitFor(webUrl)]);
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge", headless: true });

  const mainPage = await newPage(browser, webUrl);
  await waitForRows(mainPage);
  console.log("Waiting five minutes after the fresh seed starts before capturing submission screenshots.");
  await mainPage.waitForTimeout(5 * 60 * 1000);
  let warmedSummary = await waitForLiveWorkload(mainPage, apiUrl);
  const stuckDeadline = Date.now() + dashboardConfig.stuckThresholdSeconds * 1000;
  while (warmedSummary.stuck === 0 && Date.now() < stuckDeadline) {
    await mainPage.waitForTimeout(dashboardConfig.simulationIntervalMs);
    warmedSummary = await getSummary(apiUrl);
  }
  assert.ok(warmedSummary.stuck > 0, "The live workload should include stuck learners before screenshots are captured.");
  console.log(`After warm-up: failed=${warmedSummary.failed}, stuck=${warmedSummary.stuck}, total=${warmedSummary.total}.`);

  await save(mainPage, "01-dense-all-120.png");
  const spendBeforeMinute = (await getSummary(apiUrl)).spendUsd;
  await mainPage.waitForTimeout(60_000);
  const spendAfterMinute = (await getSummary(apiUrl)).spendUsd;
  assert.notEqual(spendAfterMinute, spendBeforeMinute, "Spend should visibly move over the following minute.");
  await save(mainPage, "02-dense-60s-later.png");

  await mainPage.getByRole("button", { name: "Compact" }).click();
  await save(mainPage, "03-compact-density.png");
  await mainPage.getByRole("button", { name: "Comfortable" }).click();
  await mainPage.setViewportSize({ width: 1920, height: 1080 });
  await save(mainPage, "04-wide-1920.png");
  await mainPage.setViewportSize({ width: 1280, height: 720 });
  await save(mainPage, "05-laptop-1280.png");
  await mainPage.close();

  const groupsPage = await newPage(browser, webUrl);
  await waitForRows(groupsPage);
  await groupsPage.locator("tr.group-failed").waitFor();
  await groupsPage.locator("tr.group-stuck").waitFor();
  await save(groupsPage, "06-failed-and-stuck-groups.png");

  const failedRow = groupsPage.locator('tr[data-priority="failed"]').first();
  const failedId = await failedRow.locator("[data-row-id]").getAttribute("data-row-id");
  assert.ok(failedId, "A seeded failed environment is required for the inspector screenshots.");
  await failedRow.locator("[data-row-id]").click();
  await groupsPage.locator(".environment-inspector").waitFor();
  await save(groupsPage, "07-inspector-failed-row.png");
  await save(groupsPage, "08-reprovision-before.png");

  const reprovisionResponse = groupsPage.waitForResponse((response) =>
    response.url().endsWith(`/api/environments/${failedId}`)
      && response.request().method() === "PATCH",
  );
  await groupsPage.locator(".environment-inspector").getByRole("button", { name: "Reprovision" }).click();
  const response = await reprovisionResponse;
  assert.equal(response.status(), 200, await response.text());
  await groupsPage.getByText(`Reprovisioning ${failedId}.`, { exact: true }).waitFor();
  await groupsPage.waitForTimeout(dashboardConfig.pollIntervalMs + 300);
  const afterReprovision = await getRows(apiUrl);
  assert.equal(afterReprovision.items.find((item) => item.id === failedId)?.state, "provisioning");
  await groupsPage.locator(".environment-inspector").getByText("Provisioning", { exact: true }).waitFor();
  await save(groupsPage, "09-reprovision-after.png");
  await groupsPage.close();

  const filtersPage = await newPage(browser, webUrl);
  await waitForRows(filtersPage);
  await filtersPage.locator(".state-chips button").nth(1).click();
  await filtersPage.locator("tr.group-failed").waitFor();
  await save(filtersPage, "10-filter-chips-failed.png");

  const aiInput = filtersPage.getByRole("searchbox", { name: "Filter environments" });
  await aiInput.fill("failed environments with quota errors");
  await aiInput.press("Enter");
  await filtersPage.getByText("Model unavailable, parsed locally", { exact: true }).waitFor();
  await filtersPage.getByRole("button", { name: "Remove Failed" }).waitFor();
  await filtersPage.getByRole("button", { name: "Remove Reason: quota" }).waitFor();
  await save(filtersPage, "11-ai-filter-chips.png");

  await aiInput.fill("everyone stuck on step 4 over 20 min");
  await aiInput.press("Enter");
  await filtersPage.getByText("Model unavailable, parsed locally", { exact: true }).waitFor();
  await filtersPage.getByRole("button", { name: "Remove Stuck" }).waitFor();
  await save(filtersPage, "12-ai-model-unavailable.png");

  await aiInput.fill("no-such-learner-identifier-987654");
  await aiInput.press("Enter");
  await filtersPage.getByText("Model unavailable, parsed locally", { exact: true }).waitFor();
  await filtersPage.getByText("No environments match this filter.").waitFor();
  await filtersPage.getByText(/Try: “failed labs with quota errors”/).waitFor();
  await save(filtersPage, "13-ai-no-match.png");
  await filtersPage.close();

  const loadingPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await loadingPage.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await loadingPage.route("**/api/environments?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await loadingPage.goto(webUrl, { waitUntil: "domcontentloaded" });
  await loadingPage.getByRole("status").waitFor({ state: "attached" });
  await save(loadingPage, "14-state-loading.png");
  await loadingPage.close();

  const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await emptyPage.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await emptyPage.route("**/api/environments?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: [],
      total: 0,
      page: 1,
      pageSize: dashboardConfig.environmentCount,
      groups: { failed: 0, stuck: 0, other: 0 },
      updatedAt: new Date().toISOString(),
    }),
  }));
  await emptyPage.route("**/api/session-summary", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      total: 0,
      active: 0,
      failed: 0,
      stuck: 0,
      completed: 0,
      stateCounts: { provisioning: 0, ready: 0, in_use: 0, failed: 0, deprovisioned: 0 },
      averageCompletionPercent: 0,
      spendUsd: 0,
      steps: Array.from({ length: dashboardConfig.stepNames.length }, (_, index) => ({
        step: index + 1,
        learners: 0,
        stuck: 0,
        typicalDurationSeconds: null,
      })),
      updatedAt: new Date().toISOString(),
    }),
  }));
  await emptyPage.goto(webUrl, { waitUntil: "domcontentloaded" });
  await emptyPage.getByText("No environments in this session.").waitFor();
  await save(emptyPage, "15-state-empty.png");
  await emptyPage.close();

  const focusPage = await newPage(browser, webUrl);
  await waitForRows(focusPage);
  const focusedRow = focusPage.locator(".learner-button").nth(1);
  await focusedRow.focus();
  await assert.doesNotReject(() => focusedRow.evaluate((element) => {
    if (document.activeElement !== element) throw new Error("The learner row did not receive keyboard focus.");
  }));
  await save(focusPage, "17-keyboard-focus.png");
  await focusPage.close();

  const errorPage = await newPage(browser, webUrl);
  await waitForRows(errorPage);
  api.kill("SIGTERM");
  apiStopped = true;
  await errorPage.getByRole("alert").waitFor({ timeout: dashboardConfig.pollIntervalMs + 5_000 });
  assert.equal(await errorPage.locator(".learner-button").count(), dashboardConfig.environmentCount);
  await save(errorPage, "16-state-error.png");
  await errorPage.close();

  const requiredNames = new Set(screenshotNames);
  for (const entry of await readdir(output, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:png|jpe?g)$/i.test(entry.name) && !requiredNames.has(entry.name)) {
      await rm(path.join(output, entry.name));
    }
  }
  console.log(`Saved ${screenshotNames.length - 1} dashboard captures in ${output}.`);
  console.log("18-tests-passing.png is captured separately from the real test terminal output.");
  console.log(screenshotNames.filter((name) => name !== "18-tests-passing.png").join("\n"));
} finally {
  await browser?.close();
  if (!apiStopped) api.kill("SIGTERM");
  web.kill("SIGTERM");
}
