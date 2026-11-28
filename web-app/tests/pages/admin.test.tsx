import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { must } from "../must";
import { freshServices, renderApp } from "../renderApp";

async function openAdmin() {
  const services = freshServices();
  await services.player.signIn("admin@example.com");
  renderApp("/admin", services);
  await screen.findByText("Total players");
  return services;
}

const figure = (title: string) => {
  const heading = screen.getByRole("heading", { level: 3, name: title });
  const element = heading.closest("figure");
  if (element === null) throw new Error(`no figure for ${title}`);
  return element;
};

describe("admin page", () => {
  it("shows today's key metrics as tiles", async () => {
    await openAdmin();
    expect(screen.getByText("Active players", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Turn failures today")).toBeInTheDocument();
    expect(screen.getByText("Median round trip today")).toBeInTheDocument();
    expect(screen.getByText("target under 2 s")).toBeInTheDocument();
  });

  it("draws three charts with legends only for multi-series charts", async () => {
    await openAdmin();
    expect(within(figure("Active players")).queryByRole("list")).not.toBeInTheDocument();
    expect(
      within(figure("Turn failures")).getByRole("list", { name: "Turn failures legend" }),
    ).toHaveTextContent("Hard failuresSoft failures");
    expect(within(figure("Voice round trip")).getByRole("list")).toHaveTextContent(
      "Median95th percentile",
    );
    expect(within(figure("Voice round trip")).getByText("2 s target")).toBeInTheDocument();
  });

  it("shows a readout on hover and hides it on leave", async () => {
    await openAdmin();
    for (const title of ["Active players", "Turn failures", "Voice round trip"]) {
      const chart = figure(title);
      const hits = chart.querySelectorAll("[data-testid^='hit-']");
      const last = hits[hits.length - 1];
      const first = hits[0];
      if (last === undefined || first === undefined) throw new Error("no hit targets");
      fireEvent.mouseEnter(last);
      expect(within(chart).getByRole("status")).toBeInTheDocument();
      fireEvent.mouseLeave(last);
      fireEvent.mouseEnter(first);
      expect(within(chart).getByRole("status")).toBeInTheDocument();
      fireEvent.mouseLeave(first);
      expect(within(chart).queryByRole("status")).not.toBeInTheDocument();
    }
  });

  it("offers every chart as a table", async () => {
    const user = userEvent.setup();
    await openAdmin();
    const chart = figure("Turn failures");
    await user.click(within(chart).getByText("Show as a table"));
    expect(within(chart).getByRole("columnheader", { name: "Total" })).toBeVisible();
    expect(within(chart).getAllByRole("row")).toHaveLength(31);
  });

  it("lists recent failures", async () => {
    await openAdmin();
    expect(screen.getByText("“for two nine”")).toBeInTheDocument();
    expect(screen.getByText(/unrecognized, hard, 2,210 ms/)).toBeInTheDocument();
  });

  it("asks before deploying, and shows the new run", async () => {
    const user = userEvent.setup();
    await openAdmin();
    await user.click(screen.getByRole("button", { name: "Deploy now" }));
    expect(screen.getByText("Deploy the latest code to Test, then Prod?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Deploy now" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Deployment started.")).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Admin" })).toHaveLength(1);
    expect(screen.getAllByRole("cell", { name: "Failed" })).toHaveLength(1);
  });
});

describe("admin page with sparse data", () => {
  it("says no metrics are recorded yet, and still lists deployments, without metrics", async () => {
    const services = freshServices();
    await services.player.signIn("admin@example.com");
    services.admin.metrics = () => Promise.resolve({ days: [] });
    renderApp("/admin", services);
    expect(await screen.findByText(/No product metrics are recorded/)).toBeInTheDocument();
    expect(screen.queryByText("Total players")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Active players" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Deployments" })).toBeInTheDocument();
  });

  it("handles a quiet day, missing latencies and manual runs", async () => {
    const services = freshServices();
    await services.player.signIn("admin@example.com");
    const { days } = await services.admin.metrics("2000-01-01", "2999-12-31");
    const quiet = {
      ...must(days[days.length - 1]),
      decisions: 0,
      clientLatencyP50Ms: null,
      clientLatencyP95Ms: null,
    };
    services.admin.metrics = () => Promise.resolve({ days: [quiet] });
    services.admin.failures = () =>
      Promise.resolve({
        decisions: [
          {
            decisionId: "d",
            createdAt: "2026-12-02T10:00:00.000Z",
            gameId: null,
            transcript: "hmm",
            outcome: "UNRECOGNIZED",
            failureClass: "HARD",
            clientLatencyMs: null,
          },
        ],
      });
    const { deployments } = await services.admin.deployments();
    services.admin.deployments = () =>
      Promise.resolve({
        deployments: deployments.map((run) => ({ ...run, trigger: "MANUAL" as const })),
      });
    renderApp("/admin", services);
    expect(await screen.findByText("0.0 s")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(await screen.findByText("unrecognized, hard")).toBeInTheDocument();
    expect((await screen.findAllByRole("cell", { name: "Manual" })).length).toBe(3);
  });

  it("lists duplicate accounts and merges the newer one after confirming", async () => {
    const user = userEvent.setup();
    await openAdmin();
    const panel = screen.getByRole("region", { name: "Duplicate accounts" });
    expect(within(panel).getByText("pat@example.com")).toBeInTheDocument();
    expect(within(panel).getByText(/Keeps ACCT#sample-apple/)).toBeInTheDocument();
    expect(within(panel).getByText(/ACCT#sample-google, 2026-11-15, Google/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Merge" }));
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    await user.click(within(panel).getByRole("button", { name: "Merge" }));
    await user.click(within(panel).getByRole("button", { name: "Yes, merge into the oldest" }));
    expect(await within(panel).findByText("Merged ACCT#sample-google.")).toBeInTheDocument();
    expect(await within(panel).findByText("No accounts share an email.")).toBeInTheDocument();
  });

  it("reports a failed merge and names accounts without a recorded sign-in", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    await services.player.signIn("admin@example.com");
    services.admin.duplicates = () =>
      Promise.resolve({
        duplicates: [
          {
            emailKey: "x@example.com",
            accounts: [
              {
                playerId: "ACCT#1",
                signInProviders: ["COGNITO"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              { playerId: "ACCT#2", signInProviders: [], createdAt: "2026-02-01T00:00:00.000Z" },
            ],
          },
        ],
      });
    services.admin.mergeAccounts = () => Promise.reject(new Error("refused"));
    renderApp("/admin", services);
    const panel = await screen.findByRole("region", { name: "Duplicate accounts" });
    expect(await within(panel).findByText(/no sign-in recorded/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Merge" }));
    await user.click(within(panel).getByRole("button", { name: "Yes, merge into the oldest" }));
    expect(await within(panel).findByText("Could not merge ACCT#2.")).toBeInTheDocument();
  });

  it("pauses and restarts play with the andon cord after a confirmation", async () => {
    const user = userEvent.setup();
    await openAdmin();
    const panel = must(screen.getByRole("heading", { name: "Andon cord" }).closest("section"));
    expect(await within(panel).findByText("Play is running.")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Pause play" }));
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    await user.click(within(panel).getByRole("button", { name: "Pause play" }));
    await user.click(within(panel).getByRole("button", { name: "Yes, pause play" }));
    expect(
      await within(panel).findByText(
        "Play is paused in this stage, by an admin: Pulled by an admin.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/Last changed/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Restart play" }));
    await user.click(within(panel).getByRole("button", { name: "Yes, restart play" }));
    expect(await within(panel).findByText("Play is running.")).toBeInTheDocument();
  });

  it("invites a player once and reports a repeat invitation", async () => {
    const user = userEvent.setup();
    await openAdmin();
    const panel = must(screen.getByRole("heading", { name: "Invite a player" }).closest("section"));
    await user.type(within(panel).getByLabelText("Email"), "Pat@Example.com");
    await user.click(within(panel).getByRole("button", { name: "Send invitation" }));
    expect(
      await within(panel).findByText("Invited pat@example.com. Send them this site's link."),
    ).toBeInTheDocument();
    await user.type(within(panel).getByLabelText("Email"), "pat@example.com");
    await user.click(within(panel).getByRole("button", { name: "Send invitation" }));
    expect(
      await within(panel).findByText("That email already has an account."),
    ).toBeInTheDocument();
  });
});
