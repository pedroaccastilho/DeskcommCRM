/**
 * "ENTRAR COMO" (fork TOQ): o administrador da clínica vê o sistema como outra pessoa da equipe
 * para conferir o que ela vê, e volta quando quiser.
 *
 * Pedido do Pedro (2026-10-04): "o administrador pode se logar com outros perfis (sendo possível
 * reverter), pra que ele possa validar a visão deles". A sessão continua sendo a do
 * administrador; o que muda é o que a interface nova (`/novo`) monta: papel, perfis, cadastro de
 * profissional e "quem sou eu" passam a ser os da outra pessoa (`/api/v1/clinica/eu`).
 *
 * É SÓ OLHAR. Enquanto o modo está ligado, toda escrita de `/api/v1` é recusada pela guarda de
 * efeito (`requireSupportWrite`), menos sair do modo. Assim nada é gravado em nome de quem não
 * fez, e o administrador nunca assina prontuário como o médico. Ler continua sendo o
 * administrador: a RLS e a lista de "quem abriu o prontuário" registram ele, não a outra pessoa.
 *
 * O cookie guarda `<organização>.<pessoa>` e só vale para quem é administrador DAQUELA
 * organização. Quem não é (outra pessoa que entrou no mesmo navegador) segue normal.
 */
import { cookies } from "next/headers";

import type { AuthUser } from "@/lib/auth/types";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const COOKIE_VER_COMO = "clinica_ver_como";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerComo {
  orgId: string;
  userId: string;
}

export const MENSAGEM_SO_OLHAR =
  "Você está vendo o sistema como outra pessoa: aqui é só olhar. Volte para o administrador para alterar.";

export function lerValorDoVerComo(valor: string | undefined | null): VerComo | null {
  if (!valor) return null;
  const [orgId, userId, ...resto] = valor.split(".");
  if (resto.length > 0 || !orgId || !userId || !UUID.test(orgId) || !UUID.test(userId)) {
    return null;
  }
  return { orgId, userId };
}

/** O modo vale só para administrador daquela organização, e nunca para ver a si mesmo. */
export function verComoValido(
  ver: VerComo | null,
  user: Pick<AuthUser, "id" | "organizations">,
): VerComo | null {
  if (!ver || ver.userId === user.id) return null;
  const vinculo = user.organizations.find((o) => o.organization_id === ver.orgId);
  return vinculo?.role === "admin" ? ver : null;
}

/** O cookie lido do pedido; `null` fora de um pedido (worker, teste) ou sem cookie. */
export async function lerVerComo(): Promise<VerComo | null> {
  try {
    return lerValorDoVerComo((await cookies()).get(COOKIE_VER_COMO)?.value);
  } catch {
    return null;
  }
}

/** A mensagem de recusa para a guarda de efeito, ou `null` quando a escrita segue. */
export async function escritaBloqueadaPeloVerComo(
  user: Pick<AuthUser, "id" | "organizations">,
): Promise<string | null> {
  return verComoValido(await lerVerComo(), user) ? MENSAGEM_SO_OLHAR : null;
}

/** Oito horas: um esquecimento não deixa o administrador preso no modo no dia seguinte. */
export async function gravarVerComo(ver: VerComo): Promise<void> {
  (await cookies()).set(COOKIE_VER_COMO, `${ver.orgId}.${ver.userId}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function apagarVerComo(): Promise<void> {
  (await cookies()).delete(COOKIE_VER_COMO);
}
