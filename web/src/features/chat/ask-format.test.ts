import { describe, expect, it } from "vitest";
import { formatAnswers, parseAskContent } from "./ask-format";

describe("ask-format", () => {
  it("extracts questions and strips the json block", () => {
    const content = `请确认两点：\n\`\`\`json\n{"questions":[{"id":"q1","question":"目标平台？","options":["Web","移动"]},{"id":"q2","question":"截止时间？"}]}\n\`\`\``;
    const parsed = parseAskContent(content);
    expect(parsed.questions).toEqual([
      { id: "q1", question: "目标平台？", options: ["Web", "移动"] },
      { id: "q2", question: "截止时间？", options: [] },
    ]);
    expect(parsed.cleanText).toBe("请确认两点：");
  });

  it("leaves ordinary code blocks and prose untouched", () => {
    const content = "先看代码：\n```ts\nconst x = 1\n```";
    expect(parseAskContent(content)).toEqual({ questions: [], cleanText: content });
  });

  it("formats only answered questions", () => {
    const text = formatAnswers(
      [
        { id: "q1", question: "平台？", options: [] },
        { id: "q2", question: "时间？", options: [] },
      ],
      { q1: "Web" },
    );
    expect(text).toContain("q1. 平台？\n答：Web");
    expect(text).not.toContain("q2");
  });
});
