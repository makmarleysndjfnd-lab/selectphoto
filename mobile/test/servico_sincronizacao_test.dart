import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/servicos/servico_api.dart';

class MockApiService extends Fake implements ApiService {
  final List<Map<String, dynamic>> registeredSales = [];
  final List<String> uploadedReceipts = [];
  bool shouldFailSales = false;
  bool shouldHangSales = false;
  Completer<void>? hangCompleter;

  @override
  Future<String> registerSaleWithReceipt(
      Map<String, dynamic> saleData, String receiptFilePath) async {
    if (shouldHangSales && hangCompleter != null) {
      await hangCompleter!.future;
    }
    if (shouldFailSales) {
      throw const ApiRequestException('Servidor indisponível', retryable: true);
    }
    registeredSales.add(saleData);
    uploadedReceipts.add(receiptFilePath);
    return 'server_sale_${registeredSales.length}';
  }

  @override
  Future<void> uploadSaleReceipt(String saleId, String filePath) async {
    uploadedReceipts.add(filePath);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;
  late Directory controlledDir;
  late MockApiService mockApi;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    tempDir = await Directory.systemTemp.createTemp('sync_test_');
    controlledDir = Directory(
        '${tempDir.path}${Platform.pathSeparator}pending_receipts');
    await controlledDir.create(recursive: true);
    mockApi = MockApiService();
  });

  tearDown(() async {
    try {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    } catch (_) {}
  });

  SyncService buildService({
    bool? initialOnline,
    Future<bool> Function(String, String)? storageWriter,
    Future<Directory> Function()? dirProvider,
  }) {
    return SyncService(
      mockApi,
      initialOnline: initialOnline ?? false,
      controlledDirProvider: dirProvider ?? () async => controlledDir,
      storageWriter: storageWriter,
    );
  }

  group('Validação Canônica e Ausência de Estado Global', () {
    test('Caminho canônico válido dentro da raiz controlada é aceito', () async {
      final service = buildService();
      final file = File('${controlledDir.path}${Platform.pathSeparator}receipt1.jpg');
      await file.writeAsString('valid');

      expect(service.isPathInsideControlledDirectory(file.path), isTrue);
    });

    test('Pasta externa também chamada pending_receipts é categoricamente rejeitada', () async {
      final service = buildService();
      final externalDir = Directory('${tempDir.path}${Platform.pathSeparator}external${Platform.pathSeparator}pending_receipts');
      await externalDir.create(recursive: true);
      final file = File('${externalDir.path}${Platform.pathSeparator}photo.jpg');
      await file.writeAsString('external');

      expect(service.isPathInsideControlledDirectory(file.path), isFalse);
    });

    test('pending_receipts_fake é rejeitada', () async {
      final service = buildService();
      final fakeDir = Directory('${tempDir.path}${Platform.pathSeparator}pending_receipts_fake');
      await fakeDir.create(recursive: true);
      final file = File('${fakeDir.path}${Platform.pathSeparator}photo.jpg');
      await file.writeAsString('fake');

      expect(service.isPathInsideControlledDirectory(file.path), isFalse);
    });

    test('Travessia ../ é rejeitada', () async {
      final service = buildService();
      final traversalPath = '${controlledDir.path}${Platform.pathSeparator}..${Platform.pathSeparator}hacked.jpg';
      expect(service.isPathInsideControlledDirectory(traversalPath), isFalse);
    });

    test('Raiz indisponível: arquivo não é aceito nem apagado (falha fechada)', () async {
      // Provedor que lança erro simulando indisponibilidade de armazenamento nativo
      final service = buildService(dirProvider: () async => throw Exception('Disk failure'));
      await Future.delayed(const Duration(milliseconds: 20));

      final file = File('${tempDir.path}${Platform.pathSeparator}some_file.jpg');
      await file.writeAsString('data');

      expect(service.isPathInsideControlledDirectory(file.path), isFalse);

      final queued = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'c_fail_closed',
        'pendingReceiptPath': file.path,
      });

      expect(queued, isFalse);
      expect(file.existsSync(), isTrue); // Arquivo não foi apagado
    });

    test('Nenhum estado global persiste entre instâncias de teste', () async {
      final otherDir = await Directory.systemTemp.createTemp('other_ctrl_');
      final service1 = buildService(dirProvider: () async => controlledDir);
      final service2 = buildService(dirProvider: () async => otherDir);
      await Future.delayed(const Duration(milliseconds: 20));

      final fileInDir1 = File('${controlledDir.path}${Platform.pathSeparator}test1.jpg');
      await fileInDir1.writeAsString('1');

      final fileInDir2 = File('${otherDir.path}${Platform.pathSeparator}test2.jpg');
      await fileInDir2.writeAsString('2');

      expect(service1.isPathInsideControlledDirectory(fileInDir1.path), isTrue);
      expect(service1.isPathInsideControlledDirectory(fileInDir2.path), isFalse);

      expect(service2.isPathInsideControlledDirectory(fileInDir1.path), isFalse);
      expect(service2.isPathInsideControlledDirectory(fileInDir2.path), isTrue);

      await otherDir.delete(recursive: true);
    });

    test('Reinicialização com pendência existente e raiz resolvida antes do sync', () async {
      final receiptFile = File('${controlledDir.path}${Platform.pathSeparator}boot_test.jpg');
      await receiptFile.writeAsString('receipt content');

      // Preenche os SharedPreferences pré-existentes
      final existingReq = [
        {
          'id': 'req_boot_1',
          'type': 'REGISTER_SALE',
          'payload': {
            'clientId': 'client_boot',
            'pendingReceiptPath': receiptFile.path,
          },
          'createdAt': DateTime.now().toIso8601String(),
          'retryCount': 0,
        }
      ];
      SharedPreferences.setMockInitialValues({
        'offline_backups': json.encode(existingReq),
      });

      // Cria o serviço online
      final service = buildService(initialOnline: true);
      // Aguarda sync processar
      await Future.delayed(const Duration(milliseconds: 50));

      expect(mockApi.registeredSales.length, equals(1));
      expect(mockApi.registeredSales.first['clientId'], equals('client_boot'));
      expect(service.pendingRequests.isEmpty, isTrue);
    });
  });

  group('Concorrência e Persistência da Fila Serializada', () {
    test('Duas chamadas simultâneas de addPendingRequest para clientes diferentes preservam as duas entradas', () async {
      final service = buildService(initialOnline: false);

      final file1 = File('${controlledDir.path}${Platform.pathSeparator}photo1.jpg');
      await file1.writeAsString('p1');
      final file2 = File('${controlledDir.path}${Platform.pathSeparator}photo2.jpg');
      await file2.writeAsString('p2');

      // Dispara simultaneamente
      final results = await Future.wait<bool>([
        service.addPendingRequest('REGISTER_SALE', {
          'clientId': 'client_A',
          'pendingReceiptPath': file1.path,
        }),
        service.addPendingRequest('REGISTER_SALE', {
          'clientId': 'client_B',
          'pendingReceiptPath': file2.path,
        }),
      ]);

      expect(results, equals([true, true]));
      expect(service.pendingRequests.length, equals(2));
      final ids = service.pendingRequests.map((r) => r.payload['clientId']).toSet();
      expect(ids, containsAll(['client_A', 'client_B']));
    });

    test('Add concorrente com sync não perde nenhuma pendência', () async {
      mockApi.shouldHangSales = true;
      mockApi.hangCompleter = Completer<void>();

      final file1 = File('${controlledDir.path}${Platform.pathSeparator}sync1.jpg');
      await file1.writeAsString('s1');
      final file2 = File('${controlledDir.path}${Platform.pathSeparator}sync2.jpg');
      await file2.writeAsString('s2');

      final service = buildService(initialOnline: false);

      // Adiciona o primeiro item offline
      await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client_1',
        'pendingReceiptPath': file1.path,
      });

      // Configura a API para travar na primeira chamada
      mockApi.shouldHangSales = true;
      mockApi.hangCompleter = Completer<void>();

      // Habilita online sem disparar sync síncrono aqui
      await service.setOnlineForTesting(true, triggerSync: false);

      // Inicia o sync em background (ficará aguardando no hangCompleter)
      final syncFuture = service.syncAllPending();

      // Dá um microtick para garantir que o sync entrou na critical section
      await Future<void>.delayed(const Duration(milliseconds: 10));

      // Durante o sync travado, dispara o addPendingRequest concorrente
      final addFuture = service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client_2',
        'pendingReceiptPath': file2.path,
      });

      // Libera a API
      mockApi.hangCompleter!.complete();

      await Future.wait<dynamic>([syncFuture, addFuture]);

      // Ambas as operações devem ser concluídas e o segundo item não pode ser perdido
      // (ele foi adicionado de forma serializada)
      final allClients = mockApi.registeredSales
          .map((s) => s['clientId'])
          .followedBy(service.pendingRequests.map((r) => r.payload['clientId']))
          .toList();

      expect(allClients, containsAll(['client_1', 'client_2']));
    });

    test('Persistência retornando false: estado em memória é preservado intacto', () async {
      final file = File('${controlledDir.path}${Platform.pathSeparator}photo_fail.jpg');
      await file.writeAsString('pf');

      // Writer que simula falha ao gravar
      final service = buildService(
        initialOnline: false,
        storageWriter: (key, val) async => false,
      );

      final success = await service.addPendingRequest('REGISTER_SALE', {
        'clientId': 'client_fail',
        'pendingReceiptPath': file.path,
      });

      expect(success, isFalse);
      expect(service.pendingRequests.isEmpty, isTrue);
      expect(file.existsSync(), isTrue); // Arquivo não é deletado
    });

    test('100 chamadas simultâneas de generateUuid geram 100 UUIDs v4 únicos', () {
      final uuids = List.generate(100, (_) => SyncService.generateUuid());
      expect(uuids.toSet().length, equals(100));
      for (final u in uuids) {
        expect(
          RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
              .hasMatch(u),
          isTrue,
        );
      }
    });
  });
}
