"use client";

/**
 * "Oferecer renovação": os pacotes perto do fim, para a recepção (módulo clínica, migration 9004).
 *
 * Lê `GET /api/v1/clinica/pacotes/renovar`, que já devolve só os pacotes ativos com saldo no
 * limite das Regras da clínica, os que vencem antes primeiro. Cada linha leva à ficha do
 * paciente, onde fica o "Vender pacote". Some quando não há nada a oferecer, sem o módulo e para
 * quem não é da Recepção para cima (a rota responde 403 e 409).
 */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import Link from "next/link";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PacoteDaFicha } from "@/lib/clinica/pacotes-na-ficha";

type PacoteParaRenovar = PacoteDaFicha & {
  paciente: {
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
  } | null;
};

export function PacotesParaRenovar({ ativo = true }: { ativo?: boolean }) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const lista = useQuery({
    queryKey: ["clinica", "pacotes", "renovar"],
    enabled: ativo,
    staleTime: 60_000,
    retry: false,
    queryFn: async () =>
      (await apiClient.get<{ data: PacoteParaRenovar[] }>("/api/v1/clinica/pacotes/renovar")).data,
  });

  if (!ativo || !lista.data || lista.data.length === 0) return null;

  return (
    <section
      data-testid="pacotes-para-renovar"
      aria-labelledby="titulo-renovacao"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="titulo-renovacao" className="text-base font-medium text-text">
        {t("Oferecer renovação")}
      </h2>
      <p className="text-sm text-text-muted">
        {t(
          lista.data.length === 1
            ? "{n} paciente está perto do fim do pacote."
            : "{n} pacientes estão perto do fim do pacote.",
        ).replace("{n}", String(lista.data.length))}
      </p>
      <ul className="grid divide-y divide-border">
        {lista.data.map((p) => (
          <li key={p.id} data-testid="pacote-para-renovar" className="py-2 first:pt-0 last:pb-0">
            <Link
              href={`/app/contacts/${p.contact_id}`}
              className="grid gap-0.5 rounded-sm hover:bg-surface-elevated"
            >
              <span className="text-sm text-text">
                {p.paciente?.display_name || p.paciente?.name || t("Paciente sem nome")}
              </span>
              <span className="text-sm text-text-muted">
                {t(
                  p.saldo === 1
                    ? "{pacote}: resta {n} de {total} sessões. Vale até {data}."
                    : "{pacote}: restam {n} de {total} sessões. Vale até {data}.",
                )
                  .replace("{pacote}", p.nome)
                  .replace("{n}", String(p.saldo))
                  .replace("{total}", String(p.sessoes_total))
                  .replace(
                    "{data}",
                    format(new Date(p.valido_ate), t("d 'de' MMMM"), { locale: localeDaData }),
                  )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
