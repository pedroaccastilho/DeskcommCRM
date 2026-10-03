/**
 * Os limites de um dia `AAAA-MM-DD` no fuso da organização, em ISO, para pedir a agenda da
 * clínica daquele dia. Usado pelo Balcão e pelo Meu dia.
 */
import { instanteDe } from "@/lib/agenda/fuso";

export function limitesDoDia(hoje: string, fuso: string): { de: string; ate: string } {
  const [ano, mes, dia] = hoje.split("-").map(Number) as [number, number, number];
  const amanha = new Date(Date.UTC(ano, mes - 1, dia + 1, 12));
  return {
    de: instanteDe({ ano, mes, dia }, fuso).toISOString(),
    ate: instanteDe(
      { ano: amanha.getUTCFullYear(), mes: amanha.getUTCMonth() + 1, dia: amanha.getUTCDate() },
      fuso,
    ).toISOString(),
  };
}
