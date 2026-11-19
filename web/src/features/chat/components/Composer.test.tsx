import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer";

const baseProps: ComposerProps = {
  disabled: false,
  status: "idle",
  restoredInput: null,
  onConsumedRestore: () => undefined,
  onSend: () => undefined,
  modelLabel: "FakeModel",
  models: [],
  modelValue: "",
  onModelChange: () => undefined,
  kbs: [],
  kbIds: [],
  onToggleKb: () => undefined,
  connectors: [],
  connectorIds: [],
  onToggleConnector: () => undefined,
  subagents: [],
  subagentIds: [],
  onToggleSubagent: () => undefined,
  approvalPolicy: "ask",
  onApprovalPolicyChange: () => undefined,
  onNewThread: () => undefined,
  onExport: () => undefined,
};

function Harness(props: { disabled?: boolean; restored?: string | null }) {
  const [restored, setRestored] = useState<string | null>(props.restored ?? null);
  const onSend = vi.fn();
  return (
    <Composer
      {...baseProps}
      disabled={props.disabled ?? false}
      restoredInput={restored}
      onConsumedRestore={() => setRestored(null)}
      onSend={onSend}
    />
  );
}

describe("Composer", () => {
  it("Enter sends trimmed content and clears the input", async () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps} onSend={onSend} />);
    const box = screen.getByLabelText("消息输入框");
    await userEvent.type(box, "  你好  ");
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("你好");
    expect(box).toHaveValue("");
  });

  it("Shift+Enter inserts a newline instead of sending", async () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("消息输入框"), "a{Shift>}{Enter}{/Shift}b");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText("消息输入框")).toHaveValue("a\nb");
  });

  it("disabled composer cannot send", async () => {
    const onSend = vi.fn();
    render(
      <Composer
        {...baseProps}
        disabled
        status="streaming"
        onSend={onSend}
      />,
    );
    const box = screen.getByLabelText("消息输入框");
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("restored input lands back in the box (rollback never swallows text)", async () => {
    render(<Harness restored="没发出去的话" />);
    const box = screen.getByLabelText("消息输入框");
    await screen.findByLabelText("消息输入框");
    expect(box).toHaveValue("没发出去的话");
  });
});
