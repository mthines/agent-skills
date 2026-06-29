/**
 * Unit tests for the markdown click-debounce helper.
 *
 * Uses vitest fake timers so we can control clock advancement without real delays.
 * The helper has no vscode import — it is a pure timer-based state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createClickState,
  handleMarkdownClick,
  DOUBLE_CLICK_MS,
} from './markdown-click-handler';

describe('handleMarkdownClick', () => {
  const FILE_A = '/workspace/.agent/feat/plan.md';
  const FILE_B = '/workspace/.agent/feat/walkthrough.md';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onSingleClick after DOUBLE_CLICK_MS with no second click', () => {
    const state = createClickState();
    const onSingleClick = vi.fn();
    const onDoubleClick = vi.fn();

    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);

    // Neither callback should fire synchronously.
    expect(onSingleClick).not.toHaveBeenCalled();
    expect(onDoubleClick).not.toHaveBeenCalled();

    // Advance past the debounce window.
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);

    expect(onSingleClick).toHaveBeenCalledOnce();
    expect(onSingleClick).toHaveBeenCalledWith(FILE_A);
    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('fires onDoubleClick on the second click within DOUBLE_CLICK_MS and does NOT fire onSingleClick', () => {
    const state = createClickState();
    const onSingleClick = vi.fn();
    const onDoubleClick = vi.fn();

    // First click.
    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);

    // Second click before the debounce window closes.
    vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1);
    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);

    expect(onDoubleClick).toHaveBeenCalledOnce();
    expect(onDoubleClick).toHaveBeenCalledWith(FILE_A);
    expect(onSingleClick).not.toHaveBeenCalled();

    // Confirm no delayed single-click fires afterwards either.
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);
    expect(onSingleClick).not.toHaveBeenCalled();
  });

  it('resets after a double click so the next click starts a fresh single-click window', () => {
    const state = createClickState();
    const onSingleClick = vi.fn();
    const onDoubleClick = vi.fn();

    // Double click pair.
    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);
    vi.advanceTimersByTime(1);
    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);
    expect(onDoubleClick).toHaveBeenCalledOnce();

    // A subsequent single click should schedule a fresh timer.
    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);
    expect(onSingleClick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(onSingleClick).toHaveBeenCalledOnce();
    expect(onSingleClick).toHaveBeenCalledWith(FILE_A);
  });

  it('tracks different paths independently', () => {
    const state = createClickState();
    const onSingleClickA = vi.fn();
    const onDoubleClickA = vi.fn();
    const onSingleClickB = vi.fn();
    const onDoubleClickB = vi.fn();

    // Click A once, click B twice (within the window).
    handleMarkdownClick(FILE_A, state, onSingleClickA, onDoubleClickA);
    handleMarkdownClick(FILE_B, state, onSingleClickB, onDoubleClickB);
    vi.advanceTimersByTime(1);
    handleMarkdownClick(FILE_B, state, onSingleClickB, onDoubleClickB);

    // B is a double-click; A is still pending.
    expect(onDoubleClickB).toHaveBeenCalledOnce();
    expect(onSingleClickB).not.toHaveBeenCalled();
    expect(onSingleClickA).not.toHaveBeenCalled();

    // Advance fully — A's single click fires.
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(onSingleClickA).toHaveBeenCalledOnce();
    expect(onSingleClickA).toHaveBeenCalledWith(FILE_A);
  });

  it('does not fire onSingleClick exactly at DOUBLE_CLICK_MS - 1 (window not yet elapsed)', () => {
    const state = createClickState();
    const onSingleClick = vi.fn();
    const onDoubleClick = vi.fn();

    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);
    vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1);

    expect(onSingleClick).not.toHaveBeenCalled();
    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('cleans up the state map entry after single-click fires', () => {
    const state = createClickState();
    const onSingleClick = vi.fn();
    const onDoubleClick = vi.fn();

    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);
    expect(state.size).toBe(1);

    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(state.size).toBe(0);
  });

  it('cleans up the state map entry after double-click fires', () => {
    const state = createClickState();
    const onSingleClick = vi.fn();
    const onDoubleClick = vi.fn();

    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);
    handleMarkdownClick(FILE_A, state, onSingleClick, onDoubleClick);

    expect(state.size).toBe(0);
  });
});
