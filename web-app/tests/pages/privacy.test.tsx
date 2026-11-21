import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../renderApp";

describe("privacy page", () => {
  it("states what is kept, what is not, guest expiry and how to delete an account", async () => {
    renderApp("/privacy");
    expect(await screen.findByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    for (const heading of [
      "What All Play keeps",
      "What All Play does not keep",
      "Playing without an account",
      "Deleting your account",
    ])
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    expect(screen.getByText(/never stored/)).toBeInTheDocument();
  });

  it("is linked from Help", async () => {
    renderApp("/help");
    expect(await screen.findByRole("link", { name: /Privacy/ })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
