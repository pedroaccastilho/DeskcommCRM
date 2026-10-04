import { describe, expect, it } from "vitest";

import { moduloClinicaNaoInstalado } from "./api";

describe("moduloClinicaNaoInstalado", () => {
  it("reconhece a tabela ausente pelo Postgres e pelo PostgREST", () => {
    expect(moduloClinicaNaoInstalado({ code: "42P01" })).toBe(true);
    // O que o PostgREST responde a `.from("clinica_profissionais")` antes de instalar.
    expect(moduloClinicaNaoInstalado({ code: "PGRST205" })).toBe(true);
  });

  it("não engole outro erro", () => {
    expect(moduloClinicaNaoInstalado({ code: "42501" })).toBe(false);
    expect(moduloClinicaNaoInstalado({ code: "PGRST202" })).toBe(false);
    expect(moduloClinicaNaoInstalado(null)).toBe(false);
  });
});
