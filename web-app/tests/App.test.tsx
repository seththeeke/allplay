import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

const config = { stage: "LOCAL", dataMode: "MEMORY" } as const;

function renderAt(path: string) {
  return render(
    <App
      config={config}
      router={(children) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>}
    />,
  );
}

describe("App", () => {
  it("renders the home page at /", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: "All Play" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders the not found page for unknown paths, with a way home", () => {
    renderAt("/nowhere");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });

  it("uses the browser router by default", () => {
    window.history.pushState({}, "", "/");
    render(<App config={config} />);
    expect(screen.getByRole("heading", { level: 1, name: "All Play" })).toBeInTheDocument();
  });
});
