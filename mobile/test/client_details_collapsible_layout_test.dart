import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/telas/tela_detalhes_cliente_vendedor.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MockApiService extends ApiService {
  MockApiService() : super.testInstance();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockApiService testApi;
  late SyncService testSync;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    testApi = MockApiService();
    testSync = SyncService(
      testApi,
      initialOnline: true,
      fileExistsChecker: (path) => true,
    );
  });

  tearDown(() {
    testSync.dispose();
  });

  final mockClient = {
    'id': 'cli-999',
    'name': 'Mariana Souza dos Santos',
    'phone1': '(41) 99999-1111',
    'phone2': '(41) 98888-2222',
    'city': 'Curitiba',
    'street': 'Rua XV de Novembro',
    'number': '1500',
    'referencePoint': 'Próximo à Praça Osório',
    'sequenceNumber': 'SEQ-12345',
    'profession': 'Engenheira Civil',
    'visitTime': '15:00',
    'houseColor': 'Color(0xFF00FF00)',
    'gateColor': 'Color(0xFF0000FF)',
    'bookStatus': 'IN_STOCK',
  };

  Widget buildTestScreen(Size size, {double textScale = 1.0}) {
    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: testApi),
        ChangeNotifierProvider<SyncService>.value(value: testSync),
        ChangeNotifierProvider(create: (_) => SettingsProvider()),
      ],
      child: MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(textScale),
            padding: const EdgeInsets.only(top: 24, bottom: 16),
            viewInsets: EdgeInsets.zero,
          ),
          child: SellerClientDetailScreen(clientData: mockClient),
        ),
      ),
    );
  }

  group('Layout Recolhível da Ficha do Cliente (Aumento do Espaço Útil)', () {
    for (final size in [
      const Size(360, 800), // Compacto
      const Size(393, 873), // Padrão Pixel 7
      const Size(412, 915), // Grande
    ]) {
      testWidgets('Responsividade e recolhimento em ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(buildTestScreen(size));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // 1. Inicialmente os detalhes estão abertos: botão mostra "Ocultar"
        final toggleBtn = find.byKey(const ValueKey('toggle_client_details_button'));
        expect(toggleBtn, findsOneWidget);
        expect(find.text('Ocultar'), findsOneWidget);

        // Informações estendidas visíveis inicialmente
        expect(find.text('Engenheira Civil'), findsOneWidget);
        expect(find.text('Visita: 15:00'), findsOneWidget);

        // Dados essenciais visíveis
        expect(find.text('(41) 99999-1111'), findsOneWidget);
        expect(find.text('(41) 98888-2222'), findsOneWidget);
        expect(find.text('Ref: Próximo à Praça Osório'), findsOneWidget);

        // 2. Alvo de toque do botão de alternância possui no mínimo 48x48px
        final btnSize = tester.getSize(toggleBtn);
        expect(btnSize.height, greaterThanOrEqualTo(48.0));
        expect(btnSize.width, greaterThanOrEqualTo(48.0));

        // 3. Toca no botão para recolher manualmente
        await tester.tap(toggleBtn);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // Texto do botão mudou para "Ver detalhes"
        expect(find.text('Ver detalhes'), findsOneWidget);
        expect(find.text('Ocultar'), findsNothing);

        // DADOS ESSENCIAIS CONTINUAM VISÍVEIS MESMO QUANDO RECOLHIDA:
        // telefone principal, secundário, WhatsApp, endereço e ponto de referência
        expect(find.text('(41) 99999-1111'), findsOneWidget);
        expect(find.text('(41) 98888-2222'), findsOneWidget);
        expect(find.text('Ref: Próximo à Praça Osório'), findsOneWidget);

        // 4. Toca no botão para expandir novamente
        await tester.tap(toggleBtn);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Ocultar'), findsOneWidget);

        // 5. Tocar na aba 'Não Venda' deve auto-recolher os detalhes para maximizar a área da operação
        final naoVendaTab = find.text('Não Venda');
        expect(naoVendaTab, findsOneWidget);
        await tester.tap(naoVendaTab);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull, reason: 'Erro na aba Não Venda');

        // Detalhes foram recolhidos automaticamente
        expect(find.text('Ver detalhes'), findsOneWidget);
        expect(find.text('Ocultar'), findsNothing);

        // 6. Tocar na aba 'Agendar' mantém ou aciona o recolhimento
        final agendarTab = find.text('Agendar');
        expect(agendarTab, findsOneWidget);
        await tester.tap(agendarTab);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull);
        expect(find.text('Ver detalhes'), findsOneWidget);

        // 7. Tocar na aba 'Venda' volta para Venda com espaço otimizado
        final vendaTab = find.text('Venda');
        expect(vendaTab, findsOneWidget);
        await tester.tap(vendaTab);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Ver detalhes'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('Sem overflow em tela compacta 360x800 com escala de texto ampliada 1.3', (tester) async {
      const size = Size(360, 800);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(buildTestScreen(size, textScale: 1.3));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'Não pode haver overflow em 360x800 com escala 1.3');

      final toggleBtn = find.byKey(const ValueKey('toggle_client_details_button'));
      expect(toggleBtn, findsOneWidget);

      // Alterna recolhimento com escala 1.3
      await tester.tap(toggleBtn);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(tester.takeException(), isNull, reason: 'Não pode haver overflow ao recolher em 360x800 escala 1.3');
      expect(find.text('Ver detalhes'), findsOneWidget);
      expect(find.text('(41) 99999-1111'), findsOneWidget);
      expect(find.text('(41) 98888-2222'), findsOneWidget);
      expect(find.text('Ref: Próximo à Praça Osório'), findsOneWidget);
    });
  });
}
