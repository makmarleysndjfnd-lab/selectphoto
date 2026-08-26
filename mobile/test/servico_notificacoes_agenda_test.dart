import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_notificacoes_agenda.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ServicoNotificacoesAgenda - Lembretes com App Fechado', () {
    late ServicoNotificacoesAgenda servico;

    setUp(() {
      servico = ServicoNotificacoesAgenda();
    });

    test('1. Singleton é mantido consistentemente', () {
      final s1 = ServicoNotificacoesAgenda();
      final s2 = ServicoNotificacoesAgenda();
      expect(identical(s1, s2), isTrue);
    });

    test('2. Inicialização carrega timezones e configura sem erro', () async {
      await servico.inicializar();
      expect(servico.notificationsPlugin, isNotNull);
    });

    test('3. Agendar lembrete para compromisso futuro calcula horários', () async {
      final futureTime = DateTime.now().add(const Duration(hours: 2));
      
      // Não deve lançar exceções mesmo sem canal nativo em ambiente headless de teste
      await expectLater(
        servico.agendarLembreteCompromisso(
          id: 1234,
          titulo: 'Visita Cliente João',
          descricao: 'Rua das Flores, 123',
          horarioCompromisso: futureTime,
        ),
        completes,
      );
    });

    test('4. sincronizarLembretesLista processa múltiplos itens da agenda', () async {
      final now = DateTime.now();
      final items = [
        {
          'id': 'appt-1',
          'clientName': 'Cliente A',
          'notes': 'Revisita para fechar venda',
          'dateTime': now.add(const Duration(hours: 3)).toIso8601String(),
        },
        {
          'id': 'appt-2',
          'title': 'Reunião de Equipe',
          'date': now.add(const Duration(days: 1)).toIso8601String(),
          'time': '14:30',
        },
      ];

      await expectLater(
        servico.sincronizarLembretesLista(items),
        completes,
      );
    });

    test('5. Cancelar lembrete conclui sem exceção', () async {
      await expectLater(servico.cancelarLembrete(1234), completes);
    });
  });
}
