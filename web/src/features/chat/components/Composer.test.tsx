import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

function Harness(props: { disabled?: boolean; restored?: string | null }) {
  const [restored, setRestored] = useState<string | null>(props.restored ?? null);
  const onSend = vi.fn();
  return (
    <Composer
      disabled={props.disabled ?? false}
      status="idle"
      restoredInput={restored}
      onConsumedRestore={() => setRestored(null)}
      onSend={onSend}
    />
  );
}

describe("Composer", () => {
  it("Enter sends trimmed content and clears the input", async () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} status="idle" restoredInput={null} onConsumedRestore={() => undefined} onSend={onSend} />);
    const box = screen.getByLabelText("消息输入框");
    await userEvent.type(box, "  你好  ");
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("你好");
    expect(box).toHaveValue("");
  });

  it("Shift+Enter inserts a newline instead of sending", async () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} status="idle" restoredInput={null} onConsumedRestore={() => undefined} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("消息输入框"), "a{Shift>}{Enter}{/Shift}b");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText("消息输入框")).toHaveValue("a\nb");
  });

  it("disabled composer cannot send", async () => {
    const onSend = vi.fn();
    render(
      <Composer
        disabled
        status="streaming"
        restoredInput={null}
        onConsumedRestore={() => undefined}
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
