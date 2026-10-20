// One JSON object per line on stdout: the app's only telemetry.
export function log(level, event, fields = {}) {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }) + '\n');
}
