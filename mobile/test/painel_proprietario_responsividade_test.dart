import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/telas/painel_proprietario_empresas.dart';
import 'package:mobile/telas/tela_login.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('pt_BR', null);
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'jwt_token': 'fake_jwt_token_superadmin',
      'user_role': 'SUPER_ADMIN',
      'user_name': 'Proprietário Lumora',
    });
  });

  Widget buildTestableWidget({
    required Size screenSize,
    double textScaleFactor = 1.0,
  }) {
    return MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: screenSize,
          textScaler: TextScaler.linear(textScaleFactor),
        ),
        child: const PainelProprietarioEmpresas(),
      ),
    );
  }

  group('Painel do Proprietário — Responsividade, Navegação e Logout', () {
    testWidgets(
      '1. Renderização responsiva em 320px, 360px e 412px sem RenderFlex overflow',
      (tester) async {
        final screenSizes = [
          const Size(320, 640),
          const Size(360, 800),
          const Size(412, 915),
        ];

        for (final size in screenSizes) {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);

          await tester.pumpWidget(buildTestableWidget(screenSize: size, textScaleFactor: 1.0));
          await tester.pumpAndSettle();

          // Verificar que os elementos chave renderizam
          expect(find.text('Central do Proprietário'), findsOneWidget);
          expect(find.text('Sair'), findsOneWidget);
          expect(find.text('Faturamento'), findsOneWidget);
          expect(find.text('APIs'), findsOneWidget);
          expect(find.text('Suporte'), findsOneWidget);

          // Testar com text scale elevado (1.5x)
          await tester.pumpWidget(buildTestableWidget(screenSize: size, textScaleFactor: 1.5));
          await tester.pumpAndSettle();

          // Sem exceções de overflow capturadas pelo FlutterError
          expect(tester.takeException(), isNull, reason: 'Não deve haver overflow em $size com escala 1.5x');
        }
      },
    );

    testWidgets(
      '2. Botão Nova Empresa aparece exclusivamente na aba Empresas',
      (tester) async {
        tester.view.physicalSize = const Size(360, 800);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(buildTestableWidget(screenSize: const Size(360, 800)));
        await tester.pumpAndSettle();

        // Aba 0: Empresas -> FAB Nova Empresa visível
        expect(find.text('Nova Empresa'), findsOneWidget);

        // Trocar para Aba 1: Auditoria
        await tester.tap(find.text('Auditoria'));
        await tester.pumpAndSettle();

        // FAB Nova Empresa DEVE desaparecer
        expect(find.text('Nova Empresa'), findsNothing);

        // Trocar para Aba 2: Capacidades
        await tester.tap(find.text('Capacidades'));
        await tester.pumpAndSettle();

        // FAB Nova Empresa DEVE permanecer invisível
        expect(find.text('Nova Empresa'), findsNothing);

        // Voltar para Aba 0: Empresas
        await tester.tap(find.text('Empresas'));
        await tester.pumpAndSettle();

        // FAB Nova Empresa DEVE reaparecer
        expect(find.text('Nova Empresa'), findsOneWidget);
      },
    );

    testWidgets(
      '3. Ação Sair da Conta abre diálogo e limpa credenciais com segurança',
      (tester) async {
        tester.view.physicalSize = const Size(360, 800);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(buildTestableWidget(screenSize: const Size(360, 800)));
        await tester.pumpAndSettle();

        // Tocar em Sair
        await tester.tap(find.text('Sair'));
        await tester.pumpAndSettle();

        // Diálogo de confirmação
        expect(find.text('Sair da Conta'), findsWidgets);
        expect(
          find.textContaining('O banco offline e as fichas locais são preservados integralmente'),
          findsOneWidget,
        );

        // Confirmar saída
        final botaoConfirmar = find.widgetWithText(ElevatedButton, 'Sair da Conta');
        expect(botaoConfirmar, findsOneWidget);
        await tester.tap(botaoConfirmar);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // SharedPreferences: jwt_token e user_role devem ter sido removidos
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('jwt_token'), isNull);
        expect(prefs.getString('user_role'), isNull);

        // Deve navegar para LoginScreen
        expect(find.byType(LoginScreen), findsOneWidget);
      },
    );

    testWidgets(
      '4. Chips de classificação: Operacionais, Testes / Demo e Todas',
      (tester) async {
        tester.view.physicalSize = const Size(412, 915);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(buildTestableWidget(screenSize: const Size(412, 915)));
        await tester.pumpAndSettle();

        expect(find.text('Operacionais'), findsOneWidget);
        expect(find.text('Testes / Demo'), findsOneWidget);
        expect(find.text('Todas as Empresas'), findsOneWidget);
      },
    );
  });
}
