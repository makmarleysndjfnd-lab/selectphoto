import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/telas/visao_crediario_admin.dart';

class MockCrediarioFilterApiService extends ApiService {
  String? lastClosingsCompetence;
  String? lastClosingsSellerId;
  String? lastSellersCompetence;

  MockCrediarioFilterApiService() : super.testInstance();

  @override
  Future<Map<String, dynamic>> getCreditSummary({
    DateTime? startDate,
    DateTime? endDate,
    String? dateFilterType,
  }) async {
    return {
      'totalReceivableCents': 0,
      'overdueCents': 0,
      'totalSalesValueCents': 0,
      'totalDownPaymentValueCents': 0,
      'totalFinancedAmountCents': 0,
      'totalPaidPrincipalCents': 0,
      'totalRemainingPrincipalCents': 0,
      'futureEstimatedCommissionCents': 0,
      'totalAgreementsCount': 0,
      'activeAgreementsCount': 0,
      'settledAgreementsCount': 0,
      'overdueAgreementsCount': 0,
      'renegotiatedAgreementsCount': 0,
    };
  }

  @override
  Future<Map<String, dynamic>> getCreditOverview({
    String? sellerId,
    String? startDate,
    String? endDate,
    String? dateFilterType,
  }) async {
    return {
      'totalReceivableCents': 0,
      'overdueCents': 0,
      'totalSalesValueCents': 0,
      'totalDownPaymentValueCents': 0,
      'totalFinancedAmountCents': 0,
      'totalPaidPrincipalCents': 0,
      'totalRemainingPrincipalCents': 0,
      'futureEstimatedCommissionCents': 0,
      'totalAgreementsCount': 0,
      'activeAgreementsCount': 0,
      'settledAgreementsCount': 0,
      'overdueAgreementsCount': 0,
      'renegotiatedAgreementsCount': 0,
    };
  }

  @override
  Future<List<dynamic>> getCreditAgreements({
    String? status,
    String? sellerId,
    String? search,
    int? limit,
    int? offset,
    String? startDate,
    String? endDate,
    String? dateFilterType,
  }) async {
    return [];
  }

  @override
  Future<List<dynamic>> getSellersCreditSummary({
    String? startDate,
    String? endDate,
    String? competence,
    String? context,
  }) async {
    lastSellersCompetence = competence;
    if (competence == '2026-10') {
      return [
        {'sellerId': 'seller-A', 'sellerName': 'Vendedor A'},
      ];
    } else if (competence == '2026-11') {
      return [
        {'sellerId': 'seller-B', 'sellerName': 'Vendedor B'},
      ];
    } else if (competence == '2026-12') {
      return [];
    }
    return [
      {'sellerId': 'seller-A', 'sellerName': 'Vendedor A'},
      {'sellerId': 'seller-B', 'sellerName': 'Vendedor B'},
    ];
  }

  @override
  Future<List<dynamic>> getMonthlyCreditClosings({
    String? competence,
    String? sellerId,
    String? status,
  }) async {
    lastClosingsCompetence = competence;
    lastClosingsSellerId = sellerId;

    if (competence == '2026-10') {
      if (sellerId == 'seller-A' || sellerId == null) {
        return [
          {
            'id': 'closing-oct-A',
            'sellerId': 'seller-A',
            'sellerName': 'Vendedor A',
            'competence': '2026-10',
            'status': 'PAID',
            'netCommission': 150.0,
            'paidAmount': 150.0,
            'remainingBalance': 0.0,
            'totalPrincipalReceived': 1500.0,
            'totalCommission': 150.0,
            'adjustments': 0.0,
            'itemsCount': 2,
          }
        ];
      }
      return [];
    } else if (competence == '2026-11') {
      if (sellerId == 'seller-A') {
        // Vendedor A não possui fechamentos em novembro
        return [];
      }
      // Quando sellerId é null (Todos), retorna o fechamento do Vendedor B
      return [
        {
          'id': 'closing-nov-B',
          'sellerId': 'seller-B',
          'sellerName': 'Vendedor B',
          'competence': '2026-11',
          'status': 'PENDING',
          'netCommission': 200.0,
          'paidAmount': 0.0,
          'remainingBalance': 200.0,
          'totalPrincipalReceived': 2000.0,
          'totalCommission': 200.0,
          'adjustments': 0.0,
          'itemsCount': 1,
        }
      ];
    } else if (competence == '2026-12') {
      return [];
    }

    return [];
  }

