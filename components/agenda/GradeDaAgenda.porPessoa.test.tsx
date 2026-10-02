/**
 * O DIA COM UMA COLUNA POR PESSOA — `colunasPorPessoa` na visão Dia.
 *
 * Quem escolhe as colunas é quem monta a grade (o módulo clínica); aqui se
 * prova o que a grade faz com elas: cada compromisso na coluna de quem atende,
 * os blocos livres só na coluna dona dos horários, e nada muda fora do Dia.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GradeDaAgenda, type ColunaDePessoa } from "./GradeDaAgenda";
import type { Agendamento } from "./tipos";

const DIA = new Date("2026-09-16T12:00:00-03:00");
const ANTES = new Date("2026-09-15T12:00:00-03:00");
const FUSO = "America/Sao_Paulo";
const ANA = { id: "ana", nome: "Ana Prado", trilha: 3 as const };
const BRUNO = { id: "bruno", nome: "Bruno Lima", trilha: 5 as const };

function bloco(id: string, responsavelId: string, extra: Partial<Agendamento> = {}): Agendamento {
  return {
    id,
    titulo: "Sessão de fisioterapia",
    responsavelId,
    comeca: "2026-09-16T10:00:00-03:00",
    termina: "2026-09-16T10:50:00-03:00",
    origem: "ui",
    situacao: "confirmed",
    ...extra,
  };
}

const COLUNAS: ColunaDePessoa[] = [
  { pessoa: ANA, detalhe: "Fisioterapia", marcaAqui: true },
  { pessoa: BRUNO, marcaAqui: false },
];

function desenhar(visao: "dia" | "semana", agendamentos: Agendamento[]) {
  return render(
    <GradeDaAgenda
      visao={visao}
      ancora={DIA}
      agora={ANTES}
      fuso={FUSO}
      agendamentos={agendamentos}
      pessoas={[ANA, BRUNO]}
      colunasPorPessoa={COLUNAS}
      interacao={{
        horariosPorDia: {},
        motivo: null,
        duracaoMin: 50,
        onMarcarEm: () => {},
      }}
    />,
  );
}

describe("dia com uma coluna por pessoa", () => {
  it("cada compromisso cai na coluna de quem atende, e o cabeçalho conta os da pessoa", () => {
    desenhar("dia", [
      bloco("a1", "ana"),
      bloco("a2", "ana", {
        comeca: "2026-09-16T14:00:00-03:00",
        termina: "2026-09-16T14:50:00-03:00",
      }),
      bloco("b1", "bruno"),
    ]);

    const colunaDaAna = screen.getByTestId("coluna-pessoa-ana");
    const colunaDoBruno = screen.getByTestId("coluna-pessoa-bruno");
    expect(within(colunaDaAna).getByTestId("agendamento-a1")).toBeTruthy();
    expect(within(colunaDaAna).queryByTestId("agendamento-b1")).toBeNull();
    expect(within(colunaDoBruno).getByTestId("agendamento-b1")).toBeTruthy();

    expect(screen.getByTestId("quantos-pessoa-ana").textContent).toBe("2");
    expect(screen.getByTestId("quantos-pessoa-bruno").textContent).toBe("1");
    expect(
      within(screen.getByTestId("cabecalho-pessoa-ana")).getByText("Fisioterapia"),
    ).toBeTruthy();
  });

  it("com a cor da modalidade, o bloco não repete a inicial que o cabeçalho já mostra", () => {
    desenhar("dia", [bloco("a1", "ana", { corDoBloco: "var(--agenda-modalidade-fisioterapia)" })]);
    expect(screen.getByTestId("agendamento-a1")).toBeTruthy();
    expect(screen.queryByTestId("inicial-a1")).toBeNull();
  });

  it("os blocos livres só aparecem na coluna dona dos horários", () => {
    desenhar("dia", []);
    expect(
      within(screen.getByTestId("coluna-pessoa-ana")).getAllByRole("button").length,
    ).toBeGreaterThan(0);
    expect(within(screen.getByTestId("coluna-pessoa-bruno")).queryAllByRole("button")).toHaveLength(
      0,
    );
  });

  it("fora da visão Dia, as colunas por pessoa não valem", () => {
    desenhar("semana", [bloco("a1", "ana")]);
    expect(screen.queryByTestId("dia-por-pessoa")).toBeNull();
    expect(screen.queryByTestId("coluna-pessoa-ana")).toBeNull();
    expect(screen.getByTestId("coluna-dia-2026-09-16")).toBeTruthy();
  });
});
