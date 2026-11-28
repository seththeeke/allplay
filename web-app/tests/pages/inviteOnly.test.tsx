import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import { nextPath } from "../../src/routes/InviteGate";
import { LOCAL_CONFIG, renderApp } from "../renderApp";

const inviteOnly = () =>
  createServices({ ...LOCAL_CONFIG, accessMode: "INVITE_ONLY" }, createMemoryStore(null));

describe("invite-only stage", () => {
  it("sends a signed-out visitor to sign in, without sign-up, and back to the page asked for", async () => {
    const user = userEvent.setup();
    renderApp("/stats", inviteOnly());
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText(/All Play Test is invite only/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create an account" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "Secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your statistics" }),
    ).toBeInTheDocument();
  });

  it("keeps the public pages open and turns sign-up into sign-in", async () => {
    renderApp("/privacy", inviteOnly());
    expect(await screen.findByRole("heading", { level: 1, name: /Privacy/ })).toBeInTheDocument();
  });

  it("redirects sign-up to sign-in", async () => {
    renderApp("/sign-up", inviteOnly());
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("lets an invited player choose a password on first sign-in", async () => {
    const user = userEvent.setup();
    const { services } = renderApp("/sign-in", inviteOnly());
    await user.type(await screen.findByLabelText("Email"), "invited.pat@example.com");
    await user.type(screen.getByLabelText("Password"), "Temp1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Choose your password" }),
    ).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save password and sign in" });
    await user.type(screen.getByLabelText("New password"), "Mine12345");
    await user.click(save);
    expect(
      screen.getByRole("heading", { level: 2, name: "Choose your password" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Type it again"), "Mine12345");
    await user.click(save);
    expect(await screen.findByRole("heading", { level: 1, name: "All Play" })).toBeInTheDocument();
    expect((await services.player.me()).email).toBe("invited.pat@example.com");
  });

  it("only follows a next page on this site", () => {
    expect(nextPath("/spider")).toBe("/spider");
    expect(nextPath("//evil.example.com")).toBe("/");
    expect(nextPath("https://evil.example.com")).toBe("/");
    expect(nextPath(null)).toBe("/");
  });
});
