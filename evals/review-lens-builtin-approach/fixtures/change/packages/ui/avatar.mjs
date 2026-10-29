// Shared UI used by every app; it receives data through its arguments.
import { currentUser } from "../../apps/web/session.mjs";

export function avatar({ name }) {
  return `<span class="avatar">${name.slice(0, 1).toUpperCase()}</span>`;
}

export function myAvatar() {
  return avatar(currentUser());
}
