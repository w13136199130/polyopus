import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Empty } from "./Empty";
import { ErrorState } from "./ErrorState";
import { Forbidden } from "./Forbidden";
import { Loading, PageLoading } from "./Loading";
import { Skeleton } from "./Skeleton";
import { StreamConnectingIndicator } from "./StreamConnectingIndicator";
import { Table, type Column } from "./Table";

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: "a", name: "第一个" },
  { id: "b", name: "第二个" },
];

const COLUMNS: Array<Column<Row>> = [
  { key: "id", header: "ID", render: (row) => row.id },
  { key: "name", header: "名称", render: (row) => row.name },
];

describe("Table", () => {
  it("renders caption, headers and rows", () => {
    render(<Table caption="示例表" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByRole("table", { name: "示例表" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "名称" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "第一个" })).toBeInTheDocument();
  });
});

describe("Empty", () => {
  it("shows title/hint and fires the action", async () => {
    const onClick = vi.fn();
    render(<Empty title="还没有工单" hint="建一个触发器" action={{ label: "去创建", onClick }} />);
    expect(screen.getByRole("status")).toHaveTextContent("还没有工单");
    await userEvent.click(screen.getByRole("button", { name: "去创建" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("ErrorState", () => {
  it("alerts with message, traceId and retry", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState message="HTTP 500" traceId="tr_abc" onRetry={onRetry} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("HTTP 500");
    expect(alert).toHaveTextContent("tr_abc");
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("Forbidden", () => {
  it("explains without leaking resource existence", () => {
    render(<Forbidden />);
    expect(screen.getByRole("alert")).toHaveTextContent("没有权限");
  });
});

describe("Loading / PageLoading", () => {
  it("announces politely", () => {
    render(<Loading label="载入工单…" />);
    expect(screen.getByRole("status")).toHaveTextContent("载入工单…");
  });

  it("page variant centers", () => {
    render(<PageLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from the a11y tree", () => {
    const { container } = render(<Skeleton lines={3} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StreamConnectingIndicator", () => {
  it("announces the reconnect attempt", () => {
    render(<StreamConnectingIndicator />);
    expect(screen.getByRole("status")).toHaveTextContent("正在重连");
  });
});
