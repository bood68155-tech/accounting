import { isDatabaseConfigured } from "@/lib/db";

/** True when the app has a working Neon connection string in the environment. */
export function isDatabaseConfiguredPublic(): boolean {
  return isDatabaseConfigured();
}
