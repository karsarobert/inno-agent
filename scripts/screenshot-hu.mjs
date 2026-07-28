import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../docs/use-cases/assets/hu");
mkdirSync(OUT_DIR, { recursive: true });
const BASE = "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

await page.addInitScript(() => {
  try {
    localStorage.setItem("inno.locale", "hu");
    localStorage.setItem("inno.content-locale", "hu");
  } catch (e) {}
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const lang = await page.evaluate(() => document.documentElement.lang);
console.log("HTML lang:", lang);
if (lang !== "hu") throw new Error(`Expected hu, got ${lang}`);

// Helper: click IELTS-felkészítő workspace button
async function selectWorkspace() {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "IELTS-felkészítő"
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
}

// Helper: expand folder tree items
async function expandFolders() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="treeitem"][aria-expanded="false"]');
      for (const item of items) {
        const text = item.textContent?.trim() || "";
        // Skip files (have file extensions)
        if (/\.\w+\s/.test(text)) continue;
        const inner = item.querySelector('div[onclick], div[style*="cursor"]') || item.querySelector("div");
        if (inner) { inner.click(); return text.substring(0, 30); }
      }
      return null;
    });
    if (!result) break;
    await page.waitForTimeout(800);
  }
}

// Helper: click tree item by text
async function clickTreeItem(text) {
  return page.evaluate((searchText) => {
    const items = document.querySelectorAll('[role="treeitem"]');
    for (const item of items) {
      if (item.textContent?.includes(searchText)) {
        const inner = item.querySelector('div[onclick], div[style*="cursor"]') || item.querySelector("div");
        if (inner) { inner.click(); return true; }
        item.click();
        return true;
      }
    }
    return false;
  }, text);
}

// Helper: scroll chat area
async function scrollChat(position) {
  await page.evaluate((pos) => {
    const chatScroll = document.querySelector(".chat-scroll, [class*='chat-scroll']");
    if (chatScroll) {
      if (pos === "top") chatScroll.scrollTop = 0;
      else if (pos === "bottom") chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }, position);
  await page.waitForTimeout(1000);
}

// ============================================================
// Screenshot 02: agent.md in file tree + preview
// ============================================================
console.log("=== 02_agent_create.png ===");
await selectWorkspace();
const agentClicked = await clickTreeItem("agent.md");
console.log("  agent.md clicked:", agentClicked);
await page.waitForTimeout(2000);
await page.screenshot({ path: resolve(OUT_DIR, "02_agent_create.png") });
console.log("  ✓ saved");

// ============================================================
// Screenshot 03: .skills/card-maker/SKILL.md in tree + preview
// ============================================================
console.log("=== 03_skill_uploaded.png ===");
await expandFolders();
await page.waitForTimeout(1000);
const skillClicked = await clickTreeItem("SKILL.md");
console.log("  SKILL.md clicked:", skillClicked);
await page.waitForTimeout(2000);
await page.screenshot({ path: resolve(OUT_DIR, "03_skill_uploaded.png") });
console.log("  ✓ saved");

// ============================================================
// Screenshot 04: Vocabulary explanation in chat (top of conversation)
// ============================================================
console.log("=== 04_vocab_explain.png ===");

// Click on the vocab session
await page.evaluate(() => {
  const els = document.querySelectorAll('[role="button"], button');
  for (const el of els) {
    if (el.textContent?.includes("szókártyá")) {
      el.click();
      break;
    }
  }
});
await page.waitForTimeout(3000);

// Scroll to top to see the beginning of the conversation (vocab explanations)
await scrollChat("top");
await page.screenshot({ path: resolve(OUT_DIR, "04_vocab_explain.png") });
console.log("  ✓ saved");

// ============================================================
// Screenshot 05: Cards result (bottom of conversation)
// ============================================================
console.log("=== 05_cards_result.png ===");

// Scroll to bottom to see the card creation results
await scrollChat("bottom");
await page.screenshot({ path: resolve(OUT_DIR, "05_cards_result.png") });
console.log("  ✓ saved");

// ============================================================
// Screenshot 06: Skills panel (go back to workspace view)
// ============================================================
console.log("=== 06_skills_panel.png ===");

// Go back to workspace by clicking the IELTS-felkészítő button again
await selectWorkspace();

// Now click the "Készségek" tab
const skillsClicked = await page.evaluate(() => {
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    if (btn.textContent?.trim() === "Készségek") {
      btn.click();
      return true;
    }
  }
  return false;
});
console.log("  skills tab clicked:", skillsClicked);
await page.waitForTimeout(2000);
await page.screenshot({ path: resolve(OUT_DIR, "06_skills_panel.png") });
console.log("  ✓ saved");

await browser.close();
console.log("\nDone. Files in:", OUT_DIR);
