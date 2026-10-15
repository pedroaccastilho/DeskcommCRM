import { describe, expect, it } from "vitest";

import {
  diaParaInstante,
  nomeDoArquivoFinanceiro,
  registrarDespesaSchema,
  saldoDo,
  type ResumoFinanceiro,
} from "./financeiro";

const despesa = {
  descricao: "Aluguel de outubro",
  categoria: "aluguel",
  forma: "boleto",
  valor_cents: 300000,
  dia: "2026-10-05",
};

describe("a despesa que entra pela rota", () => {
  it("aceita a despesa completa e apara a descrição", () => {
    const lido = registrarDespesaSchema.parse({ ...despesa, descricao: "  Luz  " });
    expect(lido.descricao).toBe("Luz");
  });

  it("recusa valor zero, categoria ou forma desconhecida, dia mal escrito e campo a mais", () => {
    expect(registrarDespesaSchema.safeParse({ ...despesa, valor_cents: 0 }).success).toBe(false);
    expect(registrarDespesaSchema.safeParse({ ...despesa, categoria: "energia" }).success).toBe(
      false,
    );
    expect(registrarDespesaSchema.safeParse({ ...despesa, forma: "cheque" }).success).toBe(false);
    expect(registrarDespesaSchema.safeParse({ ...despesa, dia: "05/10/2026" }).success).toBe(false);
    expect(
      registrarDespesaSchema.safeParse({ ...despesa, organization_id: "x" }).success,
      "a organização vem do cookie, nunca do corpo",
    ).toBe(false);
  });
});

describe("as contas do painel", () => {
  it("o dia da despesa vira meio-dia de Brasília, longe da virada do período", () => {
    expect(diaParaInstante("2026-10-31")).toBe("2026-10-31T15:00:00.000Z");
    expect(diaParaInstante("2026-10-01")).toBe("2026-10-01T15:00:00.000Z");
  });

  it("saldo é o que entrou menos o que saiu", () => {
    const r = {
      entradas: { qtd: 2, total_cents: 168000, sem_valor: 0, por_forma: [], por_tipo: [] },
      saidas: { qtd: 1, total_cents: 300000, por_categoria: [] },
      a_receber: { qtd: 0, total_cents: 0, sem_valor: 0, por_tipo: [] },
    } satisfies ResumoFinanceiro;
    expect(saldoDo(r)).toBe(-132000);
  });

  it("o nome da planilha diz o tipo e o período", () => {
    expect(nomeDoArquivoFinanceiro("a_receber", "2026-10-01", "2026-10-31")).toBe(
      "clinica-financeiro-a-receber-2026-10-01-a-2026-10-31.csv",
    );
  });
});
