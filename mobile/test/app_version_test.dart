import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/config/app_config.dart';

void main() {
  group('VersionNumber e AppConfig.shouldPromptUpdate', () {
    const validUrl = 'https://selectphoto-k1ac.onrender.com/apk/app-release.apk';

    test('1. Versão maior deve disparar atualização', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.4+5',
        remoteVersion: '1.0.5+1',
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isTrue);
    });

    test('2. Mesmo versionName com buildNumber maior deve disparar atualização', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.4+5',
        remoteVersion: '1.0.4+6',
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isTrue);
    });

    test('3. Versão e buildNumber iguais NÃO devem disparar atualização', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.4+5',
        remoteVersion: '1.0.4+5',
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isFalse);
    });

    test('4. Versão inferior NÃO deve disparar atualização', () {
      final shouldUpdate = AppConfig.shouldPromptUpdate(
        currentVersion: '1.0.4+5',
        remoteVersion: '1.0.3+4',
        downloadUrl: validUrl,
      );
      expect(shouldUpdate, isFalse);
    });

    test('5. Resposta sem downloadUrl ou com URL inválida/não-HTTPS NÃO deve disparar atualização', () {
      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5+1',
          downloadUrl: null,
        ),
        isFalse,
      );

      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5+1',
          downloadUrl: '',
        ),
        isFalse,
      );

      expect(
        AppConfig.shouldPromptUpdate(
          currentVersion: '1.0.4+5',
          remoteVersion: '1.0.5+1',
          downloadUrl: 'http://insecure-site.com/app.apk',
        ),
        isFalse,
      );
    });

    test('6. VersionNumber comparadores puros', () {
      final v1 = VersionNumber.tryParse('1.0.4+5')!;
      final v2 = VersionNumber.tryParse('1.0.4+6')!;
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
