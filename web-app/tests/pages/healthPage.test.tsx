import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HealthCheck, Services } from "../../src/services/types";
import { freshServices, renderApp } from "../renderApp";

function withHealth(check: () => Promise<HealthCheck>): Services {
  return { ...freshServices(), health: { check } };
}

describe("health page", () => {
  it("shows the local answer in memory mode and checks again on request", async () => {
    const user = userEvent.setup();
    renderApp("/health");
    expect(await screen.findByRole("heading", { level: 1, name: "Server health" })).toBeVisible();
    const status = await screen.findByText(/answered 200 OK from the LOCAL stage/);
    expect(status).toHaveAttribute("data-health", "HEALTHY");
    expect(screen.getByText("HTTP status: 200")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    });
  });

  it("reports an unhealthy status", async () => {
    renderApp(
      "/health",
      withHealth(() => Promise.resolve({ httpStatus: 503, body: null, latencyMs: 4 })),
    );
    const status = await screen.findByText("The server answered 503, which is not healthy.");
    expect(status).toHaveAttribute("data-health", "UNHEALTHY");
  });

  it("reports a server that cannot be reached", async () => {
    renderApp(
      "/health",
      withHealth(() => Promise.reject(new Error("Failed to fetch"))),
    );
    expect(
      await screen.findByText("The server could not be reached. Failed to fetch"),
    ).toHaveAttribute("data-health", "UNHEALTHY");
  });

  it("reports an unreachable server without a message", async () => {
    renderApp(
      "/health",
      withHealth(() => Promise.reject(new Error(""))),
    );
    expect(await screen.findByText("The server could not be reached.")).toBeInTheDocument();
  });
});
