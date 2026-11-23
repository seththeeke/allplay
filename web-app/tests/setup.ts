import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/* jsdom does not implement scrolling; the help walkthrough scrolls its target into view. */
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-motion");
  document.documentElement.style.fontSize = "";
});

/* jsdom has no canvas; the orb then shows its CSS gradient, as a browser without canvas would. */
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
