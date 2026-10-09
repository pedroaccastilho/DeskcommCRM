import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Um negócio abria nos Ajustes; o endereço antigo leva ao novo (`/leads/[id]`). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/leads/${encodeURIComponent(id)}`);
}
