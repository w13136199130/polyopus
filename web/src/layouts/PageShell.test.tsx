import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PageShell } from "./PageShell";

describe("PageShell", () => {
  it("renders header, tabs, sticky filters and body in order", () => {
    render(
      <MemoryRouter>
        <PageShell
          title="任务"
          subtitle="进行中与待决"
          bell={false}
          actions={<button type="button">新建</button>}
          tabs={<div>tabs-slot</div>}
          filters={<div>filters-slot</div>}
        >
          <div>body-slot</div>
        </PageShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "任务", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("进行中与待决")).toBeInTheDocument();
    expect(screen.getByText("tabs-slot")).toBeInTheDocument();
    expect(screen.getByText("filters-slot")).toBeInTheDocument();
    expect(screen.getByText("body-slot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
  });
});
