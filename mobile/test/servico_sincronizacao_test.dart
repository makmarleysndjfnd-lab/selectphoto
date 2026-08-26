import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeApiService extends ApiService {
  int registerSaleCalls = 0;
  int registerSaleWithReceiptCalls = 0;
  bool shouldFail = false;
  Completer<void>? inFlightCompleter;

  FakeApiService() : super.testInstance();

  @override
  Future<String> registerSale(Map<String, dynamic> data) async {
    registerSaleCalls++;
    if (inFlightCompleter != null) {
      await inFlightCompleter!.future;
    }
    if (shouldFail) {
      throw Exception('Network timeout test');
    }
    return 'sale-1';
  }

  @override
  Future<String> registerSaleWithReceipt(
      Map<String, dynamic> data, String filePath) async {
    registerSaleWithReceiptCalls++;
    if (inFlightCompleter != null) {
      await inFlightCompleter!.future;
    }
    if (shouldFail) throw Exception('Network timeout test');
    return 'sale-with-receipt-1';
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeApiService fakeApi;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    fakeApi = FakeApiService();
    SyncService.skipFileExistenceCheckForTesting = true;
  });

  group('SyncRequest Model Tests', () {
    test('deve instanciar SyncRequest com valores padrão de retryCount = 0',
        () {
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

    test('deve serializar e desserializar SyncRequest via JSON corretamente',
        () {
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

  group('SyncService - Fila, Conectividade, Bateria e Backoff Exponencial', () {
    test('1. Fila vazia não cria timer de retry (economia de bateria)',
        () async {
      final service = SyncService(fakeApi, initialOnline: true);
      expect(service.pendingRequests, isEmpty);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('2. Nova pendência online sincroniza imediatamente', () async {
      final service = SyncService(fakeApi, initialOnline: true);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 100.0,
        'pendingReceiptPath': 'receipt-100.jpg',
      });

      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(service.pendingRequests, isEmpty);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('3. Pendência offline aguarda reconexão sem chamar API imediatamente',
        () async {
      final service = SyncService(fakeApi, initialOnline: false);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 150.0,
        'pendingReceiptPath': 'receipt-150.jpg',
      });

      expect(fakeApi.registerSaleCalls, 0);
      expect(service.pendingRequests.length, 1);
      expect(service.retryTimer,
          isNull); // Offline não cria timer; aguarda reconexão
      service.dispose();
    });

    test('4. Reconexão de rede dispara sincronização de pendências', () async {
      final service = SyncService(fakeApi, initialOnline: false);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 200.0,
        'pendingReceiptPath': 'receipt-200.jpg',
      });
      expect(fakeApi.registerSaleCalls, 0);

      // Simular reconexão de rede
      await service.setOnlineForTesting(true);

      // Sincronização executada automaticamente
      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(service.pendingRequests, isEmpty);
      service.dispose();
    });

    test('5. Falha cria backoff exponencial (15s, 30s, 60s, max 120s)',
        () async {
      expect(SyncService.calculateBackoff(0), 15);
      expect(SyncService.calculateBackoff(1), 30);
      expect(SyncService.calculateBackoff(2), 60);
      expect(SyncService.calculateBackoff(3), 120);
      expect(SyncService.calculateBackoff(4), 120);
      expect(SyncService.calculateBackoff(10), 120);

      fakeApi.shouldFail = true;
      final service = SyncService(fakeApi, initialOnline: true);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 250.0,
        'pendingReceiptPath': 'receipt-250.jpg',
      });

      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.first.retryCount, 1);
      expect(service.retryTimer, isNotNull);

      service.dispose();
    });

    test('6. Fila vazia cancela timer e removePendingRequest limpa timer',
        () async {
      fakeApi.shouldFail = true;
      final service = SyncService(fakeApi, initialOnline: true);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 300.0,
        'pendingReceiptPath': 'receipt-300.jpg',
      });
      expect(service.retryTimer, isNotNull);

      final reqId = service.pendingRequests.first.id;
      await service.removePendingRequest(reqId);

      expect(service.pendingRequests, isEmpty);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('7. Dispose cancela timer e recursos', () async {
      fakeApi.shouldFail = true;
      final service = SyncService(fakeApi, initialOnline: true);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 350.0,
        'pendingReceiptPath': 'receipt-350.jpg',
      });
      expect(service.retryTimer, isNotNull);

      service.dispose();
      expect(service.retryTimer, isNull);
    });

    test('8. Bloqueio contra execuções concorrentes simultâneas', () async {
      fakeApi.inFlightCompleter = Completer<void>();
      final service = SyncService(fakeApi, initialOnline: true);

      final future1 = service.addPendingRequest('REGISTER_SALE', {
        'value': 400.0,
        'pendingReceiptPath': 'receipt-400.jpg',
      });
      // Tenta chamar syncAllPending enquanto a primeira ainda está em voo
      final future2 = service.syncAllPending();
      await Future<void>.delayed(Duration.zero);

      expect(service.isSyncing, isTrue);

      // Conclui a chamada da API
      fakeApi.inFlightCompleter!.complete();
      await future1;
      await future2;

      expect(service.isSyncing, isFalse);
      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      service.dispose();
    });

    test(
        '9. Item com maxRetries permanece visível como falha definitiva sem loop infinito',
        () async {
      fakeApi.shouldFail = true;
      final service = SyncService(fakeApi, initialOnline: true);

      // Adiciona item que já atingiu maxRetries
      final reqExceeded = SyncRequest(
        id: 'exceeded-1',
        type: 'REGISTER_SALE',
        payload: {'value': 500.0},
        createdAt: DateTime.now(),
        retryCount: 5,
        lastError: 'Permanent failure',
      );
      service.pendingRequests.add(reqExceeded);

      await service.syncAllPending();

      // Chamadas à API não devem ser feitas para item com retryCount >= 5
      expect(fakeApi.registerSaleCalls, 0);
      expect(service.pendingRequests.length, 1);
      expect(service.retryTimer, isNull); // Nenhum timer agendado
      service.dispose();
    });

    test('10. Duas vendas offline da mesma ficha viram uma única pendência',
        () async {
      final service = SyncService(fakeApi, initialOnline: false);
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-1',
        'value': 100,
        'pendingReceiptPath': 'receipt-a.jpg',
      });
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-1',
        'value': 120,
        'pendingReceiptPath': 'receipt-b.jpg',
      });

      expect(service.pendingRequests, hasLength(1));
      expect(service.pendingRequests.single.payload['value'], 120);
      service.dispose();
    });

    test(
        '11. Venda com comprovante pendente usa a operação atômica ao reconectar',
        () async {
      final service = SyncService(fakeApi, initialOnline: false);
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-2',
        'value': 200,
        'pendingReceiptPath': 'receipt.jpg',
      });
      await service.setOnlineForTesting(true);

      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(fakeApi.registerSaleCalls, 0);
      expect(service.pendingRequests, isEmpty);
      service.dispose();
    });

    test('12. Distingue requisições sincronizáveis de itens legados', () async {
      final service = SyncService(fakeApi, initialOnline: false);

      // Item sincronizável (com comprovante)
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-syncable',
        'value': 100,
        'pendingReceiptPath': 'receipt.jpg',
      });

      // Item legado (venda antiga sem comprovante)
      service.pendingRequests.add(SyncRequest(
        id: 'legacy-1',
        type: 'REGISTER_SALE',
        payload: {'clientId': 'c-legacy', 'value': 250},
        createdAt: DateTime.now(),
      ));

      expect(service.syncableRequests.length, 1);
      expect(service.legacyRequests.length, 1);
      expect(service.syncableRequests.first.payload['clientId'], 'c-syncable');
      expect(service.legacyRequests.first.payload['clientId'], 'c-legacy');
      service.dispose();
    });

    test('13. Itens legados sem foto não entram em loop infinito no syncAllPending', () async {
      final service = SyncService(fakeApi, initialOnline: true);

      // Item legado inserido diretamente na fila
      service.pendingRequests.add(SyncRequest(
        id: 'legacy-loop-test',
        type: 'REGISTER_SALE',
        payload: {'clientId': 'c-legacy-loop', 'value': 300},
        createdAt: DateTime.now(),
      ));

      await service.syncAllPending();

      // Nenhuma chamada feita para API
      expect(fakeApi.registerSaleWithReceiptCalls, 0);
      expect(fakeApi.registerSaleCalls, 0);
      // Registro continua identificado como legado sem agendar retry infinito
      expect(service.legacyRequests.length, 1);
      expect(service.retryTimer, isNull);
      expect(service.legacyRequests.first.lastError, contains('Registro antigo sem a fotografia'));
      service.dispose();
    });

    test('14. removeLegacyRequests remove apenas legados mantendo sincronizáveis', () async {
      final service = SyncService(fakeApi, initialOnline: false);

      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-keep',
        'value': 150,
        'pendingReceiptPath': 'receipt.jpg',
      });

      service.pendingRequests.add(SyncRequest(
        id: 'legacy-delete-test',
        type: 'REGISTER_SALE',
        payload: {'clientId': 'c-delete', 'value': 400},
        createdAt: DateTime.now(),
      ));

      expect(service.pendingRequests.length, 2);

      await service.removeLegacyRequests();

      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.first.payload['clientId'], 'c-keep');
      expect(service.legacyRequests, isEmpty);
      service.dispose();
    });
  });
}
