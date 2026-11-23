/** Parse the optional structured question block emitted in Ask mode. */

export interface AskQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface ParsedAsk {
  questions: AskQuestion[];
  cleanText: string;
}

const FENCE = /```(?:json)?\s*([\s\S]*?)```/gi;

function questionsOf(value: unknown): AskQuestion[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return [];
  const out: AskQuestion[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const question = String(row.question ?? "").trim();
    if (!question) continue;
    const options = Array.isArray(row.options)
      ? row.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 6)
      : [];
    out.push({
      id: String(row.id ?? `q${index + 1}`),
      question,
      options,
    });
    if (out.length >= 3) break;
  }
  return out;
}

export function parseAskContent(content: string): ParsedAsk {
  let cleanText = content;
  let questions: AskQuestion[] = [];
  for (const match of content.matchAll(FENCE)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const candidate = questionsOf(parsed);
      if (candidate.length) {
        questions = candidate;
        cleanText = content.replace(match[0], "").trim();
        break;
      }
    } catch {
      // A normal code block is not an Ask payload; leave the text alone.
    }
  }
  return { questions, cleanText };
}

export function formatAnswers(
  questions: AskQuestion[],
  answers: Record<string, string>,
): string {
  const lines = questions.flatMap((question) => {
    const answer = answers[question.id]?.trim();
    return answer ? [`${question.id}. ${question.question}\n答：${answer}`] : [];
  });
  return `对澄清问题的回答：\n${lines.join("\n")}`;
}
