import { describe, expect, it } from "vitest";

import {
  cargosDoUsuario,
  interfaceDosCargos,
  papelDosCargos,
  problemaNosCargos,
  SAUDE_DO_CARGO,
} from "./cargos";
import { registroParaGravar } from "./equipe-servidor";
import { convidarComCargosSchema } from "./schemas";

describe("perfis calculados para quem ainda não tem linha (quem já estava cadastrado não muda)", () => {
  it("o papel diz o cargo de gestão, o cadastro ativo diz o de saúde, e os dois se somam", () => {
    expect(cargosDoUsuario("admin", null)).toEqual(["administrador"]);
    expect(cargosDoUsuario("manager", null)).toEqual(["gerente"]);
    expect(cargosDoUsuario("manager", { conselho: "CREFITO", ativo: true })).toEqual([
      "gerente",
      "fisioterapeuta",
    ]);
    expect(cargosDoUsuario("admin", { conselho: "CRM", ativo: true })).toEqual([
      "administrador",
      "medico",
    ]);
  });

  it("o conselho do cadastro ativo diz o cargo de saúde", () => {
    expect(cargosDoUsuario("agent", { conselho: "CRM", ativo: true })).toEqual(["medico"]);
    expect(cargosDoUsuario("agent", { conselho: "CREFITO", ativo: true })).toEqual([
      "fisioterapeuta",
    ]);
    expect(cargosDoUsuario("agent", { conselho: "COREN", ativo: true })).toEqual(["enfermeiro"]);
    expect(cargosDoUsuario("agent", { conselho: "CREF", ativo: true })).toEqual(["educador"]);
  });

  it("sem gestão nem saúde é recepção; conselho fora da lista fica sem cargo", () => {
    expect(cargosDoUsuario("agent", null)).toEqual(["recepcao"]);
    expect(cargosDoUsuario("agent", { conselho: "CRM", ativo: false })).toEqual(["recepcao"]);
    expect(cargosDoUsuario("agent", { conselho: "CRP", ativo: true })).toEqual([]);
    expect(cargosDoUsuario("manager", { conselho: "CRP", ativo: true })).toEqual(["gerente"]);
  });

  it("todo cargo de saúde, sozinho ou com gestão, volta a ser lido como ele mesmo", () => {
    for (const saude of ["medico", "fisioterapeuta", "enfermeiro", "educador"] as const) {
      const gravado = { conselho: SAUDE_DO_CARGO[saude].conselho, ativo: true };
      for (const cargos of [[saude], ["gerente", saude], ["administrador", saude]] as const) {
        expect(cargosDoUsuario(papelDosCargos(cargos), gravado)).toEqual(cargos);
      }
    }
  });
});

describe("perfis gravados vencem os calculados", () => {
  it("quem tem linha em clinica_cargos_membro tem exatamente aqueles perfis, em ordem fixa", () => {
    expect(cargosDoUsuario("manager", null, ["juridico", "gerente", "financeiro"])).toEqual([
      "gerente",
      "financeiro",
      "juridico",
    ]);
    expect(
      cargosDoUsuario("agent", { conselho: "CREFITO", ativo: true }, [
        "recepcao",
        "fisioterapeuta",
      ]),
    ).toEqual(["recepcao", "fisioterapeuta"]);
    // Valor fora do vocabulário (linha de outra versão) é ignorado; sem nenhum válido, calcula.
    expect(cargosDoUsuario("admin", null, ["xyz"])).toEqual(["administrador"]);
  });
});

describe("combinações", () => {
  it("qualquer soma vale, menos dois perfis de saúde", () => {
    expect(problemaNosCargos(["juridico", "financeiro", "gerente"])).toBeNull();
    expect(problemaNosCargos(["gerente", "fisioterapeuta"])).toBeNull();
    expect(problemaNosCargos(["recepcao", "educador"])).toBeNull();
    expect(problemaNosCargos([])).not.toBeNull();
    expect(problemaNosCargos(["medico", "enfermeiro"])).not.toBeNull();
    expect(problemaNosCargos(["gerente", "gerente"])).not.toBeNull();
  });
});

