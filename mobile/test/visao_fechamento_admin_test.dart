import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/telas/visao_fechamento_admin.dart';

class MockFechamentoApiService extends ApiService {
  int getCustomMetricsCalls = 0;
  List<String>? lastSellerIds;
  String? lastStartDate;
  String? lastEndDate;
  String? lastCity;

  MockFechamentoApiService() : super.testInstance();

  @override
  Future<List<dynamic>> getCompanyUsers() async {
    return [
      {'id': 'seller-1', 'name': 'Vendedor Um', 'role': 'SELLER'},
      {'id': 'seller-2', 'name': 'Vendedor Dois', 'role': 'SELLER'},
    ];
  }

  @override
  Future<List<dynamic>> getAllClients() async {
    return [
      {'id': 'c1', 'city': 'Londrina', 'bookStatus': 'CREATED'},
      {'id': 'c2', 'city': 'Maringá', 'bookStatus': 'CREATED'},
    ];
  }

  @override
  Future<List<dynamic>> getBookBatches() async {
    return [];
  }

  @override
  Future<Map<String, dynamic>> getClosingSummary({
    DateTime? startDate,
    DateTime? endDate,
    String? sellerId,
  }) async {
    return {
      'totalGrossSales': 0,
      'totalCommission': 0,
      'totalAdvances': 0,
      'netToPay': 0,
      'sales': [],
      'advances': [],
    };
  }

  @override
  Future<Map<String, dynamic>> getCustomMetrics({
    List<String>? sellerIds,
    String? startDate,
    String? endDate,
    String? city,
  }) async {
    getCustomMetricsCalls++;
    lastSellerIds = sellerIds;
    lastStartDate = startDate;
    lastEndDate = endDate;
    lastCity = city;

    return {
      'salesCount': 10,
      'nonSalesCount': 2,
      'totalSalesValue': 5000.0,
    };
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockFechamentoApiService mockApi;

  setUp(() {
    mockApi = MockFechamentoApiService();
    ApiService.setMockInstance(mockApi);
  });

  tearDown(() {
    ApiService.setMockInstance(null);
  });

  Widget buildTestableScreen() {
    return const MaterialApp(
      home: VisaoFechamentoAdmin(),
    );
  }

  group('VisaoFechamentoAdmin - Análise de Desempenho e Limpar Pesquisa', () {
    testWidgets('1. Inicialmente exibe mensagem neutra sem disparar getCustomMetrics',
        (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableScreen());
      await tester.pumpAndSettle();

      // Não deve consultar métricas automaticamente na inicialização
      expect(mockApi.getCustomMetricsCalls, 0);

      // Deve mostrar a mensagem neutra
      expect(find.text('Selecione os filtros e toque em Buscar.'), findsOneWidget);
      expect(find.text('Métricas de Vendas x Não Vendas'), findsNothing);
    });

    testWidgets('2. Buscar sem filtros executa busca global e exibe métricas',
        (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableScreen());
      await tester.pumpAndSettle();

      final buscarBtn = find.byKey(const ValueKey('buscar_metricas_btn'));
      expect(buscarBtn, findsOneWidget);

      await tester.tap(buscarBtn);
      await tester.pumpAndSettle();

      // Disparou uma chamada global
      expect(mockApi.getCustomMetricsCalls, 1);
      expect(mockApi.lastCity, isNull);
      expect(mockApi.lastSellerIds, isEmpty);

      // Métricas são exibidas
      expect(find.text('Métricas de Vendas x Não Vendas'), findsOneWidget);
      expect(find.text('Total de Fichas'), findsOneWidget);
      expect(find.text('12'), findsOneWidget); // 10 vendas + 2 não vendas
      expect(find.text('R\$ 5000.00'), findsOneWidget);
    });

    testWidgets('3. Limpar pesquisa remove métricas e volta para mensagem neutra sem requisição automática',
        (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableScreen());
      await tester.pumpAndSettle();

      // Executa busca
      await tester.tap(find.byKey(const ValueKey('buscar_metricas_btn')));
      await tester.pumpAndSettle();
      expect(mockApi.getCustomMetricsCalls, 1);
      expect(find.text('Métricas de Vendas x Não Vendas'), findsOneWidget);

      // Clica em Limpar pesquisa
      final limparBtn = find.byKey(const ValueKey('limpar_pesquisa_btn'));
      expect(limparBtn, findsOneWidget);
      await tester.tap(limparBtn);
      await tester.pumpAndSettle();

      // Métricas removidas e mensagem neutra restaurada
      expect(find.text('Métricas de Vendas x Não Vendas'), findsNothing);
      expect(find.text('Selecione os filtros e toque em Buscar.'), findsOneWidget);

      // NÃO disparou consulta global automática após limpar
      expect(mockApi.getCustomMetricsCalls, 1);
    });

    testWidgets('4. Alterar filtros após pesquisa invalida o resultado anterior',
        (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableScreen());
      await tester.pumpAndSettle();

      // Busca inicial
      await tester.tap(find.byKey(const ValueKey('buscar_metricas_btn')));
      await tester.pumpAndSettle();
      expect(find.text('Métricas de Vendas x Não Vendas'), findsOneWidget);

      // Altera o filtro de cidade
      final cityDropdown = find.byKey(const ValueKey('cidade_finalizada_dropdown'));
      expect(cityDropdown, findsOneWidget);
      await tester.ensureVisible(cityDropdown);
      await tester.tap(cityDropdown);
      await tester.pumpAndSettle();

      final londrinaItem = find.text('Londrina').last;
      await tester.tap(londrinaItem);
      await tester.pumpAndSettle();

      // Resultado antigo NÃO deve permanecer visível após alteração do filtro
      expect(find.text('Métricas de Vendas x Não Vendas'), findsNothing);
      expect(find.text('Selecione os filtros e toque em Buscar.'), findsOneWidget);

      // Toca em buscar com o novo filtro
      await tester.tap(find.byKey(const ValueKey('buscar_metricas_btn')));
      await tester.pumpAndSettle();

      expect(mockApi.getCustomMetricsCalls, 2);
      expect(mockApi.lastCity, 'Londrina');
      expect(find.text('Métricas de Vendas x Não Vendas'), findsOneWidget);
    });
  });
}
