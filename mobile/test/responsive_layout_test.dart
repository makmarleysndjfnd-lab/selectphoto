import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/telas/painel_admin.dart';
import 'package:mobile/telas/painel_vendedor.dart';
import 'package:mobile/telas/tela_detalhes_cliente_vendedor.dart';
import 'package:mobile/telas/tela_gerenciamento_funcionarios.dart';
import 'package:mobile/telas/visao_frota_admin.dart';
import 'package:mobile/telas/visao_rotas_chegada.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';

class MockDioAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.path;
    String jsonStr = '[]';

    if (path.contains('/app/version')) {
      jsonStr = '{"version": "1.0.5+6", "downloadUrl": "https://selectphoto-k1ac.onrender.com/apk", "mandatory": false}';
    } else if (path.contains('/users/company')) {
      jsonStr = '[{"id": "u1", "name": "Vendedor Carlos Lima", "role": "SELLER", "active": true, "email": "carlos@exemplo.com", "phone": "41999999999"}]';
    } else if (path.contains('/users')) {
      jsonStr = '[{"id": "u1", "name": "Carlos Lima", "role": "SELLER", "active": true, "email": "carlos@exemplo.com", "phone": "41999999999"}]';
    } else if (path.contains('/teams')) {
      jsonStr = '[{"id": "t1", "name": "Equipe 1 — Curitiba", "code": "EQP1"}]';
    } else if (path.contains('/fleet') || path.contains('/cars')) {
      jsonStr = '[{"id": "c1", "plate": "BRA2E19", "model": "Fiat Toro Freedom", "status": "AVAILABLE", "currentKm": 45230, "maintenancePending": false}]';
    } else if (path.contains('/clients/by-city') || path.contains('/clients')) {
      jsonStr = '[{"id": "cl1", "name": "Ana Paula Rodrigues", "city": "Curitiba", "event": "Formatura Direito 2026", "bookStatus": "IN_STOCK", "sequenceNumber": "1001"}]';
    } else if (path.contains('/quotes')) {
      jsonStr = '{"texto": "O Senhor é o meu pastor", "autor": "Salmo 23"}';
    } else if (path.contains('/notifications')) {
      jsonStr = '[]';
    }

    return ResponseBody.fromString(
      jsonStr,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late ApiService testApi;
  late SyncService testSync;

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'user_name': 'Administrador Geral da Silva Santos',
      'user_role': 'ADMIN',
      'company_name': 'Empresa Fotografia Alpha Premium LTDA',
      'company_id': 'comp-1',
      'jwt_token': 'fake_jwt_token_for_layout_test',
    });

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('dev.fluttercommunity.plus/connectivity'),
      (MethodCall methodCall) async {
        return ['wifi'];
      },
    );

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockStreamHandler(
      const EventChannel('dev.fluttercommunity.plus/connectivity_status'),
      MockStreamHandler.inline(
        onListen: (args, sink) {
          sink.success(['wifi']);
        },
      ),
    );

    testApi = ApiService();
    testApi.dio.httpClientAdapter = MockDioAdapter();
    testSync = SyncService(testApi, initialOnline: true);
  });

  tearDown(() {
    testSync.dispose();
  });

  Widget buildTestApp({
    required Size size,
    required double textScale,
    required Widget child,
  }) {
    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: testApi),
        ChangeNotifierProvider<SyncService>.value(value: testSync),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData.dark().copyWith(
          scaffoldBackgroundColor: const Color(0xFF0F0C20),
        ),
        home: MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(textScale),
            padding: const EdgeInsets.only(top: 24, bottom: 16),
            viewInsets: EdgeInsets.zero,
          ),
          child: Scaffold(
            body: child,
          ),
        ),
      ),
    );
  }

  group('Testes de Responsividade com Widgets Reais e Mock de Dados (Sem Overflows)', () {
    final resolutions = [
      const Size(360, 800),  // Compact / Narrow
      const Size(393, 873),  // Standard Modern
      const Size(412, 915),  // Large Phone
      const Size(800, 1280), // Tablet
    ];

    final scales = [1.0, 1.3];

    for (final size in resolutions) {
      for (final scale in scales) {
        testWidgets('1. AdminDashboard renderiza sem overflow em ${size.width.toInt()}x${size.height.toInt()} scale $scale', (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);

          await tester.pumpWidget(
            buildTestApp(
              size: size,
              textScale: scale,
              child: const AdminDashboard(),
            ),
          );

          await tester.pumpAndSettle(const Duration(milliseconds: 50));
          expect(tester.takeException(), isNull);
        });

        testWidgets('2. EmployeeManagementScreen renderiza sem overflow em ${size.width.toInt()}x${size.height.toInt()} scale $scale', (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);

          await tester.pumpWidget(
            buildTestApp(
              size: size,
              textScale: scale,
              child: const EmployeeManagementScreen(),
            ),
          );

          await tester.pumpAndSettle(const Duration(milliseconds: 50));
          expect(tester.takeException(), isNull);
        });

        testWidgets('3. FleetAdminView renderiza sem overflow em ${size.width.toInt()}x${size.height.toInt()} scale $scale', (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);

          await tester.pumpWidget(
            buildTestApp(
              size: size,
              textScale: scale,
              child: const FleetAdminView(),
            ),
          );

          await tester.pumpAndSettle(const Duration(milliseconds: 50));
          expect(tester.takeException(), isNull);
        });

        testWidgets('4. VisaoRotasChegada renderiza sem overflow em ${size.width.toInt()}x${size.height.toInt()} scale $scale', (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);

          await tester.pumpWidget(
            buildTestApp(
              size: size,
              textScale: scale,
              child: const VisaoRotasChegada(),
            ),
          );

          await tester.pumpAndSettle(const Duration(milliseconds: 50));
          expect(tester.takeException(), isNull);
        });
      }
    }
  });

  group('Novos Layouts e Responsividade Mobile (1.0.5)', () {
    testWidgets('5. SellerDashboard em 360x800 e escala 1.3: sem overflow, botão Ações abre menu vertical', (tester) async {
      const size = Size(360, 800);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(
        buildTestApp(
          size: size,
          textScale: 1.3,
          child: const SellerDashboard(),
        ),
      );

      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(tester.takeException(), isNull);

      // Botão "Ações" deve estar visível no cabeçalho
      expect(find.text('Ações'), findsOneWidget);

      // Tocar no botão de Ações Rápidas
      await tester.tap(find.text('Ações'));
      await tester.pumpAndSettle();

      // Menu vertical abre exibindo todas as 5 opções em lista
      expect(find.text('Ações Rápidas'), findsOneWidget);
      expect(find.text('Notificações'), findsOneWidget);
      expect(find.text('Transferir / Dividir Capas'), findsOneWidget);
      expect(find.text('Transferir / Dividir Books'), findsOneWidget);
      expect(find.text('Lançar Despesa'), findsOneWidget);
      expect(find.text('Configurações'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('6. SellerClientDetailScreen: profissão e horário separados, cabeçalho compacto com teclado aberto (viewInsets=300), campo de venda >= 56px', (tester) async {
      const size = Size(360, 800);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      final mockClient = {
        'id': 'cli-123',
        'name': 'Mariana Souza dos Santos',
        'city': 'Londrina',
        'sequenceNumber': 'SEQ-9988',
        'profession': 'Advogada Trabalhista',
        'visitTime': '14:30',
        'bookStatus': 'IN_STOCK',
      };

      // 1. Renderiza sem teclado (viewInsets = 0)
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            Provider<ApiService>.value(value: testApi),
            ChangeNotifierProvider<SyncService>.value(value: testSync),
            ChangeNotifierProvider(create: (_) => SettingsProvider()),
          ],
          child: MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(
                size: size,
                textScaler: TextScaler.linear(1.0),
                padding: EdgeInsets.only(top: 24, bottom: 16),
                viewInsets: EdgeInsets.zero,
              ),
              child: SellerClientDetailScreen(clientData: mockClient),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      // Profissão e Horário aparecem em linhas separadas
      expect(find.text('Advogada Trabalhista'), findsOneWidget);
      expect(find.text('Visita: 14:30'), findsOneWidget);

      // 2. Renderiza com teclado aberto (viewInsets.bottom = 300)
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            Provider<ApiService>.value(value: testApi),
            ChangeNotifierProvider<SyncService>.value(value: testSync),
            ChangeNotifierProvider(create: (_) => SettingsProvider()),
          ],
          child: MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(
                size: size,
                textScaler: TextScaler.linear(1.0),
                padding: EdgeInsets.only(top: 24, bottom: 16),
                viewInsets: EdgeInsets.only(bottom: 300),
              ),
              child: SellerClientDetailScreen(clientData: mockClient),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      // Com teclado aberto, o cabeçalho compacto está ativo (nome continua visível)
      expect(find.text('Mariana Souza dos Santos'), findsOneWidget);

      // Campo "Valor da Venda (R$)" continua visível
      expect(find.text(r'Valor da Venda (R$)'), findsOneWidget);

      // Campo possui altura mínima de 56px
      final constrainedBoxFinder = find.ancestor(
        of: find.widgetWithText(TextField, r'Valor da Venda (R$)'),
        matching: find.byType(ConstrainedBox),
      );
      expect(constrainedBoxFinder, findsWidgets);
      final constrainedBox = tester.widget<ConstrainedBox>(constrainedBoxFinder.first);
      expect(constrainedBox.constraints.minHeight, greaterThanOrEqualTo(56.0));

      // Permite rolagem com teclado aberto
      final scrollable = find.byType(SingleChildScrollView);
      expect(scrollable, findsOneWidget);
      await tester.drag(scrollable, const Offset(0, -100));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });
}
