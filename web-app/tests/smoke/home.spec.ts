import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();

/*
 * An invite-only stage has no guests (productionalization.md section 3): the
 * pipeline creates a run-scoped account and passes it as SMOKE_EMAIL and
 * SMOKE_PASSWORD, and each test signs in first. Open stages play as a guest.
 */
const email = process.env["SMOKE_EMAIL"];
const password = process.env["SMOKE_PASSWORD"] ?? "";

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (email === undefined) return;
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("the sign-in page of an invite-only stage has no accessibility violations", async ({
  page,
}) => {
  test.skip(email === undefined, "The stage has guests.");
  await page.goto("/sign-in");
  await expect(page.getByText(/invite only/)).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
});

test("home page loads with no accessibility violations", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "All Play" })).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
});

test("unknown paths load the app and show not found", async ({ page }) => {
  await open(page, "/spider-does-not-exist-yet");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

/* Starting a game writes a session, so only Test's smoke run plays (cdk-stacks.md section 7, CDK-10). */
test("deals a Spider game from the stage's API", async ({ page }) => {
  test.skip(process.env["SMOKE_WRITES"] !== "stage", "Writes only in Test.");
  await open(page, "/spider");
  await expect(page.getByRole("heading", { level: 1, name: "Spider Solitaire" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Card table" })).toBeVisible({ timeout: 15_000 });
});
