import { describe, expect, it } from "vitest";

import type { Agendamento, Pessoa } from "@/components/agenda/tipos";

import { colunasDaEquipe, resumoDoDia } from "./dia-da-equipe";

const pessoas: Pessoa[] = [
  { id: "recepcao", nome: "Rita Recepção", trilha: 1 },
  { id: "ana", nome: "Ana Fisio", trilha: 2 },
  { id: "bruno", nome: "Bruno Médico", trilha: 3 },
  { id: "caio", nome: "Caio Pilates", trilha: 4 },
];

const profissionais = [
  { user_id: "ana", modalidades: ["fisioterapia", "pilates"] as const, ativo: true },
  { user_id: "bruno", modalidades: ["medicina"] as const, ativo: true },
  { user_id: "caio", modalidades: ["pilates"] as const, ativo: false },
];

function ag(parcial: Partial<Agendamento>): Agendamento {
  return {
    id: Math.random().toString(36).slice(2),
    titulo: "Compromisso",
    responsavelId: "ana",
    comeca: "2026-10-05T12:00:00.000Z",
    termina: "2026-10-05T13:00:00.000Z",
    origem: "ui",
    situacao: "confirmed",
    ...parcial,
  };
}

describe("colunasDaEquipe", () => {
  it("abre coluna para cada profissional ativo, mesmo sem compromisso", () => {
    const colunas = colunasDaEquipe({
      pessoas,
      profissionais,
      agendamentosDoDia: [],
      isolada: null,
    });
    expect(colunas.map((c) => c.pessoa.id)).toEqual(["ana", "bruno"]);
    expect(colunas[0]!.modalidades).toEqual(["fisioterapia", "pilates"]);
  });

  it("quem não é profissional ativo só aparece com compromisso no dia, depois dos profissionais", () => {
    const colunas = colunasDaEquipe({
      pessoas,
      profissionais,
      agendamentosDoDia: [ag({ responsavelId: "recepcao" }), ag({ responsavelId: "caio" })],
      isolada: null,
    });
    expect(colunas.map((c) => c.pessoa.id)).toEqual(["ana", "bruno", "recepcao", "caio"]);
    expect(colunas[2]!.modalidades).toEqual([]);
  });

  it("sem profissional cadastrado, a equipe inteira vira coluna", () => {
    const colunas = colunasDaEquipe({
      pessoas,
      profissionais: [],
      agendamentosDoDia: [],
      isolada: null,
    });
    expect(colunas).toHaveLength(4);
  });

  it("com uma pessoa isolada no filtro, só ela", () => {
    const colunas = colunasDaEquipe({
      pessoas,
      profissionais,
      agendamentosDoDia: [],
      isolada: "bruno",
    });
    expect(colunas.map((c) => c.pessoa.id)).toEqual(["bruno"]);
  });
});

describe("resumoDoDia", () => {
  it("conta atendimentos, pendentes e faltas, e agrupa por modalidade", () => {
    const resumo = resumoDoDia([
      ag({ tipo: "Sessão de fisioterapia", situacao: "pending" }),
      ag({ tipo: "Sessão de fisioterapia" }),
      ag({ tipo: "Aula de pilates", situacao: "no_show" }),
      ag({ titulo: "Reunião de equipe" }),
      ag({ titulo: "Ocupado", origem: "google_sync" }),
      ag({ tipo: "Consulta médica", situacao: "cancelled" }),
    ]);
    expect(resumo).toEqual({
      total: 4,
      aguardando: 1,
      faltas: 1,
      porModalidade: [
        { modalidade: "fisioterapia", quantos: 2 },
        { modalidade: "pilates", quantos: 1 },
        { modalidade: null, quantos: 1 },
      ],
    });
  });

  it("dia vazio dá zero em tudo", () => {
    expect(resumoDoDia([])).toEqual({ total: 0, aguardando: 0, faltas: 0, porModalidade: [] });
  });
});
