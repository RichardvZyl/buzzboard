import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

// Tests only use the in-memory demo, never a user's relay or private key.
const port = Number(process.env.BUZZBOARD_TEST_PORT ?? 18401);
const origin = `http://127.0.0.1:${port}`;
let server;
let browser;
let serverOutput = "";

before(async () => {
  server = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "preview",
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { serverOutput += chunk; });
  }
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch { /* Wait for the preview server, not for an arbitrary UI delay. */ }
    await delay(100);
  }
  assert.ok(ready, `Preview server did not start: ${serverOutput}`);
  browser = await chromium.launch({
    channel: "chromium",
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function demo(t, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.clock.install();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "No browser errors");
  });
  await page.goto(`${origin}/?demo`);
  await page.locator(".lane .card").first().waitFor();
  page.setDefaultTimeout(5000);
  return page;
}

test("collapse hides only one board's contents and expand restores its cards", async (t) => {
  const page = await demo(t);
  const lanes = page.locator(".lane");
  const first = lanes.nth(0);
  const second = lanes.nth(1);
  const name = await first.locator("h2").innerText();
  const cardIds = await first.locator("[data-card]").evaluateAll(
    (cards) => cards.map((card) => card.dataset.card).sort(),
  );
  const cardTitle = await first.locator(".card-title").first().innerText();
  const toggle = first.locator(".lane-toggle");
  await first.getByRole("button", { name: `Collapse ${name}`, exact: true }).click();
  assert.equal(await first.locator("h2").isVisible(), true);
  assert.equal(await first.getByRole("button", { name: "Card", exact: true }).isVisible(), true);
  assert.equal(await first.locator(".columns").isVisible(), false);
  assert.equal(await second.locator(".columns").isVisible(), true);
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.ok(await toggle.getAttribute("aria-controls"));
  assert.equal((await first.ariaSnapshot()).includes(cardTitle), false);
  await first.getByRole("button", { name: `Expand ${name}`, exact: true }).click();
  assert.equal(await first.locator(".columns").isVisible(), true);
  assert.deepEqual(await first.locator("[data-card]").evaluateAll(
    (cards) => cards.map((card) => card.dataset.card).sort(),
  ), cardIds);
});

test("Enter and Space operate the toggle without losing focus", async (t) => {
  const page = await demo(t);
  const lane = page.locator(".lane").first();
  const toggle = lane.locator(".lane-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  assert.equal(await lane.locator(".columns").isVisible(), false);
  assert.equal(await toggle.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Space");
  assert.equal(await lane.locator(".columns").isVisible(), true);
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
});

test("collapse state survives filtering out and restoring a board", async (t) => {
  const page = await demo(t);
  const first = page.locator(".lane").first();
  const name = await first.locator("h2").innerText();
  await first.locator(".lane-toggle").click();
  await page.getByRole("textbox", { name: "Filter swimlanes" }).fill("no-such-board-zzzz");
  assert.equal(await page.locator(".lane").count(), 0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const restored = page.locator(".lane").filter({ has: page.getByRole("heading", { name, exact: true }) });
  assert.equal(await restored.locator(".columns").isVisible(), false);
  await restored.locator(".lane-toggle").click();
  assert.equal(await restored.locator(".columns").isVisible(), true);
});

test("adding a card expands its board and leaves other collapsed boards alone", async (t) => {
  const page = await demo(t);
  const first = page.locator(".lane").nth(0);
  const second = page.locator(".lane").nth(1);
  await first.locator(".lane-toggle").click();
  await second.locator(".lane-toggle").click();
  await first.getByRole("button", { name: "Card", exact: true }).click();
  assert.equal(await first.locator(".columns").isVisible(), true);
  assert.equal(await second.locator(".columns").isVisible(), false);
  await page.getByPlaceholder("Title", { exact: true }).fill("Collapse regression card");
  await page.locator(".modal").getByRole("button", { name: "Create", exact: true }).click();
  await first.getByText("Collapse regression card", { exact: true }).waitFor();
  assert.equal(await page.locator(".modal").count(), 0);
});

test("card details, drag/drop, and new-lane dialog still work after expanding", async (t) => {
  const page = await demo(t);
  const lane = page.locator(".lane").first();
  await lane.locator(".lane-toggle").click();
  await lane.locator(".lane-toggle").click();
  const card = lane.locator(".card").filter({ hasText: "Offline queue for card drags" });
  await card.click();
  assert.equal(await page.locator(".modal").getByRole("heading", {
    name: "Offline queue for card drags", exact: true,
  }).isVisible(), true);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const triage = lane.locator(".column").filter({ has: page.locator(".column-head", { hasText: "Triage" }) });
  await card.dragTo(triage.locator(".cell"));
  await triage.getByText("Offline queue for card drags", { exact: true }).waitFor();
  await page.getByRole("button", { name: "+ New swimlane", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator(".lane").count(), 3);
});

test("background polling preserves collapse and a fresh page starts expanded", async (t) => {
  const page = await demo(t);
  const lane = page.locator(".lane").first();
  await lane.locator(".lane-toggle").click();
  // Advance the app's real polling timer rather than sleeping for five seconds.
  await page.clock.runFor(5500);
  assert.equal(await lane.locator(".columns").isVisible(), false);
  await page.reload();
  await lane.locator(".columns").waitFor();
  assert.equal(await lane.locator(".lane-toggle").getAttribute("aria-expanded"), "true");
});

test("exit demo returns to the connection page", async (t) => {
  const page = await demo(t);
  await page.getByRole("link", { name: "Exit demo", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("link", { name: "Explore the demo", exact: true }).isVisible(), true);
});

test("collapsed heading and toggle remain usable at mobile width", async (t) => {
  const page = await demo(t, { width: 375, height: 812 });
  const lane = page.locator(".lane").first();
  await lane.locator(".lane-toggle").click();
  const heading = await lane.locator("h2").boundingBox();
  const toggle = await lane.locator(".lane-toggle").boundingBox();
  assert.ok(heading && toggle);
  assert.ok(toggle.x >= 0 && toggle.x + toggle.width <= 375);
  assert.equal(await lane.locator(".columns").isVisible(), false);
  await lane.locator(".lane-toggle").click();
  assert.equal(await lane.locator(".columns").isVisible(), true);
});