describe("o que os perfis gravam", () => {
  it("o papel é o maior que algum perfil pede", () => {
    expect(papelDosCargos(["administrador", "medico"])).toBe("admin");
    expect(papelDosCargos(["gerente", "fisioterapeuta"])).toBe("manager");
    expect(papelDosCargos(["juridico"])).toBe("manager");
    expect(papelDosCargos(["financeiro", "recepcao"])).toBe("manager");
    expect(papelDosCargos(["fisioterapeuta"])).toBe("agent");
    expect(papelDosCargos(["recepcao"])).toBe("agent");
  });

  it("fisioterapeuta atende fisioterapia e pilates; educador só pilates", () => {
    expect(SAUDE_DO_CARGO.fisioterapeuta.modalidades).toEqual(["fisioterapia", "pilates"]);
    expect(SAUDE_DO_CARGO.educador.modalidades).toEqual(["pilates"]);
    expect(SAUDE_DO_CARGO.medico.modalidades).toEqual(["medicina"]);
    expect(SAUDE_DO_CARGO.enfermeiro.modalidades).toEqual(["enfermagem"]);
  });

  it("o menu: gestão vê tudo; o resto é a união dos menus prontos", () => {
    expect(interfaceDosCargos(["administrador"])).toEqual({ preset: "completa" });
    expect(interfaceDosCargos(["juridico", "financeiro"])).toEqual({ preset: "completa" });
    expect(interfaceDosCargos(["medico"]).destinos?.[0]).toBe("/app/clinica/meu-dia");
    expect(interfaceDosCargos(["educador"]).destinos).not.toContain("/app/clinica/pendencias");
    expect(interfaceDosCargos(["recepcao"]).destinos?.[0]).toBe("/app/clinica/balcao");
    const soma = interfaceDosCargos(["recepcao", "fisioterapeuta"]).destinos ?? [];
    expect(soma).toEqual(expect.arrayContaining(["/app/clinica/balcao", "/app/clinica/meu-dia"]));
    expect(new Set(soma).size).toBe(soma.length);
  });
});

describe("registro do conselho", () => {
  const existente = {
    conselho: "CREFITO",
    nome_profissional: "Ana Souza",
    registro_numero: "12345-F",
    registro_uf: "SP",
  };

  it("trocar os cargos mantendo o mesmo conselho reaproveita o registro", () => {
    expect(registroParaGravar("fisioterapeuta", {}, existente)).toEqual({
      nome_profissional: "Ana Souza",
      registro_numero: "12345-F",
      registro_uf: "SP",
    });
  });

  it("outro conselho exige o registro novo", () => {
    expect(registroParaGravar("medico", {}, existente)).toBeNull();
    expect(
      registroParaGravar(
        "medico",
        { nome_profissional: "Ana", registro_numero: "9", registro_uf: "RJ" },
        existente,
      ),
    ).toEqual({ nome_profissional: "Ana", registro_numero: "9", registro_uf: "RJ" });
  });

  it("o convite com cargo de saúde recusa sem o registro; recepção e gerente não precisam", () => {
    const ok = (corpo: object) => convidarComCargosSchema.safeParse(corpo).success;
    expect(ok({ email: "a@b.com", cargos: ["medico"] })).toBe(false);
    expect(ok({ email: "a@b.com", cargos: ["gerente", "fisioterapeuta"] })).toBe(false);
    expect(ok({ email: "a@b.com", cargos: ["recepcao"] })).toBe(true);
    expect(ok({ email: "a@b.com", cargos: ["gerente"] })).toBe(true);
    expect(ok({ email: "a@b.com", cargos: ["juridico", "financeiro", "gerente"] })).toBe(true);
    expect(ok({ email: "a@b.com", cargos: ["medico", "fisioterapeuta"] })).toBe(false);
    expect(
      convidarComCargosSchema.safeParse({
        email: "A@B.com",
        cargos: ["gerente", "fisioterapeuta"],
        nome_profissional: "Rui",
        registro_numero: "1",
        registro_uf: "SP",
      }).data?.email,
    ).toBe("a@b.com");
  });
});
