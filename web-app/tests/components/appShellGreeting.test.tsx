import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { greeting } from "../../src/components/AppShell";
import { freshServices, renderApp } from "../renderApp";

describe("header greeting", () => {
  it("greets a signed-in player by the start of their email, with a gear link to Account", async () => {
    const services = freshServices();
    await services.player.signIn("pat.smith@example.com");
    renderApp("/", services);
    expect(await screen.findByText("Hello, pat.smith")).toBeInTheDocument();
    const gear = screen.getByRole("link", { name: "Account" });
    expect(gear).toHaveAttribute("href", "/account");
    expect(gear.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("offers sign in to guests and greets an account without an email plainly", async () => {
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/^Hello/)).not.toBeInTheDocument();
    expect(greeting(null)).toBe("Hello");
    expect(greeting("@example.com")).toBe("Hello");
  });
});
