import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";

function renderDialog(open = true, onOpenChange = vi.fn()) {
  render(
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="确认操作"
      description="说明文字"
      footer={<button type="button">确定</button>}
    >
      <p>内容</p>
    </Dialog>,
  );
  return { onOpenChange };
}

describe("Dialog", () => {
  it("exposes role=dialog with an accessible name", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "确认操作" })).toBeInTheDocument();
  });

  it("moves focus into the panel and traps Tab", async () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    // Radix focuses the panel itself first; focus must be inside the dialog
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

    await userEvent.tab();
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
  });

  it("Esc closes via onOpenChange(false)", async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("close button is labelled for screen readers", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
});

describe("Drawer", () => {
  it("exposes role=dialog with an accessible name", () => {
    render(
      <Drawer open onOpenChange={vi.fn()} title="详情抽屉">
        <p>内容</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "详情抽屉" })).toBeInTheDocument();
  });

  it("Esc closes", async () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange} title="详情抽屉">
        <p>内容</p>
      </Drawer>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
