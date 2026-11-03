const {build} = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const root = path.resolve(__dirname, '..');
process.chdir(root);
async function run() {
  await build({
    entryPoints: ['editor/main.tsx'], bundle: true, outfile: 'public/editor.js',
    alias: {'@': path.join(root, 'editor')}, jsx: 'automatic', minify: true,
    define: {'process.env.NODE_ENV': '"production"'}, legalComments: 'eof',
  });
  const source = await fs.readFile('editor/theme.css', 'utf8');
  const css = await postcss([tailwind(require('../editor/tailwind.cjs'))]).process(source, {from: 'editor/theme.css'});
  await fs.writeFile('public/editor.css', css.css);
}
run().catch(error => { console.error(error); process.exitCode = 1; });

