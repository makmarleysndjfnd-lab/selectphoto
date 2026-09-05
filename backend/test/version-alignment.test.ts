import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('ALINHAMENTO DE VERSÃO — Consistência Multi-Camadas (1.0.8+10)', { concurrency: 1 }, () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('1. backend/package.json possui versão 1.0.8', () => {
    const pkgPath = path.join(rootDir, 'backend/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '1.0.8');
  });

  it('2. backend/src/index.ts retorna versão 1.0.8 no /health', () => {
    const indexPath = path.join(rootDir, 'backend/src/index.ts');
    const content = fs.readFileSync(indexPath, 'utf8');
    const match = content.match(/version:\s*['"]([^'"]+)['"]/);
    assert.ok(match, 'Campo version deve existir no /health de index.ts');
    assert.equal(match[1], '1.0.8');
  });

  it('3. backend/src/routes/app.ts define CURRENT_APP_VERSION 1.0.8 e CURRENT_BUILD_NUMBER 10', () => {
    const appRoutePath = path.join(rootDir, 'backend/src/routes/app.ts');
    const content = fs.readFileSync(appRoutePath, 'utf8');
    const vMatch = content.match(/CURRENT_APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const bMatch = content.match(/CURRENT_BUILD_NUMBER\s*=\s*(\d+)/);
    assert.ok(vMatch, 'CURRENT_APP_VERSION deve existir');
    assert.ok(bMatch, 'CURRENT_BUILD_NUMBER deve existir');
    assert.equal(vMatch[1], '1.0.8');
    assert.equal(bMatch[1], '10');
  });

  it('4. mobile/pubspec.yaml define versão 1.0.8+10', () => {
    const pubspecPath = path.join(rootDir, 'mobile/pubspec.yaml');
    const content = fs.readFileSync(pubspecPath, 'utf8');
    const match = content.match(/^version:\s*([0-9.]+)\+(\d+)/m);
    assert.ok(match, 'Campo version deve existir no pubspec.yaml');
    assert.equal(match[1], '1.0.8');
    assert.equal(match[2], '10');
  });

  it('5. mobile/lib/config/app_config.dart define appVersion 1.0.8 e buildNumber 10', () => {
    const configPath = path.join(rootDir, 'mobile/lib/config/app_config.dart');
    const content = fs.readFileSync(configPath, 'utf8');
    const vMatch = content.match(/static const String appVersion = '([^']+)';/);
    const bMatch = content.match(/static const int buildNumber = (\d+);/);
    assert.ok(vMatch, 'appVersion deve existir no AppConfig');
    assert.ok(bMatch, 'buildNumber deve existir no AppConfig');
    assert.equal(vMatch[1], '1.0.8');
    assert.equal(bMatch[1], '10');
  });

  it('6. TODAS as camadas (package.json, health, app.ts, pubspec, AppConfig) esto 100% alinhadas', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'backend/package.json'), 'utf8'));
    const indexContent = fs.readFileSync(path.join(rootDir, 'backend/src/index.ts'), 'utf8');
    const appContent = fs.readFileSync(path.join(rootDir, 'backend/src/routes/app.ts'), 'utf8');
    const pubspecContent = fs.readFileSync(path.join(rootDir, 'mobile/pubspec.yaml'), 'utf8');
    const configContent = fs.readFileSync(path.join(rootDir, 'mobile/lib/config/app_config.dart'), 'utf8');

    const backendPkgVersion = pkg.version;
    const healthVersion = indexContent.match(/version:\s*['"]([^'"]+)['"]/)?.[1];
    const appRouteVersion = appContent.match(/CURRENT_APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const appRouteBuild = appContent.match(/CURRENT_BUILD_NUMBER\s*=\s*(\d+)/)?.[1];
    const pubspecMatch = pubspecContent.match(/^version:\s*([0-9.]+)\+(\d+)/m);
    const configVersion = configContent.match(/static const String appVersion = '([^']+)';/)?.[1];
    const configBuild = configContent.match(/static const int buildNumber = (\d+);/)?.[1];

    assert.equal(backendPkgVersion, healthVersion, 'package.json == health');
    assert.equal(healthVersion, appRouteVersion, 'health == app.ts version');
    assert.equal(appRouteVersion, pubspecMatch?.[1], 'app.ts version == pubspec version');
    assert.equal(pubspecMatch?.[1], configVersion, 'pubspec version == AppConfig appVersion');
    assert.equal(appRouteBuild, pubspecMatch?.[2], 'app.ts buildNumber == pubspec build');
    assert.equal(pubspecMatch?.[2], configBuild, 'pubspec build == AppConfig buildNumber');
  });
});
