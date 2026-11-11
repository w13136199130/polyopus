/**
 * Incremental SSE parser (docs/49 §5.3).
 *
 * Frames end at a blank line (\n\n or \r\n\r\n); feed() may receive bytes
 * split anywhere. Comment lines (`: ping`) are ignored; malformed frames are
 * skipped, never thrown.
 */

export interface SseMessage {
  event?: string;
  id?: string;
  data: string;
}

interface FrameBoundary {
  /** Index where the frame's bytes end (before the blank line). */
  end: number;
  /** Index where the next frame starts (after the blank line). */
  next: number;
}

export class SseParser {
  private buffer = "";
  private decoder = new TextDecoder();

  feed(bytes: Uint8Array): SseMessage[] {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    const out: SseMessage[] = [];
    for (;;) {
      const b = this.findFrameEnd();
      if (!b) break;
      const chunk = this.buffer.slice(0, b.end);
      this.buffer = this.buffer.slice(b.next);
      const message = this.parseFrame(chunk);
      if (message) out.push(message);
    }
    return out;
  }

  /** Flush a trailing unterminated frame at EOF. */
  flush(): SseMessage[] {
    const rest = this.buffer;
    this.buffer = "";
    const message = rest ? this.parseFrame(rest) : null;
    return message ? [message] : [];
  }

  private findFrameEnd(): FrameBoundary | null {
    const lf = this.buffer.indexOf("\n\n");
    const crlf = this.buffer.indexOf("\r\n\r\n");
    if (lf === -1 && crlf === -1) return null;
    if (crlf !== -1 && (lf === -1 || crlf < lf)) {
      return { end: crlf, next: crlf + 4 };
    }
    // "\n\n" found; guard against "\r\n\n" being read as "\n\n"
    const end = this.buffer[lf - 1] === "\r" ? lf - 1 : lf;
    return { end, next: lf + 2 };
  }

  private parseFrame(chunk: string): SseMessage | null {
    const data: string[] = [];
    let event: string | undefined;
    let id: string | undefined;

    for (const line of chunk.split("\n")) {
      const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (clean === "" || clean.startsWith(":")) continue;
      const colon = clean.indexOf(":");
      const field = colon === -1 ? clean : clean.slice(0, colon);
      let value = colon === -1 ? "" : clean.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
      else if (field === "id") id = value;
      // unknown fields are ignored per spec
    }

    if (data.length === 0 && event === undefined) return null;
    return { event, id, data: data.join("\n") };
  }
}
