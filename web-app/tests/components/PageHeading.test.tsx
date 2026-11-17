import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeading } from "../../src/components/PageHeading";

describe("PageHeading", () => {
  it("renders a title with or without a lead", () => {
    render(<PageHeading title="Only a title" />);
    expect(screen.getByRole("heading", { level: 1, name: "Only a title" })).toBeInTheDocument();
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
    render(<PageHeading title="With lead" lead="Extra words" />);
    expect(screen.getByText("Extra words")).toBeInTheDocument();
  });
});
