import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AndonPanel } from "../../src/components/AndonPanel";
import { GameLimitsPanel, limitText } from "../../src/components/GameLimitsPanel";
import { InvitePanel } from "../../src/components/InvitePanel";
import { LatencySection } from "../../src/components/LatencySection";
import type { AdminPlayer } from "../../src/models/api";

const player = (gameLimit: AdminPlayer["gameLimit"]): AdminPlayer => ({
  playerId: "ACCT#a",
  email: null,
  gameLimit,
  gameAllowance: { limit: 5, period: "DAY", used: 1, resetsAt: null },
});

describe("admin panels", () => {
  it("shows the andon cord as checking until its state loads, and a budget pull", () => {
    const { rerender } = render(<AndonPanel andon={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking...");
    expect(screen.getByRole("button", { name: "Pause play" })).toBeDisabled();
    rerender(
      <AndonPanel
        andon={{ pulled: true, reason: "AllPlay-Polly", pulledBy: "BUDGET", changedAt: null }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Play is paused in this stage, by a cost budget: AllPlay-Polly.",
    );
    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument();
  });

  it("reports an invitation that failed without a message", async () => {
    const user = userEvent.setup();
    render(<InvitePanel onInvite={() => Promise.reject(new Error(""))} />);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The invitation failed.");
  });

  it("words limits, shows no account found, and reports a failed change", async () => {
    expect(limitText(player(null))).toBe("the stage default");
    expect(limitText(player({ unlimited: true }))).toBe("no limit");
    expect(limitText(player({ count: 3, period: "WEEK" }))).toBe("3 a week");
    const user = userEvent.setup();
    const { unmount } = render(
      <GameLimitsPanel onFind={() => Promise.resolve([])} onSet={vi.fn()} />,
    );
    await user.type(screen.getByLabelText("Account email"), "x@example.com");
    await user.click(screen.getByRole("button", { name: "Find account" }));
    expect(await screen.findByText("No account has that email.")).toBeInTheDocument();
    unmount();
    render(
      <GameLimitsPanel
        onFind={() => Promise.resolve([player(null)])}
        onSet={() => Promise.reject(new Error(""))}
      />,
    );
    await user.type(screen.getByLabelText("Account email"), "x@example.com");
    await user.click(screen.getByRole("button", { name: "Find account" }));
    expect(await screen.findByText(/ACCT#a/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "No limit" }));
    expect(await screen.findByText("That did not work.")).toBeInTheDocument();
  });

  it("shows No data for a latency without samples today", () => {
    render(
      <LatencySection
        days={[
          {
            period: "2026-11-28",
            totalPlayers: 0,
            totalAccounts: 0,
            totalGuests: 0,
            activePlayers30d: 0,
            newPlayers: 0,
            gamesStarted: {},
            gamesWon: {},
            gamesAbandoned: {},
            decisions: 0,
            hardFailures: 0,
            softFailures: 0,
            llmCalls: 0,
            llmInputTokens: 0,
            llmOutputTokens: 0,
            clientLatencyP50Ms: null,
            clientLatencyP95Ms: null,
            serverLatencyP50Ms: null,
            serverLatencyP95Ms: null,
            llmLatencyP50Ms: null,
            llmLatencyP95Ms: null,
            transcribeLatencyP50Ms: null,
            transcribeLatencyP95Ms: null,
            pollyLatencyP50Ms: null,
            pollyLatencyP95Ms: null,
            moveLatencyP50Ms: null,
            moveLatencyP95Ms: null,
          },
        ]}
      />,
    );
    expect(screen.getAllByText("No data")).toHaveLength(6);
  });
});
