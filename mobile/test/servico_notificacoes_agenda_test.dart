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
  bool requestNotificationsPermissionCalled = false;
  bool allowExactAlarms = true;
  final List<ScheduledNotificationRecord> scheduled = [];
  final List<int> cancelled = [];

  @override
  Future<bool?> initialize(InitializationSettings settings) async {
    initializeCalled = true;
    return true;
  }

  @override
  Future<bool?> requestNotificationsPermission() async {
    requestNotificationsPermissionCalled = true;
    return true;
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

  group('ServicoNotificacoesAgenda - Lembretes com Mock e Sem LateInitializationError', () {
    late FakeNotificationPluginWrapper fakeWrapper;
    late ServicoNotificacoesAgenda servico;

    setUp(() {
      fakeWrapper = FakeNotificationPluginWrapper();
      ServicoNotificacoesAgenda.resetInstance(fakeWrapper);
      servico = ServicoNotificacoesAgenda();
    });

    test('1. Inicialização chama initialize e solicita permissão de notificação', () async {
      final ok = await servico.inicializar();
      expect(ok, isTrue);
      expect(fakeWrapper.initializeCalled, isTrue);
      expect(fakeWrapper.requestNotificationsPermissionCalled, isTrue);
    });

    test('2. Agendar lembrete futuro agenda 30 min antes e horário exato com IDs determinísticos', () async {
      final agora = DateTime.now();
      final horarioCompromisso = agora.add(const Duration(hours: 2));

      const int idBase = 500;
      final res = await servico.agendarLembreteCompromisso(
        id: idBase,
        titulo: 'Visita Cliente Maria',
        descricao: 'Rua das Palmeiras, 45',
        horarioCompromisso: horarioCompromisso,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoExato));
      expect(fakeWrapper.scheduled.length, equals(2), reason: 'Deve agendar 2 lembretes');

      final lembrete30Min = fakeWrapper.scheduled[0];
      final lembreteExato = fakeWrapper.scheduled[1];

      // Verificação dos IDs determinísticos (id * 2 e id * 2 + 1)
      expect(lembrete30Min.id, equals(idBase * 2));
      expect(lembreteExato.id, equals(idBase * 2 + 1));

      // Verificação do modo de agendamento exato
      expect(lembrete30Min.scheduleMode, equals(AndroidScheduleMode.exactAllowWhileIdle));
      expect(lembreteExato.scheduleMode, equals(AndroidScheduleMode.exactAllowWhileIdle));

      // Verificação do conteúdo
      expect(lembrete30Min.title, contains('Lembrete em 30 min'));
      expect(lembreteExato.title, contains('Agendamento Agora'));
    });

    test('3. Fallback para agendadoAproximado quando alarme exato for negado', () async {
      fakeWrapper.allowExactAlarms = false;

      final horario = DateTime.now().add(const Duration(hours: 3));
      final res = await servico.agendarLembreteCompromisso(
        id: 700,
        titulo: 'Reunião de Fechamento',
        descricao: 'Reunião semanal',
        horarioCompromisso: horario,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoAproximado));
      expect(fakeWrapper.scheduled.isNotEmpty, isTrue);
      expect(
        fakeWrapper.scheduled.first.scheduleMode,
        equals(AndroidScheduleMode.inexactAllowWhileIdle),
        reason: 'Deve usar inexactAllowWhileIdle como fallback seguro',
      );
    });

    test('4. Cancelar lembrete remove ambos os alarmes (30 min e exato)', () async {
      const int idBase = 800;
      await servico.cancelarLembrete(idBase);

      expect(fakeWrapper.cancelled, contains(idBase * 2));
      expect(fakeWrapper.cancelled, contains(idBase * 2 + 1));
    });

    test('5. Sincronizar agenda cancela itens removidos e não duplica agendamentos existentes', () async {
      final now = DateTime.now();
      final dt1 = now.add(const Duration(hours: 2));
      final dt2 = now.add(const Duration(hours: 4));

      final items1 = [
        {
          'id': 'appt-001',
          'title': 'Cliente Carlos',
          'dateTime': dt1.toIso8601String(),
        },
        {
          'id': 'appt-002',
          'title': 'Cliente Ana',
          'dateTime': dt2.toIso8601String(),
        },
      ];

      // 1ª sincronização: deve agendar os dois itens
      final res1 = await servico.sincronizarLembretesLista(items1);
      expect(res1.length, equals(2));
      expect(fakeWrapper.scheduled.length, equals(4)); // 2 lembretes cada

      final scheduledCountAfterFirst = fakeWrapper.scheduled.length;

      // 2ª sincronização idêntica: NÃO deve reinvocar zonedSchedule para os mesmos itens
      final res2 = await servico.sincronizarLembretesLista(items1);
      expect(res2.length, equals(2));
      expect(fakeWrapper.scheduled.length, equals(scheduledCountAfterFirst),
          reason: 'Não pode reagendar itens idênticos duplicando alarmes');

      // 3ª sincronização removendo appt-002: deve cancelar o alarme de appt-002
      final items2 = [
        {
          'id': 'appt-001',
          'title': 'Cliente Carlos',
          'dateTime': dt1.toIso8601String(),
        },
      ];
      await servico.sincronizarLembretesLista(items2);
      expect(fakeWrapper.cancelled.isNotEmpty, isTrue,
          reason: 'Deve cancelar compromisso que foi removido da agenda');
    });

    test('6. IDs determinísticos são estáveis para o mesmo compromisso', () {
      final idA = ServicoNotificacoesAgenda.gerarIdDeterminante('cliente_123_2026-08-27T14:00:00');
      final idB = ServicoNotificacoesAgenda.gerarIdDeterminante('cliente_123_2026-08-27T14:00:00');
      final idC = ServicoNotificacoesAgenda.gerarIdDeterminante('cliente_999_2026-08-27T14:00:00');

      expect(idA, equals(idB));
      expect(idA, isNot(equals(idC)));
      expect(idA, isPositive);
    });
  });
}
