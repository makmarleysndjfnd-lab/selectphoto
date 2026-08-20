import fs from 'fs';
import path from 'path';

function getLatestMtime(dir: string): number {
  let latest = 0;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const sub = getLatestMtime(fullPath);
      if (sub > latest) latest = sub;
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
  }
  return latest;
}

function getOldestDistMtime(distFile: string): number {
  if (!fs.existsSync(distFile)) return 0;
  return fs.statSync(distFile).mtimeMs;
}

function verifyDistSync() {
  const rootDir = path.resolve(__dirname, '..');
  const srcDir = path.join(rootDir, 'src');
  const distEntry = path.join(rootDir, 'dist', 'index.js');

  console.log('=== VERIFICAÇÃO DE SINCRONIZAÇÃO DIST/SRC ===');
  
  if (!fs.existsSync(distEntry)) {
    console.error('❌ ERRO CRÍTICO: dist/index.js não existe. Execute "npm run build" antes de iniciar.');
    process.exit(1);
  }

  const latestSrcMtime = getLatestMtime(srcDir);
  const distMtime = getOldestDistMtime(distEntry);

  if (latestSrcMtime > distMtime + 2000) { // tolerância de 2s para sistemas de arquivo
    console.error(`❌ ERRO: O diretório src possui alterações mais recentes que o bundle compilado em dist.`);
    console.error(`   Latest src mtime: ${new Date(latestSrcMtime).toISOString()}`);
    console.error(`   Dist entry mtime: ${new Date(distMtime).toISOString()}`);
    console.error('Execute "npm run build" para atualizar dist antes de rodar o servidor.');
    process.exit(1);
  }

  console.log('✅ dist/index.js está sincronizado com src/ (build atualizado).');
}

verifyDistSync();
