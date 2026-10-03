import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usuario = vi.hoisted(() => ({
  atual: {
    organizations: [{ organization_id: "a", organization_name: "TOQ" }],
    is_platform_admin: true,
    support: null as null | object,
  },
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/hooks/auth/AuthProvider", () => ({ useUser: () => usuario.atual }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/shell/TenantSwitcher", () => ({
  TenantSwitcher: () => <div data-testid="tenant-switcher" />,
}));

import { SeletorDeOrganizacao } from "./SeletorDeOrganizacao";

function desenhar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeletorDeOrganizacao />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  usuario.atual = {
    organizations: [{ organization_id: "a", organization_name: "TOQ" }],
    is_platform_admin: true,
    support: null,
  };
});

describe("seletor de organização com o módulo clínica", () => {
  it("some para o administrador da instalação numa clínica com equipe cadastrada", async () => {
    api.get.mockResolvedValue({ data: [{ user_id: "p1", ativo: true }] });
    desenhar();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/v1/clinica/profissionais"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("tenant-switcher")).toBeNull();
  });

  it("volta ao comportamento do núcleo sem o módulo (409)", async () => {
    api.get.mockRejectedValue(new Error("module_not_installed"));
    desenhar();
    expect(await screen.findByTestId("tenant-switcher")).toBeTruthy();
  });

  it("volta ao comportamento do núcleo quando ninguém da equipe está ativo", async () => {
    api.get.mockResolvedValue({ data: [{ user_id: "p1", ativo: false }] });
    desenhar();
    expect(await screen.findByTestId("tenant-switcher")).toBeTruthy();
  });

  it("não pergunta nada a quem tem mais de uma organização, nem durante o suporte", () => {
    usuario.atual = {
      ...usuario.atual,
      organizations: [
        { organization_id: "a", organization_name: "TOQ" },
        { organization_id: "b", organization_name: "Outra" },
      ],
    };
    const { unmount } = desenhar();
    expect(screen.getByTestId("tenant-switcher")).toBeTruthy();
    unmount();

    usuario.atual = {
      ...usuario.atual,
      organizations: [usuario.atual.organizations[0]!],
      support: {},
    };
    desenhar();
    expect(screen.getByTestId("tenant-switcher")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });
});
