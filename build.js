/* build.js — собирает полностью автономный index.html из исходников.
   Запуск: node build.js
   Итоговый index.html не содержит ни одного внешнего <link> или <script src>,
   поэтому работает в sandboxed-предпросмотре, с file:// и на телефоне. */
const fs = require('fs');
const path = require('path');
const root = __dirname;
const JS_FILES = ['vendor/mp4-muxer.js','vendor/webm-muxer.js','js/utils.js','js/state.js','js/media.js','js/engine.js','js/timeline.js','js/panels.js',
  'js/pro_core.js','js/pro_tools.js','js/pro_panels.js','js/animation_core.js','js/animation_export.js','js/animation_ui.js','js/animation_sprite.js','js/projects.js','js/storage_bridge.js','js/export_fast.js','js/tutorial.js','js/app.js'];

let html = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const d = new Date();
const stamp = d.toISOString().slice(0, 10) + ' ' +
  String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const js = '/* Метка сборки: по ней видно, какая версия открыта в браузере. */\n' +
  'window.PPE_BUILD = ' + JSON.stringify(stamp) + ';\n' +
  JS_FILES.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');

if (/<\/style/i.test(css)) throw new Error('CSS contains a closing style tag');
if (/<\/script/i.test(js)) throw new Error('JS contains a closing script tag');
if (!html.includes('<!--INLINE_CSS-->') || !html.includes('<!--INLINE_JS-->'))
  throw new Error('template.html is missing inline placeholders');

// Replacer FUNCTIONS are essential: with a string replacement "$$" in the JS
// bundle would be interpreted as an escaped "$" and silently corrupt the code.
html = html.replace('<!--INLINE_CSS-->', () => '<style data-ff="styles.css">\n' + css + '\n</style>');
html = html.replace('<!--INLINE_JS-->', () => '<script data-ff="bundle">\n' + js + '\n</script>');
html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- Сгенерировано командой `node build.js`: все стили и скрипты встроены.\n     Открывайте этот файл напрямую — внешние ресурсы не нужны. -->');
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('build ' + stamp + ' · index.html built:', (html.length / 1024).toFixed(1) + ' KB, css ' + (css.length / 1024).toFixed(1) + ' KB, js ' + (js.length / 1024).toFixed(1) + ' KB');
