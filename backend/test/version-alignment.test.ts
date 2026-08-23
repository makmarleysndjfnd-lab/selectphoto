import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('ALINHAMENTO DE VERS�O � Consist�ncia Multi-Camadas (1.0.5+6)', { concurrency: 1 }, () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('1. backend/package.json possui vers�o 1.0.5', () => {
    const pkgPath = path.join(rootDir, 'backend/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '1.0.5');
  });

  it('2. backend/src/index.ts retorna vers�o 1.0.5 no /health', () => {
    const indexPath = path.join(rootDir, 'backend/src/index.ts');
    const content = fs.readFileSync(indexPath, 'utf8');
    const match = content.match(/version:\s*['"]([^'"]+)['"]/);
    assert.ok(match, 'Campo version deve existir no /health de index.ts');
    assert.equal(match[1], '1.0.5');
  });

  it('3. backend/src/routes/app.ts define CURRENT_APP_VERSION 1.0.5 e CURRENT_BUILD_NUMBER 6', () => {
    const appRoutePath = path.join(rootDir, 'backend/src/routes/app.ts');
    const content = fs.readFileSync(appRoutePath, 'utf8');
    const vMatch = content.match(/CURRENT_APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const bMatch = content.match(/CURRENT_BUILD_NUMBER\s*=\s*(\d+)/);
    assert.ok(vMatch, 'CURRENT_APP_VERSION deve existir');
    assert.ok(bMatch, 'CURRENT_BUILD_NUMBER deve existir');
    assert.equal(vMatch[1], '1.0.5');
    assert.equal(bMatch[1], '6');
  });

  it('4. mobile/pubspec.yaml define vers�o 1.0.5+6', () => {
    const pubspecPath = path.join(rootDir, 'mobile/pubspec.yaml');
    const content = fs.readFileSync(pubspecPath, 'utf8');
    const match = content.match(/^version:\s*([0-9.]+)\+(\d+)/m);
    assert.ok(match, 'Campo version deve existir no pubspec.yaml');
    assert.equal(match[1], '1.0.5');
    assert.equal(match[2], '6');
  });

  it('5. mobile/lib/config/app_config.dart define appVersion 1.0.5 e buildNumber 6', () => {
    const configPath = path.join(rootDir, 'mobile/lib/config/app_config.dart');
    const content = fs.readFileSync(configPath, 'utf8');
    const vMatch = content.match(/static const String appVersion = '([^']+)';/);
    const bMatch = content.match(/static const int buildNumber = (\d+);/);
    assert.ok(vMatch, 'appVersion deve existir no AppConfig');
    assert.ok(bMatch, 'buildNumber deve existir no AppConfig');
    assert.equal(vMatch[1], '1.0.5');
    assert.equal(bMatch[1], '6');
  });

  it('6. TODAS as camadas (package.json, health, app.ts, pubspec, AppConfig) est�o 100% alinhadas', () => {
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
