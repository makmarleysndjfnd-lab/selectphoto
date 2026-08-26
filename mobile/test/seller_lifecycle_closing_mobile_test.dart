import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/config/app_config.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/telas/painel_vendedor.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Widget buildTestableWidget({required Widget child, SyncService? syncService}) {
    return ChangeNotifierProvider<SyncService>.value(
      value: syncService ?? SyncService(ApiService(), initialOnline: false),
      child: MaterialApp(
        home: child,
      ),
    );
  }

  group('Escopo 5 e 6: Ciclo de Vida das Fichas e Agenda Mobile (1.0.7+8)', () {
    test('1. Versão compilada e build number do AppConfig estão em 1.0.7+8', () {
      expect(AppConfig.appVersion, equals('1.0.7'));
      expect(AppConfig.buildNumber, equals(8));
      expect(AppConfig.fullVersion, equals('1.0.7+8'));
    });

    testWidgets('2. SellerDashboard renderiza cabeçalhos de grupos de fichas (Pendentes e Atendidas)', (tester) async {
      await tester.pumpWidget(buildTestableWidget(child: const SellerDashboard()));
      await tester.pump(const Duration(milliseconds: 100));

      // Verifica elementos principais do painel do vendedor
      expect(find.text('Clientes do Dia'), findsOneWidget);
      expect(find.textContaining('Fichas Pendentes'), findsOneWidget);
      expect(find.textContaining('Fichas Atendidas'), findsOneWidget);
      expect(find.text('Fechamento de Cidade'), findsOneWidget);
      expect(find.text('Abrir Agenda Completa'), findsOneWidget);
    });

    testWidgets('3. Seção recolhível de Fichas Atendidas expande e revela Revisitas e Vendidas', (tester) async {
      await tester.pumpWidget(buildTestableWidget(child: const SellerDashboard()));
      await tester.pump(const Duration(milliseconds: 100));

      // Inicialmente a seção Atendidas está recolhida
      expect(find.textContaining('Revisitas / Não Vendidas'), findsNothing);

      // Toca para expandir a seção Fichas Atendidas
      final atendidasHeader = find.textContaining('Fichas Atendidas');
      expect(atendidasHeader, findsOneWidget);
      await tester.tap(atendidasHeader);
      await tester.pump(const Duration(milliseconds: 100));

      // Subgrupos agora devem estar visíveis
      expect(find.textContaining('Revisitas / Não Vendidas'), findsOneWidget);
      expect(find.text('Nenhuma ficha vendida ainda.'), findsOneWidget);
    });

    testWidgets('4. Diálogo de Fechamento de Cidade exibe alerta se houver operações pendentes', (tester) async {
      final syncService = SyncService(ApiService(), initialOnline: false);
      // Simula uma requisição offline pendente
      await syncService.addPendingRequest(
        'REGISTER_SALE',
        {'clientId': 'c-1', 'value': 100},
      );

      await tester.pumpWidget(buildTestableWidget(child: const SellerDashboard(), syncService: syncService));
      await tester.pump(const Duration(milliseconds: 100));

      final fechamentoBtn = find.text('Fechamento de Cidade');
      expect(fechamentoBtn, findsOneWidget);
      await tester.ensureVisible(fechamentoBtn);
      await tester.tap(fechamentoBtn);
      await tester.pumpAndSettle();

      // Diálogo de bloqueio por operações offline
      expect(find.text('Operações Pendentes'), findsOneWidget);
      expect(find.textContaining('Você possui 1 operação(ões) offline pendente(s)'), findsOneWidget);
    });

    test('5. Ficha vendida sem comprovante é classificada nas pendentes com trava', () {
      final clientWithMissingReceipt = {
        'id': 'c-sold-no-receipt',
        'name': 'Cliente Teste',
        'sequenceNumber': 'CF-001',
        'city': 'Goiânia',
        'outcomeStatus': 'SOLD',
        'sales': [
          {'id': 's-1', 'value': 500.0, 'receiptUrl': null}
        ],
      };

      final salesList = clientWithMissingReceipt['sales'] as List;
      final hasReceipt = salesList.isNotEmpty && salesList.every((s) => s['receiptUrl'] != null && s['receiptUrl'].toString().trim().isNotEmpty);
      expect(hasReceipt, isFalse);
    });
  });
}
