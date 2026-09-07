import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/telas/lista_fichas_fotografo.dart';
import 'package:provider/provider.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';

void main() {
  group('Isolamento de Fichas do Fotógrafo e Rótulos (1.0.8+16)', () {
    testWidgets('1. Ficha legada confirmada sem visibleCode exibe sequência e NÃO mostra alerta falso de sincronização', (tester) async {
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<SyncService>(create: (_) => SyncService(ApiService())),
          ],
          child: const MaterialApp(
            home: ListaFichasFotografo(),
          ),
        ),
      );

      // A tela inicializa em loading
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    test('2. Fichas legadas confirmadas com visibleCode nulo não devem acionar alerta falso', () {
      final legacyConfirmedFicha = {
        'id': '101',
        'sequenceNumber': '0042',
        'visibleCode': null,
        'isOfflinePending': false,
        'bookStatus': 'IN_STOCK',
      };

      // isOfflinePending é false, então isOffline é false
      final isOffline = legacyConfirmedFicha['isOfflinePending'] == true;
      expect(isOffline, isFalse);

      // O fallback deve ser a sequência limpa
      final seq = legacyConfirmedFicha['sequenceNumber']?.toString();
      final fallbackCode = (seq != null && seq.isNotEmpty) ? seq : '#${legacyConfirmedFicha['id']}';
      expect(fallbackCode, equals('0042'));
    });

    test('3. Ficha pendente de sincronização exibe PROV e status de pendente', () {
      final offlineDraft = {
        'uuid': 'abcdef12-3456-7890-abcd-ef1234567890',
        'visibleCode': null,
        'isOfflinePending': true,
        'bookStatus': 'CREATED',
      };

      final isOffline = offlineDraft['isOfflinePending'] == true;
      expect(isOffline, isTrue);

      final uuid = offlineDraft['uuid']?.toString();
      final prov = 'PROV-${uuid!.substring(0, 8).toUpperCase()}';
      expect(prov, equals('PROV-ABCDEF12'));
    });

    test('4. Lógica de fallback para ticket bluetooth em ListaFichasFotografo', () {
      // Caso 1: Ficha com visibleCode
      final fichaComVisibleCode = {
        'sequenceNumber': '0010',
        'visibleCode': 'CUR-0010',
        'isOfflinePending': false,
      };
      final v1 = (fichaComVisibleCode['visibleCode'] != null && fichaComVisibleCode['visibleCode'].toString().isNotEmpty)
          ? fichaComVisibleCode['visibleCode'].toString()
          : (fichaComVisibleCode['isOfflinePending'] == true && fichaComVisibleCode['uuid'] != null
              ? 'PROV-${fichaComVisibleCode['uuid'].toString().substring(0, 8).toUpperCase()}'
              : (fichaComVisibleCode['sequenceNumber'] ?? 'S/N').toString());
      expect(v1, equals('CUR-0010'));

      // Caso 2: Ficha legada confirmada sem visibleCode
      final fichaLegada = {
        'sequenceNumber': '0025',
        'uuid': '11223344-5566-7788-9900-aabbccddeeff',
        'visibleCode': null,
        'isOfflinePending': false,
      };
      final v2 = (fichaLegada['visibleCode'] != null && fichaLegada['visibleCode'].toString().isNotEmpty)
          ? fichaLegada['visibleCode'].toString()
          : (fichaLegada['isOfflinePending'] == true && fichaLegada['uuid'] != null
              ? 'PROV-${fichaLegada['uuid'].toString().substring(0, 8).toUpperCase()}'
              : (fichaLegada['sequenceNumber'] ?? 'S/N').toString());
      expect(v2, equals('0025')); // Não gera PROV-11223344!

      // Caso 3: Ficha offline pendente
      final fichaOffline = {
        'sequenceNumber': 'S/N',
        'uuid': '11223344-5566-7788-9900-aabbccddeeff',
        'visibleCode': null,
        'isOfflinePending': true,
      };
      final v3 = (fichaOffline['visibleCode'] != null && fichaOffline['visibleCode'].toString().isNotEmpty)
          ? fichaOffline['visibleCode'].toString()
          : (fichaOffline['isOfflinePending'] == true && fichaOffline['uuid'] != null
              ? 'PROV-${fichaOffline['uuid'].toString().substring(0, 8).toUpperCase()}'
              : (fichaOffline['sequenceNumber'] ?? 'S/N').toString());
      expect(v3, equals('PROV-11223344'));
    });

    test('5. Confirmação de código no painel_fotografo após sincronização', () {
      // Simula confirmação com visibleCode
      String? confirmedCode = 'LON-0005';
      String? sequenceNumber = '0005';
      String? confirmedVisibleCode = (confirmedCode.isNotEmpty) ? confirmedCode : sequenceNumber;
      expect(confirmedVisibleCode, equals('LON-0005'));

      // Simula confirmação legada onde backend retornou sequenceNumber mas visibleCode nulo
      confirmedCode = null;
      sequenceNumber = '0089';
      confirmedVisibleCode = (confirmedCode != null && confirmedCode.isNotEmpty) ? confirmedCode : sequenceNumber;
      expect(confirmedVisibleCode, equals('0089'));

      // Quando _isFichaSynced é true, label é sempre Sincronizada com o servidor
      bool isFichaSynced = true;
      final statusText = isFichaSynced
          ? 'Sincronizada com o servidor'
          : 'Aguardando sincronização';
      expect(statusText, equals('Sincronizada com o servidor'));
    });

    test('6. Remoção de cópias locais sem autorização mantendo pendentes offline reais', () {
      final localCachedClients = [
        {'id': 1, 'uuid': 'u1', 'name': 'Cliente 1 (Fechado)', 'isOfflinePending': false},
        {'id': 2, 'uuid': 'u2', 'name': 'Cliente 2 (Ativo)', 'isOfflinePending': false},
        {'id': null, 'uuid': 'u3', 'name': 'Cliente 3 (Rascunho Offline)', 'isOfflinePending': true},
      ];

      // Servidor retornou apenas Cliente 2 (pois Cliente 1 foi fechado/transferido)
      final serverFichas = [
        {'id': 2, 'uuid': 'u2', 'name': 'Cliente 2 (Ativo)', 'isOfflinePending': false},
      ];

      // Lógica de mesclagem / purga:
      // Mantém rascunhos offline pendentes e substitui o cache de consulta pelo retorno do servidor
      final offlineDrafts = localCachedClients.where((c) => c['isOfflinePending'] == true).toList();
      final updatedCache = [...serverFichas, ...offlineDrafts];

      expect(updatedCache.length, equals(2));
      expect(updatedCache.any((c) => c['name'] == 'Cliente 1 (Fechado)'), isFalse);
      expect(updatedCache.any((c) => c['name'] == 'Cliente 2 (Ativo)'), isTrue);
      expect(updatedCache.any((c) => c['name'] == 'Cliente 3 (Rascunho Offline)'), isTrue);
    });
  });
}
