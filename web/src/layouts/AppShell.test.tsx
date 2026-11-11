import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/session";
import { AppShell } from "./AppShell";

const LOGIN_MARK = "本地多智能体工作台";
const SHELL_MARK = "PolyOpus";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>{LOGIN_MARK}</div>} />
          <Route path="/" element={<AppShell />}>
            <Route path="chat" element={<div>chat-body</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function respond(_url: string, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell auth guard", () => {
  it("anonymous visitor is redirected to /login with the origin path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          respond(String(input), 401, { error: { code: "UNAUTHORIZED", message: "" } }),
        ),
      ),
    );

    renderAt("/chat");
    await waitFor(() => expect(screen.getByText(LOGIN_MARK)).toBeInTheDocument());
  });

  it("authenticated visitor sees the shell and the page body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          respond(String(input), 200, {
            user: { userId: "u", tenantId: "t", username: "admin", displayName: "Admin", isOwner: true },
          }),
        ),
      ),
    );

    renderAt("/chat");
    await waitFor(() => expect(screen.getByText("chat-body")).toBeInTheDocument());
    expect(screen.getByText(SHELL_MARK)).toBeInTheDocument();
  });
});
