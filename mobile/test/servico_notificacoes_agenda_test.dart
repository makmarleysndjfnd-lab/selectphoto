import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_notificacoes_agenda.dart';
import 'package:timezone/timezone.dart' as tz;

class ScheduledNotificationRecord {
  final int id;
  final String? title;
  final String? body;
  final tz.TZDateTime scheduledDate;
  final AndroidScheduleMode scheduleMode;

  ScheduledNotificationRecord({
    required this.id,
    required this.title,
    required this.body,
    required this.scheduledDate,
    required this.scheduleMode,
  });
}

class FakeNotificationPluginWrapper implements INotificationPluginWrapper {
  bool initializeCalled = false;
  bool allowNotifications = true;
  bool allowExactAlarms = true;
  bool throwOnZonedSchedule = false;
  bool throwOnSecondSchedule = false;
  int zonedScheduleCallCount = 0;
  final List<ScheduledNotificationRecord> scheduled = [];
  final List<int> cancelled = [];

  @override
  Future<bool?> initialize(InitializationSettings settings) async {
    initializeCalled = true;
    return true;
  }

  @override
  Future<bool?> requestNotificationsPermission() async {
    return allowNotifications;
  }

  @override
  Future<bool?> canScheduleExactNotifications() async {
    return allowExactAlarms;
  }

  @override
  Future<bool?> requestExactAlarmsPermission() async {
    return allowExactAlarms;
  }

  @override
  Future<void> zonedSchedule(
    int id,
    String? title,
    String? body,
    tz.TZDateTime scheduledDate,
    NotificationDetails notificationDetails, {
    required AndroidScheduleMode androidScheduleMode,
    required UILocalNotificationDateInterpretation uiLocalNotificationDateInterpretation,
  }) async {
    zonedScheduleCallCount++;
    if (throwOnZonedSchedule) {
      throw Exception('Simulated zonedSchedule exception');
    }
    if (throwOnSecondSchedule && zonedScheduleCallCount == 2) {
      throw Exception('Simulated exception on second schedule');
    }
    scheduled.add(ScheduledNotificationRecord(
      id: id,
      title: title,
      body: body,
      scheduledDate: scheduledDate,
      scheduleMode: androidScheduleMode,
    ));
  }

  @override
  Future<void> cancel(int id) async {
    cancelled.add(id);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ServicoNotificacoesAgenda - Lembretes com Mock e Resiliência', () {
    late FakeNotificationPluginWrapper fakeWrapper;
    late ServicoNotificacoesAgenda servico;

    setUp(() {
      fakeWrapper = FakeNotificationPluginWrapper();
      ServicoNotificacoesAgenda.resetInstance(fakeWrapper);
      servico = ServicoNotificacoesAgenda();
    });

    test('1. Inicialização chama initialize com sucesso', () async {
      final ok = await servico.inicializar();
      expect(ok, isTrue);
      expect(fakeWrapper.initializeCalled, isTrue);
    });

    test('2. Permissão geral negada retorna permissaoNegada', () async {
      fakeWrapper.allowNotifications = false;

      final res = await servico.agendarLembreteCompromisso(
        id: 101,
        titulo: 'Teste Permissão Negada',
        descricao: 'Sem notificações',
        horarioCompromisso: DateTime.now().add(const Duration(hours: 2)),
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.permissaoNegada));
      expect(fakeWrapper.scheduled, isEmpty, reason: 'Nenhum alarme deve ser agendado se a permissão geral for negada');
    });

