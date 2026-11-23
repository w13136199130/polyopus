import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichText, parseRichText } from "./MessageList";

describe("RichText", () => {
  it("splits fenced code from prose and keeps the language label", () => {
    const text = "先看这段：\n```ts\nconst x = 1;\n```\n再继续。";
    expect(parseRichText(text)).toEqual([
      { kind: "text", content: "先看这段：" },
      { kind: "code", content: "const x = 1;", lang: "ts" },
      { kind: "text", content: "再继续。" },
    ]);
    render(<RichText text={text} />);
    expect(screen.getByTestId("code-block")).toHaveTextContent("const x = 1;");
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("renders an unfinished fence while streaming", () => {
    render(<RichText text={"答案：\n```python\nprint(1)"} />);
    expect(screen.getByTestId("code-block")).toHaveTextContent("print(1)");
    expect(screen.getByText("python")).toBeInTheDocument();
  });
});
