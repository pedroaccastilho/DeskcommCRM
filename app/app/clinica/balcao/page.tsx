import { redirect } from "next/navigation";

import { diaDeHojeNoFuso } from "@/lib/agenda/semana-semente";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { Balcao } from "./_client";

export const dynamic = "force-dynamic";

/**
 * BALCÃO DA RECEPÇÃO — módulo opcional clínica (fork TOQ).
 *
 * A tela de quem atende no balcão: a fila do dia ao lado do paciente escolhido, com as ações que
 * a recepção faz o dia todo (confirmar, remarcar, cancelar com a multa já calculada, registrar a
 * falta depois da tolerância, mandar WhatsApp) em janelas rápidas, sem sair da tela.
 *
 * O relógio é o da ORGANIZAÇÃO, como na Agenda (decisão do dono do produto em #1350): a recepção
 * e os profissionais olham o mesmo dia.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const fuso = fusoUtilizavel(org.timezone);
  return <Balcao fuso={fuso} hoje={diaDeHojeNoFuso(new Date(), fuso)} />;
}
