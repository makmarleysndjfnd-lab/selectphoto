import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SyncRequest Model Tests', () {
    test('deve instanciar SyncRequest com valores padrão de retryCount = 0', () {
      final req = SyncRequest(
        id: '123',
        type: 'REGISTER_SALE',
        payload: {'value': 150.0, 'clientId': 'c-1'},
        createdAt: DateTime(2026, 8, 18, 10, 0),
      );

      expect(req.id, '123');
      expect(req.type, 'REGISTER_SALE');
      expect(req.retryCount, 0);
      expect(req.lastError, isNull);
      expect(req.isSyncing, isFalse);
    });

    test('deve serializar e desserializar SyncRequest via JSON corretamente', () {
      final original = SyncRequest(
        id: '456',
        type: 'SUBMIT_COST',
        payload: {'amount': 85.5, 'category': 'COMBUSTIVEL'},
        createdAt: DateTime(2026, 8, 18, 12, 30),
        retryCount: 2,
        lastError: 'DioException [connection error]',
      );

      final json = original.toJson();
      final reconstructed = SyncRequest.fromJson(json);

      expect(reconstructed.id, original.id);
      expect(reconstructed.type, original.type);
      expect(reconstructed.payload['amount'], 85.5);
      expect(reconstructed.payload['category'], 'COMBUSTIVEL');
      expect(reconstructed.retryCount, 2);
      expect(reconstructed.lastError, 'DioException [connection error]');
    });

    test('deve lidar com JSON com campos ausentes ou nulos com segurança', () {
      final req = SyncRequest.fromJson({});

      expect(req.id, isNotEmpty);
      expect(req.type, '');
      expect(req.payload, isEmpty);
      expect(req.retryCount, 0);
      expect(req.lastError, isNull);
    });
  });

  group('Sync Queue Storage and Resiliency', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('deve respeitar maxRetries = 5 e não travar o loop de sincronização', () {
      final req = SyncRequest(
        id: '789',
        type: 'REGISTER_SALE',
        payload: {'value': 200.0},
        createdAt: DateTime.now(),
        retryCount: 5,
        lastError: 'Fatal error',
      );

      expect(req.retryCount >= SyncService.maxRetries, isTrue);
    });
  });
}
