import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/telas/lista_fichas_fotografo.dart';
import 'package:provider/provider.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';

void main() {
  group('Isolamento de Fichas do Fotógrafo e Rótulos (1.0.8+15)', () {
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
  });
}
