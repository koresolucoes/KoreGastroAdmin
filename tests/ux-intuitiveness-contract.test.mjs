import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, uxJs, uxCss] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/ux-enhancements.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/ux-enhancements.css', import.meta.url), 'utf8')
]);

test('carrega a camada UX depois do frontend e do tema legado', () => {
  assert.match(index, /\/ux-enhancements\.css/);
  assert.match(index, /\/ux-enhancements\.js/);
  assert.ok(index.indexOf('/chefos-theme.css') < index.indexOf('/ux-enhancements.css'));
  assert.ok(index.indexOf('/app.js') < index.indexOf('/ux-enhancements.js'));
});

test('sidebar desktop é recolhível e persiste a preferência', () => {
  for (const marker of [
    'chefos_admin_sidebar_collapsed',
    'toggle-sidebar-collapse',
    'ux-sidebar-collapsed',
    'localStorage.setItem(SIDEBAR_KEY'
  ]) assert.ok(uxJs.includes(marker), `Contrato ausente: ${marker}`);
  assert.match(uxCss, /\.app-shell\.ux-sidebar-collapsed/);
  assert.match(uxCss, /--ux-sidebar-collapsed:/);
});

test('cada área pode receber orientação contextual sem alterar a lógica de negócio', () => {
  for (const route of ['inicio', 'clientes', 'suporte', 'assinaturas', 'planos', 'cardapios', 'equipe', 'auditoria', 'saude']) {
    assert.ok(uxJs.includes(`${route}:`) || uxJs.includes(`'${route}':`), `Guia ausente: ${route}`);
  }
  assert.match(uxJs, /ux-context-guide/);
  assert.match(uxJs, /ux-quick-start/);
  assert.match(uxJs, /Como usar o painel/);
});

test('tabelas grandes recebem paginação progressiva e seletor de linhas', () => {
  for (const marker of ['DEFAULT_PAGE_SIZE = 25', 'PAGE_SIZE_OPTIONS', 'renderPager', 'data-ux-page-size', 'Mostrando']) {
    assert.ok(uxJs.includes(marker), `Paginação ausente: ${marker}`);
  }
  assert.match(uxCss, /\.ux-table-pagination/);
  assert.match(uxCss, /\.ux-page-number/);
});

test('scroll horizontal, kanban e overlays possuem comportamento explícito', () => {
  for (const marker of ['ux-scroll-region', 'ux-horizontal-region', 'ux-scroll-hint', 'scrollWidth > wrapper.clientWidth']) {
    assert.ok(uxJs.includes(marker), `Scroll UX ausente: ${marker}`);
  }
  assert.match(uxCss, /overflow-x:\s*auto\s*!important/);
  assert.match(uxCss, /scroll-snap-type:\s*x proximity/);
  assert.match(uxCss, /\.modal-card[\s\S]*max-height:/);
  assert.match(uxCss, /\.modal-card > \.modal-body[\s\S]*overflow-y:\s*auto/);
  assert.match(uxCss, /\.detail-drawer[\s\S]*overflow-y:\s*auto\s*!important/);
});

test('a camada UX é progressiva e observa rerenders do app', () => {
  assert.match(uxJs, /new MutationObserver\(scheduleEnhance\)/);
  assert.match(uxJs, /requestAnimationFrame/);
  assert.doesNotMatch(uxJs, /fetch\(/);
  assert.doesNotMatch(uxJs, /\/api\/admin\//);
});
