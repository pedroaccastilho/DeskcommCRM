import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ProfissionaisDaClinica } from "./_client";

export const dynamic = "force-dynamic";

/**
 * PROFISSIONAIS DE SAÚDE — módulo opcional clínica (fork TOQ, ADR-0002).
 *
 * Estar cadastrado e ativo aqui é o que dá acesso ao prontuário; o papel na organização não
 * basta (a recepção pode ser `manager` e não lê prontuário). Só `admin` cadastra, e a RLS da
 * migration 9001 diz o mesmo — esta página só decide o que mostrar.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Profissionais de saúde")}</h1>
        <p className="text-sm text-text-muted">
          {t("Só quem está cadastrado e ativo aqui lê e assina o prontuário dos pacientes.")}
        </p>
      </div>
      <p className="bg-surface-subtle rounded-md border border-border p-3 text-sm">
        {t(
          "O cadastro da equipe agora fica em Equipe, na interface nova: lá você escolhe os perfis de cada pessoa (Médico, Fisioterapeuta, Gerente, Financeiro…) e o registro no conselho vai junto.",
        )}{" "}
        <a href="/novo/equipe" className="font-semibold underline">
          {t("Abrir a Equipe")}
        </a>
      </p>
      <ProfissionaisDaClinica podeEditar={ROLE_RANK[org.role] >= ROLE_RANK.admin} />
    </div>
  );
}
