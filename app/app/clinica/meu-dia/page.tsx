import { redirect } from "next/navigation";

import { diaDeHojeNoFuso } from "@/lib/agenda/semana-semente";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { MeuDia } from "./_client";

export const dynamic = "force-dynamic";

/**
 * MEU DIA — módulo opcional clínica (fork TOQ).
 *
 * A tela do profissional de saúde: os próprios horários do dia e, ao lado, o paciente da vez em
 * modo atendimento (o que foi feito na última sessão e a evolução de hoje), sem sair da tela.
 * O relógio é o da organização, como no Balcão e na Agenda.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const fuso = fusoUtilizavel(org.timezone);
  return <MeuDia fuso={fuso} hoje={diaDeHojeNoFuso(new Date(), fuso)} />;
}
