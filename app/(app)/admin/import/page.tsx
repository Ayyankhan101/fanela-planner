import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isAdminOrOps } from "@/lib/auth/access";
import { ImportWizard } from "./wizard";

export default async function ImportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminOrOps(user)) redirect("/jobs"); // E6: no dead 403 page
  return <ImportWizard />;
}
