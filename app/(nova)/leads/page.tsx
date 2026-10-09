import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** `/leads` sozinho leva à lista dos funis, que é a porta "Leads" do menu. */
export default function Page() {
  redirect("/funis");
}
