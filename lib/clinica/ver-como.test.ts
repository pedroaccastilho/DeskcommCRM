import { describe, expect, it } from "vitest";

import type { UserOrgMembership } from "@/lib/auth/types";

import { lerValorDoVerComo, verComoValido } from "./ver-como";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const MEDICA = "44444444-4444-4444-8444-444444444444";

function usuario(role: string, org = ORG) {
  return {
    id: ADMIN,
    organizations: [{ organization_id: org, role } as unknown as UserOrgMembership],
  };
}

describe("lerValorDoVerComo", () => {
  it("lê organização e pessoa", () => {
    expect(lerValorDoVerComo(`${ORG}.${MEDICA}`)).toEqual({ orgId: ORG, userId: MEDICA });
  });

  it("recusa valor torto", () => {
    expect(lerValorDoVerComo(undefined)).toBeNull();
    expect(lerValorDoVerComo("")).toBeNull();
    expect(lerValorDoVerComo(MEDICA)).toBeNull();
    expect(lerValorDoVerComo(`${ORG}.nao-e-uuid`)).toBeNull();
    expect(lerValorDoVerComo(`${ORG}.${MEDICA}.${ADMIN}`)).toBeNull();
  });
});

describe("verComoValido", () => {
  const ver = { orgId: ORG, userId: MEDICA };

  it("vale para o administrador daquela organização", () => {
    expect(verComoValido(ver, usuario("admin"))).toEqual(ver);
  });

  it("não vale para quem não é administrador, nem em outra organização", () => {
    expect(verComoValido(ver, usuario("manager"))).toBeNull();
    expect(verComoValido(ver, usuario("admin", OUTRA_ORG))).toBeNull();
  });

  it("não vale para ver a si mesmo", () => {
    expect(verComoValido({ orgId: ORG, userId: ADMIN }, usuario("admin"))).toBeNull();
  });

  it("sem cookie, nada", () => {
    expect(verComoValido(null, usuario("admin"))).toBeNull();
  });
});
