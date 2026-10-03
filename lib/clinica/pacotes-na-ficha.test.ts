import { describe, expect, it } from "vitest";

import {
  ajustesPermitidos,
  congeladoAte,
  corpoDaVenda,
  opcoesDeVenda,
  separarPacotes,
  type PacoteDaFicha,
  type ProdutoDoCatalogo,
} from "./pacotes-na-ficha";

function pacote(extra: Partial<PacoteDaFicha> = {}): PacoteDaFicha {
  return {
    id: "p1",
    contact_id: "c1",
    produto_id: null,
    nome: "Fisioterapia, 10 sessões",
    modalidade: "fisioterapia",
    sessoes_total: 10,
    sessoes_usadas: 4,
    saldo: 6,
    situacao: "ativo",
    precisa_renovar: false,
    valor_cents: null,
    currency: "BRL",
    comprado_em: "2026-10-01T12:00:00Z",
    valido_ate: "2026-11-30T12:00:00Z",
    status: "ativo",
    congelado_em: null,
    congelado_dias: null,
    cancelado_em: null,
    cancelamento_motivo: null,
    ...extra,
  };
}

const produto = (extra: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo => ({
  id: "prod1",
  nome: "Pilates 8 aulas",
  modalidade: "pilates",
  sessoes: 8,
  validade_dias: 45,
  valor_cents: 48000,
  currency: "BRL",
  ativo: true,
  ...extra,
});

describe("pacotes na ficha do paciente", () => {
  it("separa o que está valendo do que já passou, na ordem da rota", () => {
    const { vigentes, anteriores } = separarPacotes([
      pacote({ id: "a" }),
      pacote({ id: "b", situacao: "vencido" }),
      pacote({ id: "c", situacao: "cancelado", status: "cancelado" }),
      pacote({ id: "d", situacao: "esgotado", saldo: 0 }),
    ]);
    expect(vigentes.map((p) => p.id)).toEqual(["a"]);
    expect(anteriores.map((p) => p.id)).toEqual(["b", "c", "d"]);
  });

  it("vende do catálogo à venda e, sempre, o pacote padrão de cada modalidade", () => {
    const opcoes = opcoesDeVenda([produto(), produto({ id: "fora", ativo: false })]);
    expect(opcoes.map((o) => o.chave)).toEqual([
      "produto:prod1",
      "padrao:fisioterapia",
      "padrao:pilates",
      "padrao:medicina",
      "padrao:enfermagem",
    ]);
    // Catálogo vazio (a TOQ ainda não fechou os preços): o padrão continua à venda.
    expect(opcoesDeVenda([])).toHaveLength(4);
  });

  it("monta o corpo da venda com o aceite, sem mandar valor que ninguém digitou", () => {
    const [doCatalogo, padrao] = opcoesDeVenda([produto()]);
    expect(corpoDaVenda("c1", doCatalogo!, 999)).toEqual({
      contact_id: "c1",
      produto_id: "prod1",
      aceite_politica: true,
    });
    expect(corpoDaVenda("c1", padrao!, null)).toEqual({
      contact_id: "c1",
      modalidade: "fisioterapia",
      aceite_politica: true,
    });
    expect(corpoDaVenda("c1", padrao!, 30000)).toMatchObject({ valor_cents: 30000 });
  });

  it("calcula até quando o congelamento segura o pacote", () => {
    expect(congeladoAte(pacote())).toBeNull();
    expect(
      congeladoAte(
        pacote({ congelado_em: "2026-10-03T12:00:00Z", congelado_dias: 10 }),
      )?.toISOString(),
    ).toBe("2026-10-13T12:00:00.000Z");
  });

  it("oferece a cada perfil só o ajuste que a rota aceitaria", () => {
    expect(ajustesPermitidos(pacote(), false)).toEqual(["congelar"]);
    expect(ajustesPermitidos(pacote(), true)).toEqual(["congelar", "prorrogar", "cancelar"]);
    // Congelar é uma vez por pacote, e só no que está valendo.
    expect(ajustesPermitidos(pacote({ congelado_em: "2026-10-03T12:00:00Z" }), false)).toEqual([]);
    expect(ajustesPermitidos(pacote({ situacao: "vencido" }), true)).toEqual(["prorrogar"]);
    // Sem saldo, prorrogar não devolve nada, e só se cancela o que está valendo.
    expect(ajustesPermitidos(pacote({ situacao: "esgotado", saldo: 0 }), true)).toEqual([]);
    expect(ajustesPermitidos(pacote({ situacao: "cancelado", status: "cancelado" }), true)).toEqual(
      [],
    );
  });
});
