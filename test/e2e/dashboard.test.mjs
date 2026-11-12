import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:5173";
const apiUrl = "http://127.0.0.1:3001";
let apiProcess;
let webProcess;
let browser;

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5_000);
  return page;
}

describe("workshop dashboard in Chromium", () => {
  before(async () => {
    const projectRoot = new URL("../../", import.meta.url);
    const cwd = decodeURIComponent(projectRoot.pathname).replace(/^\/(\w:)/, "$1");
    apiProcess = spawn(process.execPath, ["src/server/index.ts"], { cwd, windowsHide: true, stdio: "ignore" });
    webProcess = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], { cwd, windowsHide: true, stdio: "ignore" });
    await Promise.all([waitFor(`${apiUrl}/api/session-summary`), waitFor(baseUrl)]);
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge", headless: true });
  });

  after(async () => {
    await browser?.close();
    apiProcess?.kill();
    webProcess?.kill();
  });

  test("loads the dense 120-environment table and session totals", async () => {
    const page = await newPage();
    await page.goto(baseUrl);
    await page.getByRole("heading", { name: "Workshop operations", level: 1 }).waitFor();
    const table = page.getByRole("table", { name: "Lab environments" });
    await table.waitFor();
    assert.equal(await table.locator("tbody tr").count(), 120);
    assert.match(await page.getByLabel("Session summary").innerText(), /120/);
    await page.close();
  });

  test("puts a skip link first in the keyboard order", async () => {
    const page = await newPage();
    await page.goto(baseUrl);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Skip to content");
    await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).hash, "#main");
    await page.close();
  });

  test("filters by state and learner text through the API", async () => {
    const page = await newPage();
    await page.goto(baseUrl);
    await page.getByRole("table", { name: "Lab environments" }).waitFor();
    await page.getByRole("combobox", { name: "State" }).selectOption("failed");
    const failedRows = page.getByRole("table", { name: "Lab environments" }).locator("tbody tr");
    await failedRows.first().waitFor();
    assert.ok(await failedRows.count() > 0);
    assert.equal(await failedRows.first().getAttribute("data-state"), "failed");
    await page.getByRole("searchbox", { name: "Find labs" }).fill("quota limit reached");
    await page.getByRole("table", { name: "Lab environments" }).locator("tbody tr").first().waitFor();
    assert.ok(await page.getByRole("table", { name: "Lab environments" }).locator("tbody tr").count() > 0);
    await page.close();
  });

  test("selects and reprovisions a failed lab through PATCH", async () => {
    const page = await newPage();
    const failureResponse = await fetch(`${apiUrl}/api/environments?state=failed&pageSize=1`);
    const failures = await failureResponse.json();
    const failedId = failures.items[0].id;
    await page.goto(baseUrl);
    await page.getByRole("table", { name: "Lab environments" }).waitFor();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/environments/${failedId}`) && response.request().method() === "PATCH");
    await page.getByRole("button", { name: `Open lab ${failedId}` }).click();
    await page.getByRole("button", { name: `Reprovision ${failedId}` }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    await page.getByText(`Reprovisioning requested for ${failedId}`).waitFor();
    await page.getByRole("complementary", { name: "Environment details" }).getByText("Provisioning", { exact: true }).waitFor();
    await page.close();
  });

  test("keeps row selection and scroll position during polling", async () => {
    const page = await newPage();
    await page.goto(baseUrl);
    await page.getByRole("table", { name: "Lab environments" }).waitFor();
    await page.getByRole("button", { name: "Open lab LAB-001" }).click();
    const scroller = page.locator("[data-testid='table-scroll']");
    await scroller.evaluate((element) => { element.scrollTop = 240; });
    const previous = await scroller.evaluate((element) => element.scrollTop);
    await page.waitForTimeout(5_500);
    assert.equal(await scroller.evaluate((element) => element.scrollTop), previous);
    assert.match(await page.getByRole("complementary", { name: "Environment details" }).innerText(), /LAB-\d{3}/);
    await page.close();
  });

  test("shows empty and server-error responses", async () => {
    const page = await newPage();
    await page.route("**/api/environments?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 120, updatedAt: "2026-11-12T06:00:00.000Z" }),
    }));
    await page.route("**/api/session-summary", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ total: 0, active: 0, failed: 0, completed: 0, averageCompletionPercent: 0, spendUsd: 0, updatedAt: "2026-11-12T06:00:00.000Z" }),
    }));
    await page.goto(baseUrl);
    await page.getByText("No lab environments in this session.").waitFor();
    await page.unrouteAll();
    await page.route("**/api/environments?*", (route) => route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "about:blank", title: "Service Unavailable", status: 503, detail: "Unavailable", instance: "/api/environments" }),
    }));
    await page.reload();
    await page.getByRole("alert").getByText("The environment list could not be loaded.").waitFor();
    await page.close();
  });

  test("shows loading feedback while the list request is pending", async () => {
    const page = await newPage();
    let release;
    await page.route("**/api/environments?*", async (route) => {
      await new Promise((resolve) => { release = resolve; });
      await route.continue();
    });
    await page.goto(baseUrl);
    await page.getByText("Loading environments…").waitFor();
    release();
    await page.getByRole("table", { name: "Lab environments" }).waitFor();
    await page.close();
  });

  test("uses the at-risk endpoint and filters to its results", async () => {
    const page = await newPage();
    await page.goto(baseUrl);
    await page.getByRole("table", { name: "Lab environments" }).waitFor();
    await page.getByRole("button", { name: "Show at-risk only" }).click();
    await page.getByRole("button", { name: "Show all labs" }).waitFor();
    assert.match(await page.getByLabel("At-risk ranking").innerText(), /rules|AI/i);
    const rows = page.getByRole("table", { name: "Lab environments" }).locator("tbody tr");
    assert.ok(await rows.count() > 0);
    await page.close();
  });
});
