import { requireSignedIn } from "@/lib/server-auth";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  await requireSignedIn(); // リソースレベル認証
  return <SettingsClient />;
}
