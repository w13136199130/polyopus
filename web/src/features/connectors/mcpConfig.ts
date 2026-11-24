/** MCP server config shape shared by the drawer and the page-level JSON editor. */

export const MCP_TEMPLATE = `{
  "servers": {
    "my-mcp": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}`;

export interface ParsedMcpConfig {
  /** First server name, used as the instance display name. */
  name: string;
  serverNames: string[];
  config: Record<string, unknown>;
}

/** Accepts {"servers": {...}} or a bare name->server map, mirroring the API. */
export function parseMcpConfig(text: string): ParsedMcpConfig | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "JSON 无法解析" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "配置需要是 JSON 对象" };
  }
  const root = raw as Record<string, unknown>;
  const map =
    root.servers && typeof root.servers === "object" && !Array.isArray(root.servers)
      ? (root.servers as Record<string, unknown>)
      : root;
  const serverNames = Object.keys(map).filter(
    (name) => name !== "auth" && name !== "headers",
  );
  if (serverNames.length === 0) return { error: "至少需要一个 MCP server" };
  for (const name of serverNames) {
    const value = map[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: `${name}: server 必须是对象` };
    }
    const server = value as Record<string, unknown>;
    const transport = String(server.type ?? server.transport ?? "http");
    if (transport === "http") {
      if (!String(server.url ?? "").trim()) return { error: `${name}: 缺少 url` };
    } else if (transport === "stdio") {
      if (!String(server.command ?? "").trim()) return { error: `${name}: 缺少 command` };
    } else {
      return { error: `${name}: 不支持的 transport ${transport}` };
    }
  }
  return { name: serverNames[0], serverNames, config: { servers: map } };
}
