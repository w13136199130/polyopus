import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/session";
import { LoginPage } from "./LoginPage";

const LANDING = "落地页";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<div>{LANDING}</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockFetch(responses: Record<string, { status: number; body: unknown }>) {
  const impl: typeof fetch = (input) => {
    const url = String(input);
    for (const [key, response] of Object.entries(responses)) {
      if (url.includes(key)) {
        return Promise.resolve(
          new Response(JSON.stringify(response.body), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  return vi.fn(impl);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("successful login lands on the default page", async () => {
    const fetchMock = mockFetch({
      "/auth/me": {
        status: 401,
        body: { error: { code: "UNAUTHORIZED", message: "" } },
      },
      "/auth/login": {
        status: 200,
        body: {
          accessToken: "t",
          user: { userId: "u", tenantId: "t", username: "admin", displayName: "Admin", isOwner: true },
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLogin();
    await userEvent.type(await screen.findByLabelText(/用户名/), "admin");
    await userEvent.type(screen.getByLabelText(/密码/), "secret");
    await userEvent.click(screen.getByRole("button", { name: /登录/ }));

    await waitFor(() => expect(screen.getByText(LANDING)).toBeInTheDocument());
    const [, loginCall] = fetchMock.mock.calls;
    expect(String(loginCall?.[0])).toContain("/api/v1/auth/login");
  });

  it("wrong credentials show a readable error and keep the form", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/auth/me": {
          status: 401,
          body: { error: { code: "UNAUTHORIZED", message: "" } },
        },
        "/auth/login": {
          status: 401,
          body: { error: { code: "AUTH_FAILED", message: "账号或密码错误" } },
        },
      }),
    );

    renderLogin();
    await userEvent.type(await screen.findByLabelText(/用户名/), "admin");
    await userEvent.type(screen.getByLabelText(/密码/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /登录/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码错误");
    expect(screen.getByLabelText(/用户名/)).toHaveValue("admin");
  });
});
