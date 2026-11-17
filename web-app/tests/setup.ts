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
