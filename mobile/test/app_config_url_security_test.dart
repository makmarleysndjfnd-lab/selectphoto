import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:mobile/config/app_config.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Segurança de SERVER_URL e Proteção contra Fallback Silencioso', () {
    test('1. AppConfig: Se SERVER_URL não for fornecida, AppConfig.serverUrl lança StateError explícito', () {
      if (!AppConfig.hasServerUrl) {
        expect(
          () => AppConfig.serverUrl,
          throwsA(isA<StateError>().having(
            (e) => e.message,
            'message',
            contains('SERVER_URL não foi definida'),
          )),
        );
      } else {
        // Se fornecida via dart-define, deve retornar a URL sem fallback silencioso para Render
        expect(AppConfig.serverUrl, isNotEmpty);
      }
    });

    test('2. ApiService: Chamada HTTP sem SERVER_URL é rejeitada pelo interceptor sem tocar a rede', () async {
      final api = ApiService(customBaseUrl: '');
      expect(api.baseUrl, isEmpty);

      expect(
        () async => await api.dio.get('/health'),
        throwsA(isA<DioException>().having(
          (e) => e.error.toString(),
          'error',
          contains('SERVER_URL não foi definida'),
        )),
      );
    });

    test('3. ApiService: URL recebida é utilizada e não reverte para Render', () {
      final testStagingUrl = 'http://127.0.0.1:3001/api';
      final api = ApiService(customBaseUrl: testStagingUrl);

      expect(api.baseUrl, equals(testStagingUrl));
      expect(api.dio.options.baseUrl, equals(testStagingUrl));
      expect(api.baseUrl.contains('onrender.com'), isFalse);
    });

    test('4. SettingsProvider: Não possui fallback fixo para Render em ambiente sem URL', () {
      final settings = SettingsProvider();
      if (!AppConfig.hasServerUrl) {
        expect(settings.serverUrl.contains('onrender.com'), isFalse);
      }
    });
  });
}
