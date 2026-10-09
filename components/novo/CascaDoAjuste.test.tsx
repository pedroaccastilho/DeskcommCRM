import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CascaDoAjuste } from "./CascaDoAjuste";

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** Uma tela da versão atual: pede o roteador como o `useRouter` do Next pede, pelo contexto. */
function TelaDeLa({ href, como }: { href: string; como: "push" | "replace" }) {
  const roteador = useContext(AppRouterContext);
  return (
    <>
      <button type="button" onClick={() => roteador?.[como](href)}>
        navegar
      </button>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- o clique que a casca desvia é o do <a> no DOM */}
      <a href="/app/pipelines/42">funil</a>
    </>
  );
}

const CONVERSA = "87923512-7426-4614-9f1a-eeb1351b6688";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CascaDoAjuste: a navegação da tela de lá fica na interface nova", () => {
  it.each([
    ["push", "/app/campaigns", "/ajustes/campanhas"],
    ["push", "/app/ai/agents/7", "/ajustes/ia/agentes/7"],
    ["push", `/app/inbox?id=${CONVERSA}`, `/whatsapp?id=${CONVERSA}`],
    ["replace", "/app/integrations/nuvemshop", "/ajustes/canais/nuvemshop"],
  ] as const)("%s(%s) vai para %s", (como, de, para) => {
    render(
      <CascaDoAjuste>
        <TelaDeLa href={de} como={como} />
      </CascaDoAjuste>,
    );
    fireEvent.click(screen.getByText("navegar"));
    expect(router[como]).toHaveBeenCalledWith(para, undefined);
  });

  it("endereço sem par aqui segue para a versão atual", () => {
    render(
      <CascaDoAjuste>
        <TelaDeLa href="/app/sem-par-na-nova" como="push" />
      </CascaDoAjuste>,
    );
    fireEvent.click(screen.getByText("navegar"));
    expect(router.push).toHaveBeenCalledWith("/app/sem-par-na-nova", undefined);
  });

  it("clique num link com par fica na interface nova", () => {
    render(
      <CascaDoAjuste>
        <TelaDeLa href="/app/campaigns" como="push" />
      </CascaDoAjuste>,
    );
    fireEvent.click(screen.getByText("funil"));
    expect(router.push).toHaveBeenCalledWith("/funis/42");
  });
});
