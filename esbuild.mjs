import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const isWatch = process.argv.includes('--watch');

// CSS files to concatenate
function collectCssFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectCssFiles(fullPath));
      } else if (entry.name.endsWith('.css')) {
        files.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return files;
}

// Extension bundle (Node.js target)
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
};

// Webview bundle (browser target)
const webviewConfig = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  target: 'es2020',
};

// CSS bundle plugin - concatenates all CSS files
const cssBundlePlugin = {
  name: 'css-bundle',
  setup(build) {
    build.onEnd(() => {
      const cssFiles = collectCssFiles('webview/styles');
      if (cssFiles.length > 0) {
        const combined = cssFiles
          .map(f => readFileSync(f, 'utf-8'))
          .join('\n');
        writeFileSync('dist/webview.css', combined);
      }
    });
  }
};

if (isWatch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context({ ...webviewConfig, plugins: [cssBundlePlugin] });
  await Promise.all([ctx1.watch(), ctx2.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build({ ...webviewConfig, plugins: [cssBundlePlugin] }),
  ]);
  console.log('Build complete.');
}
