import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const rebuildLogger = {
  name: 'rebuild-logger',
  setup(build) {
    let started = 0;
    build.onStart(() => {
      started = Date.now();
    });
    build.onEnd((result) => {
      const ms = Date.now() - started;
      const ts = new Date().toLocaleTimeString();
      const errs = result.errors?.length ?? 0;
      const warns = result.warnings?.length ?? 0;
      if (errs > 0) {
        console.log(`[${ts}] rebuild failed (${errs} error${errs === 1 ? '' : 's'}, ${ms}ms)`);
      } else {
        console.log(
          `[${ts}] rebuild ok (${ms}ms${warns ? `, ${warns} warning${warns === 1 ? '' : 's'}` : ''}) — reload Extension Host (Cmd+R) to pick up changes`,
        );
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !isWatch,
  logLevel: 'info',
  plugins: [rebuildLogger],
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(config);
  console.log('Build complete.');
}
