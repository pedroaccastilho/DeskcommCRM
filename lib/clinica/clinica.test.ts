import { describe, expect, it } from "vitest";

import { falhaDoProntuario } from "@/lib/clinica/api";
import { criarRegistroSchema, editarProfissionalSchema } from "@/lib/clinica/schemas";
import {
  MODALIDADES,
  MODELO_DA_MODALIDADE,
  camposObrigatoriosFaltando,
  camposParaMostrar,
  modeloDoRegistro,
} from "@/lib/clinica/vocabulario";

const UUID = "7f9c1d2e-3b4a-4c5d-8e6f-0a1b2c3d4e5f";

async function corpo(r: Response) {
  return {
    status: r.status,
    ...((await r.json()) as { error: { code: string; message: string } }),
  };
}

describe("falhaDoProntuario", () => {
  it("tabela ausente vira module_not_installed, nunca 500", async () => {
    const r = await corpo(falhaDoProntuario({ code: "42P01" }, "req"));
    expect(r.status).toBe(409);
    expect(r.error.code).toBe("module_not_installed");
  });

  it("recusa com nome do gatilho vira 403 em linguagem de quem usa", async () => {
    const r = await corpo(
      falhaDoProntuario(
        { code: "42501", message: "prontuario_modalidade_fora_do_cadastro: pilates" },
        "req",
      ),
    );
    expect(r.status).toBe(403);
    expect(r.error.message).toBe("Essa modalidade não está no seu cadastro de profissional.");
  });

  it("42501 sem nome (RLS) vira 403 de quem não é profissional", async () => {
    const r = await corpo(falhaDoProntuario({ code: "42501", message: "row-level security" }, "r"));
    expect(r.status).toBe(403);
    expect(r.error.message).toMatch(/profissional de saúde cadastrado/);
  });

  it("registro vazio (23514) vira 422", async () => {
    const r = await corpo(falhaDoProntuario({ code: "23514" }, "req"));
    expect(r.status).toBe(422);
  });
});

describe("criarRegistroSchema", () => {
  const base = { contact_id: UUID, modalidade: "fisioterapia", tipo: "evolucao" } as const;

  it("aceita evolução com conteúdo estruturado", () => {
    expect(criarRegistroSchema.safeParse({ ...base, conteudo: { dor: 4 } }).success).toBe(true);
  });

  it("adendo sem registro original é recusado, e só adendo aponta um", () => {
    expect(criarRegistroSchema.safeParse({ ...base, tipo: "adendo" }).success).toBe(false);
    expect(criarRegistroSchema.safeParse({ ...base, adendo_de: UUID }).success).toBe(false);
    expect(
      criarRegistroSchema.safeParse({ ...base, tipo: "adendo", adendo_de: UUID }).success,
    ).toBe(true);
  });

  it("modalidade fora do vocabulário é recusada", () => {
    expect(criarRegistroSchema.safeParse({ ...base, modalidade: "nutricao" }).success).toBe(false);
  });
});

describe("editarProfissionalSchema", () => {
  it("corpo vazio não é edição", () => {
    expect(editarProfissionalSchema.safeParse({}).success).toBe(false);
    expect(editarProfissionalSchema.safeParse({ ativo: false }).success).toBe(true);
  });
});

describe("modelos por modalidade", () => {
  it("toda modalidade tem modelo, sem chave repetida", () => {
    for (const m of MODALIDADES) {
      const chaves = MODELO_DA_MODALIDADE[m].map((c) => c.chave);
      expect(chaves.length).toBeGreaterThan(0);
      expect(new Set(chaves).size).toBe(chaves.length);
    }
  });
});

describe("modelos por tipo de registro (COFFITO 414/2012)", () => {
  const base = { contact_id: UUID, modalidade: "fisioterapia" } as const;

  it("avaliação de fisioterapia sem diagnóstico, prognóstico e objetivos não assina", () => {
    const r = criarRegistroSchema.safeParse({
      ...base,
      tipo: "avaliacao",
      conteudo: { queixa: "dor lombar" },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/Diagnóstico fisioterapêutico/);
  });

  it("avaliação de fisioterapia completa assina", () => {
    const r = criarRegistroSchema.safeParse({
      ...base,
      tipo: "avaliacao",
      conteudo: {
        diagnostico_fisioterapeutico: "Lombalgia mecânica",
        prognostico: "Bom",
        objetivos: "Reduzir dor",
        numero_de_sessoes: 10,
        frequencia_semanal: 2,
      },
    });
    expect(r.success).toBe(true);
  });

  it("alta exige motivo do vocabulário e resumo", () => {
    const semMotivo = { ...base, tipo: "alta", conteudo: { resumo: "Tratamento concluído" } };
    expect(criarRegistroSchema.safeParse(semMotivo).success).toBe(false);
    const motivoInventado = {
      ...base,
      tipo: "alta",
      conteudo: { motivo: "sumiu", resumo: "x" },
    };
    expect(criarRegistroSchema.safeParse(motivoInventado).success).toBe(false);
    const certa = { ...base, tipo: "alta", conteudo: { motivo: "abandono", resumo: "x" } };
    expect(criarRegistroSchema.safeParse(certa).success).toBe(true);
  });

  it("evolução continua curta e sem obrigatórios", () => {
    expect(modeloDoRegistro("fisioterapia", "evolucao")).toBe(MODELO_DA_MODALIDADE.fisioterapia);
    expect(camposObrigatoriosFaltando("fisioterapia", "evolucao", {})).toEqual([]);
  });

  it("avaliação médica tem HDA e CID; enfermagem tem glicemia", () => {
    const medica = modeloDoRegistro("medicina", "avaliacao").map((c) => c.chave);
    expect(medica).toEqual(expect.arrayContaining(["hda", "cid"]));
    expect(MODELO_DA_MODALIDADE.enfermagem.map((c) => c.chave)).toContain("glicemia");
  });

  it("registro antigo de avaliação, com chaves da evolução, continua aparecendo", () => {
    const chaves = camposParaMostrar("fisioterapia", "avaliacao").map((c) => c.chave);
    expect(chaves).toEqual(
      expect.arrayContaining(["amplitude", "local_da_dor", "diagnostico_fisioterapeutico"]),
    );
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
