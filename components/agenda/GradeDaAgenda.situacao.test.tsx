/**
 * A SITUAÇÃO NA FORMA DO BLOCO — e a cor do bloco quando ela não é a da pessoa.
 *
 * jsdom não pinta: o teste prova a REGRA (classe, estilo e rótulo acessível),
 * e a prova visual é a captura em `evidence/visual-situacao-no-bloco/`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GradeDaAgenda } from "./GradeDaAgenda";
import type { Agendamento } from "./tipos";

const QUARTA = new Date("2026-09-16T12:00:00-03:00");
const FUSO = "America/Sao_Paulo";
const PESSOAS = [{ id: "ana", nome: "Ana Prado", trilha: 3 as const }];

function bloco(id: string, extra: Partial<Agendamento>): Agendamento {
  return {
    id,
    titulo: "Sessão de fisioterapia",
    responsavelId: "ana",
    comeca: "2026-09-16T10:00:00-03:00",
    termina: "2026-09-16T10:50:00-03:00",
    origem: "ui",
    situacao: "confirmed",
    ...extra,
  };
}

function desenhar(agendamentos: Agendamento[], visao: "semana" | "mes" = "semana") {
  return render(
    <GradeDaAgenda
      visao={visao}
      ancora={QUARTA}
      agora={QUARTA}
      fuso={FUSO}
      agendamentos={agendamentos}
      pessoas={PESSOAS}
    />,
  );
}

describe("situação na forma do bloco", () => {
  it("aguardando confirmação vem tracejado, na cor da faixa, e o leitor de tela ouve", () => {
    desenhar([bloco("p", { situacao: "pending" })]);
    const b = screen.getByTestId("agendamento-p");
    expect(b.className).toContain("border-dashed");
    expect(b.style.borderColor).toBe("var(--agenda-pessoa-3)");
    expect(b.getAttribute("aria-label")).toContain("Aguardando confirmação");
  });

  it("não compareceu vem hachurado, com o título riscado", () => {
    desenhar([
      bloco("f", {
        situacao: "no_show",
        comeca: "2026-09-16T08:00:00-03:00",
        termina: "2026-09-16T08:50:00-03:00",
      }),
    ]);
    const b = screen.getByTestId("agendamento-f");
    expect(b.style.background).toContain("repeating-linear-gradient");
    expect(b.querySelector(".line-through")?.textContent).toBe("Sessão de fisioterapia");
    expect(b.getAttribute("aria-label")).toContain("Não compareceu");
  });

  it("confirmado segue cheio, sem tracejado nem risco", () => {
    desenhar([bloco("c", {})]);
    const b = screen.getByTestId("agendamento-c");
    expect(b.className).not.toContain("border-dashed");
    expect(b.querySelector(".line-through")).toBeNull();
  });

  it("com corDoBloco, a faixa usa essa cor e a inicial de quem atende aparece", () => {
    desenhar([bloco("m", { corDoBloco: "var(--agenda-modalidade-pilates)" })]);
    expect(screen.getByTestId("faixa-m").style.backgroundColor).toBe(
      "var(--agenda-modalidade-pilates)",
    );
    expect(screen.getByTestId("inicial-m").textContent).toBe("AP");
  });

  it("no mês, a falta também aparece riscada", () => {
    desenhar([bloco("fm", { situacao: "no_show" })], "mes");
    const chip = screen.getByTestId("chip-mes-fm");
    expect(chip.getAttribute("data-situacao")).toBe("no_show");
    expect(chip.querySelector(".line-through")).not.toBeNull();
  });
});
