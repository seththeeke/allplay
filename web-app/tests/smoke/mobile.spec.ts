import { expect, test, type Page } from "@playwright/test";
import { axe, open } from "./session";

/* A phone held upright and sideways (productionalization.md section 10). */
const PHONES = [
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
] as const;

/** Elements wider than the viewport, which would make the page scroll sideways. */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > width + 1)
      .map((element) => element.tagName);
  });

for (const phone of PHONES) {
  test.describe(`phone ${phone.name}`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true });

    test("the home page fits the screen with no accessibility violations", async ({ page }) => {
      await open(page, "/");
      await expect(page.getByRole("heading", { level: 1, name: "All Play" })).toBeVisible();
      expect(await overflowing(page)).toEqual([]);
      expect((await axe(page)).violations).toEqual([]);
    });

    /* Starting a game writes a session, so only Test's smoke run plays (cdk-stacks.md section 7). */
    test("the game fits the screen, every column reachable without scrolling sideways", async ({
      page,
    }) => {
      test.skip(process.env["SMOKE_WRITES"] !== "stage", "Writes only in Test.");
      await open(page, "/spider");
      const table = page.getByRole("region", { name: "Card table" });
      await expect(table).toBeVisible({ timeout: 15_000 });
      expect(await overflowing(page)).toEqual([]);
      const column = page.getByRole("button", { name: /^column 10/i });
      const box = await column.boundingBox();
      expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(phone.width);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  });
}
