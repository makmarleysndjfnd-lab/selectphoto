import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/timezone.dart' as tz;
import 'package:mobile/servicos/servico_notificacoes_agenda.dart';

class MockNotificationPluginWrapper implements NotificationPluginWrapper {
  final List<int> scheduledIds = [];
  final List<tz.TZDateTime> scheduledDates = [];
  final List<int> cancelledIds = [];
  bool throwOnSecondSchedule = false;
  bool returnDenyExactAlarms = false;
  bool returnDenyNotifications = false;

  @override
  Future<bool?> initialize(
    InitializationSettings initializationSettings, {
    void Function(NotificationResponse)? onDidReceiveNotificationResponse,
  }) async {
    return true;
  }

  @override
  Future<NotificationAppLaunchDetails?> getNotificationAppLaunchDetails() async {
    return null;
  }

  @override
  Future<void> zonedSchedule(
    int id,
    String? title,
    String? body,
    tz.TZDateTime scheduledDate,
    NotificationDetails notificationDetails, {
    required AndroidScheduleMode androidScheduleMode,
  }) async {
    if (throwOnSecondSchedule && scheduledIds.isNotEmpty) {
      throw Exception('Simulated crash on second notification');
    }
    scheduledIds.add(id);
    scheduledDates.add(scheduledDate);
  }

  @override
  Future<void> cancel(int id) async {
    cancelledIds.add(id);
    scheduledIds.remove(id);
  }

  @override
  Future<void> cancelAll() async {
    cancelledIds.addAll(scheduledIds);
    scheduledIds.clear();
  }

  @override
  Future<bool?> requestNotificationsPermission() async {
    return !returnDenyNotifications;
  }

  @override
  Future<bool?> requestExactAlarmsPermission() async {
    return !returnDenyExactAlarms;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockNotificationPluginWrapper mockWrapper;

  setUp(() {
    mockWrapper = MockNotificationPluginWrapper();
  });

  group('ServicoNotificacoesAgenda - Fusos IANA e Fallback UTC', () {
    test('Provider retorna America/Sao_Paulo com sucesso e isUsingFallback é false', () async {
      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => 'America/Sao_Paulo',
      );
      await servico.inicializar();

      expect(servico.isUsingFallback, isFalse);
      expect(servico.resolvedTimeZoneName, equals('America/Sao_Paulo'));

      final futuro = DateTime.now().add(const Duration(hours: 2));
      final res = await servico.agendarCompromisso(
        id: 1,
        clienteId: 'c1',
        nomeCliente: 'Cliente SP',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoExato));
      expect(mockWrapper.scheduledIds, containsAll([2, 3]));
      expect(servico.agendadosAtivos.containsKey('c1'), isTrue);
    });

    test('Provider retorna America/Campo_Grande com sucesso e isUsingFallback é false', () async {
      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => 'America/Campo_Grande',
      );
      await servico.inicializar();

      expect(servico.isUsingFallback, isFalse);
      expect(servico.resolvedTimeZoneName, equals('America/Campo_Grande'));

      final futuro = DateTime.now().add(const Duration(hours: 2));
      final res = await servico.agendarCompromisso(
        id: 2,
        clienteId: 'c2',
        nomeCliente: 'Cliente CG',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoExato));
      expect(mockWrapper.scheduledIds, containsAll([4, 5]));
    });

    test('Provider retorna identificador inválido e cai no fallback UTC explícito', () async {
      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => 'FusoInexistente/PlanetaMarte',
      );
      await servico.inicializar();

      expect(servico.isUsingFallback, isTrue);
      expect(servico.resolvedTimeZoneName, equals('UTC'));

      final futuro = DateTime.now().add(const Duration(hours: 2));
      final res = await servico.agendarCompromisso(
        id: 3,
        clienteId: 'c3',
        nomeCliente: 'Cliente Fallback',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoExato));
      expect(mockWrapper.scheduledDates.length, equals(2));
      // O instante agendado em UTC coincide exatamente com o instante do evento
      expect(
        mockWrapper.scheduledDates.last.millisecondsSinceEpoch,
        equals(futuro.millisecondsSinceEpoch),
      );
    });

    test('Provider lança exceção e cai no fallback UTC explícito sem travar a agenda', () async {
      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => throw Exception('Native platform channel failed'),
      );
      await servico.inicializar();

      expect(servico.isUsingFallback, isTrue);
      expect(servico.resolvedTimeZoneName, equals('UTC'));

      final futuro = DateTime.now().add(const Duration(hours: 1));
      final res = await servico.agendarCompromisso(
        id: 4,
        clienteId: 'c4',
        nomeCliente: 'Cliente Exception',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoExato));
    });

    test('Nenhum item com falha entra em agendadosAtivos', () async {
      mockWrapper.throwOnSecondSchedule = true;

      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => 'America/Sao_Paulo',
      );

      final futuro = DateTime.now().add(const Duration(hours: 2));
      final res = await servico.agendarCompromisso(
        id: 5,
        clienteId: 'c_fail',
        nomeCliente: 'Cliente Falha',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.falha));
      expect(servico.agendadosAtivos.containsKey('c_fail'), isFalse);
      // Confirma que o primeiro agendamento parcial foi cancelado (rollback)
      expect(mockWrapper.cancelledIds, contains(10));
    });

    test('Permissão de notificação negada não agenda e não entra em agendadosAtivos', () async {
      mockWrapper.returnDenyNotifications = true;

      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => 'America/Sao_Paulo',
      );

      final futuro = DateTime.now().add(const Duration(hours: 2));
      final res = await servico.agendarCompromisso(
        id: 6,
        clienteId: 'c_deny',
        nomeCliente: 'Cliente Negado',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.permissaoNegada));
      expect(servico.agendadosAtivos.containsKey('c_deny'), isFalse);
      expect(mockWrapper.scheduledIds.isEmpty, isTrue);
    });

    test('Alarme exato negado gera agendamento aproximado e mantém status', () async {
      mockWrapper.returnDenyExactAlarms = true;

      final servico = ServicoNotificacoesAgenda(
        wrapper: mockWrapper,
        ianaTimeZoneProvider: () => 'America/Sao_Paulo',
      );

      final futuro = DateTime.now().add(const Duration(hours: 2));
      final res = await servico.agendarCompromisso(
        id: 7,
        clienteId: 'c_approx',
        nomeCliente: 'Cliente Aprox',
        horarioCompromisso: futuro,
      );

      expect(res, equals(ResultadoAgendamentoNotificacao.agendadoAproximado));
      expect(servico.agendadosAtivos['c_approx']?.status,
          equals(ResultadoAgendamentoNotificacao.agendadoAproximado));
    });
  });
}
