// ============================================================================
//  NO SIGNAL — build
//  Inlines three.js and the game into one double-clickable file.
//  Run:  npx esbuild src/main.js --bundle --format=iife --minify \
//          --alias:three=./vendor/three.module.js --outfile=dist/nosignal.bundle.js
//        node build.js
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const html = readFileSync('index.html', 'utf8');
const bundle = readFileSync('dist/nosignal.bundle.js', 'utf8');

const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();

const guard = `
window.addEventListener('error', function (e) {
  var el = document.getElementById('err');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = 'NO SIGNAL failed to start\\n\\n' + ((e.error && e.error.stack) || e.message);
});`;

// a closing script tag inside a string literal would end the block early
const safe = bundle.replace(/<\/script>/gi, '<\\/script>');

const content =
`<title>NO SIGNAL — a horror walk</title>
<style>
${css}</style>

${body}

<script>${guard}</script>
<script>${safe}</script>`;

writeFileSync('dist/nosignal-artifact.html', content);

writeFileSync('dist/nosignal.html',
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
${content.split('\n')[0]}
</head>
<body>
${content.split('\n').slice(1).join('\n')}
</body>
</html>`);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log('dist/nosignal.html          ' + kb(readFileSync('dist/nosignal.html').length));
console.log('dist/nosignal-artifact.html ' + kb(readFileSync('dist/nosignal-artifact.html').length));
