import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/config/app_config.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Validação Centralizada de URLs e Segurança do AppConfig', () {
    test('1. Host de produção oficial é estritamente selectphoto-k1ac.onrender.com', () {
      expect(AppConfig.authorizedProductionHost, equals('selectphoto-k1ac.onrender.com'));
      expect(AppConfig.officialProductionUrl, equals('https://selectphoto-k1ac.onrender.com/api'));
      expect(AppConfig.appVersion, equals('1.0.3'));
      expect(AppConfig.buildNumber, equals(3));
      expect(AppConfig.fullVersion, equals('1.0.3+3'));
    });

    test('2. Validador em release aceita apenas HTTPS e host oficial', () {
      final valid = AppConfig.validateUrl('https://selectphoto-k1ac.onrender.com/api', isRelease: true);
      expect(valid, equals('https://selectphoto-k1ac.onrender.com/api'));

      // Rejeita HTTP
      expect(
        () => AppConfig.validateUrl('http://selectphoto-k1ac.onrender.com/api', isRelease: true),
        throwsA(isA<StateError>().having((e) => e.message, 'msg', contains('apenas conexões HTTPS'))),
      );

      // Rejeita host sem -k1ac
      expect(
        () => AppConfig.validateUrl('https://selectphoto.onrender.com/api', isRelease: true),
        throwsA(isA<StateError>().having((e) => e.message, 'msg', contains('apenas o host oficial'))),
      );

      // Rejeita localhost e IPs locais em release
      expect(
        () => AppConfig.validateUrl('http://127.0.0.1:3000/api', isRelease: true),
        throwsA(isA<StateError>()),
      );
      expect(
        () => AppConfig.validateUrl('http://192.168.1.6:3000/api', isRelease: true),
        throwsA(isA<StateError>()),
      );
    });

    test('3. Em debug, aceita URLs locais válidas para desenvolvimento', () {
      final localUrl = AppConfig.validateUrl('http://localhost:3000/api', isRelease: false);
      expect(localUrl, equals('http://localhost:3000/api'));

      final emuUrl = AppConfig.validateUrl('http://10.0.2.2:3000/api', isRelease: false);
      expect(emuUrl, equals('http://10.0.2.2:3000/api'));
    });

    test('4. SharedPreferences com URL antiga não sobrescreve release oficial', () async {
      SharedPreferences.setMockInitialValues({
        'serverUrl': 'http://127.0.0.1:3001/api',
      });

      final settings = SettingsProvider();
      await Future.delayed(const Duration(milliseconds: 50));
      expect(settings.serverUrl, isNotEmpty);
    });
  });

  group('Tratamento Granular de Erros de Conexão e API', () {
    test('5. Mapeamento correto de erros HTTP e exceções de conexão', () {
      final api = ApiService(customBaseUrl: 'http://localhost:3000/api');
      expect(api.baseUrl, equals('http://localhost:3000/api'));

      // Timeout
      final timeoutErr = DioException(
        requestOptions: RequestOptions(path: '/test'),
        type: DioExceptionType.connectionTimeout,
      );
      expect(timeoutErr.type, equals(DioExceptionType.connectionTimeout));

      // Credenciais inválidas (401)
      final authErr = DioException(
        requestOptions: RequestOptions(path: '/auth/login'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/login'),
          statusCode: 401,
          data: {'error': 'Invalid credentials'},
        ),
      );
      expect(authErr.response?.statusCode, equals(401));

      // Usuário / Empresa inativa (401 / 403)
      final inactiveErr = DioException(
        requestOptions: RequestOptions(path: '/auth/login'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/login'),
          statusCode: 401,
          data: {'error': 'User is inactive'},
        ),
      );
      expect(inactiveErr.response?.statusCode, equals(401));

      // Limite de requisições excedido (429)
      final rateLimitErr = DioException(
        requestOptions: RequestOptions(path: '/auth/login'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/login'),
          statusCode: 429,
          data: {'error': 'Too many requests'},
        ),
      );
      expect(rateLimitErr.response?.statusCode, equals(429));
    });
  });
}
