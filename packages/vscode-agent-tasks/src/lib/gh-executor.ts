/**
 * GhExecutor — interface + default implementation for shelling out to `gh`.
 *
 * The interface is injected into PrStatusCache so the cache logic can be
 * unit-tested without spawning a real `gh` process.
 */

import * as child_process from 'child_process';

export interface GhExecutor {
  /**
   * Execute `gh` with the given arguments in an optional working directory.
   * Resolves with the combined stdout+stderr output and the exit code.
   * Rejects only for spawn failures (e.g. ENOENT when `gh` is not installed).
   */
  exec(args: string[], cwd?: string): Promise<{ stdout: string; exitCode: number }>;
}

/**
 * Default production implementation — spawns the real `gh` CLI.
 * Uses the system PATH; assumes `gh` is installed.
 */
export class SystemGhExecutor implements GhExecutor {
  private static readonly TIMEOUT_MS = 5_000;

  exec(args: string[], cwd?: string): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = child_process.spawn('gh', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ stdout: stdout + stderr, exitCode: 1 });
      }, SystemGhExecutor.TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout: stdout + stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
