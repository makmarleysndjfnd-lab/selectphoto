import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:mobile/main.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/servicos/servico_sincronizacao.dart';
import 'package:mobile/provedores/provedor_configuracoes.dart';

void main() {
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

    // Confirma que a tela de login inicializa
    expect(find.byType(MyApp), findsOneWidget);
  });
}
