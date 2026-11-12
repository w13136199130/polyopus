import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard";
import type { AttentionItem } from "@/lib/api/wire";

function attentionFixture(payload: Record<string, unknown>): AttentionItem {
  return {
    attentionId: "at_1",
    kind: "approval",
    sourceType: "approval",
    sourceId: "ap_1",
    payload,
    status: "pending",
    turnId: "tu_1",
    ticketId: null,
    expiresAt: 0,
    createdAt: 0,
  };
}

describe("ApprovalCard", () => {
  it("shows the tool and answers approve/deny", async () => {
    const onAnswer = vi.fn();
    render(
      <ApprovalCard
        attention={attentionFixture({
          actions: [{ tool: "fs.write", args_preview: '{"path":"a.txt"}' }],
        })}
        busy={false}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText("fs.write")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "批准" }));
    expect(onAnswer).toHaveBeenCalledWith("at_1", "approve");
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(onAnswer).toHaveBeenCalledWith("at_1", "deny");
  });

  it("expands the arguments preview", async () => {
    render(
      <ApprovalCard
        attention={attentionFixture({
          actions: [{ tool: "fs.write", args_preview: '{"path":"a.txt","content":"x"}' }],
        })}
        busy={false}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByText(/"path":"a.txt"/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "查看参数" }));
    expect(screen.getByText(/"path":"a.txt"/)).toBeInTheDocument();
  });

  it("busy disables both answers", () => {
    render(
      <ApprovalCard
        attention={attentionFixture({ actions: [{ tool: "fs.write" }] })}
        busy
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "批准" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeDisabled();
  });
});