  @override
  Future<Map<String, dynamic>> getAsaasStatus() async {
    return {'configured': false};
  }

  @override
  Future<Map<String, dynamic>> getAsaasConfig() async {
    return {'mode': 'SANDBOX'};
  }

  @override
  Future<List<dynamic>> getAsaasDuplicateAlerts({String? status}) async {
    return [];
  }

  @override
  Future<Map<String, dynamic>> getSellerCreditPortfolio({String? sellerId, String? competence}) async {
    return {};
  }

  @override
  Future<List<dynamic>> getCompanyUsers() async {
    return [];
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockCrediarioFilterApiService mockApi;

  setUp(() {
    mockApi = MockCrediarioFilterApiService();
    ApiService.setMockInstance(mockApi);
  });

  tearDown(() {
    ApiService.setMockInstance(null);
  });

  Widget buildTestScreen() {
    return const MaterialApp(
      home: VisaoCrediarioAdmin(),
    );
  }

  group('VisaoCrediarioAdmin - Alinhamento de Filtros e Seleção Mensal', () {
    testWidgets(
      'Mês X com vendedor A selecionado -> Mês Y sem A, mas com B: seletor vai para Todos e fechamentos de B aparecem na mesma atualização',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(buildTestScreen());
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // 1. Navega para a aba de Fechamento Mensal
        final tabFechamento = find.text('Fechamento Mensal (10%)');
        expect(tabFechamento, findsOneWidget);
        await tester.tap(tabFechamento);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // 2. Seleciona Competência '2026-10'
        final compDropdown = tester.widget<DropdownButtonFormField<String>>(
          find.byKey(const Key('dropdown_closing_competence')),
        );
        compDropdown.onChanged!('2026-10');
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // 3. Seleciona Vendedor A
        final sellerDropdown = tester.widget<DropdownButtonFormField<String>>(
          find.byKey(const Key('dropdown_closing_seller')),
        );
        sellerDropdown.onChanged!('seller-A');
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // Verifica que o fechamento do Vendedor A aparece na tela
        expect(find.text('Vendedor A'), findsWidgets);
        expect(find.textContaining('150,00'), findsWidgets);

        // 4. Troca Competência para '2026-11' (onde o Vendedor A NÃO tem movimentação, apenas Vendedor B)
        final compDropdownNov = tester.widget<DropdownButtonFormField<String>>(
          find.byKey(const Key('dropdown_closing_competence')),
        );
        compDropdownNov.onChanged!('2026-11');
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // 5. O seletor de vendedor deve ter sido automaticamente limpo para "Todos os Vendedores",
        // e na MESMA atualização o fechamento do Vendedor B deve ser consultado e exibido!
        expect(mockApi.lastClosingsSellerId, isNull, reason: 'Deve consultar fechamentos com sellerId null (Todos)');
        expect(find.textContaining('Vendedor B'), findsWidgets, reason: 'Fechamento de B deve aparecer na mesma atualização');
        expect(find.textContaining('200,00'), findsWidgets, reason: 'Valor do fechamento de B deve ser exibido');

        // 6. Troca Competência para '2026-09' (onde NINGUÉM tem movimentação)
        final compDropdownSep = tester.widget<DropdownButtonFormField<String>>(
          find.byKey(const Key('dropdown_closing_competence')),
        );
        compDropdownSep.onChanged!('2026-09');
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // Deve exibir o estado vazio verdadeiro
        expect(find.textContaining('Nenhum'), findsOneWidget);
      },
    );
  });
}
