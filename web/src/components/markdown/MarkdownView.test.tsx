import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView", () => {
  it("renders headings, bold, lists and code blocks", () => {
    render(<MarkdownView content={"# 标题\n\n**重点**\n\n- 第一项\n- 第二项\n\n```ts\nconst x = 1\n```"} />);
    expect(screen.getByRole("heading", { level: 1, name: "标题" })).toBeInTheDocument();
    expect(screen.getByText("重点").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("markdown-code")).toHaveTextContent("const x = 1");
  });

  it("renders tables and blockquotes", () => {
    render(<MarkdownView content={"> 注意\n\n| 项目 | 数值 |\n| --- | --- |\n| 温度 | 20 |"} />);
    expect(screen.getByText("注意")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("温度");
    expect(screen.getByRole("table")).toHaveTextContent("20");
  });

  it("keeps an unfinished fence readable while a chat answer streams", () => {
    render(<MarkdownView content={"答案：\n```python\nprint(1)"} compact />);
    expect(screen.getByTestId("markdown-code")).toHaveTextContent("print(1)");
    expect(screen.getByText("python")).toBeInTheDocument();
  });

  it("compact mode still renders headings with their level", () => {
    render(<MarkdownView content={"# 小节\n\n正文"} compact />);
    expect(screen.getByRole("heading", { level: 1, name: "小节" })).toBeInTheDocument();
    expect(screen.getByText("正文")).toBeInTheDocument();
  });

  it("does not turn javascript links into anchors", () => {
    render(<MarkdownView content={"[点我](javascript:alert(1))"} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("点我")).toBeInTheDocument();
  });
});
