import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../src/components/Button";
import { PasswordField } from "../../src/components/PasswordField";
import { passwordReady } from "../../src/components/passwordChecks";
import { ProviderButtons } from "../../src/components/ProviderButtons";
import { freshServices, renderApp } from "../renderApp";

describe("busy buttons", () => {
  it("show a spinner and the busy label, announce it, and refuse presses", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button busy busyLabel="Creating account" onClick={onClick}>
        Create account
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Creating account..." });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.className).toContain("cursor-pointer");
    expect(screen.getByTestId("spinner")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Creating account");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button busy>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Working");
    rerender(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stay busy while sign-up waits on the network, then move on", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    let finish: () => void = () => undefined;
    services.player.signUp = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    renderApp("/sign-up", services);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "Spider2026");
    await user.type(screen.getByLabelText("Confirm password"), "Spider2026");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("button", { name: "Creating account..." })).toBeDisabled();
    finish();
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
  });
});

function Field() {
  const [value, setValue] = useState("Spider2026");
  return (
    <PasswordField
      id="pw"
      label="Password"
      autoComplete="new-password"
      value={value}
      onChange={setValue}
    />
  );
}

describe("password field", () => {
  it("shows and hides the password with a pressed toggle", async () => {
    render(<Field />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(toggle.querySelector("line")).toBeNull();
    await userEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }).querySelector("line"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("is ready only when every rule is met and both match", () => {
    expect(passwordReady("Spider2026", "Spider2026")).toBe(true);
    expect(passwordReady("Spider2026", "Spider2025")).toBe(false);
    expect(passwordReady("spider2026", "spider2026")).toBe(false);
    expect(passwordReady("", "")).toBe(false);
  });
});

describe("provider buttons", () => {
  it("mark the chosen provider busy and hold the others", () => {
    render(<ProviderButtons providers={["GOOGLE", "APPLE"]} busy="GOOGLE" onChoose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Opening sign-in..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
  });
});
