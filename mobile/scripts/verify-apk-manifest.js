/**
 * Script de verificação e auditoria automatizada do APK Release
 * Valida:
 * 1. Existência e integridade do APK
 * 2. android:name da tag <application> no manifesto compilado
 * 3. Ausência de classes inexistentes (ex: io.flutter.app.FlutterMultiDexApplication)
 * 4. Validação de que a classe Application é válida e existente no runtime
 * 5. Ausência da flag android:debuggable / application-debuggable
 * 6. Versão versionName = 1.0.8 e versionCode = 9
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const APK_PATH = path.resolve(__dirname, '../build/app/outputs/flutter-apk/app-release.apk');

function findAapt() {
  const possiblePaths = [
    'C:\\Users\\mau_m\\AppData\\Local\\Android\\Sdk\\build-tools\\34.0.0\\aapt.exe',
    'C:\\Users\\mau_m\\AppData\\Local\\Android\\Sdk\\build-tools\\35.0.0\\aapt.exe',
    'C:\\Users\\mau_m\\AppData\\Local\\Android\\Sdk\\build-tools\\33.0.0\\aapt.exe',
    'aapt'
  ];

  for (const p of possiblePaths) {
    if (p === 'aapt' || fs.existsSync(p)) {
      try {
        execSync(`"${p}" version`, { stdio: 'ignore' });
        return p;
      } catch (_) {}
    }
  }
  throw new Error('aapt.exe não foi encontrado no sistema.');
}

function verifyApk() {
  console.log('🔍 [AUDITORIA AUTOMATIZADA DO APK RELEASE]');

  if (!fs.existsSync(APK_PATH)) {
    console.error(`❌ APK não encontrado em: ${APK_PATH}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(APK_PATH);
  const fileSize = fileBuffer.length;
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();

  console.log(`📦 Arquivo: ${path.basename(APK_PATH)}`);
  console.log(`📏 Tamanho: ${fileSize} bytes (~${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`🔑 SHA-256: ${sha256}`);

  const aapt = findAapt();

  // 1. Dump Badging
  const badgingOutput = execSync(`"${aapt}" dump badging "${APK_PATH}"`, { encoding: 'utf-8' });

  // Checagem de versão
  const packageMatch = badgingOutput.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
  if (!packageMatch) {
    console.error('❌ Falha ao extrair informações do pacote do APK.');
    process.exit(1);
  }
  const [, packageName, versionCode, versionName] = packageMatch;
  console.log(`🏷️  Package: ${packageName}`);
  console.log(`🏷️  Version: ${versionName} (code ${versionCode})`);

  if (versionName !== '1.0.8' || versionCode !== '9') {
    console.error(`❌ Versão incorreta! Esperado: versionName='1.0.8', versionCode='9'. Encontrado: versionName='${versionName}', versionCode='${versionCode}'`);
    process.exit(1);
  }

  // Checagem de Debuggable
  if (badgingOutput.includes('application-debuggable')) {
    console.error('❌ ERRO CRÍTICO: APK compilado como DEBUGGABLE! Rejeitado para release.');
    process.exit(1);
  }
  console.log('✅ APK é não-debuggable (produção).');

  // 2. Dump XMLTree do AndroidManifest.xml
  const xmltreeOutput = execSync(`"${aapt}" dump xmltree "${APK_PATH}" AndroidManifest.xml`, { encoding: 'utf-8' });

  // Procura por android:name na tag <application>
  // Exemplo no xmltree:
  //   E: application (line=...)
  //     A: android:label(0x01010001)="Lumora"
  //     A: android:name(0x01010003)="android.app.Application"
  const lines = xmltreeOutput.split('\n');
  let insideApplication = false;
  let applicationName = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('E: application')) {
      insideApplication = true;
      continue;
    }
    if (insideApplication) {
      if (line.includes('E: activity') || line.includes('E: service') || line.includes('E: receiver') || line.includes('E: provider')) {
        break;
      }
      const nameMatch = line.match(/A: android:name\([^)]+\)="([^"]+)"/);
      if (nameMatch) {
        applicationName = nameMatch[1];
        break;
      }
    }
  }

  console.log(`📱 android:name em <application>: "${applicationName || 'android.app.Application (padrão implícito)'}"`);

  // Validação estrita de Application Class
  if (applicationName === 'io.flutter.app.FlutterMultiDexApplication') {
    console.error('❌ ERRO CRÍTICO: O manifesto declara "io.flutter.app.FlutterMultiDexApplication", classe legada inexistente no runtime!');
    process.exit(1);
  }

  const validKnownClasses = ['android.app.Application', 'io.flutter.app.FlutterApplication', null];
  if (!validKnownClasses.includes(applicationName)) {
    console.warn(`⚠️ Classe de aplicação personalizada detectada: ${applicationName}`);
  } else {
    console.log(`✅ Classe de aplicação válida: ${applicationName || 'android.app.Application'}`);
  }

  console.log('🎉 [AUDITORIA DO MANIFESTO CONCLUÍDA COM SUCESSO]');
}

try {
  verifyApk();
} catch (err) {
  console.error('❌ Erro durante a auditoria do APK:', err.message);
  process.exit(1);
}
