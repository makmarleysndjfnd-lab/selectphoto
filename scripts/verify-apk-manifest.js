/**
 * Script de verificação e auditoria automatizada do APK Release
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

function findApk() {
  const possiblePaths = [
    path.resolve(__dirname, '../mobile/build/app/outputs/flutter-apk/app-release.apk'),
    path.resolve(__dirname, '../build/app/outputs/flutter-apk/app-release.apk'),
    path.resolve(__dirname, '../backend/public/apk/app-release.apk'),
    path.resolve(process.cwd(), 'mobile/build/app/outputs/flutter-apk/app-release.apk'),
    path.resolve(process.cwd(), 'build/app/outputs/flutter-apk/app-release.apk')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return possiblePaths[0];
}

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

  const apkPath = findApk();
  if (!fs.existsSync(apkPath)) {
    console.error(`❌ APK não encontrado em: ${apkPath}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(apkPath);
  const fileSize = fileBuffer.length;
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();

  console.log(`📦 Arquivo: ${path.basename(apkPath)}`);
  console.log(`📏 Tamanho: ${fileSize} bytes (~${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`🔑 SHA-256: ${sha256}`);

  const aapt = findAapt();

  // 1. Dump Badging
  const badgingOutput = execSync(`"${aapt}" dump badging "${apkPath}"`, { encoding: 'utf-8' });

  // Checagem de versão
  const packageMatch = badgingOutput.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
  if (!packageMatch) {
    console.error('❌ Falha ao extrair informações do pacote do APK.');
    process.exit(1);
  }
  const [, packageName, versionCode, versionName] = packageMatch;
  console.log(`🏷️  Package: ${packageName}`);
  console.log(`🏷️  Version: ${versionName} (code ${versionCode})`);

  // Obter versão esperada dinamicamente do pubspec.yaml
  const pubspecPath = path.resolve(__dirname, '../mobile/pubspec.yaml');
  let expectedVersion = '1.0.5';
  let expectedBuild = '6';
  if (fs.existsSync(pubspecPath)) {
    const pubspecContent = fs.readFileSync(pubspecPath, 'utf-8');
    const vMatch = pubspecContent.match(/^version:\s*([^\s+]+)\+(\d+)/m);
    if (vMatch) {
      expectedVersion = vMatch[1];
      expectedBuild = vMatch[2];
    }
  }

  if (versionName !== expectedVersion || versionCode !== expectedBuild) {
    console.error(`❌ Versão incorreta! Esperado: versionName='${expectedVersion}', versionCode='${expectedBuild}'. Encontrado: versionName='${versionName}', versionCode='${versionCode}'`);
    process.exit(1);
  }

  // Checagem de Debuggable
  if (badgingOutput.includes('application-debuggable')) {
    console.error('❌ ERRO CRÍTICO: APK compilado como DEBUGGABLE! Rejeitado para release.');
    process.exit(1);
  }
  console.log('✅ APK é não-debuggable (produção).');

  // 2. Dump XMLTree do AndroidManifest.xml
  const xmltreeOutput = execSync(`"${aapt}" dump xmltree "${apkPath}" AndroidManifest.xml`, { encoding: 'utf-8' });

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
