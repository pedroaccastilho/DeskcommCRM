import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A VIRADA DO DIA NAS SPECS DA CLÍNICA.
 *
 * O Balcão e o Meu dia mostram as sessões de HOJE no fuso da organização (`organizations.timezone`).
 * Specs que semeiam sessões em instantes relativos ao agora (de "25 min atrás" a "daqui a 1 h")
 * quebram quando a rodada cai perto da meia-noite desse fuso: a sessão vai para o dia seguinte
 * (ou o anterior) e some da fila. Medido no CI em 2026-10-05: `clinica-balcao` e `clinica-chegou`
 * vermelhas na `main` e em três PRs, todas entre 23h40 e 23h58 de Brasília.
 *
 * O relógio do servidor não se finge. O que se escolhe é o FUSO da organização durante o caso: se o
 * de São Paulo deixa a janela inteira no mesmo dia, nada muda; senão vale o primeiro fuso da lista
 * em que ela cabe, e o anterior volta no fim. Os specs rodam com um worker só, então ninguém mais
 * vê a troca.
 */
const FUSOS = [
  "America/Sao_Paulo",
  "Europe/Lisbon",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "America/Los_Angeles",
] as const;

/** Folga além da janela pedida: o caso leva minutos para rodar. */
const FOLGA_MIN = 20;

function minutoDoDia(fuso: string, agora: Date): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(agora);
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minuto = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
  return hora * 60 + minuto;
}

/**
 * O fuso em que `[agora - antesMin, agora + depoisMin]` (mais a folga) cai num dia só.
 */
export function fusoLongeDaVirada(antesMin: number, depoisMin: number, agora = new Date()): string {
  for (const fuso of FUSOS) {
    const m = minutoDoDia(fuso, agora);
    if (m - antesMin - FOLGA_MIN >= 0 && m + depoisMin + FOLGA_MIN < 24 * 60) return fuso;
  }
  throw new Error(`nenhum fuso deixa ${antesMin} min antes e ${depoisMin} min depois no mesmo dia`);
}

/**
 * Põe a organização num fuso longe da virada do dia e devolve quem desfaz. Sem troca (o fuso que
 * ela já tem serve), o desfazer não faz nada.
 */
export async function fusoDaOrganizacaoLongeDaVirada(
  admin: SupabaseClient,
  orgId: string,
  antesMin: number,
  depoisMin: number,
): Promise<() => Promise<void>> {
  const { data, error } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .single();
  if (error) throw new Error(`organizations select: ${error.message}`);
  const antes = (data as { timezone: string | null }).timezone;
  const fuso = fusoLongeDaVirada(antesMin, depoisMin);
  if (fuso === (antes ?? "America/Sao_Paulo")) return async () => {};

  const { error: erroTroca } = await admin
    .from("organizations")
    .update({ timezone: fuso } as never)
    .eq("id", orgId);
  if (erroTroca) throw new Error(`organizations update: ${erroTroca.message}`);
  return async () => {
    await admin
      .from("organizations")
      .update({ timezone: antes } as never)
      .eq("id", orgId);
  };
}
