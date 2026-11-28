import { expect, test } from "@playwright/test";
import { axe, email, open } from "./session";

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
