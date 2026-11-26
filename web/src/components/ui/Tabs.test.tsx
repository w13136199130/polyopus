import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs";

function Harness({ variant }: { variant?: "page" | "segmented" }) {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <Tabs
      ariaLabel="视图"
      variant={variant}
      value={value}
      onChange={setValue}
      items={[
        { key: "a", label: "甲", badge: 2 },
        { key: "b", label: "乙" },
        { key: "c", label: "丙", disabled: true },
      ]}
    />
  );
}

describe("Tabs", () => {
  it("renders a tablist with the selected tab and badge", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "视图" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /甲/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /甲/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: "丙" })).toBeDisabled();
  });

  it("changes selection on click", async () => {
    render(<Harness variant="segmented" />);
    await userEvent.click(screen.getByRole("tab", { name: "乙" }));
    expect(screen.getByRole("tab", { name: "乙" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /甲/ })).toHaveAttribute("aria-selected", "false");
  });

  it("moves selection with arrow keys, skipping disabled tabs", async () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: /甲/ });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "乙" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    // disabled 丙 is skipped, wraps to 甲
    expect(screen.getByRole("tab", { name: /甲/ })).toHaveAttribute("aria-selected", "true");
  });
});
