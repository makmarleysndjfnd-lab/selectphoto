import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/main.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';

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
}
