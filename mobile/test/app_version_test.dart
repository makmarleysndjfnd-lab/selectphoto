import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/config/app_config.dart';

void main() {
  group('0. Verificação da Versão Efetivamente Compilada no AppConfig', () {
    test('AppConfig reflete fielmente a release 1.0.6+7', () {
      expect(AppConfig.appVersion, equals('1.0.6'));
      expect(AppConfig.buildNumber, equals(7));
      expect(AppConfig.fullVersion, equals('1.0.6+7'));
    });
  });

  group('1. Validação de Segurança da URL do APK (AppConfig.isValidApkDownloadUrl)', () {
    test('Aceita SOMENTE HTTPS com host exato selectphoto-k1ac.onrender.com', () {
      expect(AppConfig.isValidApkDownloadUrl('https://selectphoto-k1ac.onrender.com/apk/app-release.apk'), isTrue);
      expect(AppConfig.isValidApkDownloadUrl('https://selectphoto-k1ac.onrender.com/api/app-version/download'), isTrue);
      expect(AppConfig.isValidApkDownloadUrl('https://selectphoto-k1ac.onrender.com/download.apk?v=1.0.6'), isTrue);
    });

    test('Rejeita conexões HTTP (inseguras)', () {
      expect(AppConfig.isValidApkDownloadUrl('http://selectphoto-k1ac.onrender.com/apk/app-release.apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('http://selectphoto-k1ac.onrender.com/download'), isFalse);
    });

    test('Rejeita hosts externos não autorizados', () {
      expect(AppConfig.isValidApkDownloadUrl('https://evil.com/apk/app-release.apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('https://other.domain.com/app.apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('https://google.com/app.apk'), isFalse);
    });

    test('Rejeita subdomínios falsos ou hosts parecidos (spoofing)', () {
      expect(AppConfig.isValidApkDownloadUrl('https://sub.selectphoto-k1ac.onrender.com/apk/app-release.apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('https://api.selectphoto-k1ac.onrender.com/apk/app.apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('https://selectphoto.onrender.com/apk/app-release.apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('https://selectphoto-k1ac.onrender.com.evil.example/apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('https://selectphoto-k1ac.onrender.com.attacker.com/app.apk'), isFalse);
    });

    test('Rejeita URLs vazias, nulas ou formatos inválidos', () {
      expect(AppConfig.isValidApkDownloadUrl(null), isFalse);
      expect(AppConfig.isValidApkDownloadUrl(''), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('   '), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('invalid_uri_string'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('ftp://selectphoto-k1ac.onrender.com/apk'), isFalse);
      expect(AppConfig.isValidApkDownloadUrl('file:///android_asset/app.apk'), isFalse);
    });
  });

  group('2. Comparação de Build Number e Resposta Real do Backend (AppConfig.shouldPromptUpdate)', () {
    const validUrl = 'https://selectphoto-k1ac.onrender.com/apk/app-release.apk';

    // Testes usando a versão instalada padrão (1.0.6+7)
    test('instalada padrão (1.0.6+7) / remota version "1.0.6" e buildNumber 8: atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        remoteVersion: '1.0.6',
        remoteBuildNumber: 8,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isTrue);
    });

    test('instalada padrão (1.0.6+7) / remota version "1.0.6" e buildNumber 7: não atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        remoteVersion: '1.0.6',
        remoteBuildNumber: 7,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isFalse);
    });

    test('instalada padrão (1.0.6+7) / remota version "1.0.7" e buildNumber 1: atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        remoteVersion: '1.0.7',
        remoteBuildNumber: 1,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isTrue);
    });

    test('instalada padrão (1.0.6+7) / remota version "1.0.5" e buildNumber 10: não atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        remoteVersion: '1.0.5',
        remoteBuildNumber: 10,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isFalse);
    });

    test('instalada 1.0.5+6 / remota version "1.0.5" e buildNumber 7: atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.5+6',
        remoteVersion: '1.0.5',
        remoteBuildNumber: 7,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isTrue);
    });

    test('instalada 1.0.5+6 / remota version "1.0.5" e buildNumber 6: não atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.5+6',
        remoteVersion: '1.0.5',
        remoteBuildNumber: 6,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isFalse);
    });

    test('instalada 1.0.5+6 / remota version "1.0.6" e buildNumber 1: atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.5+6',
        remoteVersion: '1.0.6',
        remoteBuildNumber: 1,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isTrue);
    });

    test('instalada 1.0.5+6 / remota version "1.0.4" e buildNumber 10: não atualizar', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.5+6',
        remoteVersion: '1.0.4',
        remoteBuildNumber: 10,
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isFalse);
    });

    test('ausência de buildNumber deve possuir fallback seguro', () {
      // Mesma versão sem buildNumber -> não atualizar (não assume que é mais nova)
      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.4',
          remoteBuildNumber: null,
          downloadUrl: validUrl,
        ),
        isFalse,
      );

      // Versão semver maior sem buildNumber -> atualizar
      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5',
          remoteBuildNumber: null,
          downloadUrl: validUrl,
        ),
        isTrue,
      );

      // Versão semver menor sem buildNumber -> não atualizar
      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.3',
          remoteBuildNumber: null,
          downloadUrl: validUrl,
        ),
        isFalse,
      );

      // Versão remota nula -> não atualizar
      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: null,
          remoteBuildNumber: 10,
          downloadUrl: validUrl,
        ),
        isFalse,
      );
    });

    test('Mesmo com versão mais nova, URL não autorizada bloqueia diálogo de atualização', () {
      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5',
          remoteBuildNumber: 1,
          downloadUrl: 'http://selectphoto-k1ac.onrender.com/apk/app.apk',
        ),
        isFalse,
      );

      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5',
          remoteBuildNumber: 1,
          downloadUrl: 'https://evil.com/apk/app.apk',
        ),
        isFalse,
      );

      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5',
          remoteBuildNumber: 1,
          downloadUrl: 'https://selectphoto-k1ac.onrender.com.evil.example/apk',
        ),
        isFalse,
      );
    });

    test('VersionNumber comparadores puros', () {
      final v1 = VersionNumber.tryParse('1.0.4', buildNumber: 5)!;
      final v2 = VersionNumber.tryParse('1.0.4', buildNumber: 6)!;
      final v3 = VersionNumber.tryParse('2.0.0')!;
      final v4 = VersionNumber.tryParse('1.0.4+5')!;

      expect(v2.isGreaterThan(v1), isTrue);
      expect(v3.isGreaterThan(v2), isTrue);
      expect(v1.isEqualTo(v4), isTrue);
      expect(v1.isLessThan(v2), isTrue);
      expect(VersionNumber.tryParse(null), isNull);
      expect(VersionNumber.tryParse(''), isNull);
    });
  });
}
