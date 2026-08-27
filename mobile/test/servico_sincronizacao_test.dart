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
    Future<bool> Function(String key, String value)? storageWriter,
    String Function()? controlledDirResolver,
  }) {
    return SyncService(
      fakeApi,
      initialOnline: initialOnline,
      fileExistsChecker: fileChecker ?? (path) => true,
      storageWriter: storageWriter,
      controlledDirectoryResolver: controlledDirResolver ?? () => '/app/data/pending_receipts',
    );
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    fakeApi = FakeApiService();
  });

  group('SyncRequest Model e Geração de UUID v4', () {
    test('1. Deve instanciar SyncRequest com valores padrão e retryCount = 0', () {
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

    test('2. Deve serializar e desserializar SyncRequest via JSON corretamente', () {
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

    test('3. IDs simultâneos são UUIDs v4 válidos e estritamente diferentes', () {
      final generatedIds = <String>{};
      final uuidRegex = RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

      for (int i = 0; i < 100; i++) {
        final id = SyncService.generateUuid();
        expect(uuidRegex.hasMatch(id), isTrue, reason: 'ID deve ser UUID v4 RFC 4122 válido');
        expect(generatedIds.contains(id), isFalse, reason: 'IDs simultâneos devem ser únicos');
        generatedIds.add(id);
      }
      expect(generatedIds.length, 100);
    });
  });

  group('Validação Canônica de Pastas e Travessia de Diretório', () {
    test('4. pending_receipts_fake é bloqueado categoricamente', () {
      final service = createService(
        controlledDirResolver: () => '/app/data/pending_receipts',
      );

      expect(
        service.isPathInsideControlledDirectory('/app/data/pending_receipts_fake/receipt.jpg'),
        isFalse,
        reason: 'Diretório com prefixo similar mas falso deve ser recusado',
      );
      service.dispose();
    });

    test('5. Travessia de diretório com ../ é bloqueada categoricamente', () {
      final service = createService(
        controlledDirResolver: () => '/app/data/pending_receipts',
      );

      expect(
        service.isPathInsideControlledDirectory('/app/data/pending_receipts/../outside.jpg'),
        isFalse,
        reason: 'Tentativa de subida com ../ deve ser bloqueada',
      );
      expect(
        service.isPathInsideControlledDirectory('/app/data/pending_receipts/sub/../../etc/passwd'),
        isFalse,
        reason: 'Tentativa de escape multinível deve ser bloqueada',
      );
      service.dispose();
    });

    test('6. Caminhos externos e arbitrários são bloqueados', () {
      final service = createService(
        controlledDirResolver: () => '/app/data/pending_receipts',
      );

      expect(service.isPathInsideControlledDirectory('/var/log/syslog'), isFalse);
      expect(service.isPathInsideControlledDirectory('C:\\Windows\\system32\\cmd.exe'), isFalse);
      expect(service.isPathInsideControlledDirectory(''), isFalse);
      service.dispose();
    });

    test('7. Caminhos legítimos dentro da pasta controlada são aceitos', () {
      final service = createService(
        controlledDirResolver: () => '/app/data/pending_receipts',
      );

      expect(
        service.isPathInsideControlledDirectory('/app/data/pending_receipts/sale_123.jpg'),
        isTrue,
      );
      expect(
        service.isPathInsideControlledDirectory('/app/data/pending_receipts/sub/sale_456.jpg'),
        isTrue,
      );
      service.dispose();
    });
  });

  group('Persistência Transacional e Resiliência contra Falhas', () {
    test('8. setString retornando false falha a adição e preserva a fila vazia', () async {
      final service = createService(
        initialOnline: false,
        storageWriter: (key, value) async => false, // Simula falha no SharedPreferences
      );

      final success = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-1',
        'value': 100.0,
        'pendingReceiptPath': '/app/data/pending_receipts/receipt.jpg',
      });

      expect(success, isFalse, reason: 'Deve retornar false quando a persistência falha');
      expect(service.pendingRequests, isEmpty, reason: 'Memória não pode ser alterada se persistência falhou');
      service.dispose();
    });

    test('9. Persistência que lança exceção falha com segurança e preserva o estado', () async {
      final service = createService(
        initialOnline: false,
        storageWriter: (key, value) async => throw Exception('Disk I/O failure'),
      );

      final success = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-2',
        'value': 200.0,
        'pendingReceiptPath': '/app/data/pending_receipts/receipt.jpg',
      });

      expect(success, isFalse, reason: 'Deve retornar false se a persistência lançar exceção');
      expect(service.pendingRequests, isEmpty);
      service.dispose();
    });

    test('10. Substituição com falha de persistência preserva a fila e o arquivo físico antigo', () async {
      final tempDir = await Directory.systemTemp.createTemp('atomic_subst_');
      final receiptsDir = Directory('${tempDir.path}${Platform.pathSeparator}pending_receipts');
      await receiptsDir.create(recursive: true);

      final oldFile = File('${receiptsDir.path}${Platform.pathSeparator}old_receipt.jpg');
      await oldFile.writeAsString('comprovante-antigo-intacto');
      final newFile = File('${receiptsDir.path}${Platform.pathSeparator}new_receipt.jpg');
      await newFile.writeAsString('comprovante-novo');

      bool shouldFailPersistence = false;

      final service = SyncService(
        fakeApi,
        initialOnline: false,
        fileExistsChecker: (path) => File(path).existsSync(),
        controlledDirectoryResolver: () => receiptsDir.path,
        storageWriter: (key, value) async {
          if (shouldFailPersistence) return false;
          final prefs = await SharedPreferences.getInstance();
          return await prefs.setString(key, value);
        },
      );

      // 1. Primeira venda é persistida com sucesso
      final ok1 = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'cli-subst',
        'value': 100,
        'pendingReceiptPath': oldFile.path,
      });
      expect(ok1, isTrue);
      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.single.payload['value'], 100);
      expect(await oldFile.exists(), isTrue);

      // 2. Segunda venda (substituição) falha ao persistir em disco
      shouldFailPersistence = true;
      final ok2 = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'cli-subst',
        'value': 150,
        'pendingReceiptPath': newFile.path,
      });
      expect(ok2, isFalse, reason: 'Substituição deve falhar se persistência falhar');

      // 3. Estado em memória e arquivo antigo continuam 100% PRESERVADOS
      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.single.payload['value'], 100, reason: 'Valor anterior deve ser mantido');
      expect(await oldFile.exists(), isTrue, reason: 'Arquivo antigo NÃO pode ser apagado se a persistência falhou');

      service.dispose();
      await tempDir.delete(recursive: true);
    });

    test('11. Sincronização 200 seguida de falha de persistência local preserva a foto física', () async {
      final tempDir = await Directory.systemTemp.createTemp('atomic_sync_');
      final receiptsDir = Directory('${tempDir.path}${Platform.pathSeparator}pending_receipts');
      await receiptsDir.create(recursive: true);

      final receiptFile = File('${receiptsDir.path}${Platform.pathSeparator}sync_receipt.jpg');
      await receiptFile.writeAsString('dados-foto-importante');

      bool failStorageOnSyncRemoval = false;

      final service = SyncService(
        fakeApi,
        initialOnline: false,
        fileExistsChecker: (path) => File(path).existsSync(),
        controlledDirectoryResolver: () => receiptsDir.path,
        storageWriter: (key, value) async {
          if (failStorageOnSyncRemoval) return false;
          final prefs = await SharedPreferences.getInstance();
          return await prefs.setString(key, value);
        },
      );

      // Enfileira venda offline
      final ok = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'cli-sync-fail',
        'value': 300,
        'pendingReceiptPath': receiptFile.path,
      });
      expect(ok, isTrue);
      expect(await receiptFile.exists(), isTrue);

      // Simula: API aceita (200), mas a persistência da remoção no aparelho falha
      failStorageOnSyncRemoval = true;
      await service.setOnlineForTesting(true);

      // A API foi chamada
      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      // O arquivo físico NÃO pode ser apagado porque a remoção local falhou!
      expect(await receiptFile.exists(), isTrue,
          reason: 'A foto do comprovante DEVE ser preservada se a persistência da remoção falhar');

      service.dispose();
      await tempDir.delete(recursive: true);
    });

    test('12. Nova pendência online com comprovante sincroniza e exclui foto com sucesso', () async {
      final tempDir = await Directory.systemTemp.createTemp('online_success_');
      final receiptsDir = Directory('${tempDir.path}${Platform.pathSeparator}pending_receipts');
      await receiptsDir.create(recursive: true);

      final file = File('${receiptsDir.path}${Platform.pathSeparator}receipt_ok.jpg');
      await file.writeAsString('comprovante-sucesso');

      final service = SyncService(
        fakeApi,
        initialOnline: true,
        fileExistsChecker: (path) => File(path).existsSync(),
        controlledDirectoryResolver: () => receiptsDir.path,
      );

      final ok = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'cli-success',
        'value': 500,
        'pendingReceiptPath': file.path,
      });

      expect(ok, isTrue);
      expect(fakeApi.registerSaleWithReceiptCalls, 1);
      expect(service.pendingRequests, isEmpty);
      expect(await file.exists(), isFalse, reason: 'Arquivo deve ser excluído após persistência e envio 200');

      service.dispose();
      await tempDir.delete(recursive: true);
    });
  });

  group('Fila, Conectividade, Bateria e Backoff Exponencial', () {
    test('13. Fila vazia não cria timer de retry (economia de bateria)', () async {
      final service = createService(initialOnline: true);
      expect(service.pendingRequests, isEmpty);
      expect(service.retryTimer, isNull);
      service.dispose();
    });

    test('14. Backoff exponencial calcula intervalos corretamente', () {
      expect(SyncService.calculateBackoff(0), 15);
      expect(SyncService.calculateBackoff(1), 30);
      expect(SyncService.calculateBackoff(2), 60);
      expect(SyncService.calculateBackoff(3), 120);
      expect(SyncService.calculateBackoff(4), 120);
      expect(SyncService.calculateBackoff(10), 120);
    });

    test('15. Distingue requisições sincronizáveis de itens legados', () async {
      final service = createService(
        initialOnline: false,
        fileChecker: (path) => path.contains('valid'),
      );

      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-syncable',
        'value': 100,
        'pendingReceiptPath': '/app/data/pending_receipts/valid_receipt.jpg',
      });

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

    test('16. removeLegacyRequests remove apenas legados mantendo sincronizáveis', () async {
      final service = createService(initialOnline: false);

      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c-keep',
        'value': 150,
        'pendingReceiptPath': '/app/data/pending_receipts/receipt.jpg',
      });

      service.pendingRequests.add(SyncRequest(
        id: 'legacy-delete-test',
        type: 'REGISTER_SALE',
        payload: {'clientId': 'c-delete', 'value': 400},
        createdAt: DateTime.now(),
      ));

      expect(service.pendingRequests.length, 2);

      final removed = await service.removeLegacyRequests();
      expect(removed, isTrue);

      expect(service.pendingRequests.length, 1);
      expect(service.pendingRequests.first.payload['clientId'], 'c-keep');
      expect(service.legacyRequests, isEmpty);
      service.dispose();
    });
  });
}
