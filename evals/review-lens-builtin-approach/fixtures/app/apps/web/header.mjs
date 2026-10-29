import { avatar } from "../../packages/ui/avatar.mjs";
import { currentUser } from "./session.mjs";

export function header() {
  return `<header>${avatar(currentUser())}</header>`;
}
