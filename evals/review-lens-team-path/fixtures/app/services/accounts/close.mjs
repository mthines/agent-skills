import { audit } from "../../lib/audit.mjs";

export function closeAccount(account) {
  audit.record("accounts.close", { id: account.id });
  return { ...account, status: "closed" };
}
