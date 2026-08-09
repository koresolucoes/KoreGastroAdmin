import { copyFile, writeFile } from 'node:fs/promises';

const config = {
  supabaseUrl: process.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || '',
  apiBaseUrl: process.env.VITE_API_BASE_URL || ''
};

await writeFile('public/runtime-config.js', `window.KORE_ADMIN_CONFIG = ${JSON.stringify(config)};\n`, 'utf8');
await copyFile('index.html', 'public/index.html');
console.log('Configuração pública do painel preparada.');
