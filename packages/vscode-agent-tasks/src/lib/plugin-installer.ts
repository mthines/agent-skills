/**
 * PluginInstaller — first-run consent flow and CLI-based install for the
 * agent-tasks-hooks Claude Code plugin.
 *
 * Flow:
 *   1. Check `agentTasks.hooks.enabled` — return if false.
 *   2. Check globalState `agentTasks.hooks.consentShown` — return if "never".
 *   3. Show one-shot consent modal with three options:
 *        "Enable Hooks"    → detect claude version ≥ 2.1, run install, write sentinel
 *        "Not Now"         → defer until next window reload (don't set globalState)
 *        "Don't Ask Again" → set hooks.enabled = false in global settings
 *   4. On successful install: write sentinel file, log to output channel.
 *   5. On failure: show error notification with "View Output" button.
 *
 * The sentinel file at getSentinelPath() is what the hook script checks before
 * doing any work. Writing it post-install activates hook event emission.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { getSentinelPath, getPluginDataDir } from './plugin-data-path';
import { log, logError } from './logger';

const CONSENT_GLOBALSTATE_KEY = 'agentTasks.hooks.consentShown';
const MARKETPLACE_REPO = 'mthines/agent-skills';
const PLUGIN_REF = 'agent-tasks-hooks@agent-skills-plugins';
const MIN_CLAUDE_MAJOR = 2;
const MIN_CLAUDE_MINOR = 1;

/** Candidate paths for the `claude` binary when it's not in VS Code's PATH. */
const CLAUDE_BINARY_CANDIDATES = [
  'claude',
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
  `${process.env['HOME'] ?? ''}/.local/bin/claude`,
];

/** Run a shell command and return stdout. Throws on non-zero exit. */
function exec(cmd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    child_process.exec(
      cmd,
      { timeout: timeoutMs, env: { ...process.env } },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${err.message}\nstderr: ${stderr}`));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * Parse a semver string and return `{ major, minor }`.
 * Returns `{ major: 0, minor: 0 }` on parse failure.
 */
function parseSemver(raw: string): { major: number; minor: number } {
  const m = raw.match(/(\d+)\.(\d+)/);
  if (!m) return { major: 0, minor: 0 };
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

/**
 * Attempt to find the `claude` binary by trying each candidate path.
 * Returns the first one that responds to `--version`, or `null` if none found.
 */
async function findClaudeBinary(): Promise<string | null> {
  for (const candidate of CLAUDE_BINARY_CANDIDATES) {
    try {
      await exec(`"${candidate}" --version`, 3_000);
      return candidate;
    } catch {
      // Not found at this path — try next
    }
  }
  return null;
}

/** Write the sentinel file that activates hook event emission. */
function writeSentinel(): void {
  const dir = getPluginDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSentinelPath(), '', 'utf8');
  log('PluginInstaller: sentinel file written');
}

/** Remove the sentinel file to disable hook event emission. */
export function removeSentinel(): void {
  try {
    fs.unlinkSync(getSentinelPath());
    log('PluginInstaller: sentinel file removed');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logError('PluginInstaller: failed to remove sentinel', err);
    }
  }
}

/** Return true if the sentinel file currently exists. */
export function isSentinelPresent(): boolean {
  try {
    fs.accessSync(getSentinelPath(), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export class PluginInstaller {
  /**
   * Entry point: check settings and globalState, then show the consent modal
   * if this is the first time the user has seen it.
   *
   * Call once from `extension.ts` `activate()`, after providers are initialised.
   */
  async ensurePluginInstalled(context: vscode.ExtensionContext): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('agentTasks');
    const enabled = cfg.get<boolean>('hooks.enabled', true);
    if (!enabled) {
      log('PluginInstaller: hooks.enabled is false — skipping');
      return;
    }

    const consentState = context.globalState.get<string>(CONSENT_GLOBALSTATE_KEY);
    if (consentState === 'never') {
      log('PluginInstaller: consent state is "never" — skipping');
      return;
    }

    // If the sentinel already exists the plugin was installed in a prior session
    if (isSentinelPresent()) {
      log('PluginInstaller: sentinel already present — plugin active');
      return;
    }

    // Show one-shot consent modal
    const picked = await vscode.window.showInformationMessage(
      'Agent Tasks can install a Claude Code plugin that delivers real-time session status updates (sub-second transitions). ' +
        'The plugin only emits {event, sessionId, cwd, ts} — no prompt or transcript content.',
      { modal: false },
      'Enable Hooks',
      'Not Now',
      "Don't Ask Again"
    );

    if (!picked || picked === 'Not Now') {
      log('PluginInstaller: user deferred consent');
      // Don't store anything — show again on next window reload
      return;
    }

    if (picked === "Don't Ask Again") {
      log('PluginInstaller: user chose "Don\'t Ask Again"');
      await context.globalState.update(CONSENT_GLOBALSTATE_KEY, 'never');
      await cfg.update('hooks.enabled', false, vscode.ConfigurationTarget.Global);
      return;
    }

    // "Enable Hooks" selected — proceed with install
    await context.globalState.update(CONSENT_GLOBALSTATE_KEY, 'accepted');
    await this.installPlugin();
  }

  private async installPlugin(): Promise<void> {
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusItem.text = '$(sync~spin) Agent Tasks: installing hooks plugin…';
    statusItem.show();

    try {
      // Find claude binary
      const claude = await findClaudeBinary();
      if (!claude) {
        throw new Error(
          'Could not find the `claude` binary. ' +
            'Make sure Claude Code is installed and `claude` is in your PATH.'
        );
      }

      // Verify version ≥ 2.1
      const versionRaw = await exec(`"${claude}" --version`, 5_000);
      log(`PluginInstaller: claude version: ${versionRaw}`);
      const { major, minor } = parseSemver(versionRaw);
      if (
        major < MIN_CLAUDE_MAJOR ||
        (major === MIN_CLAUDE_MAJOR && minor < MIN_CLAUDE_MINOR)
      ) {
        throw new Error(
          `Claude Code ${major}.${minor} found, but ${MIN_CLAUDE_MAJOR}.${MIN_CLAUDE_MINOR}+ is required for plugin hooks.`
        );
      }

      // Add marketplace
      log(`PluginInstaller: adding marketplace ${MARKETPLACE_REPO}`);
      statusItem.text = '$(sync~spin) Agent Tasks: adding plugin marketplace…';
      await exec(
        `"${claude}" plugin marketplace add ${MARKETPLACE_REPO} --scope user`,
        30_000
      );

      // Install plugin
      log(`PluginInstaller: installing ${PLUGIN_REF}`);
      statusItem.text = '$(sync~spin) Agent Tasks: installing plugin…';
      await exec(`"${claude}" plugin install ${PLUGIN_REF} --scope user`, 60_000);

      // Write sentinel to activate the hook script
      writeSentinel();

      statusItem.hide();
      log('PluginInstaller: plugin installed successfully');
      void vscode.window.showInformationMessage(
        'Agent Tasks hooks plugin installed. Session status will now update in real-time.'
      );
    } catch (err) {
      statusItem.hide();
      logError('PluginInstaller: install failed', err);

      const action = await vscode.window.showErrorMessage(
        `Agent Tasks hooks plugin install failed: ${err instanceof Error ? err.message : String(err)}`,
        'View Output'
      );
      if (action === 'View Output') {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    } finally {
      statusItem.dispose();
      // Keep context in subscriptions for disposal is not needed for StatusBarItem — just dispose above
    }
  }
}
