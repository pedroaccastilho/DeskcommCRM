import { describe, expect, it } from "vitest";

import {
  consolidarRelatorio,
  ORIGENS_PADRAO,
  periodoDoRelatorio,
  recusaDaOrigemDoPaciente,
  TIPOS_DE_ORIGEM,
  type OrigemDaClinica,
} from "./origens";

const PACIENTE = "00000000-0000-4000-8000-000000000001";
const OUTRO = "00000000-0000-4000-8000-000000000002";

describe("recusaDaOrigemDoPaciente", () => {
  it("Instagram e encaminhamento pedem o detalhe", () => {
    expect(recusaDaOrigemDoPaciente("instagram", { detalhe: "  " }, PACIENTE)).toMatch(
      /influenciador ou anúncio/,
    );
    expect(recusaDaOrigemDoPaciente("encaminhamento", {}, PACIENTE)).toMatch(/médico/);
    expect(recusaDaOrigemDoPaciente("encaminhamento", { detalhe: "Dr. Silva" }, PACIENTE)).toBe(
      null,
    );
  });

  it("indicação pede quem indicou, e ninguém indica a si mesmo", () => {
    expect(recusaDaOrigemDoPaciente("indicacao", {}, PACIENTE)).toMatch(/qual paciente/);
    expect(
      recusaDaOrigemDoPaciente("indicacao", { indicado_por_contact_id: PACIENTE }, PACIENTE),
    ).toMatch(/a si mesmo/);
    expect(
      recusaDaOrigemDoPaciente("indicacao", { indicado_por_contact_id: OUTRO }, PACIENTE),
    ).toBe(null);
  });

  it("WhatsApp e outra não pedem nada", () => {
    expect(recusaDaOrigemDoPaciente("whatsapp", {}, PACIENTE)).toBe(null);
    expect(recusaDaOrigemDoPaciente("outro", {}, PACIENTE)).toBe(null);
  });
});

describe("ORIGENS_PADRAO", () => {
  it("cobre todo tipo, com nomes únicos no tamanho que o banco aceita", () => {
    expect(new Set(ORIGENS_PADRAO.map((o) => o.tipo))).toEqual(new Set(TIPOS_DE_ORIGEM));
    expect(new Set(ORIGENS_PADRAO.map((o) => o.nome)).size).toBe(ORIGENS_PADRAO.length);
    for (const o of ORIGENS_PADRAO) {
      expect(o.nome.length).toBeGreaterThanOrEqual(2);
      expect(o.nome.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("consolidarRelatorio", () => {
  const origens: OrigemDaClinica[] = [
    { id: "w", nome: "WhatsApp", tipo: "whatsapp", ativo: true, ordem: 10 },
    { id: "e", nome: "Encaminhamento médico", tipo: "encaminhamento", ativo: true, ordem: 50 },
    { id: "i", nome: "Instagram", tipo: "instagram", ativo: true, ordem: 20 },
    { id: "x", nome: "Panfleto", tipo: "outro", ativo: false, ordem: 60 },
  ];

  it("soma por origem, com o médico por baixo, na ordem da lista", () => {
    const r = consolidarRelatorio(
      [
        {
          origem_id: "w",
          detalhe: null,
          automatica: true,
          novos: 3,
          com_pacote: 1,
          pacotes: 1,
          pacotes_valor_cents: "90000",
        },
        {
          origem_id: "w",
          detalhe: null,
          automatica: false,
          novos: 1,
          com_pacote: 0,
          pacotes: 0,
          pacotes_valor_cents: 0,
        },
        {
          origem_id: "e",
          detalhe: "Dr. Silva",
          automatica: false,
          novos: 2,
          com_pacote: 2,
          pacotes: 3,
          pacotes_valor_cents: 300000,
        },
        {
          origem_id: "e",
          detalhe: "Dra. Lima",
          automatica: false,
          novos: 4,
          com_pacote: 1,
          pacotes: 1,
          pacotes_valor_cents: 100000,
        },
        {
          origem_id: null,
          detalhe: null,
          automatica: false,
          novos: 2,
          com_pacote: 0,
          pacotes: 0,
          pacotes_valor_cents: 0,
        },
      ],
      origens,
    );
    expect(r.origens.map((o) => o.nome)).toEqual([
      "WhatsApp",
      "Instagram",
      "Encaminhamento médico",
      "Sem origem registrada",
    ]);
    const [whats, insta, enc] = r.origens;
    expect(whats).toMatchObject({ novos: 4, automaticos: 3, com_pacote: 1, conversao_pct: 25 });
    expect(insta).toMatchObject({ novos: 0, conversao_pct: null, detalhes: [] });
    expect(enc).toMatchObject({ novos: 6, com_pacote: 3, pacotes: 4, pacotes_valor_cents: 400000 });
    expect(enc!.detalhes.map((d) => d.detalhe)).toEqual(["Dra. Lima", "Dr. Silva"]);
    expect(enc!.detalhes[1]).toMatchObject({ novos: 2, com_pacote: 2, conversao_pct: 100 });
    expect(r.total).toEqual({
      novos: 12,
      com_pacote: 4,
      pacotes: 5,
      pacotes_valor_cents: 490000,
      conversao_pct: 33,
    });
  });

  it("origem desligada só aparece se trouxe alguém", () => {
    expect(consolidarRelatorio([], origens).origens.map((o) => o.origem_id)).toEqual(["w", "i", "e"]);
    const r = consolidarRelatorio(
      [
        {
          origem_id: "x",
          detalhe: null,
          automatica: false,
          novos: 1,
          com_pacote: 0,
          pacotes: 0,
          pacotes_valor_cents: 0,
        },
      ],
      origens,
    );
    expect(r.origens.map((o) => o.origem_id)).toContain("x");
  });
});

describe("periodoDoRelatorio", () => {
  it("sem datas, o mês corrente no horário de Brasília", () => {
    // 1º de outubro, 01:00 UTC = 30 de setembro, 22:00 em Brasília.
    const p = periodoDoRelatorio(undefined, undefined, new Date("2026-10-01T01:00:00Z"));
    expect(p.de).toBe("2026-09-01");
    expect(p.ate).toBe("2026-09-30");
    expect(p.inicio.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(p.fim.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("o último dia entra inteiro", () => {
    const p = periodoDoRelatorio("2026-10-01", "2026-10-01");
    expect(p.fim.getTime() - p.inicio.getTime()).toBe(86_400_000);
  });
});
