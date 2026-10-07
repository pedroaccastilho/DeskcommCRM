import { Paciente } from "./_paciente";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Paciente contactId={id} />;
}
