import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { LOCAL_CONFIG, renderApp } from "./renderApp";

const config = LOCAL_CONFIG;
const renderAt = (path: string) => renderApp(path);

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
