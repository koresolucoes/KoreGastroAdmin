import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = [
  'index.html',
  'vercel.json',
  'public/app.js',
  'public/admin.css',
  'api/_lib/admin.js',
  'api/admin/session.js',
  'api/admin/restaurants.js',
  'api/admin/provision-tenant.js'
];

await Promise.all(required.map((file) => access(resolve(file))));
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
if (!Array.isArray(config.rewrites)) throw new Error('vercel.json sem regras de rota');
console.log(`Verificação concluída: ${required.length} arquivos essenciais encontrados.`);
