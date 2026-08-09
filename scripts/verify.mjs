import { access, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

const required = [
  'index.html',
  'public/index.html',
  'vercel.json',
  'public/app.js',
  'public/admin.css',
  'api/_lib/admin.js',
  'api/_lib/plan-permissions.js',
  'api/_lib/customers.js',
  'api/admin/session.js',
  'api/admin/customers.js',
  'api/admin/dashboard.js',
  'api/admin/subscriptions.js',
  'api/admin/tickets.js',
  'api/admin/messages.js',
  'api/admin/plans.js',
  'api/admin/tenant-menu.js',
  'api/admin/provision-tenant.js'
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.js', '.mjs'].includes(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

await Promise.all(required.map((file) => access(resolve(file))));

const config = JSON.parse(await readFile('vercel.json', 'utf8'));
if (!Array.isArray(config.rewrites)) throw new Error('vercel.json sem regras de rota');
const v2Rewrite = config.rewrites.some((rewrite) => rewrite.source === '/api/v2/admin/:path*' && rewrite.destination === '/api/admin/:path*');
if (!v2Rewrite) throw new Error('Compatibilidade /api/v2/admin ausente no vercel.json');

const appSource = await readFile('public/app.js', 'utf8');
for (const endpoint of ['/api/admin/customers', '/api/admin/dashboard', '/api/admin/subscriptions', '/api/admin/tickets', '/api/admin/plans', '/api/admin/tenant-menu', '/api/admin/provision-tenant']) {
  if (!appSource.includes(endpoint)) throw new Error(`Frontend não consome o endpoint obrigatório ${endpoint}`);
}

const files = (await Promise.all(['api', 'public', 'scripts'].map((directory) => sourceFiles(resolve(directory))))).flat();
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new Error(`Erro de sintaxe em ${file}:\n${check.stderr || check.stdout}`);
  }
}

console.log(`Verificação concluída: ${required.length} arquivos essenciais e ${files.length} fontes JavaScript válidas.`);
