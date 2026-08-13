import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, css, compatibilityTheme, index] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/admin.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/chefos-theme.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('mantém um único main semântico criado pelo aplicativo', () => {
  assert.match(index, /<div id="app"><\/div>/);
  assert.doesNotMatch(index, /<main id="app"/);
  assert.match(app, /<main class="content"/);
});

test('preserva navegação profunda, histórico e recuperação de sessão', () => {
  for (const marker of [
    'ROUTE_PATHS', 'window.history.pushState', "window.addEventListener('popstate'",
    'restoringSession', "error?.status === 401", 'Promise.allSettled'
  ]) assert.ok(app.includes(marker), `Contrato ausente: ${marker}`);
});

test('protege formulários, modais e ações assíncronas', () => {
  for (const marker of [
    'pendingAction', 'setPendingElement', 'modalDirty', 'beforeunload',
    'confirmCredentialExit', "event.key === 'Tab'", 'data-credential-ack'
  ]) assert.ok(app.includes(marker), `Proteção ausente: ${marker}`);
});

test('frontend consome transições e versão concorrente do beta', () => {
  for (const marker of [
    'betaTransitions', 'betaAllowedStatuses', 'expectedUpdatedAt',
    'expectedWorkUpdatedAt',
    'Esse card já está nesta coluna ou precisa passar pela etapa anterior.'
  ]) assert.ok(app.includes(marker), `Contrato do beta ausente: ${marker}`);
});

test('navegação e busca expõem semântica acessível', () => {
  for (const marker of [
    'aria-current="page"', 'role="combobox"', 'role="listbox"',
    'data-command-option', "event.key === 'ArrowDown'", 'aria-live="polite"'
  ]) assert.ok(app.includes(marker), `Semântica ausente: ${marker}`);
});

test('design system não declara texto abaixo de 12px', () => {
  const declarations = [...css.matchAll(/font-size\s*:\s*([0-9]*\.?[0-9]+)(px|rem)\b/g)];
  assert.ok(declarations.length > 0, 'Nenhuma declaração tipográfica foi encontrada.');
  const undersized = declarations
    .map((match) => ({ raw: match[0], pixels: Number(match[1]) * (match[2] === 'rem' ? 16 : 1) }))
    .filter((item) => item.pixels < 12);
  assert.deepEqual(undersized, []);
});

test('arquivo de compatibilidade não volta a duplicar componentes', () => {
  for (const selector of ['.sidebar', '.topbar', '.modal-shell', '.work-card', '.panel']) {
    assert.equal(compatibilityTheme.includes(selector), false, `Seletor duplicado em chefos-theme.css: ${selector}`);
  }
});
