import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.2 AA checks of the page as it stands. */
export const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();

/*
 * An invite-only stage has no guests (productionalization.md section 3): the
 * pipeline creates a run-scoped account and passes it as SMOKE_EMAIL and
 * SMOKE_PASSWORD, and each test signs in first. Open stages play as a guest.
 */
export const email = process.env["SMOKE_EMAIL"];
const password = process.env["SMOKE_PASSWORD"] ?? "";

export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (email === undefined) return;
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
