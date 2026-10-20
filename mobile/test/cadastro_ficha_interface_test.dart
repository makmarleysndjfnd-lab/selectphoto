import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/telas/painel_fotografo.dart';
import 'package:mobile/telas/tela_detalhes_cliente_vendedor.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MockApiService extends ApiService {
  MockApiService() : super.testInstance();

  @override
  Future<String> getDailyQuote() async => 'Frase de teste';

  @override
  Future<List<dynamic>> getClientsByPhotographer() async => [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockApiService testApi;
  late SyncService testSync;

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'lote_city': 'Curitiba',
      'lote_event_name': 'Evento Teste',
      'photographer_code': '0001',
      'lote_sequence_count': 1,
    });
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

  Widget createPhotographerApp() {
    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: testApi),
        ChangeNotifierProvider<SyncService>.value(value: testSync),
        ChangeNotifierProvider(create: (_) => SettingsProvider()),
      ],
      child: const MaterialApp(
        home: Scaffold(
          body: PhotographerDashboard(),
        ),
      ),
    );
  }

  Widget createDetailsApp(Map<String, dynamic> client) {
    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: testApi),
        ChangeNotifierProvider<SyncService>.value(value: testSync),
        ChangeNotifierProvider(create: (_) => SettingsProvider()),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SellerClientDetailScreen(clientData: client),
        ),
      ),
    );
  }

  group('Cadastro de Fichas - Novas Regras de UI e Persistência', () {
    testWidgets(
        '1. Endereço: CEP, Rua, Bairro e Cidade/UF legíveis + Sem Número funcional',
        (tester) async {
      tester.view.physicalSize = const Size(412, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(createPhotographerApp());
      await tester.pumpAndSettle();

      // Campos essenciais de endereço estão presentes
      expect(find.text('CEP'), findsOneWidget);
      expect(find.text('Rua / Logradouro'), findsOneWidget);
      expect(find.text('Bairro'), findsOneWidget);
      expect(find.text('Cidade'), findsOneWidget);
      expect(find.text('UF'), findsOneWidget);
      expect(find.text('Sem número'), findsOneWidget);

      // Clica no checkbox "Sem número"
      await tester.tap(find.text('Sem número'));
      await tester.pumpAndSettle();

      // Campo de número foi preenchido com S/N
      expect(find.text('Número (S/N)'), findsOneWidget);
      expect(find.text('S/N'), findsOneWidget);
    });

    testWidgets(
        '2. Tipo de Imóvel e expansão de condomínio/bloco/apto/complemento sem perda de dados',
        (tester) async {
      tester.view.physicalSize = const Size(412, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(createPhotographerApp());
      await tester.pumpAndSettle();

      // Opções compactas de imóvel visíveis
      expect(find.text('Casa'), findsOneWidget);
      expect(find.text('Apto / Cond.'), findsOneWidget);
      expect(find.text('Outro'), findsOneWidget);

      // Campos adicionais começam recolhidos
      expect(find.text('Nome do condomínio (Opcional)'), findsNothing);

      // Ao selecionar Apartamento / Condomínio, expande os campos
      await tester.tap(find.text('Apto / Cond.'));
      await tester.pumpAndSettle();

      expect(find.text('Nome do condomínio (Opcional)'), findsOneWidget);
      expect(find.text('Bloco / Torre (Opcional)'), findsOneWidget);
      expect(find.text('Apto / Unidade (Opcional)'), findsOneWidget);
      expect(find.text('Complemento adicional (Opcional)'), findsOneWidget);

      // Digita dados no condomínio e bloco
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Nome do condomínio (Opcional)'),
          'Residencial Primavera');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Bloco / Torre (Opcional)'), 'B');
      await tester.pumpAndSettle();

      // Recolhe via botão discreto
      await tester.tap(find.text('Ocultar complemento / condomínio'));
      await tester.pumpAndSettle();

      // Re-expande e valida que os dados NÃO foram apagados
      await tester.tap(find.text('+ Complemento / condomínio / bloco / apartamento'));
      await tester.pumpAndSettle();

      expect(find.text('Residencial Primavera'), findsOneWidget);
      expect(find.text('B'), findsOneWidget);
    });

    testWidgets(
        '3. Cor da Casa: acabamento "No reboco" e "Sem reboco" mutuamente exclusivos e não apagam cor',
        (tester) async {
      tester.view.physicalSize = const Size(412, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(createPhotographerApp());
      await tester.pumpAndSettle();

      expect(find.text('No reboco'), findsOneWidget);
      expect(find.text('Sem reboco'), findsOneWidget);

      // Marca "No reboco"
      await tester.ensureVisible(find.text('No reboco'));
      await tester.tap(find.text('No reboco'));
      await tester.pumpAndSettle();

      // "No reboco" marcado
      Checkbox rebocoCb = tester.widget(find.byWidgetPredicate(
          (w) => w is Checkbox && w.value == true));
      expect(rebocoCb.value, isTrue);

      // Clica em "Sem reboco" -> desmarca "No reboco" automaticamente (mutuamente exclusivo)
      await tester.ensureVisible(find.text('Sem reboco'));
      await tester.tap(find.text('Sem reboco'));
      await tester.pumpAndSettle();

      // Verifica que agora "Sem reboco" está ativo
      final checkboxes = tester.widgetList<Checkbox>(find.byType(Checkbox)).toList();
      final semRebocoChecked = checkboxes.any((c) => c.value == true);
      expect(semRebocoChecked, isTrue);

      // Clica novamente em "Sem reboco" para desmarcar -> ambos ficam desmarcados
      await tester.tap(find.text('Sem reboco'));
      await tester.pumpAndSettle();
    });

    testWidgets(
        '4. Cor do Portão: opção "Sem portão" desabilita visualmente controles sem apagar dados',
        (tester) async {
      tester.view.physicalSize = const Size(412, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(createPhotographerApp());
      await tester.pumpAndSettle();

      expect(find.text('Sem portão'), findsOneWidget);

      // Preenche observação do portão antes
      await tester.ensureVisible(find.widgetWithText(
          TextFormField, 'Observação sobre o Portão (Opcional)'));
      await tester.enterText(
          find.widgetWithText(
              TextFormField, 'Observação sobre o Portão (Opcional)'),
          'Portão de correr');
      await tester.pumpAndSettle();

      // Marca "Sem portão"
      await tester.ensureVisible(find.text('Sem portão'));
      await tester.tap(find.text('Sem portão'));
      await tester.pumpAndSettle();

      // Mostra mensagem clara de que o imóvel foi marcado como sem portão
      expect(
          find.text(
              'Imóvel marcado como sem portão. Cores e observação desabilitadas.'),
          findsOneWidget);

      // Desmarca "Sem portão" -> observação continua preenchida intacta
      await tester.tap(find.text('Sem portão'));
      await tester.pumpAndSettle();

      expect(find.text('Portão de correr'), findsOneWidget);
    });

    testWidgets(
        '5. Crianças Inline: 1º conjunto imediatamente visível, botão "+" adiciona outro conjunto com foco',
        (tester) async {
      tester.view.physicalSize = const Size(412, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(createPhotographerApp());
      await tester.pumpAndSettle();

      // O primeiro conjunto de criança já está visível imediatamente sem modal!
      expect(find.text('Nome da criança 1'), findsOneWidget);
      expect(find.text('Idade (anos)'), findsOneWidget);

      // Preenche a 1ª criança
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Nome da criança 1'), 'Beatriz');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Idade (anos)').first, '6');
      await tester.pumpAndSettle();

      // Toca em "Adicionar outra criança"
      final addBtn = find.text('Adicionar outra criança');
      expect(addBtn, findsOneWidget);
      await tester.ensureVisible(addBtn);
      await tester.tap(addBtn);
      await tester.pumpAndSettle();

      // Agora existe o segundo conjunto
      expect(find.text('Nome da criança 1'), findsOneWidget);
      expect(find.text('Nome da criança 2'), findsOneWidget);
      expect(find.text('Beatriz'), findsOneWidget);

      // Preenche a 2ª criança
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Nome da criança 2'), 'Pedro');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Idade (anos)').last, '1');
      await tester.pumpAndSettle();

      expect(find.text('Pedro'), findsOneWidget);
    });

    testWidgets(
        '6. Tela de Detalhes do Vendedor: exibe Sem Portão, Acabamento e Complemento de endereço',
        (tester) async {
      tester.view.physicalSize = const Size(412, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final clientWithNoGate = {
        'id': 'cli-101',
        'name': 'Carlos Eduardo Silva',
        'phone1': '(41) 98888-7777',
        'street': 'Rua das Flores',
        'number': '450',
        'condo': 'Edifício Solar',
        'block': 'A',
        'apartment': '302',
        'city': 'São José dos Pinhais',
        'state': 'PR',
        'hasNoGate': true,
        'gateColor': 'NO_GATE',
        'houseFinish': 'NO_REBOCO',
        'houseColor': 'Color(0xFF00FF00);NO_REBOCO',
        'bookStatus': 'IN_STOCK',
        'children': [
          {'name': 'Beatriz', 'age': '6'},
          {'name': 'Pedro', 'age': '1'},
        ],
      };

      await tester.pumpWidget(createDetailsApp(clientWithNoGate));
      await tester.pumpAndSettle();

      // Endereço exibe condomínio, bloco e apartamento
      expect(find.textContaining('Edifício Solar'), findsOneWidget);
      expect(find.textContaining('Bl A'), findsOneWidget);
      expect(find.textContaining('Ap 302'), findsOneWidget);

      // Valida acabamento da casa "No reboco"
      expect(find.text('No reboco'), findsOneWidget);

      // Valida tag "Sem portão" prioritária
      expect(find.text('Sem portão'), findsOneWidget);

      // Valida formatação canônica de crianças
      expect(find.textContaining('Beatriz — 6 anos'), findsOneWidget);
      expect(find.textContaining('Pedro — 1 ano'), findsOneWidget);
    });
  });
}
