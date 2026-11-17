import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page loads with no accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "All Play" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("unknown paths load the app and show not found", async ({ page }) => {
  await page.goto("/spider-does-not-exist-yet");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
