import { describe, expect, it } from "vitest";

import {
  corpoDaOrigem,
  escolhaInicial,
  periodoDoAtalho,
  recusaDaEscolha,
  type OrigemEscolhida,
} from "./origem-na-tela";

const PACIENTE = "11111111-1111-4111-8111-111111111111";
const BRUNO = { id: "22222222-2222-4222-8222-222222222222", nome: "Bruno" };

function escolha(parcial: Partial<OrigemEscolhida>): OrigemEscolhida {
  return { origem_id: "o1", tipo: "whatsapp", detalhe: "", indicado_por: null, ...parcial };
}

describe("corpoDaOrigem", () => {
  it("leva só o complemento que o tipo pede", () => {
    expect(
      corpoDaOrigem(escolha({ tipo: "whatsapp", detalhe: "Dr. Paulo", indicado_por: BRUNO })),
    ).toEqual({ origem_id: "o1", detalhe: "Dr. Paulo", indicado_por_contact_id: null });
    expect(corpoDaOrigem(escolha({ tipo: "indicacao", detalhe: "sobra", indicado_por: BRUNO })))
      .toEqual({ origem_id: "o1", detalhe: null, indicado_por_contact_id: BRUNO.id });
    expect(corpoDaOrigem(escolha({ tipo: "encaminhamento", detalhe: "  Dr. Paulo  " }))).toEqual({
      origem_id: "o1",
      detalhe: "Dr. Paulo",
      indicado_por_contact_id: null,
    });
  });

  it("detalhe em branco vai como null", () => {
    expect(corpoDaOrigem(escolha({ tipo: "outro", detalhe: "   " })).detalhe).toBeNull();
  });
});

describe("recusaDaEscolha", () => {
  it("pede o médico, o influenciador e quem indicou", () => {
    expect(recusaDaEscolha(escolha({ tipo: "encaminhamento" }), PACIENTE)).toBe(
      "Informe qual médico encaminhou o paciente.",
    );
    expect(recusaDaEscolha(escolha({ tipo: "instagram" }), PACIENTE)).toBe(
      "Informe qual influenciador ou anúncio trouxe o paciente.",
    );
    expect(recusaDaEscolha(escolha({ tipo: "indicacao" }), PACIENTE)).toBe(
      "Informe qual paciente fez a indicação.",
    );
    expect(recusaDaEscolha(escolha({ tipo: "outro" }), PACIENTE)).toBeNull();
  });

  it("recusa quem indica a si mesmo", () => {
    expect(
      recusaDaEscolha(
        escolha({ tipo: "indicacao", indicado_por: { id: PACIENTE, nome: "Ana" } }),
        PACIENTE,
      ),
    ).toBe("O paciente não pode indicar a si mesmo.");
  });
});

describe("escolhaInicial", () => {
  it("abre vazio sem origem e preenchido com ela", () => {
    expect(escolhaInicial(null)).toBeNull();
    expect(
      escolhaInicial({
        contact_id: PACIENTE,
        origem: { id: "o4", nome: "Indicação de paciente", tipo: "indicacao" },
        detalhe: null,
        indicado_por: BRUNO,
        automatica: false,
        registrado_por_user_id: null,
        atualizado_em: null,
      }),
    ).toEqual({ origem_id: "o4", tipo: "indicacao", detalhe: "", indicado_por: BRUNO });
  });
});

describe("periodoDoAtalho", () => {
  // 3 de outubro, 01:30 em UTC = 2 de outubro, 22:30 em Brasília.
  const agora = new Date("2026-10-03T01:30:00Z");

  it("conta o dia em horário de Brasília", () => {
    expect(periodoDoAtalho("este_mes", agora)).toEqual({ de: "2026-10-01", ate: "2026-10-02" });
  });

  it("mês passado vai do primeiro ao último dia", () => {
    expect(periodoDoAtalho("mes_passado", agora)).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
    expect(periodoDoAtalho("mes_passado", new Date("2026-01-15T12:00:00Z"))).toEqual({
      de: "2025-12-01",
      ate: "2025-12-31",
    });
  });

  it("últimos 90 dias contam hoje", () => {
    expect(periodoDoAtalho("ultimos_90", agora)).toEqual({ de: "2026-07-05", ate: "2026-10-02" });
  });
});
