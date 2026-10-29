let user = { name: "ada" };
export function currentUser() {
  return user;
}
export function signIn(next) {
  user = next;
}
