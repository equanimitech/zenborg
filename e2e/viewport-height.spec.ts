import { expect, test } from "@playwright/test";
import { seedGarden } from "./support/seed";

/**
 * Window → fullscreen → window. The plant toolbar must stay pinned to the
 * bottom edge at every size, and the page must never scroll.
 */
test("plant toolbar stays on the bottom edge across resizes", async ({
  page,
}) => {
  await seedGarden(page);
  await page.keyboard.press("Escape");

  const toolbar = page
    .locator("input[placeholder='Filter...']")
    .locator("xpath=ancestor::div[contains(@class,'border-t')][1]");

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1728, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const box = await toolbar.boundingBox();
        return box ? Math.round(box.y + box.height) : null;
      })
      .toBe(size.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(size.height);
  }
});
