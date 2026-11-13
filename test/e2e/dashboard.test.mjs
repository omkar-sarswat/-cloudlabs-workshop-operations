import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

let baseUrl;
let apiUrl;
let apiProcess;
let webProcess;
let browser;

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
      if (!address || typeof address === "string") throw new Error("Couldn't allocate a test port.");
      return address.port;
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  }
}

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Service did not become ready: " + url);
}

async function newPage(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(10_000);
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  return page;
}

async function waitForRows(page) {
  await page.getByRole("table", { name: "Lab environments" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".learner-button").length === 120);
}

describe("workshop dashboard in Chromium", () => {
  before(async () => {
    const projectRoot = new URL("../../", import.meta.url);
    const cwd = decodeURIComponent(projectRoot.pathname).replace(/^\/(\w:)/, "$1");
    const [apiPort, webPort] = await unusedPorts(2);
    apiUrl = "http://127.0.0.1:" + apiPort;
    baseUrl = "http://127.0.0.1:" + webPort;
    const env = {
      ...process.env,
      API_PORT: String(apiPort),
      CORS_ORIGINS: "http://127.0.0.1:" + webPort,
    };
    apiProcess = spawn(process.execPath, ["src/server/index.ts"], { cwd, env, windowsHide: true, stdio: "ignore" });
    webProcess = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(webPort)], { cwd, env, windowsHide: true, stdio: "ignore" });
    await Promise.all([waitFor(apiUrl + "/api/session-summary"), waitFor(baseUrl)]);
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge", headless: true });
  });

  after(async () => {
    await browser?.close();
    apiProcess?.kill();
    webProcess?.kill();
  });

  test("loads all 120 rows without page scrolling or a stale parser label", async () => {
    const page = await newPage();
    await waitForRows(page);
    assert.equal(await page.locator(".parse-source").count(), 0);
    assert.ok(await page.getByLabel("Session summary").isVisible());
    assert.equal(await page.locator(".learner-button").count(), 120);
    assert.deepEqual(
      await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]),
      [1440, 900],
    );
    await page.close();
  });

  test("uses a type-only wordmark and text-first operational states", async () => {
    const page = await newPage();
    await waitForRows(page);
    const visualArtifacts = await page.evaluate(() => ({
      wordmarkBefore: getComputedStyle(document.querySelector(".wordmark"), "::before").content,
      statusIcons: document.querySelectorAll(".status-icon").length,
      stepStateSquares: document.querySelectorAll(".mini-stuck-square").length,
    }));
    assert.equal(visualArtifacts.wordmarkBefore, "none");
    assert.equal(visualArtifacts.statusIcons, 0);
    assert.equal(visualArtifacts.stepStateSquares, 0);
    await page.close();
  });

  test("fills wide viewports without stretched gaps, clipping, or misaligned columns", async () => {
    const viewports = [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 3440, height: 1440 },
    ];
    const screenshotDirectory = path.resolve("screenshots", "wide-review");
    await mkdir(screenshotDirectory, { recursive: true });
    const page = await newPage(viewports[0]);
    await waitForRows(page);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Comfortable" }).click();
      await page.waitForTimeout(50);
      const comfortable = await page.evaluate(() => {
        const visible = (element) => getComputedStyle(element).display !== "none";
        const tableScroll = document.querySelector(".table-scroll");
        const table = document.querySelector(".environment-table");
        const workspace = document.querySelector(".workspace");
        const inspector = document.querySelector(".inspector");
        const pageContent = document.querySelector(".page-content");
        const header = document.querySelector(".topbar");
        const summary = document.querySelector(".summary-strip");
        const summaryItems = [...summary.querySelectorAll(".summary-item")];
        const figureItems = summaryItems.slice(0, 5);
        const summaryItemRects = figureItems.map((item) => item.getBoundingClientRect());
        const figureRects = figureItems.map((item) => item.querySelector(".summary-value").getBoundingClientRect());
        const figureTextRects = figureItems.map((item) => {
          const value = item.querySelector(".summary-value");
          const range = document.createRange();
          range.selectNodeContents(value);
          return range.getBoundingClientRect();
        });
        const labelRects = figureItems.map((item) => item.querySelector("dt").getBoundingClientRect());
        const numberStyles = figureItems.map((item) => getComputedStyle(item.querySelector(".summary-value")));
        const summaryCells = summaryItems.map((item) => item.getBoundingClientRect());
        const composition = summary.querySelector(".distribution-bar");
        const environmentsCell = summary.querySelector(".summary-environments");
        const segments = [...composition.querySelectorAll(".distribution-segment")];
        const segmentRects = segments.map((segment) => segment.getBoundingClientRect());
        const summaryStyle = getComputedStyle(summary);
        const panelHex = getComputedStyle(document.documentElement).getPropertyValue("--color-panel").trim();
        const panelChannels = [1, 3, 5].map((index) => Number.parseInt(panelHex.slice(index, index + 2), 16));
        const tokenNames = {
          "segment-failed": "--color-failed",
          "segment-provisioning": "--color-provisioning",
          "segment-ready": "--color-ready-segment",
          "segment-in_use": "--color-in-use-segment",
          "segment-deprovisioned": "--color-neutral-segment",
        };
        const tokenHex = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase();
        const hexToRgb = (hex) => {
          const value = hex.slice(1);
          return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
        };
        const luminance = (hex) => {
          const linear = hexToRgb(hex).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const ratio = (first, second) => {
          const a = luminance(first);
          const b = luminance(second);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const segmentColors = segments.map((segment) => getComputedStyle(segment).backgroundColor);
        const segmentClasses = segments.map((segment) => [...segment.classList].find((name) => name.startsWith("segment-")));
        const adjacentColorRatios = segmentClasses.slice(1).map((name, index) =>
          ratio(tokenHex(tokenNames[segmentClasses[index]]), tokenHex(tokenNames[name])),
        );
        const filters = document.querySelector(".filter-band");
        const rows = [...document.querySelectorAll("tr[data-priority]")];
        const tokenStyle = getComputedStyle(document.documentElement);
        const tokenColors = new Set(Array.from({ length: tokenStyle.length }, (_, index) => tokenStyle.item(index))
          .filter((name) => name.startsWith("--color-"))
          .map((name) => tokenStyle.getPropertyValue(name).trim().toLowerCase()));
        const rgbToHex = (value) => {
          const channels = value.match(/\d+/g);
          if (!channels || channels.length < 3) return value.toLowerCase();
          return "#" + channels.slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("");
        };
        const styles = [...document.querySelectorAll("body *")].filter(visible).map((element) => {
          const style = getComputedStyle(element);
          return { style, element };
        });
        const badColors = styles.flatMap(({ style, element }) => ["color", "backgroundColor"].flatMap((property) => {
          const value = style[property];
          return value === "transparent" || value === "rgba(0, 0, 0, 0)" || tokenColors.has(rgbToHex(value))
            ? []
            : [{ property, value, tag: element.tagName, className: element.className }];
        }));
        const badFonts = styles.filter(({ style, element }) => {
          const family = style.fontFamily.toLowerCase();
          if (!family.includes("geist")) return true;
          return family.includes("mono") && !element.closest(".environment-id, .name-id-value");
        }).map(({ element, style }) => ({ family: style.fontFamily, className: element.className }));
        const badText = styles.filter(({ style }) => style.textTransform === "uppercase");
        const shadowsWithBorders = styles.filter(({ style }) => style.boxShadow !== "none"
          && ["Top", "Right", "Bottom", "Left"].some((side) => Number.parseFloat(style[`border${side}Width`]) > 0));
        const gradients = styles.filter(({ style }) => style.backgroundImage.includes("gradient"));
        const clippedText = [...document.querySelectorAll(".cell-content, .cell-content *")]
          .filter((element) => visible(element))
          .filter((element) => ["hidden", "clip"].includes(getComputedStyle(element).overflowX)
            && element.scrollWidth > element.clientWidth + 1);
        const rowHeights = rows.map((row) => row.getBoundingClientRect().height);
        const wrapperGaps = rows.flatMap((row) => {
          const contents = [...row.children].filter(visible)
            .map((cell) => ({ cell, content: cell.querySelector(".cell-content") }))
            .filter(({ content }) => content)
            .map(({ cell, content }) => ({ numeric: cell.classList.contains("numeric"), rect: content.getBoundingClientRect() }));
          return contents.slice(1).flatMap((content, index) => content.numeric
            ? []
            : [content.rect.left - contents[index].rect.right]);
        });
        const textOverlaps = rows.some((row) => {
          const cells = [...row.children].filter(visible);
          const leafRects = cells.flatMap((cell) => {
            const root = cell.querySelector(".cell-content");
            if (!root) return [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const rects = [];
            while (walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(walker.currentNode);
              const rect = range.getBoundingClientRect();
              if (rect.width && rect.height) rects.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
            }
            return rects;
          });
          return leafRects.some((rect, index) => leafRects.slice(index + 1).some((other) =>
            rect.left < other.right - 1 && other.left < rect.right - 1
            && rect.top < other.bottom - 1 && other.top < rect.bottom - 1,
          ));
        });
        const nameIdGaps = [...document.querySelectorAll(".name-id")].filter(visible).map((pair) => {
          const name = pair.querySelector(".name-id-name").getBoundingClientRect();
          const id = pair.querySelector(".name-id-value").getBoundingClientRect();
          return id.left - name.right;
        });
        const timeHeader = [...document.querySelectorAll("thead th")].find((cell) => cell.textContent.trim() === "Time on step");
        const spendHeader = [...document.querySelectorAll("thead th")].find((cell) => cell.textContent.trim() === "Spend");
        const bodyTimeEdges = rows.map((row) => row.querySelector(".time-cell").getBoundingClientRect().right);
        const bodySpendEdges = rows.map((row) => row.querySelector(".spend-cell").getBoundingClientRect().right);
        const visibleRowCount = rows.filter((row) => {
          const rect = row.getBoundingClientRect();
          const bounds = tableScroll.getBoundingClientRect();
          return rect.top < bounds.bottom && rect.bottom > bounds.top + 32;
        }).length;
        return {
          viewport: innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          tableScrollWidth: tableScroll.scrollWidth,
          tableClientWidth: tableScroll.clientWidth,
          tableWidth: table.getBoundingClientRect().width,
          workspace: { left: workspace.getBoundingClientRect().left, right: workspace.getBoundingClientRect().right },
          tableScrollLeft: tableScroll.getBoundingClientRect().left,
          inspector: { visible: visible(inspector), left: inspector.getBoundingClientRect().left, right: inspector.getBoundingClientRect().right, width: inspector.getBoundingClientRect().width },
          contentEdges: [header.getBoundingClientRect().left + 24, summary.getBoundingClientRect().left, filters.getBoundingClientRect().left, pageContent.getBoundingClientRect().right - 24],
          summaryHeight: summary.getBoundingClientRect().height,
          summaryPanel: {
            background: summaryStyle.backgroundColor,
            border: summaryStyle.borderTopWidth,
            borderColor: summaryStyle.borderTopColor,
            radius: summaryStyle.borderTopLeftRadius,
            shadow: summaryStyle.boxShadow,
            expectedColor: `rgb(${panelChannels.join(", ")})`,
          },
          summaryLabelsAboveFigures: labelRects.every((label, index) => label.bottom < figureRects[index].top),
          summaryLabelNumberXSpread: Math.max(...figureItems.map((item) => {
            const label = item.querySelector("dt").getBoundingClientRect();
            const number = item.querySelector(".summary-value").getBoundingClientRect();
            return Math.abs(label.left - number.left);
          })),
          summaryNumberStyles: [...new Set(numberStyles.map((style) => `${style.fontSize}/${style.fontWeight}`))],
          summaryFigureBaselineSpread: Math.max(...figureRects.map((rect) => rect.bottom)) - Math.min(...figureRects.map((rect) => rect.bottom)),
          summaryMarkersInLabels: figureItems.slice(0, 2).every((item) => item.querySelector("dt .status-marker"))
            && figureItems.every((item) => !item.querySelector("dd .status-marker")),
          summaryBarStartGap: composition.getBoundingClientRect().left - environmentsCell.getBoundingClientRect().left,
          summaryBarEndGap: environmentsCell.getBoundingClientRect().right - composition.getBoundingClientRect().right,
          summaryBarWidth: composition.getBoundingClientRect().width,
          summaryBarSegmentHeights: [...new Set(segmentRects.map((rect) => rect.height))],
          summaryBarSegmentWidths: segmentRects.map((rect) => rect.width),
          summaryBarSegmentGaps: segmentRects.slice(1).map((rect, index) => rect.left - segmentRects[index].right),
          summaryFigureWidths: summaryItemRects.map((rect) => rect.width),
          summaryFigureLeftGaps: summaryItemRects.slice(1).map((rect, index) => rect.left - summaryItemRects[index].left),
          summaryBarRight: composition.getBoundingClientRect().right,
          summaryBarExpectedWidth: environmentsCell.getBoundingClientRect().width - 48,
          summaryBarColorsMatchTokens: segments.every((segment, index) => {
            const token = tokenHex(tokenNames[segmentClasses[index]]);
            const [red, green, blue] = hexToRgb(token);
            return getComputedStyle(segment).backgroundColor === `rgb(${red}, ${green}, ${blue})`;
          }),
          adjacentColorRatios,
          barCenterOffsetFromFigures: Math.abs(
            (composition.getBoundingClientRect().top + composition.getBoundingClientRect().bottom) / 2
            - (figureTextRects[0].top + figureTextRects[0].bottom) / 2,
          ),
          verticalRhythm: {
            headerToBand: summary.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
            bandToChips: filters.getBoundingClientRect().top - summary.getBoundingClientRect().bottom,
            chipsToTable: workspace.getBoundingClientRect().top - filters.getBoundingClientRect().bottom,
          },
          runningColumnVisible: [...document.querySelectorAll(".running-column")].some(visible),
          runningColumnRightAligned: [...document.querySelectorAll(".running-column")].filter(visible)
            .every((cell) => (cell.classList.contains("numeric") || cell.classList.contains("numeric-heading"))
              && getComputedStyle(cell).textAlign === "right"),
          runningValuesMatchFormat: [...document.querySelectorAll(".running-cell")].filter(visible)
            .every((cell) => /^(?:\d+m|\d+h \d+m)$/.test(cell.textContent.trim())),
          rowHeights: [...new Set(rowHeights)],
          visibleRowCount,
          maxWrapperGap: Math.max(0, ...wrapperGaps),
          textOverlaps,
          minNameIdGap: Math.min(...nameIdGaps),
          numericAlignment: bodyTimeEdges.every((edge) => Math.abs(edge - timeHeader.getBoundingClientRect().right) < 1)
            && bodySpendEdges.every((edge) => Math.abs(edge - spendHeader.getBoundingClientRect().right) < 1),
          badColors,
          badFonts,
          uppercaseTextCount: badText.length,
          clippedTextCount: clippedText.length,
          shadowsWithBordersCount: shadowsWithBorders.length,
          gradientsCount: gradients.length,
        };
      });

      const expectCheck = (condition, name) => {
        console.log(`${condition ? "PASS" : "FAIL"} ${viewport.width} comfortable: ${name}`);
        assert.ok(condition, `${viewport.width} comfortable: ${name}`);
      };
      expectCheck(comfortable.pageWidth === viewport.width, "no horizontal page overflow");
      expectCheck(comfortable.tableScrollWidth <= comfortable.tableClientWidth + 1, "no horizontal table overflow");
      expectCheck(Math.abs(comfortable.tableScrollLeft - 24) < 1, "table starts at 24px");
      expectCheck(Math.abs(comfortable.workspace.right - (viewport.width - 24)) < 1, "workspace ends at viewport minus 24px");
      expectCheck(comfortable.inspector.visible === (viewport.width >= 1440), "inspector docks from 1440px");
      if (comfortable.inspector.visible) {
        expectCheck(Math.abs(comfortable.inspector.right - (viewport.width - 24)) < 1, "inspector ends at viewport minus 24px");
        expectCheck(Math.abs(comfortable.inspector.width - Math.max(320, Math.min(440, viewport.width * 0.22))) < 1, "inspector follows its clamp width");
      }
      expectCheck(comfortable.runningColumnVisible === (viewport.width >= 1920), "Running appears only from 1920px");
        if (viewport.width >= 1920) {
          expectCheck(comfortable.runningColumnRightAligned && comfortable.runningValuesMatchFormat,
            "Running is right-aligned and uses the runtime format");
        }
      expectCheck(comfortable.summaryHeight === 96, "summary band is exactly 96px tall");
      expectCheck(comfortable.summaryPanel.background === comfortable.summaryPanel.expectedColor
        && comfortable.summaryPanel.border === "1px"
        && comfortable.summaryPanel.borderColor === "rgb(217, 217, 217)"
        && comfortable.summaryPanel.radius === "8px"
        && comfortable.summaryPanel.shadow === "none", "summary panel uses the white, hairline, rounded treatment");
      expectCheck(comfortable.summaryLabelsAboveFigures, "summary labels sit above their figures");
      expectCheck(Math.max(...comfortable.summaryFigureWidths) - Math.min(...comfortable.summaryFigureWidths) < 1
        && Math.max(...comfortable.summaryFigureLeftGaps) - Math.min(...comfortable.summaryFigureLeftGaps) < 1,
      "figure columns are evenly spaced and equal width");
      expectCheck(comfortable.summaryNumberStyles.length === 1 && comfortable.summaryNumberStyles[0] === "36px/600",
        "all five figures use 36px/600 type");
      expectCheck(comfortable.summaryLabelNumberXSpread < 1, "each number aligns with its label");
      expectCheck(comfortable.summaryFigureBaselineSpread < 1, "all five numbers share one baseline");
      expectCheck(comfortable.summaryMarkersInLabels, "failed and stuck markers stay in the label row");
      expectCheck(Math.abs(comfortable.summaryBarStartGap - 24) < 1 && Math.abs(comfortable.summaryBarEndGap - 24) < 1,
      "bar has 24px side padding in the sixth cell");
      expectCheck(Math.abs(comfortable.summaryBarWidth - comfortable.summaryBarExpectedWidth) < 1
        && comfortable.summaryBarSegmentHeights.length === 1
        && comfortable.summaryBarSegmentHeights[0] === 10, "bar is 10px tall and fills the cell minus 48px");
      expectCheck(comfortable.summaryBarSegmentWidths.every((width) => width >= 8), "composition segments respect the 8px minimum");
      expectCheck(comfortable.summaryBarSegmentGaps.every((gap) => Math.abs(gap - 2) < 1)
        && comfortable.summaryBarColorsMatchTokens, "segments have 2px gaps and use their status tokens");
      console.log(`${viewport.width} neighboring segment contrast: ${comfortable.adjacentColorRatios.map((ratio) => ratio.toFixed(2) + ":1").join(", ")}`);
      expectCheck(comfortable.barCenterOffsetFromFigures < 4, "composition bar is centered against the figures");
      expectCheck(comfortable.verticalRhythm.headerToBand === 16 && comfortable.verticalRhythm.bandToChips === 12
        && comfortable.verticalRhythm.chipsToTable === 12, "header, band, chips, and table spacing matches the spec");
      expectCheck(comfortable.rowHeights.length === 1 && comfortable.rowHeights[0] === 40, "comfortable rows are exactly 40px");
      expectCheck(comfortable.maxWrapperGap <= 64, "cell-content gaps stay within 64px");
      expectCheck(!comfortable.textOverlaps && comfortable.minNameIdGap >= 8, "table text does not overlap and name/ID gap is at least 8px");
      expectCheck(comfortable.numericAlignment, "Time and Spend right edges align");
      expectCheck(comfortable.badColors.length === 0, "computed colors come from tokens");
      expectCheck(comfortable.badFonts.length === 0 && comfortable.uppercaseTextCount === 0, "type uses Geist and sentence case");
      expectCheck(comfortable.clippedTextCount === 0, "table text is not clipped");
      expectCheck(comfortable.shadowsWithBordersCount === 0 && comfortable.gradientsCount === 0, "no border-shadow combination or gradients");
      if (viewport.width === 1440) {
        expectCheck(comfortable.visibleRowCount >= 14, "at least 14 comfortable rows are visible");
      }

      await page.screenshot({ path: path.join(screenshotDirectory, `${viewport.width}x${viewport.height}.png`) });
      if ([1280, 1440, 1920, 2560].includes(viewport.width)) {
        await page.locator(".summary-strip").screenshot({ path: path.join(screenshotDirectory, `summary-${viewport.width}.png`) });
      }
      await page.getByRole("button", { name: "Compact" }).click();
      await page.waitForTimeout(50);
      const compact = await page.evaluate(() => [...document.querySelectorAll("tr[data-priority]")]
        .map((row) => row.getBoundingClientRect().height));
      const compactHeights = [...new Set(compact)];
      const compactPass = compactHeights.length === 1 && compactHeights[0] === 32;
      console.log(`${compactPass ? "PASS" : "FAIL"} ${viewport.width} compact: rows are exactly 32px`);
      assert.ok(compactPass, `${viewport.width} compact: rows are exactly 32px`);
      if (viewport.width === 1440) {
        const visibleCompactRows = await page.evaluate(() => {
          const bounds = document.querySelector(".table-scroll").getBoundingClientRect();
          return [...document.querySelectorAll("tr[data-priority]")].filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top < bounds.bottom && rect.bottom > bounds.top + 32;
          }).length;
        });
        const compactVisiblePass = visibleCompactRows >= 17;
        console.log(`${compactVisiblePass ? "PASS" : "FAIL"} 1440 compact: at least 17 rows are visible`);
        assert.ok(compactVisiblePass, `1440 compact: ${visibleCompactRows} visible rows`);
      }
    }
    await page.close();
  });

  test("uses the compact white table, state filters, and step overview geometry", async () => {
    const page = await newPage();
    await waitForRows(page);
    await page.locator(".step-overview-row").first().waitFor();
    await page.locator(".step-meter-segment").first().waitFor();
    const metrics = await page.evaluate(() => {
      const row = document.querySelector(".environment-table tr[data-priority]");
      const firstTrack = document.querySelector(".step-meter-segment");
      const panel = document.querySelector(".inspector");
      const overviewRow = document.querySelector(".step-overview-row");
      return {
        rowHeight: row.getBoundingClientRect().height,
        rowBackground: getComputedStyle(row).backgroundColor,
        columns: [...row.children].filter((cell) => getComputedStyle(cell).display !== "none")
          .slice(0, 6).map((cell) => Math.round(cell.getBoundingClientRect().width)),
        tick: [firstTrack.getBoundingClientRect().width, firstTrack.getBoundingClientRect().height],
        panelWidth: panel.getBoundingClientRect().width,
        panelBackground: getComputedStyle(panel).backgroundColor,
        overviewRowHeight: overviewRow.getBoundingClientRect().height,
        healthyShapes: [...document.querySelectorAll(".status-line")]
          .filter((line) => ["Ready", "In use", "Deprovisioned"].includes(line.textContent.trim()))
          .filter((line) => line.querySelector("svg")).length,
        headerCase: document.querySelector("thead th").textContent,
      };
    });
    assert.equal(metrics.rowHeight, 40);
    assert.equal(metrics.rowBackground, "rgb(255, 255, 255)");
    assert.deepEqual(metrics.columns, [120, 220, 160, 150, 96, 72]);
    assert.deepEqual(metrics.tick, [10, 6]);
    assert.equal(metrics.panelWidth, 320);
    assert.equal(metrics.panelBackground, "rgb(255, 255, 255)");
    assert.equal(metrics.overviewRowHeight, 28);
    assert.equal(metrics.healthyShapes, 0);
    assert.equal(metrics.headerCase, "State");
    for (const label of ["All", "Failed", "Stuck", "Provisioning", "Ready", "In use", "Deprovisioned"]) {
      await page.getByRole("button", { name: new RegExp("^" + label.replace(" ", "\\s") + " \\d+$") }).waitFor();
    }
    assert.equal(await page.locator(".distribution-bar").count(), 1);
    assert.equal(await page.locator(".step-overview-row").count(), 8);
    await page.getByRole("button", { name: "Compact" }).click();
    assert.equal(await page.locator('.app-shell').evaluate((el) => getComputedStyle(el).getPropertyValue("--height-row").trim()), "32px");
    await page.close();
  });

  test("keeps the table usable without horizontal page scroll at 390px", async () => {
    const page = await newPage({ width: 390, height: 844 });
    await waitForRows(page);
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      bar: document.querySelector(".distribution-bar").getBoundingClientRect().toJSON(),
      figures: [...document.querySelectorAll(".summary-value")].map((figure) => figure.getBoundingClientRect()),
      summary: document.querySelector(".summary-strip").getBoundingClientRect().toJSON(),
    }));
    assert.ok(overflow.page <= overflow.viewport);
    assert.equal(overflow.bar.left, overflow.summary.left + 25);
    assert.ok(Math.abs(overflow.bar.width - (overflow.summary.width - 50)) < 1);
    assert.ok(overflow.bar.top >= Math.max(...overflow.figures.map((figure) => figure.bottom)));
    await page.close();
  });

  test("uses server severity groups and server order in the table", async () => {
    const page = await newPage();
    await waitForRows(page);
    const groups = await page.locator(".group-heading").allInnerTexts();
    assert.match(groups[0], /^Failed\s*\(\d+\)$/);
    assert.match(groups[1], /^Stuck\s*\(\d+\)$/);
    assert.match(groups[2], /^Everything else\s*\(\d+\)$/);
    const priorities = await page.locator(".learner-button").evaluateAll((buttons) => {
      const order = { failed: 0, stuck: 1, other: 2 };
      return buttons.map((button) => order[button.closest("tr").dataset.priority]);
    });
    assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));
    assert.equal(await page.locator(".queue-item").count(), 0);
    await page.close();
  });

  test("makes composition segments focusable, descriptive, and filterable", async () => {
    const page = await newPage();
    await waitForRows(page);
    const failedSegment = page.locator(".distribution-segment.segment-failed");
    await failedSegment.focus();
    assert.equal(await page.locator(".distribution-bar").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator(".tooltip-anchor:has(.distribution-segment.segment-failed) .tooltip-content")
      .evaluate((tooltip) => getComputedStyle(tooltip).display), "block");
    await failedSegment.click();
    assert.equal(await page.getByRole("button", { name: /^Failed \d+$/ }).getAttribute("aria-pressed"), "true");
    assert.ok(await page.locator(".learner-button").evaluateAll((buttons) =>
      buttons.every((button) => button.closest("tr").dataset.priority === "failed"),
    ));
    await page.close();
  });

  test("uses the same time format in the table and selected inspector", async () => {
    const page = await newPage();
    await waitForRows(page);
    const row = page.locator('tr[data-priority="stuck"] .learner-button').first();
    const tableTime = page.locator('tr[data-priority="stuck"] .time-cell').first();
    assert.match((await tableTime.innerText()).replace(/\s+/g, " "), /^stuck (?:[0-9]{2}:[0-9]{2}|[0-9]+h [0-9]+m)$/);
    await row.click();
    const inspectorTime = await page.locator(".environment-inspector .current-step-time .time-on-step").innerText();
    assert.match(inspectorTime.replace(/\s+/g, " "), /^stuck (?:[0-9]{2}:[0-9]{2}|[0-9]+h [0-9]+m)$/);
    await page.close();
  });
  test("renders the step track without overlap and target fields without ellipses", async () => {
    const page = await newPage();
    await waitForRows(page);
    const result = await page.evaluate(() => ({
      overlap: [...document.querySelectorAll(".step-cell")].some((cell) => {
        const track = cell.querySelector(".step-meter-segments");
        const count = cell.querySelector(".step-meter-count");
        if (!track || !count) return false;
        return track.getBoundingClientRect().right > count.getBoundingClientRect().left;
      }),
      provisioningHasNoTicks: [...document.querySelectorAll("tr")]
        .filter((row) => row.querySelector(".marker-provisioning"))
        .every((row) => !row.querySelector(".step-meter")),
      ellipsized: [...document.querySelectorAll(".lab-cell, .environment-id, .queue-reason")]
        .some((field) => getComputedStyle(field).textOverflow === "ellipsis"),
      tickCount: [...document.querySelectorAll(".step-meter-segments")].length > 0
        && [...document.querySelectorAll(".step-meter-segments")]
          .every((track) => track.querySelectorAll(".step-meter-segment").length === 8),
      tickStates: [...document.querySelectorAll(".step-meter-segment")].map((tick) =>
        [...tick.classList].find((name) => name.startsWith("segment-")),
      ),
    }));
    assert.equal(result.overlap, false);
    assert.equal(result.ellipsized, false);
    assert.equal(result.provisioningHasNoTicks, true);
    assert.equal(result.tickCount, true);
    assert.equal(new Set(result.tickStates).size, 3);
    await page.close();
  });

  test("filters from the step overview and the single command field", async () => {
    const page = await newPage();
    await waitForRows(page);
    await page.getByRole("button", { name: "Filter table to step 1" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".learner-button")].every((button) => {
      const count = button.closest("tr").querySelector(".step-count");
      return count?.textContent?.startsWith("0/") || button.closest("tr").querySelector(".step-state");
    }));
    await page.getByRole("searchbox", { name: "Filter environments" }).fill("quota");
    await page.waitForTimeout(350);
    assert.ok(await page.locator(".learner-button").count() > 0);
    assert.equal(await page.locator(".parse-source").innerText(), "Parsed locally");
    await page.close();
  });
  test("supports j, Enter, Escape, slash, and the shortcut popover", async () => {
    const page = await newPage();
    await waitForRows(page);
    await page.keyboard.press("j");
    assert.match(await page.evaluate(() => document.activeElement?.getAttribute("data-row-id") ?? ""), /^LAB-[0-9]{3}$/);
    await page.keyboard.press("Enter");
    await page.locator(".environment-inspector").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Where the class is" }).waitFor();
    await page.keyboard.press("/");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Filter environments");
    await page.getByRole("searchbox", { name: "Filter environments" }).blur();
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
    await page.close();
  });
  test("selects a row from any cell without waiting for a transition", async () => {
    const page = await newPage();
    await waitForRows(page);
    const row = page.locator('tr[data-priority="other"]').first();
    const result = await row.evaluate(async (element) => {
      const start = performance.now();
      element.querySelector(".lab-cell").click();
      await new Promise(requestAnimationFrame);
      return { selected: element.getAttribute("aria-selected"), elapsedMs: performance.now() - start };
    });
    assert.equal(result.selected, "true");
    assert.ok(result.elapsedMs < 100, `Row selection took ${result.elapsedMs.toFixed(1)}ms`);
    await page.close();
  });
  test("reprovisions a failed environment through the inspector action", async () => {
    const failureResponse = await fetch(apiUrl + "/api/environments?state=failed&pageSize=1");
    const failurePage = await failureResponse.json();
    const failedId = failurePage.items[0].id;
    const page = await newPage();
    await waitForRows(page);
    await page.locator('[data-row-id="' + failedId + '"]').click();
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/environments/" + failedId) && response.request().method() === "PATCH",
    );
    await page.locator(".environment-inspector").getByRole("button", { name: "Reprovision" }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, await response.text());
    await page.getByText("Reprovisioning " + failedId + ".", { exact: true }).waitFor();
    await page.locator(".environment-inspector").getByText("Provisioning", { exact: true }).waitFor();
    await page.close();
  });

  test("preserves row selection and scroll through polling", async () => {
    const failures = await (await fetch(apiUrl + "/api/environments?state=failed&pageSize=1")).json();
    const failedId = failures.items[0].id;
    const page = await newPage();
    await waitForRows(page);
    await page.locator('[data-row-id="' + failedId + '"]').evaluate((button) => button.closest("tr").querySelector(".lab-cell").click());
    const selectedRowStyles = await page.locator('tr.is-selected').evaluate((row) => ({
      background: getComputedStyle(row).backgroundColor,
      rail: getComputedStyle(row.querySelector("td")).boxShadow,
    }));
    assert.equal(selectedRowStyles.background, "rgb(232, 232, 232)");
    assert.equal(selectedRowStyles.rail, "none");
    const scroller = page.locator("[data-testid='table-scroll']");
    await scroller.evaluate((element) => { element.scrollTop = 240; });
    const previous = await scroller.evaluate((element) => element.scrollTop);
    await page.waitForTimeout(5_500);
    assert.equal(await scroller.evaluate((element) => element.scrollTop), previous);
    assert.match(await page.locator(".environment-inspector").innerText(), new RegExp(failedId));
    await page.close();
  });

  test("shows loading, empty, and server-error states", async () => {
    const emptyPage = await newPage();
    await emptyPage.route("**/api/environments?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 120, groups: { failed: 0, stuck: 0, other: 0 }, updatedAt: new Date().toISOString() }),
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
        steps: Array.from({ length: 8 }, (_, index) => ({ step: index + 1, learners: 0, stuck: 0, typicalDurationSeconds: null })),
        updatedAt: new Date().toISOString(),
      }),
    }));
    await emptyPage.reload({ waitUntil: "domcontentloaded" });
    await emptyPage.getByText("No environments in this session.").waitFor();
    await emptyPage.unrouteAll();
    await emptyPage.route("**/api/environments?*", (route) => route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "about:blank", title: "Service Unavailable", status: 503, detail: "Unavailable", instance: "/api/environments" }),
    }));
    await emptyPage.reload({ waitUntil: "domcontentloaded" });
    assert.match(await emptyPage.getByRole("alert").innerText(), /Couldn't reach the server/);
    await emptyPage.close();

    const loadingPage = await newPage();
    const releases = [];
    await loadingPage.route("**/api/environments?*", async (route) => {
      await new Promise((resolve) => releases.push(resolve));
      await route.continue();
    });
    await loadingPage.reload({ waitUntil: "domcontentloaded" });
    await loadingPage.getByRole("status").waitFor({ state: "attached" });
    assert.match(await loadingPage.getByRole("status").innerText(), /Loading environments/);
    for (const release of releases) release();
    await loadingPage.getByRole("table", { name: "Lab environments" }).waitFor();
    await loadingPage.close();
  });

  test("submits AI filters on Enter, shows removable chips, match counts, and fallback state", async () => {
    const screenshotDirectory = path.resolve("screenshots", "submission");
    await mkdir(screenshotDirectory, { recursive: true });
    const page = await newPage();
    await waitForRows(page);

    let responseBody = {
      source: "model",
      query: { states: ["failed"], failureReasonContains: "quota" },
    };
    let aiRequests = 0;
    await page.route("**/api/ai/filter", async (route) => {
      aiRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responseBody),
      });
    });

    const input = page.getByRole("searchbox", { name: "Filter environments" });
    await input.fill("failed environments with quota errors");
    await page.waitForTimeout(350);
    assert.equal(aiRequests, 0, "typing alone must not start a parse request");
    await input.press("Enter");
    await page.getByText("Parsed by model", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove Failed" }).waitFor();
    await page.getByRole("button", { name: "Remove Reason: quota" }).waitFor();
    assert.match(await page.locator(".match-count").innerText(), /^\d+ matched$/);
    await page.screenshot({ path: path.join(screenshotDirectory, "ai-filter-parsed-by-model.png") });
    await page.screenshot({ path: path.join(screenshotDirectory, "ai-filter-chips-shown.png") });

    await page.getByRole("button", { name: "Remove Failed" }).click();
    await page.getByRole("button", { name: "Remove Failed" }).waitFor({ state: "detached" });

    responseBody = {
      source: "rules",
      reason: "unavailable",
      query: { states: ["ready"] },
    };
    await input.fill("ready environments");
    await input.press("Enter");
    await page.getByText("Model unavailable, parsed locally", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove Ready" }).waitFor();
    await page.screenshot({ path: path.join(screenshotDirectory, "ai-filter-fallback-after-failure.png") });

    responseBody = {
      source: "rules",
      reason: "unavailable",
      query: { search: "no-such-learner-identifier" },
    };
    await input.fill("no-such-learner-identifier");
    await input.press("Enter");
    await page.getByText("Model unavailable, parsed locally", { exact: true }).waitFor();
    await page.getByText("No environments match this filter.").waitFor();
    await page.getByText(/Try: “failed labs with quota errors”/).waitFor();
    await page.screenshot({ path: path.join(screenshotDirectory, "ai-filter-no-match.png") });
    await input.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".learner-button").length === 120);

    let releaseParsing;
    let parsingRequestStarted;
    const parsingStarted = new Promise((resolve) => { parsingRequestStarted = resolve; });
    responseBody = { source: "model", query: { states: ["failed"] } };
    await page.unroute("**/api/ai/filter");
    await page.route("**/api/ai/filter", async (route) => {
      parsingRequestStarted();
      await new Promise((resolve) => { releaseParsing = resolve; });
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(responseBody),
        });
      } catch {
        // The request may be aborted when the page closes.
      }
    });
    await input.fill("failed labs");
    await input.press("Enter");
    await parsingStarted;
    await page.getByText("Parsing", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshotDirectory, "ai-filter-parsing.png") });
    releaseParsing();
    await page.getByText("Parsed by model", { exact: true }).waitFor();
    await page.close();
  });

  test("uses the rules parser without a provider and clears the applied query with Escape", {
    skip: Boolean(process.env.AI_FILTER_PROVIDER && process.env.AI_FILTER_PROVIDER !== "rules"),
  }, async () => {
    const page = await newPage();
    await waitForRows(page);
    const input = page.getByRole("searchbox", { name: "Filter environments" });
    await input.fill("failed environments with quota errors");
    await input.press("Enter");
    await page.getByText("Parsed locally", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove Failed" }).waitFor();
    assert.ok(await page.locator(".learner-button").count() > 0);

    await input.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".learner-button").length === 120);
    assert.equal(await input.inputValue(), "");
    assert.equal(await page.locator(".parse-source").count(), 0);
    await page.close();
  });

  test("shows the source and fallback label returned by the live AI endpoint", async () => {
    const page = await newPage();
    await waitForRows(page);
    const input = page.getByRole("searchbox", { name: "Filter environments" });
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/ai/filter") && response.request().method() === "POST",
    );
    await input.fill("failed environments with quota errors");
    await input.press("Enter");
    const response = await responsePromise;
    const result = await response.json();
    const expectedLabel = result.source === "model"
      ? "Parsed by model"
      : result.reason && result.reason !== "not configured"
        ? "Model unavailable, parsed locally"
        : "Parsed locally";
    await page.getByText(expectedLabel, { exact: true }).waitFor();
    console.log(`Live AI endpoint: source=${result.source}, reason=${result.reason ?? "none"}; screen=${expectedLabel}`);
    await page.close();
  });

  test("cancels the previous AI filter request when Enter submits a new sentence", async () => {
    const page = await newPage();
    await waitForRows(page);

    let requestCount = 0;
    let releaseFirstRequest;
    let firstRequestStarted;
    const firstStarted = new Promise((resolve) => { firstRequestStarted = resolve; });
    await page.route("**/api/ai/filter", async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        firstRequestStarted();
        await new Promise((resolve) => { releaseFirstRequest = resolve; });
        try {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ source: "model", query: { states: ["failed"] } }),
          });
        } catch {
          // The client abort is the behavior under test.
        }
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ source: "model", query: { states: ["ready"] } }),
      });
    });

    const input = page.getByRole("searchbox", { name: "Filter environments" });
    await input.fill("failed environments");
    await input.press("Enter");
    await firstStarted;
    await input.fill("ready environments");
    await input.press("Enter");
    await page.getByText("Parsed by model", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove Ready" }).waitFor();
    assert.equal(requestCount, 2);
    assert.equal(await page.getByRole("button", { name: "Remove Failed" }).count(), 0);
    releaseFirstRequest();
    await page.close();
  });
});
