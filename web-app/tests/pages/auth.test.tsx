import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PASSWORD_RULE } from "../../src/models/api";
import { freshServices, renderApp } from "../renderApp";

describe("sign in", () => {
  it.each([
    ["Continue with Google", "google.player@example.com"],
    ["Continue with Apple", "apple.player@example.com"],
  ])("signs in with %s", async (button, email) => {
    const user = userEvent.setup();
    const { services } = renderApp("/sign-in");
    await user.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByRole("link", { name: "Account" })).toBeInTheDocument();
    expect((await services.player.me()).email).toBe(email);
  });

  it("shows a sign-in failure", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    services.player.signIn = () => Promise.reject(new Error("Incorrect email or password."));
    renderApp("/sign-in", services);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "Wrong2026");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    services.player.signIn = () => Promise.reject(new Error(""));
    services.player.signInWithProvider = () => Promise.reject(new Error(""));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByText("Sign in failed. Please try again.")).toBeInTheDocument();
  });

  it("links to account creation and password reset", async () => {
    const user = userEvent.setup();
    renderApp("/sign-in");
    await user.click(screen.getByRole("link", { name: "Create an account" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Create an account" }),
    ).toBeInTheDocument();
  });
});

describe("create an account", () => {
  it("checks the password, then the code, then signs in", async () => {
    const user = userEvent.setup();
    renderApp("/sign-up");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(PASSWORD_RULE);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "weak");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_RULE);
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "Spider2026");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByText("We sent a 6-digit code to pat@example.com."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Code"), "12");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the 6-digit code from the email.",
    );
    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("link", { name: "Account" })).toBeInTheDocument();
  });

  it("signs up with a provider, and explains unexpected failures", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    services.player.signUp = () => Promise.reject(new Error(""));
    renderApp("/sign-up", services);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "Spider2026");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    await user.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(await screen.findByRole("link", { name: "Account" })).toBeInTheDocument();
  });
});

describe("reset your password", () => {
  it("sends a code, validates it and the new password, then links to sign in", async () => {
    const user = userEvent.setup();
    renderApp("/forgot-password");
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.click(screen.getByRole("button", { name: "Send me a code" }));
    await user.type(await screen.findByLabelText("Code"), "1");
    await user.type(screen.getByLabelText("New password"), "Spider2026");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the 6-digit code from the email.",
    );
    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(/Your password is changed\./)).toBeInTheDocument();
    await user.click(within(screen.getByRole("main")).getByRole("link", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("explains unexpected failures", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    services.player.confirmPasswordReset = () => Promise.reject(new Error(""));
    renderApp("/forgot-password", services);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.click(screen.getByRole("button", { name: "Send me a code" }));
    await user.type(await screen.findByLabelText("Code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Spider2026");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });
});

describe("account", () => {
  it("confirms before deleting the account", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    await services.player.signIn("pat@example.com");
    renderApp("/account", services);
    await user.click(await screen.findByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Keep my account" }));
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect((await services.player.me()).kind).toBe("GUEST");
  });
});
