import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { RegrasDaClinica } from "./_client";

export const dynamic = "force-dynamic";

/**
 * REGRAS DA CLÍNICA — módulo opcional clínica (fork TOQ, migrations 9002 e 9003).
 *
 * Os valores do negócio que a clínica muda sem programador: multa e antecedência do cancelamento,
 * tolerância de atraso, modalidade e preço de cada tipo de atendimento, pacote e alertas.
 *
 * Só `admin` (pedido do Pedro, 02/10/2026): os outros perfis nem abrem a tela, para não lerem
 * configuração e preço fora de contexto. A RLS da 9003 e as rotas cobram o mesmo degrau; esta
 * página só decide o que mostrar. A agenda de todos continua recebendo os prazos que saem daqui.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (ROLE_RANK[org.role] < ROLE_RANK.admin) redirect("/app/settings");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Regras da clínica")}</h1>
        <p className="text-sm text-text-muted">
          {t("Os valores do negócio da clínica. Só administradores veem e alteram esta tela.")}
        </p>
      </div>
      <RegrasDaClinica />
    </div>
  );
}
