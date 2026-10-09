import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** O quadro de um funil morava nos Ajustes; o endereço antigo leva ao novo, com a mesma busca. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]) {
      busca.append(chave, v);
    }
  }
  const resto = busca.toString();
  redirect(`/funis/${encodeURIComponent(id)}${resto ? `?${resto}` : ""}`);
}
