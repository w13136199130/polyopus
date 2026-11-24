import { describe, expect, it } from "vitest";
import { MCP_TEMPLATE, parseMcpConfig } from "./mcpConfig";

describe("parseMcpConfig", () => {
  it("accepts the template and keeps the servers shape", () => {
    const parsed = parseMcpConfig(MCP_TEMPLATE);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.name).toBe("my-mcp");
    expect(parsed.serverNames).toEqual(["my-mcp"]);
    expect(parsed.config).toEqual({
      servers: {
        "my-mcp": { type: "http", url: "https://mcp.example.com/mcp" },
      },
    });
  });

  it("accepts a bare name -> server map and wraps it", () => {
    const parsed = parseMcpConfig(
      JSON.stringify({ knowledge: { type: "stdio", command: "npx -y kb" } }),
    );
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.name).toBe("knowledge");
    expect(parsed.config).toEqual({
      servers: { knowledge: { type: "stdio", command: "npx -y kb" } },
    });
  });

  it("rejects broken JSON, empty maps and missing endpoints", () => {
    expect(parseMcpConfig("{")).toEqual({ error: "JSON 无法解析" });
    expect(parseMcpConfig("[]")).toEqual({ error: "配置需要是 JSON 对象" });
    expect(parseMcpConfig("{}")).toEqual({ error: "至少需要一个 MCP server" });
    expect(
      parseMcpConfig(JSON.stringify({ a: { type: "http", url: " " } })),
    ).toEqual({ error: "a: 缺少 url" });
    expect(
      parseMcpConfig(JSON.stringify({ a: { type: "stdio" } })),
    ).toEqual({ error: "a: 缺少 command" });
    expect(
      parseMcpConfig(JSON.stringify({ a: { type: "sse", url: "x" } })),
    ).toEqual({ error: "a: 不支持的 transport sse" });
  });
});
