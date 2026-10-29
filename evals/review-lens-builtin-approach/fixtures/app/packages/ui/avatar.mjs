// Shared UI used by every app; it receives data through its arguments.
export function avatar({ name }) {
  return `<span class="avatar">${name.slice(0, 1).toUpperCase()}</span>`;
}
