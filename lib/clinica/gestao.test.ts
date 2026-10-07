import { describe, expect, it } from "vitest";

import {
  csvBr,
  dataBr,
  dataDeDia,
  dinheiroBr,
  horaBr,
  linhasDoResumo,
  taxaDeFaltas,
  veRelatoriosDaGestao,
  type RelatorioDaGestao,
} from "./gestao";

describe("o CSV que a contabilidade abre", () => {
  it("usa ponto e vírgula, BOM e CRLF, e só põe aspas onde precisa", () => {
    const csv = csvBr(
      ["Paciente", "Valor (R$)"],
      [
        ["Ana; Bia", "1500,00"],
        ['Diz "oi"', null],
      ],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe('Paciente;Valor (R$)\r\n"Ana; Bia";1500,00\r\n"Diz ""oi""";\r\n');
  });

  it("não deixa texto virar fórmula na planilha", () => {
    expect(csvBr(["x"], [["=SOMA(A1)"], ["-1"], [-1]]).slice(1)).toBe(
      "x\r\n'=SOMA(A1)\r\n'-1\r\n-1\r\n",
    );
  });

  it("dinheiro com vírgula decimal e sem separador de milhar", () => {
    expect(dinheiroBr(150000)).toBe("1500,00");
    expect(dinheiroBr(5)).toBe("0,05");
    expect(dinheiroBr(-1250)).toBe("-12,50");
    expect(dinheiroBr(null)).toBe("");
  });

  it("data e hora no fuso de Brasília", () => {
    // 01h UTC do dia 2 ainda é dia 1 em Brasília.
    expect(dataBr("2026-10-02T01:30:00.000Z")).toBe("01/10/2026");
    expect(horaBr("2026-10-02T01:30:00.000Z")).toBe("22:30");
    expect(dataDeDia("2026-09-30")).toBe("30/09/2026");
  });
});

describe("os números da gestão", () => {
  it("taxa de faltas sobre o que teve desfecho; sem desfecho, sem taxa", () => {
    expect(taxaDeFaltas({ realizadas: 8, faltas: 2 })).toBe(20);
    expect(taxaDeFaltas({ realizadas: 0, faltas: 0 })).toBeNull();
  });

  it("o resumo traz período, vendas e multas com valor em reais", () => {
    const r = {
      periodo: { de: "2026-09-01", ate: "2026-09-30" },
      sessoes: {
        marcadas: 10,
        realizadas: 8,
        faltas: 1,
        canceladas: 1,
        em_aberto: 0,
        pacientes_atendidos: 5,
        avulsas_realizadas: 2,
        avulsas_valor_tabela_cents: 25000,
        avulsas_sem_preco: 0,
      },
      por_modalidade: [],
      por_profissional: [],
      pacotes: {
        vendidos: 2,
        vendidos_valor_cents: 300000,
        vendidos_sem_valor: 0,
        por_modalidade: [{ modalidade: "pilates", vendidos: 2, valor_cents: 300000, sem_valor: 0 }],
        cancelados: 0,
        cancelados_valor_cents: 0,
        reembolso_sugerido_cents: 0,
      },
      multas: {
        geradas: 1,
        geradas_valor_cents: 4500,
        pendentes: 1,
        pendentes_valor_cents: 4500,
        pagas: 0,
        pagas_valor_cents: 0,
        isentas: 0,
        isentas_valor_cents: 0,
      },
      pacientes_novos: 3,
    } satisfies RelatorioDaGestao;
    const linhas = linhasDoResumo(r);
    expect(linhas[0]).toEqual(["Período", "01/09/2026 a 30/09/2026", ""]);
    expect(linhas).toContainEqual(["Pacotes vendidos", 2, "3000,00"]);
    expect(linhas).toContainEqual(["Pacotes vendidos: Pilates", 2, "3000,00"]);
    expect(linhas).toContainEqual(["Multas pendentes", 1, "45,00"]);
  });
});

describe("quem vê os relatórios", () => {
  it("Administrador, Gerente e Financeiro; o Jurídico não, mesmo com o degrau de gerente", () => {
    expect(veRelatoriosDaGestao("admin", [])).toBe(true);
    expect(veRelatoriosDaGestao("manager", ["gerente", "fisioterapeuta"])).toBe(true);
    expect(veRelatoriosDaGestao("manager", ["financeiro"])).toBe(true);
    expect(veRelatoriosDaGestao("manager", ["juridico"])).toBe(false);
    expect(veRelatoriosDaGestao("agent", ["recepcao"])).toBe(false);
    // Perfil gravado sem o papel que a rota exige: o menu não mostra a porta.
    expect(veRelatoriosDaGestao("agent", ["gerente"])).toBe(false);
  });
});
