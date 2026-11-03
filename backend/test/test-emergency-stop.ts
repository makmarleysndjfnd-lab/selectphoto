import { spawn } from 'child_process';
import path from 'path';

console.log('🧪 [TESTE] Verificando parada emergencial com limite controlado de RSS...');

const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
const benchmarkScript = path.resolve(__dirname, 'capacity-benchmark-v3.ts');

const child = spawn(process.execPath, [tsxCli, benchmarkScript], {
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    BENCHMARK_TEST_EMERGENCY_STOP: 'true',
  },
  stdio: 'inherit',
});

child.on('exit', (code) => {
  console.log(`\n🧪 [TESTE] Processo encerrou com exit code: ${code}`);
  if (code !== 0) {
    console.log('✅ [SUCESSO DO TESTE] A parada emergencial abortou a execução e propagou exit code != 0 conforme exigido!');
    process.exit(0);
  } else {
    console.error('❌ [FALHA DO TESTE] Esperava-se exit code != 0 na parada emergencial, mas retornou 0.');
    process.exit(1);
  }
});
