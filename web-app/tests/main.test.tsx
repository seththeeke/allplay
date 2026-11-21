import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

describe("bootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("mounts the app into #root when config loads", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    stubFetch({ stage: "LOCAL", dataMode: "MEMORY" });
    await import("../src/main");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "All Play" })).toBeInTheDocument();
    });
  });

  it("shows an error page when config cannot load", async () => {
    const { bootstrap } = await import("../src/bootstrap");
    const container = document.createElement("div");
    document.body.append(container);
    stubFetch({}, 500);
    await bootstrap(container);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "ConfigLoadError: config.json request failed with status 500",
      );
    });
  });

  it("retries a just-linked Google or Apple sign-in instead of rendering", async () => {
    const redirect = vi.fn(() => Promise.resolve());
    vi.doMock("aws-amplify/auth", async (original) => ({
      ...(await original<object>()),
      signInWithRedirect: redirect,
    }));
    stubFetch({
      stage: "TEST",
      dataMode: "MEMORY",
      region: "us-east-1",
      apiUrl: "https://api.example.com/",
      userPoolId: "us-east-1_pool",
      userPoolClientId: "client",
      identityPoolId: "us-east-1:pool",
      oauthDomain: "allplay-test-x.auth.us-east-1.amazoncognito.com",
    });
    sessionStorage.setItem("allplay.pendingProvider", "GOOGLE");
    window.history.replaceState(null, "", "/?error_description=ALLPLAY_ACCOUNT_LINKED");
    const { bootstrap } = await import("../src/bootstrap");
    const container = document.createElement("div");
    await bootstrap(container);
    expect(redirect).toHaveBeenCalledWith({ provider: "Google" });
    expect(container.innerHTML).toBe("");
    window.history.replaceState(null, "", "/");
    vi.doUnmock("aws-amplify/auth");
  });

  it("fails fast without a root element", async () => {
    const { bootstrap } = await import("../src/bootstrap");
    await expect(bootstrap(null)).rejects.toThrow("Missing #root element");
  });
});
