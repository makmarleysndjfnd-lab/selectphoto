import 'dart:async';
import 'dart:io';
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

  SyncService createService({
    bool? initialOnline,
    bool Function(String path)? fileChecker,
  }) {
    return SyncService(
      fakeApi,
      initialOnline: initialOnline,
      fileExistsChecker: fileChecker ?? (path) => true,
    );
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    fakeApi = FakeApiService();
  });

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
        type: 'UPDATE_CLIENT_LOCATION',
        payload: {'clientId': 'c-2', 'lat': -16.68, 'lng': -49.25},
        createdAt: DateTime(2026, 8, 18, 10, 30),
        retryCount: 2,
        lastError: 'Connection refused',
      );

      final jsonMap = original.toJson();
      final restored = SyncRequest.fromJson(jsonMap);

      expect(restored.id, original.id);
      expect(restored.type, original.type);
      expect(restored.payload['clientId'], 'c-2');
      expect(restored.retryCount, 2);
      expect(restored.lastError, 'Connection refused');
    });
  });

  group('SyncService - Fila, Conectividade, Bateria e Backoff Exponencial', () {
    test('1. Fila vazia não cria timer de retry (economia de bateria)', () async {
      final service = createService(initialOnline: true);
      expect(service.pendingRequests, isEmpty);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('2. Nova pendência online sincroniza imediatamente e retorna true', () async {
      final service = createService(initialOnline: true);

      final success = await service.addPendingRequest('REGISTER_SALE', {
        'value': 100.0,
        'pendingReceiptPath': 'receipt-100.jpg',
      });

      expect(success, isTrue);
      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(service.pendingRequests, isEmpty);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('3. Pendência offline aguarda reconexão sem chamar API imediatamente', () async {
      final service = createService(initialOnline: false);

      final success = await service.addPendingRequest('REGISTER_SALE', {
        'value': 150.0,
        'pendingReceiptPath': 'receipt-150.jpg',
      });

      expect(success, isTrue);
      expect(fakeApi.registerSaleCalls, 0);
      expect(service.pendingRequests.length, 1);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('4. Reconexão de rede dispara sincronização de pendências', () async {
      final service = createService(initialOnline: false);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 200.0,
        'pendingReceiptPath': 'receipt-200.jpg',
      });

      expect(fakeApi.registerSaleWithReceiptCalls, 0);
      expect(service.pendingRequests.length, 1);

      await service.setOnlineForTesting(true);

      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(service.pendingRequests, isEmpty);
      service.dispose();
    });

    test('5. Retentativa com erro de rede incrementa retryCount', () async {
      fakeApi.shouldFail = true;
      final service = createService(initialOnline: false);

      await service.addPendingRequest('REGISTER_SALE', {
        'value': 250.0,
        'pendingReceiptPath': 'receipt-250.jpg',
      });

      expect(service.pendingRequests.first.retryCount, 0);

      await service.setOnlineForTesting(true);

      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.first.retryCount, 1);
      expect(service.pendingRequests.first.lastError, contains('Network timeout test'));
      service.dispose();
    });

    test('6. Backoff exponencial calcula intervalos corretamente', () {
      expect(SyncService.calculateBackoff(0), 15);
      expect(SyncService.calculateBackoff(1), 30);
      expect(SyncService.calculateBackoff(2), 60);
      expect(SyncService.calculateBackoff(3), 120);
      expect(SyncService.calculateBackoff(4), 120);
      expect(SyncService.calculateBackoff(10), 120);
    });

    test('7. addPendingRequest rejeita venda sem comprovante e retorna false', () async {
      final service = createService(
        initialOnline: false,
        fileChecker: (path) => false, // Simula arquivo inexistente
      );

      final success = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-sem-foto',
        'value': 300,
        'pendingReceiptPath': 'caminho_inexistente.jpg',
      });

      expect(success, isFalse, reason: 'Deve retornar false para venda sem arquivo físico');
      expect(service.pendingRequests, isEmpty);
      service.dispose();
    });

    test('8. Substituição de venda do mesmo cliente apaga cópia antiga em pending_receipts', () async {
      final tempDir = await Directory.systemTemp.createTemp('pending_test_');
      final receiptsDir = Directory('${tempDir.path}${Platform.pathSeparator}pending_receipts');
      await receiptsDir.create(recursive: true);

      final oldFile = File('${receiptsDir.path}${Platform.pathSeparator}old_receipt.jpg');
      await oldFile.writeAsString('dados-antigos');
      final newFile = File('${receiptsDir.path}${Platform.pathSeparator}new_receipt.jpg');
      await newFile.writeAsString('dados-novos');

      final service = SyncService(
        fakeApi,
        initialOnline: false,
        fileExistsChecker: (path) => File(path).existsSync(),
      );

      // 1º registro com oldFile
      final ok1 = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-subst',
        'value': 100,
        'pendingReceiptPath': oldFile.path,
      });
      expect(ok1, isTrue);
      expect(service.pendingRequests.length, 1);
      expect(await oldFile.exists(), isTrue);

      // 2º registro substitui o anterior com newFile
      final ok2 = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-subst',
        'value': 150,
        'pendingReceiptPath': newFile.path,
      });
      expect(ok2, isTrue);
      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.single.payload['value'], 150);

      // O arquivo antigo na pasta controlada deve ter sido excluído com segurança
      expect(await oldFile.exists(), isFalse, reason: 'Arquivo antigo em pending_receipts deve ser removido');
      // O novo arquivo deve ser preservado
      expect(await newFile.exists(), isTrue);

      service.dispose();
      await tempDir.delete(recursive: true);
    });

    test('9. removePendingRequest apaga cópia controlada em pending_receipts', () async {
      final tempDir = await Directory.systemTemp.createTemp('pending_del_');
      final receiptsDir = Directory('${tempDir.path}${Platform.pathSeparator}pending_receipts');
      await receiptsDir.create(recursive: true);

      final file = File('${receiptsDir.path}${Platform.pathSeparator}receipt_to_delete.jpg');
      await file.writeAsString('conteudo-comprovante');

      final service = SyncService(
        fakeApi,
        initialOnline: false,
        fileExistsChecker: (path) => File(path).existsSync(),
      );

      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-del',
        'value': 200,
        'pendingReceiptPath': file.path,
      });
      expect(service.pendingRequests.length, 1);
      final reqId = service.pendingRequests.first.id;

      // Remove manualmente
      await service.removePendingRequest(reqId);

      expect(service.pendingRequests, isEmpty);
      expect(await file.exists(), isFalse, reason: 'Arquivo deve ser excluído ao remover pendência');

      service.dispose();
      await tempDir.delete(recursive: true);
    });

    test('10. Trava de segurança: nunca apaga arquivos fora da pasta pending_receipts', () async {
      final tempDir = await Directory.systemTemp.createTemp('safe_dir_');
      final externalFile = File('${tempDir.path}${Platform.pathSeparator}foto_externa.jpg');
      await externalFile.writeAsString('foto-segura-nao-apagar');

      final service = SyncService(
        fakeApi,
        initialOnline: false,
        fileExistsChecker: (path) => true,
      );

      // Simula uma requisição com arquivo fora da pasta pending_receipts
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client-safe',
        'value': 300,
        'pendingReceiptPath': externalFile.path,
      });

      final reqId = service.pendingRequests.first.id;
      await service.removePendingRequest(reqId);

      // O arquivo externo NÃO pode ter sido deletado
      expect(await externalFile.exists(), isTrue, reason: 'Arquivo fora de pending_receipts nunca deve ser apagado');

      service.dispose();
      await tempDir.delete(recursive: true);
    });

    test('11. Distingue requisições sincronizáveis de itens legados', () async {
      final service = createService(
        initialOnline: false,
        fileChecker: (path) => path.contains('valid'),
      );

      // Item sincronizável (comprovante existente)
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-syncable',
        'value': 100,
        'pendingReceiptPath': 'valid_receipt.jpg',
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

    test('12. Itens legados sem foto não entram em loop infinito no syncAllPending', () async {
      final service = createService(initialOnline: true);

      service.pendingRequests.add(SyncRequest(
        id: 'legacy-loop-test',
        type: 'REGISTER_SALE',
        payload: {'clientId': 'c-legacy-loop', 'value': 300},
        createdAt: DateTime.now(),
      ));

      await service.syncAllPending();

      expect(fakeApi.registerSaleWithReceiptCalls, 0);
      expect(fakeApi.registerSaleCalls, 0);
      expect(service.legacyRequests.length, 1);
      expect(service.retryTimer, isNull);
      expect(service.legacyRequests.first.lastError, contains('Registro antigo sem a fotografia'));
      service.dispose();
    });

    test('13. removeLegacyRequests remove apenas legados mantendo sincronizáveis', () async {
      final service = createService(initialOnline: false);

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
