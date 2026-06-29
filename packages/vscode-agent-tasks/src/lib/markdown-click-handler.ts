/**
 * Single-vs-double-click debounce logic for markdown artifact rows.
 *
 * VS Code TreeView has no native double-click event — the TreeItem `command`
 * fires on every click, including the second click of a double-click on an
 * already-selected item.  We use a small per-path timer map to distinguish:
 *
 *   Single click  → after DOUBLE_CLICK_MS with no second click
 *                   → `onSingleClick(path)` is called (rendered preview).
 *   Double click  → second invocation within DOUBLE_CLICK_MS
 *                   → `onDoubleClick(path)` is called (editable editor).
 *
 * The single-click action is intentionally delayed (not fired immediately)
 * so a double click never flashes the rendered preview before opening the
 * editable editor.
 *
 * This module has zero `vscode` imports so it can be unit-tested in a plain
 * Node.js / vitest environment without a VS Code API mock.
 */

/** Delay in milliseconds between clicks that constitutes a double click. */
export const DOUBLE_CLICK_MS = 300;

export type ClickAction = 'single' | 'double';

/**
 * Debounce state — keyed by absolute file path.
 * Each entry is a pending single-click timer handle.
 */
export type ClickState = Map<string, ReturnType<typeof setTimeout>>;

/**
 * Creates a fresh, empty click-state map.
 * The caller owns the map and passes it to `handleMarkdownClick` on each invocation.
 */
export function createClickState(): ClickState {
  return new Map();
}

/**
 * Processes one click on a markdown artifact at `filePath`.
 *
 * `onSingleClick` / `onDoubleClick` are called asynchronously (after the
 * debounce window) so the caller can pass async functions directly.
 *
 * The function itself is synchronous so the tests can control timer
 * advancement independently of any async work the callbacks perform.
 */
export function handleMarkdownClick(
  filePath: string,
  state: ClickState,
  onSingleClick: (p: string) => void,
  onDoubleClick: (p: string) => void,
): void {
  const pending = state.get(filePath);

  if (pending !== undefined) {
    // Second click within DOUBLE_CLICK_MS → double-click.
    clearTimeout(pending);
    state.delete(filePath);
    onDoubleClick(filePath);
    return;
  }

  // First click — schedule single-click action after the debounce window.
  const timer = setTimeout(() => {
    state.delete(filePath);
    onSingleClick(filePath);
  }, DOUBLE_CLICK_MS);

  state.set(filePath, timer);
}
