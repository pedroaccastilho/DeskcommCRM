/**
 * A SESSÃO DA AGENDA CHEGA AO REGISTRO — entrega 4 do prontuário (fork TOQ).
 *
 * O atalho "Registrar evolução" (agenda e Evoluções pendentes) abre a ficha com `sessao=<id>`.
 * O que prova que o laço fecha é o corpo do POST: sem `appointment_id`, a sessão continuaria
 * pendente para sempre depois de a evolução estar assinada.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSAO = "0b9c1d2e-3b4a-4c5d-8e6f-0a1b2c3d4e5f";
const CONTATO = "7f9c1d2e-3b4a-4c5d-8e6f-0a1b2c3d4e5f";

const post = vi.fn((..._a: unknown[]) => Promise.resolve({ data: {} }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (url: string) => {
      if (url.startsWith("/api/v1/clinica/eu")) {
        return Promise.resolve({
          data: {
            instalado: true,
            profissional: { modalidades: ["fisioterapia"], nome_profissional: "Ana" },
          },
        });
      }
      return Promise.resolve({ data: [] });
    },
    post: (...a: unknown[]) => post(...a),
  },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { ProntuarioDoPaciente } from "./ProntuarioDoPaciente";

function montar(sessaoInicial?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProntuarioDoPaciente contactId={CONTATO} sessaoInicial={sessaoInicial} />
    </QueryClientProvider>,
  );
}

async function assinarComTexto() {
  await userEvent.type(await screen.findByTestId("registro-texto"), "Evoluiu bem.");
  await userEvent.click(screen.getByTestId("assinar-registro"));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  return post.mock.calls[0]![1] as Record<string, unknown>;
}

describe("registro vinculado à sessão da agenda", () => {
  beforeEach(() => post.mockClear());

  it("com sessão no atalho, o registro sai com appointment_id", async () => {
    montar(SESSAO);
    expect(await screen.findByTestId("registro-sessao")).toBeTruthy();
    const corpo = await assinarComTexto();
    expect(corpo.appointment_id).toBe(SESSAO);
    expect(corpo.tipo).toBe("evolucao");
  });

  it("desvincular tira a sessão do registro", async () => {
    montar(SESSAO);
    await userEvent.click(await screen.findByText("Desvincular"));
    expect(screen.queryByTestId("registro-sessao")).toBeNull();
    const corpo = await assinarComTexto();
    expect(corpo.appointment_id).toBeNull();
  });

  it("sem atalho, nada é vinculado", async () => {
    montar();
    await screen.findByTestId("registro-texto");
    expect(screen.queryByTestId("registro-sessao")).toBeNull();
    const corpo = await assinarComTexto();
    expect(corpo.appointment_id).toBeNull();
  });
});
