import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/main.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';
import 'package:mobile/telas/tela_configuracoes.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('App smoke test - inicialização dos provedores e tela inicial', (WidgetTester tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => SettingsProvider()),
          ProxyProvider<SettingsProvider, ApiService>(
            update: (context, settings, previous) {
              final apiService = previous ?? ApiService();
              apiService.updateBaseUrl(settings.serverUrl);
              return apiService;
            },
          ),
          ChangeNotifierProxyProvider<ApiService, SyncService>(
            create: (context) => SyncService(context.read<ApiService>()),
            update: (context, apiService, previous) => previous ?? SyncService(apiService),
          ),
        ],
        child: const MyApp(),
      ),
    );

    // Renderiza o primeiro frame e aguarda ciclo
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Confirma que a árvore inicializa com sucesso
    expect(find.byType(MyApp), findsOneWidget);
  });

  group('SettingsScreen - Controle de Acesso a ROI e Parâmetros (1.0.5)', () {
    Widget buildSettingsScreen({bool canManageRoi = false, bool isFotografo = false}) {
      return MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => SettingsProvider()),
        ],
        child: MaterialApp(
          home: SettingsScreen(
            canManageRoi: canManageRoi,
            isFotografo: isFotografo,
          ),
        ),
      );
    }

    testWidgets('Admin (canManageRoi: true) visualiza os parâmetros de ROI', (WidgetTester tester) async {
      await tester.pumpWidget(buildSettingsScreen(canManageRoi: true));
      await tester.pumpAndSettle();

      expect(find.text('Parâmetros Base da Calculadora de ROI'), findsOneWidget);
      expect(find.text('Hospedagem (R\$/p/dia)'), findsOneWidget);
    });

    testWidgets('Vendedor (canManageRoi: false) NÃO visualiza os parâmetros de ROI', (WidgetTester tester) async {
      await tester.pumpWidget(buildSettingsScreen(canManageRoi: false, isFotografo: false));
      await tester.pumpAndSettle();

      expect(find.text('Parâmetros Base da Calculadora de ROI'), findsNothing);
      expect(find.text('Hospedagem (R\$/p/dia)'), findsNothing);
    });

    testWidgets('Fotógrafo (canManageRoi: false, isFotografo: true) NÃO visualiza ROI', (WidgetTester tester) async {
      await tester.pumpWidget(buildSettingsScreen(canManageRoi: false, isFotografo: true));
      await tester.pumpAndSettle();

      expect(find.text('Parâmetros Base da Calculadora de ROI'), findsNothing);
      expect(find.text('Hospedagem (R\$/p/dia)'), findsNothing);
    });

    testWidgets('Padrão fechado: const SettingsScreen() sem argumentos NÃO visualiza ROI', (WidgetTester tester) async {
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider(create: (_) => SettingsProvider()),
          ],
          child: const MaterialApp(
            home: SettingsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Parâmetros Base da Calculadora de ROI'), findsNothing);
    });

    testWidgets('Fotógrafo (isFotografo: true) visualiza Configurar Impressora e não Baixar Backup', (WidgetTester tester) async {
      await tester.pumpWidget(buildSettingsScreen(isFotografo: true));
      await tester.pumpAndSettle();

      expect(find.text('Configurar Impressora'), findsOneWidget);
      expect(find.text('Baixar Backup (JSON)'), findsNothing);
    });

    testWidgets('Não-fotógrafo (isFotografo: false) visualiza Baixar Backup e não Configurar Impressora', (WidgetTester tester) async {
      await tester.pumpWidget(buildSettingsScreen(isFotografo: false));
      await tester.pumpAndSettle();

      expect(find.text('Baixar Backup (JSON)'), findsOneWidget);
      expect(find.text('Configurar Impressora'), findsNothing);
    });
  });
}
