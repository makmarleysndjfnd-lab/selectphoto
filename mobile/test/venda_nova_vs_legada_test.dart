import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/telas/tela_detalhes_cliente_vendedor.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';

class MockApiServiceForSale extends Fake implements ApiService {
  final List<Map<String, dynamic>> uploadedReceipts = [];

  @override
  Future<void> uploadSaleReceipt(String saleId, String filePath) async {
    uploadedReceipts.add({'saleId': saleId, 'filePath': filePath});
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Widget createClientDetailScreen({
    required Map<String, dynamic> client,
    required ApiService apiService,
  }) {
    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: apiService),
        ChangeNotifierProvider<SyncService>(
          create: (_) => SyncService(apiService, initialOnline: false),
        ),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SellerClientDetailScreen(
            clientData: client,
          ),
        ),
      ),
    );
  }

  group('Diferenciação Estrita: Venda Nova vs Regularização Legada', () {
    testWidgets('1. Venda nova nunca oferece opção de pular o comprovante e exige Confirmar Venda com Comprovante', (tester) async {
      final newClient = {
        'id': 'client_new_1',
        'name': 'Novo Cliente',
        'phone': '67999998888',
        'outcomeStatus': 'PENDING',
        'city': 'Campo Grande',
      };

      final apiMock = MockApiServiceForSale();

      // Ajusta tamanho da tela
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createClientDetailScreen(
        client: newClient,
        apiService: apiMock,
      ));
      await tester.pumpAndSettle();

      // Rola até a seção de confirmação de venda
      final confirmBtnFinder = find.text('Confirmar Venda com Comprovante');
      await tester.scrollUntilVisible(
        confirmBtnFinder,
        200,
        scrollable: find.byType(Scrollable).first,
      );

      // Botão obrigatório presente
      expect(confirmBtnFinder, findsOneWidget);
      expect(find.text('Comprovante de pagamento (obrigatório)'), findsOneWidget);

      // Comprova ausência total da opção de pular ou fechar
      expect(find.text('Pular / Fechar'), findsNothing);
      expect(find.text('Venda Finalizada!'), findsNothing);
      expect(find.text('Enviar Comprovante'), findsNothing);
    });

    test('2. Regularização legada: uploadSaleReceipt continua sendo consumidor ativo para anexar comprovante a vendas antigas', () async {
      final apiMock = MockApiServiceForSale();

      // Simula a anexação de comprovante a uma venda legada sem foto (ID existente no backend)
      await apiMock.uploadSaleReceipt('legacy_sale_123', '/storage/legacy_receipt.jpg');

      expect(apiMock.uploadedReceipts.length, equals(1));
      expect(apiMock.uploadedReceipts.first['saleId'], equals('legacy_sale_123'));
      expect(apiMock.uploadedReceipts.first['filePath'], equals('/storage/legacy_receipt.jpg'));
    });
  });
}
