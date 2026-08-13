import { access, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

const required = [
  'index.html',
  'public/index.html',
  'vercel.json',
  'public/app.js',
  'public/admin.css',
  'public/chefos-theme.css',
  'api/_lib/admin.js',
  'api/_lib/plan-permissions.js',
  'api/_lib/customers.js',
  'api/_lib/beta-operations.js',
  'api/admin/session.js',
  'api/admin/customers.js',
  'api/admin/dashboard.js',
  'api/admin/subscriptions.js',
  'api/admin/tickets.js',
  'api/admin/messages.js',
  'api/admin/plans.js',
  'api/admin/tenant-menu.js',
  'api/admin/provision-tenant.js',
  'api/admin/administrators.js',
  'api/admin/health.js',
  'api/admin/logs.js',
  'api/admin/beta-applications.js',
  'api/admin/work-board.js',
  'api/public/beta-application.js',
  'tests/admin-ux-contract.test.mjs',
  'tests/beta-state-machine.test.mjs',
  'references/admin-ux-principles.md',
  'supabase/migrations/20260813135859_operational_kanban.sql',
  'supabase/migrations/202608120001_beta_minimum_flow.sql',
  'supabase/migrations/202608090001_admin_control_center.sql'
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

for (const endpoint of ['/api/admin/administrators', '/api/admin/health', '/api/admin/logs']) {
  if (!appSource.includes(endpoint)) throw new Error(`Frontend não consome o endpoint de controle ${endpoint}`);
}
if (!appSource.includes('/api/admin/beta-applications')) throw new Error('Frontend não consome o pipeline mínimo do beta.');
for (const marker of ['Operação do beta', 'beta-application', 'Movimentações da candidatura', 'beta_ends_at', 'ciclo de 90 dias']) {
  if (!appSource.includes(marker)) throw new Error(`Fluxo operacional do beta incompleto: ${marker}`);
}
if (!appSource.includes('/api/admin/work-board')) throw new Error('Frontend não consome o Kanban operacional.');
for (const marker of ['Radar inteligente', 'Prioridade explicável', 'data-drop-lane', 'work-item']) {
  if (!appSource.includes(marker)) throw new Error(`Kanban operacional incompleto: ${marker}`);
}

for (const marker of ['invite-password', '/factors/', 'challenge_id', 'mfaMode']) {
  if (!appSource.includes(marker)) throw new Error(`Fluxo de convite/MFA incompleto: ${marker}`);
}

const adminSource = await readFile('api/_lib/admin.js', 'utf8');
const healthSource = await readFile('api/admin/health.js', 'utf8');
const accessSource = await readFile('api/admin/administrators.js', 'utf8');
for (const marker of ['access.root', 'ADMIN_ENFORCE_MFA', 'admin_audit_events', 'CAPABILITY_REQUIRED']) {
  if (!`${adminSource}\n${accessSource}`.includes(marker)) throw new Error(`Fundação de segurança incompleta: ${marker}`);
}

const legacyServiceRoleName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
if (adminSource.includes(legacyServiceRoleName) || healthSource.includes(legacyServiceRoleName)) {
  throw new Error('O Admin ainda depende da chave service_role legada.');
}
if (!adminSource.includes('process.env.SUPABASE_SECRET_KEY') || !healthSource.includes('SUPABASE_SECRET_KEY')) {
  throw new Error('O Admin deve exigir SUPABASE_SECRET_KEY no backend e no health check.');
}

const migrationSource = await readFile('supabase/migrations/202608090001_admin_control_center.sql', 'utf8');
for (const marker of ['drop policy if exists "Admins can manage admins"', 'protect_last_admin_owner', 'admin_health_snapshots', 'admin_audit_events']) {
  if (!migrationSource.includes(marker)) throw new Error(`Migração administrativa incompleta: ${marker}`);
}

const kanbanMigrationSource = await readFile('supabase/migrations/20260813135859_operational_kanban.sql', 'utf8');
for (const marker of ['admin_work_items_single_source_check', 'enable row level security', 'revoke all on public.admin_work_items from anon, authenticated', 'support_ticket_messages_ticket_created_idx']) {
  if (!kanbanMigrationSource.includes(marker)) throw new Error(`Migração do Kanban incompleta: ${marker}`);
}

const files = (await Promise.all(['api', 'public', 'scripts'].map((directory) => sourceFiles(resolve(directory))))).flat();
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new Error(`Erro de sintaxe em ${file}:\n${check.stderr || check.stdout}`);
  }
}

console.log(`Verificação concluída: ${required.length} arquivos essenciais e ${files.length} fontes JavaScript válidas.`);
