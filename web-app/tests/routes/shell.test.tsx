import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { freshServices, renderApp } from "../renderApp";

describe("app shell", () => {
  it("offers navigation and a skip link, without an Admin tab for guests", async () => {
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav).toHaveTextContent("Stats");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it.each([
    ["/stats", "Your statistics"],
    ["/settings", "Settings"],
    ["/help", "Help"],
    ["/sign-in", "Sign in"],
  ])("renders %s", async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("applies saved preferences to the document", async () => {
    const services = freshServices();
    await services.preferences.patchApp({ theme: "DARK", zoomLevel: 1.75 });
    renderApp("/", services);
    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBe("DARK");
    });
    expect(document.documentElement.style.fontSize).toBe("175%");
  });
});

describe("tier guards", () => {
  it("answers /admin as not found for guests", async () => {
    renderApp("/admin");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
  });

  it("answers /admin as not found for players", async () => {
    const services = freshServices();
    await services.player.signIn("pat@example.com");
    renderApp("/admin", services);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
  });

  it("shows the admin page and tab to admins", async () => {
    const services = freshServices();
    await services.player.signIn("admin@example.com");
    renderApp("/admin", services);
    expect(await screen.findByRole("heading", { level: 1, name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("sends guests from /account to sign in, then signs in and out", async () => {
    const user = userEvent.setup();
    renderApp("/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("link", { name: "Account" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Account" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("pat@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});
