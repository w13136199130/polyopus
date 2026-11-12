import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders variants and sizes", () => {
    render(
      <>
        <Button>主要</Button>
        <Button variant="secondary">次要</Button>
        <Button variant="danger">危险</Button>
        <Button variant="ghost">幽灵</Button>
        <Button size="sm">小号</Button>
      </>,
    );
    for (const name of ["主要", "次要", "危险", "幽灵", "小号"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("fires onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点我</Button>);
    await userEvent.click(screen.getByRole("button", { name: "点我" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("loading disables and announces busy", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    );
    const button = screen.getByRole("button", { name: /提交/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled never fires", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        禁用
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "禁用" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
