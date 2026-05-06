/**
 * Tests for PrPoller — focused on the eager-fetch behavior of
 * `setActiveBranches`, which is the path users hit on extension startup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrPoller, type BranchTarget } from './pr-poller';
import type { PrStatusCache } from './pr-status-cache';

function fakeCache(): {
  cache: PrStatusCache;
  fetchEnrichment: ReturnType<typeof vi.fn>;
} {
  const fetchEnrichment = vi.fn().mockResolvedValue(undefined);
  const cache = { fetchEnrichment } as unknown as PrStatusCache;
  return { cache, fetchEnrichment };
}

function target(branch: string, mtime = Date.now()): BranchTarget {
  return { branch, worktreePath: `/tmp/${branch}`, mtime };
}

describe('PrPoller.setActiveBranches', () => {
  let poller: PrPoller;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    poller?.dispose();
    vi.useRealTimers();
  });

  it('eagerly fetches enrichment for newly-seen branches', async () => {
    const { cache, fetchEnrichment } = fakeCache();
    poller = new PrPoller(cache, { intervalMs: 90_000 });

    poller.setActiveBranches([target('feat/a'), target('feat/b')]);

    // Allow the floating promise from setActiveBranches to settle.
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalledTimes(2));
    expect(fetchEnrichment).toHaveBeenCalledWith('feat/a', '/tmp/feat/a');
    expect(fetchEnrichment).toHaveBeenCalledWith('feat/b', '/tmp/feat/b');
  });

  it('does not re-fetch branches it has already seen', async () => {
    const { cache, fetchEnrichment } = fakeCache();
    poller = new PrPoller(cache, { intervalMs: 90_000 });

    poller.setActiveBranches([target('feat/a')]);
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalledTimes(1));

    poller.setActiveBranches([target('feat/a')]);
    // Same branch — no additional fetch from the eager path.
    expect(fetchEnrichment).toHaveBeenCalledTimes(1);
  });

  it('only fetches the new subset when branches are added', async () => {
    const { cache, fetchEnrichment } = fakeCache();
    poller = new PrPoller(cache, { intervalMs: 90_000 });

    poller.setActiveBranches([target('feat/a')]);
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalledTimes(1));

    poller.setActiveBranches([target('feat/a'), target('feat/b')]);
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalledTimes(2));
    expect(fetchEnrichment).toHaveBeenLastCalledWith('feat/b', '/tmp/feat/b');
  });

  it('fires onPrStatusChanged after the eager fetch settles', async () => {
    const { cache, fetchEnrichment } = fakeCache();
    poller = new PrPoller(cache, { intervalMs: 90_000 });
    const onChanged = vi.fn();
    poller.onPrStatusChanged(onChanged);

    poller.setActiveBranches([target('feat/a')]);
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('does no eager fetch when the active set is unchanged', async () => {
    const { cache, fetchEnrichment } = fakeCache();
    poller = new PrPoller(cache, { intervalMs: 90_000 });

    poller.setActiveBranches([]);
    poller.setActiveBranches([]);
    expect(fetchEnrichment).not.toHaveBeenCalled();
  });
});
