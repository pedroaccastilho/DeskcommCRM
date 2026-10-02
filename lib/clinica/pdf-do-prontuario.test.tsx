// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  registrosParaImprimir,
  renderProntuarioPdf,
  type RegistroParaPdf,
} from "./pdf-do-prontuario";

function registro(
  r: Partial<RegistroParaPdf> & { id: string; assinado_em: string },
): RegistroParaPdf {
  return {
    modalidade: "fisioterapia",
    tipo: "evolucao",
    appointment_id: null,
    adendo_de: null,
    conteudo: {},
    texto: null,
    autor_nome: "Ana Fisio",
    autor_registro: "CREFITO 123456-F/SP",
    ...r,
  };
}

const AVALIACAO = registro({
  id: "a",
  tipo: "avaliacao",
  assinado_em: "2026-09-01T13:00:00Z",
  conteudo: { diagnostico_fisioterapeutico: "Lombalgia", prognostico: "", objetivos: "Dor 0" },
});
const ALTA = registro({
  id: "c",
  tipo: "alta",
  assinado_em: "2026-09-20T13:00:00Z",
  conteudo: { motivo: "objetivo_atingido", resumo: "Concluído" },
});
const ADENDO = registro({
  id: "b",
  tipo: "adendo",
  adendo_de: "a",
  appointment_id: null,
  assinado_em: "2026-09-02T13:00:00Z",
  texto: "Correção: lado direito.",
});

describe("registrosParaImprimir", () => {
  const impressos = registrosParaImprimir([ALTA, ADENDO, AVALIACAO]);

  it("imprime na ordem em que aconteceu, o mais antigo primeiro", () => {
    expect(impressos.map((r) => r.titulo)).toEqual([
      "Fisioterapia · Avaliação",
      "Fisioterapia · Adendo",
      "Fisioterapia · Alta",
    ]);
  });

  it("campo vazio fica fora, e opção sai com o rótulo, não com o código", () => {
    expect(impressos[0]!.campos.map((c) => c.rotulo)).not.toContain("Prognóstico");
    expect(impressos[2]!.campos.map((c) => c.valor)).toEqual(["Objetivo atingido", "Concluído"]);
  });

  it("adendo diz a qual registro se refere", () => {
    expect(impressos[1]!.adendoDe).toMatch(/^Avaliação de 01\/09\/2026/);
  });

  it("a assinatura é a que o banco carimbou, no fuso de Brasília", () => {
    expect(impressos[0]!.assinatura).toBe(
      "Assinado eletronicamente por Ana Fisio · CREFITO 123456-F/SP em 01/09/2026, 10:00",
    );
  });
});

describe("renderProntuarioPdf", () => {
  it("gera um PDF, com e sem registros", async () => {
    for (const registros of [[AVALIACAO, ADENDO, ALTA], []]) {
      const buf = await renderProntuarioPdf({
        clinica: "TOQ Clínica do Movimento LTDA",
        paciente: { nome: "Maria", telefone: "+5511999990000" },
        geradoPor: "Ana Fisio · CREFITO 123456-F/SP",
        geradoEm: new Date("2026-10-01T12:00:00Z"),
        registros,
      });
      expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});