    test('3. Alarme exato negado realiza fallback para agendadoAproximado', () async {
      fakeWrapper.allowExactAlarms = false;

      final res = await servico.agendarLembreteCompromisso(
        id: 102,
        titulo: 'Reunião Aproximada',
        descricao: 'Sem alarme exato',
        horarioCompromisso: DateTime.now().add(const Duration(hours: 3)),
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoAproximado));
      expect(fakeWrapper.scheduled.isNotEmpty, isTrue);
      expect(
        fakeWrapper.scheduled.first.scheduleMode,
        equals(AndroidScheduleMode.inexactAllowWhileIdle),
        reason: 'Deve usar inexactAllowWhileIdle quando alarme exato for negado',
      );
    });

    test('4. Wrapper lança exceção retorna falha sem registrar como ativo', () async {
      fakeWrapper.throwOnZonedSchedule = true;

      final res = await servico.agendarLembreteCompromisso(
        id: 103,
        titulo: 'Falha no Plugin',
        descricao: 'Erro forçado',
        horarioCompromisso: DateTime.now().add(const Duration(hours: 2)),
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.falha));
      expect(servico.agendadosAtivos, isEmpty, reason: 'Itens com falha não podem entrar como agendados ativos');
    });

    test('5. Falha parcial no segundo lembrete cancela o primeiro imediatamente', () async {
      fakeWrapper.throwOnSecondSchedule = true;

      const int idBase = 104;
      final res = await servico.agendarLembreteCompromisso(
        id: idBase,
        titulo: 'Falha Parcial',
        descricao: 'O 2º agendamento vai falhar',
        horarioCompromisso: DateTime.now().add(const Duration(hours: 2)),
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.falha));
      // Deve ter cancelado o primeiro lembrete (id * 2) que havia sido agendado antes da falha
      expect(fakeWrapper.cancelled, contains(idBase * 2),
          reason: 'Falha no 2º agendamento deve acionar cancelamento do 1º lembrete');
    });

    test('6. Item com falha é retentado na próxima sincronização (retry após falha)', () async {
      fakeWrapper.throwOnZonedSchedule = true;

      final dt = DateTime.now().add(const Duration(hours: 2));
      final items = [
        {'id': 'retry-1', 'title': 'Tentativa Retry', 'dateTime': dt.toIso8601String()}
      ];

      // 1ª sincronização: falha forçada
      final res1 = await servico.sincronizarLembretesLista(items);
      expect(res1.values.single, equals(ResultadoAgendamentoNotificacao.falha));
      expect(servico.agendadosAtivos, isEmpty);

      // 2ª sincronização: recupera normalidade
      fakeWrapper.throwOnZonedSchedule = false;
      final res2 = await servico.sincronizarLembretesLista(items);
      expect(res2.values.single, equals(ResultadoAgendamentoNotificacao.agendadoExato),
          reason: 'Item que falhou anteriormente deve ser retentado na próxima sincronização');
      expect(servico.agendadosAtivos.length, 1);
    });

    test('7. Item aproximado permanece com status agendadoAproximado na sincronização seguinte', () async {
      fakeWrapper.allowExactAlarms = false;

      final dt = DateTime.now().add(const Duration(hours: 2));
      final items = [
        {'id': 'aprox-1', 'title': 'Lembrete Inexato', 'dateTime': dt.toIso8601String()}
      ];

      // 1ª sincronização com alarme exato desabilitado
      final res1 = await servico.sincronizarLembretesLista(items);
      expect(res1.values.single, equals(ResultadoAgendamentoNotificacao.agendadoAproximado));

      // 2ª sincronização idêntica: deve reportar agendadoAproximado, e NÃO agendadoExato
      final res2 = await servico.sincronizarLembretesLista(items);
      expect(res2.values.single, equals(ResultadoAgendamentoNotificacao.agendadoAproximado),
          reason: 'O resultado real (aproximado) deve ser preservado na reconexão/sincronização subsequente');
    });

    test('8. Resolução de fusos IANA injetados America/Sao_Paulo e America/Campo_Grande', () {
      // Injeta America/Sao_Paulo
      ServicoNotificacoesAgenda.resetInstance(
        fakeWrapper,
        () => 'America/Sao_Paulo',
      );
      final servicoSP = ServicoNotificacoesAgenda();
      final fusoSP = servicoSP.resolverFusoAparelho();
      expect(fusoSP.name, equals('America/Sao_Paulo'));

      // Injeta America/Campo_Grande
      ServicoNotificacoesAgenda.resetInstance(
        fakeWrapper,
        () => 'America/Campo_Grande',
      );
      final servicoMS = ServicoNotificacoesAgenda();
      final fusoMS = servicoMS.resolverFusoAparelho();
      expect(fusoMS.name, equals('America/Campo_Grande'));
    });

    test('9. Cancelar lembrete remove ambos os alarmes (30 min e horário exato)', () async {
      const int idBase = 800;
      await servico.cancelarLembrete(idBase);

      expect(fakeWrapper.cancelled, contains(idBase * 2));
      expect(fakeWrapper.cancelled, contains(idBase * 2 + 1));
    });

    test('10. IDs determinísticos são estáveis para o mesmo compromisso', () {
      final idA = ServicoNotificacoesAgenda.gerarIdDeterminante('cliente_123_2026-08-27T14:00:00');
      final idB = ServicoNotificacoesAgenda.gerarIdDeterminante('cliente_123_2026-08-27T14:00:00');
      final idC = ServicoNotificacoesAgenda.gerarIdDeterminante('cliente_999_2026-08-27T14:00:00');

      expect(idA, equals(idB));
      expect(idA, isNot(equals(idC)));
      expect(idA, isPositive);
    });
  });
}
