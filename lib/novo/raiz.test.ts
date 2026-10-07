import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { destinoNaInterfaceNova, usaSoAInterfaceNova } from "./raiz";

const ID = "4c97628c-6540-4f09-8c32-1bc43e99098a";
const base = { isPlatformAdmin: false, suporte: false, clinicaInstalada: true };

describe("quem trabalha só na interface nova", () => {
  it("todo perfil que não administra; o Administrador alterna", () => {
    expect(usaSoAInterfaceNova({ ...base, role: "agent" })).toBe(true);
    expect(usaSoAInterfaceNova({ ...base, role: "manager" })).toBe(true);
    expect(usaSoAInterfaceNova({ ...base, role: "viewer" })).toBe(true);
    expect(usaSoAInterfaceNova({ ...base, role: "admin" })).toBe(false);
  });

  it("suporte, administrador da plataforma e instalação sem o módulo ficam na atual", () => {
    expect(usaSoAInterfaceNova({ ...base, role: "agent", suporte: true })).toBe(false);
    expect(usaSoAInterfaceNova({ ...base, role: "agent", isPlatformAdmin: true })).toBe(false);
    expect(usaSoAInterfaceNova({ ...base, role: "agent", clinicaInstalada: false })).toBe(false);
  });
});

describe("a tela equivalente", () => {
  it("leva cada tela do dia a dia para a nova, com o mesmo paciente e a mesma conversa", () => {
    expect(destinoNaInterfaceNova("/app")).toBe("/hoje");
    expect(destinoNaInterfaceNova("/app/")).toBe("/hoje");
    expect(destinoNaInterfaceNova("/app/clinica/balcao")).toBe("/hoje");
    expect(destinoNaInterfaceNova("/app/clinica/meu-dia")).toBe("/hoje");
    expect(destinoNaInterfaceNova("/app/agenda")).toBe("/agenda");
    expect(destinoNaInterfaceNova("/app/tasks")).toBe("/tarefas");
    expect(destinoNaInterfaceNova("/app/contacts")).toBe("/pacientes");
    expect(destinoNaInterfaceNova(`/app/contacts/${ID}`)).toBe(`/pacientes/${ID}`);
    expect(destinoNaInterfaceNova("/app/inbox", `id=${ID}`)).toBe(`/whatsapp?id=${ID}`);
    expect(destinoNaInterfaceNova(`/app/inbox/${ID}`)).toBe(`/whatsapp?id=${ID}`);
  });

  it("a conta da pessoa (perfil, segurança, avisos) também tem tela na nova", () => {
    expect(destinoNaInterfaceNova("/app/settings/profile")).toBe("/conta");
    expect(destinoNaInterfaceNova("/app/settings/security")).toBe("/conta/seguranca");
    expect(destinoNaInterfaceNova("/app/settings/notifications")).toBe("/conta/avisos");
  });

  it("tela sem equivalente continua na atual, e lixo na URL não vira destino", () => {
    expect(destinoNaInterfaceNova("/app/settings/billing")).toBeNull();
    expect(destinoNaInterfaceNova("/app/notifications")).toBeNull();
    expect(destinoNaInterfaceNova("/app/contacts/nao-e-uuid")).toBeNull();
    expect(destinoNaInterfaceNova("/app/inbox", "id=//evil.example")).toBe("/whatsapp");
  });
});

describe("todo destino existe", () => {
  it("cada tela da nova para onde a atual leva tem página (senão o link antigo vira 404)", () => {
    const origens = [
      "/app",
      "/app/agenda",
      "/app/tasks",
      "/app/clinica/origens",
      "/app/contacts",
      `/app/contacts/${ID}`,
      "/app/inbox",
      "/app/settings/profile",
      "/app/settings/security",
      "/app/settings/notifications",
    ];
    for (const origem of origens) {
      const destino = destinoNaInterfaceNova(origem)!;
      const rota = destino.split("?")[0]!.replace(ID, "[id]");
      const pagina = path.join(process.cwd(), "app", "(nova)", rota, "page.tsx");
      expect(existsSync(pagina), `${origem} leva a ${rota}, que não tem ${pagina}`).toBe(true);
    }
  });
});
