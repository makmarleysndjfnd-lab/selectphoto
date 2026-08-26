import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/telas/tela_gerenciamento_funcionarios.dart';
import 'package:mobile/servicos/servico_api.dart';

class MockEmployeeApiService extends ApiService {
  MockEmployeeApiService() : super.testInstance();

  @override
  Future<List<dynamic>> getUsers() async => [];

  @override
  Future<List<dynamic>> getTeams() async => [];

  @override
  Future<List<dynamic>> getCars() async => [];

  @override
  Future<dynamic> createUser(dynamic formData) async => {'id': 'new-user-1'};
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    ApiService.setMockInstance(MockEmployeeApiService());
  });

  tearDown(() {
    ApiService.setMockInstance(null);
  });

  testWidgets('EmployeeManagementScreen abre cadastro em tela cheia e protege dados contra descarte',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: EmployeeManagementScreen(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // 1. Toca no FAB 'Novo Funcionário'
    final fab = find.byType(FloatingActionButton);
    expect(fab, findsOneWidget);
    await tester.tap(fab);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // 2. Verifica se a tela cheia abriu com AppBar 'Novo Funcionário'
    expect(find.text('Novo Funcionário'), findsWidgets);
    expect(find.byType(Scaffold), findsWidgets);

    // 3. Preenche um campo (Nome)
    final nameField = find.widgetWithText(TextFormField, 'Nome Completo');
    expect(nameField, findsOneWidget);
    await tester.enterText(nameField, 'Carlos Silva');
    await tester.pump(const Duration(milliseconds: 100));

    // 4. Toca no botão de voltar da AppBar (ou Cancelar)
    final backBtn = find.byIcon(Icons.arrow_back);
    expect(backBtn, findsOneWidget);
    await tester.tap(backBtn);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // 5. Diálogo de confirmação deve aparecer para não perder dados acidentalmente
    expect(find.text('Descartar alterações?'), findsOneWidget);
    expect(find.text('Você tem dados preenchidos. Se sair agora, as informações serão perdidas.'), findsOneWidget);

    // 6. Toca em 'Continuar editando' -> tela de cadastro continua aberta com nome preenchido
    await tester.tap(find.text('Continuar editando'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Descartar alterações?'), findsNothing);
    expect(find.text('Carlos Silva'), findsOneWidget);

    // 7. Toca em Voltar e depois 'Descartar e Sair' -> fecha a tela
    await tester.tap(backBtn);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Descartar e Sair'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // Voltou para a lista de funcionários
    expect(find.text('CPF (Login)'), findsNothing);
    expect(find.text('Nenhum funcionário cadastrado.'), findsOneWidget);
  });
}
