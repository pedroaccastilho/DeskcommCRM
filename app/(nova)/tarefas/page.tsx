import type { Metadata } from "next";

import { TelaDeTarefas } from "@/components/novo/Tarefas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tarefas" };

export default function Page() {
  return <TelaDeTarefas />;
}
