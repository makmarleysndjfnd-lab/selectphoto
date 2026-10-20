import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('ALINHAMENTO DE VERSÃO — Consistência Multi-Camadas', { concurrency: 1 }, () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('1. backend/package.json possui versão válida SemVer (1.0.8)', () => {
    const pkgPath = path.join(rootDir, 'backend/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '1.0.8');
  });

  it('2. backend/src/index.ts retorna versão alinhada com package.json no /health', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'backend/package.json'), 'utf8'));
    const indexPath = path.join(rootDir, 'backend/src/index.ts');
    const content = fs.readFileSync(indexPath, 'utf8');
    const match = content.match(/version:\s*['"]([^'"]+)['"]/);
    assert.ok(match, 'Campo version deve existir no /health de index.ts');
    assert.equal(match[1], pkg.version);
  });

  it('3. backend/src/routes/app.ts define CURRENT_APP_VERSION e CURRENT_BUILD_NUMBER válidos', () => {
    const appRoutePath = path.join(rootDir, 'backend/src/routes/app.ts');
    const content = fs.readFileSync(appRoutePath, 'utf8');
    const vMatch = content.match(/CURRENT_APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const bMatch = content.match(/CURRENT_BUILD_NUMBER\s*=\s*(\d+)/);
    assert.ok(vMatch, 'CURRENT_APP_VERSION deve existir');
    assert.ok(bMatch, 'CURRENT_BUILD_NUMBER deve existir');
    assert.ok(vMatch[1].length > 0);
    assert.ok(Number(bMatch[1]) > 0);
  });

  it('4. mobile/pubspec.yaml define versão e build number válidos', () => {
    const pubspecPath = path.join(rootDir, 'mobile/pubspec.yaml');
    const content = fs.readFileSync(pubspecPath, 'utf8');
    const match = content.match(/^version:\s*([0-9.]+)\+(\d+)/m);
    assert.ok(match, 'Campo version deve existir no pubspec.yaml');
    assert.ok(match[1].length > 0);
    assert.ok(Number(match[2]) > 0);
  });

  it('5. mobile/lib/config/app_config.dart define appVersion e buildNumber válidos', () => {
    const configPath = path.join(rootDir, 'mobile/lib/config/app_config.dart');
    const content = fs.readFileSync(configPath, 'utf8');
    const vMatch = content.match(/static const String appVersion = '([^']+)';/);
    const bMatch = content.match(/static const int buildNumber = (\d+);/);
    assert.ok(vMatch, 'appVersion deve existir no AppConfig');
    assert.ok(bMatch, 'buildNumber deve existir no AppConfig');
    assert.ok(vMatch[1].length > 0);
    assert.ok(Number(bMatch[1]) > 0);
  });

  it('6. TODAS as camadas estão 100% alinhadas em seus respectivos subsistemas (backend e mobile)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'backend/package.json'), 'utf8'));
    const indexContent = fs.readFileSync(path.join(rootDir, 'backend/src/index.ts'), 'utf8');
    const pubspecContent = fs.readFileSync(path.join(rootDir, 'mobile/pubspec.yaml'), 'utf8');
    const configContent = fs.readFileSync(path.join(rootDir, 'mobile/lib/config/app_config.dart'), 'utf8');

    const backendPkgVersion = pkg.version;
    const healthVersion = indexContent.match(/version:\s*['"]([^'"]+)['"]/)?.[1];
    const pubspecMatch = pubspecContent.match(/^version:\s*([0-9.]+)\+(\d+)/m);
    const configVersion = configContent.match(/static const String appVersion = '([^']+)';/)?.[1];
    const configBuild = configContent.match(/static const int buildNumber = (\d+);/)?.[1];

    // Consistência backend
    assert.equal(backendPkgVersion, healthVersion, 'package.json == health');

    // Consistência mobile
    assert.equal(pubspecMatch?.[1], configVersion, 'pubspec version == AppConfig appVersion');
    assert.equal(pubspecMatch?.[2], configBuild, 'pubspec build == AppConfig buildNumber');
  });
});
