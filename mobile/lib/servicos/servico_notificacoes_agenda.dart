import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

const MethodChannel _nativeTimezoneChannel =
    MethodChannel('com.selectphoto/native_timezone');

/// Obtém o identificador IANA real fornecido nativamente pelo Android.
Future<String?> obterFusoIanaNativo() async {
  try {
    final tzId = await _nativeTimezoneChannel
        .invokeMethod<String>('getNativeTimeZone');
    return tzId;
  } catch (e) {
    if (kDebugMode) {
      print('[ServicoNotificacoesAgenda] Erro ao obter fuso IANA nativo: $e');
    }
    return null;
  }
}

/// Interface injetável para isolamento do FlutterLocalNotificationsPlugin em testes
abstract class NotificationPluginWrapper {
  Future<bool?> initialize(
    InitializationSettings initializationSettings, {
    void Function(NotificationResponse)? onDidReceiveNotificationResponse,
  });

  Future<NotificationAppLaunchDetails?> getNotificationAppLaunchDetails();

  Future<void> zonedSchedule(
    int id,
    String? title,
    String? body,
    tz.TZDateTime scheduledDate,
    NotificationDetails notificationDetails, {
    required AndroidScheduleMode androidScheduleMode,
  });

  Future<void> cancel(int id);
  Future<void> cancelAll();
  Future<bool?> requestNotificationsPermission();
  Future<bool?> requestExactAlarmsPermission();
}

class DefaultNotificationPluginWrapper implements NotificationPluginWrapper {
  final FlutterLocalNotificationsPlugin _plugin;

  DefaultNotificationPluginWrapper(this._plugin);

  @override
  Future<bool?> initialize(
    InitializationSettings initializationSettings, {
    void Function(NotificationResponse)? onDidReceiveNotificationResponse,
  }) {
    return _plugin.initialize(
      initializationSettings,
      onDidReceiveNotificationResponse: onDidReceiveNotificationResponse,
    );
  }

  @override
  Future<NotificationAppLaunchDetails?> getNotificationAppLaunchDetails() {
    return _plugin.getNotificationAppLaunchDetails();
  }

  @override
  Future<void> zonedSchedule(
    int id,
    String? title,
    String? body,
    tz.TZDateTime scheduledDate,
    NotificationDetails notificationDetails, {
    required AndroidScheduleMode androidScheduleMode,
  }) {
    return _plugin.zonedSchedule(
      id,
      title,
      body,
      scheduledDate,
      notificationDetails,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      androidScheduleMode: androidScheduleMode,
    );
  }

  @override
  Future<void> cancel(int id) => _plugin.cancel(id);

  @override
  Future<void> cancelAll() => _plugin.cancelAll();

  @override
  Future<bool?> requestNotificationsPermission() async {
    final androidImpl = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return await androidImpl?.requestNotificationsPermission();
  }

  @override
  Future<bool?> requestExactAlarmsPermission() async {
    final androidImpl = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return await androidImpl?.requestExactAlarmsPermission();
  }
}

enum ResultadoAgendamentoNotificacao {
  agendadoExato,
  agendadoAproximado,
  permissaoNegada,
  horarioPassado,
  falha,
}

class ItemAgendadoAtivo {
  final int notificationId;
  final String clienteId;
  final String titulo;
  final DateTime horarioCompromisso;
  ResultadoAgendamentoNotificacao status;

  ItemAgendadoAtivo({
    required this.notificationId,
    required this.clienteId,
    required this.titulo,
    required this.horarioCompromisso,
    required this.status,
  });
}

class ServicoNotificacoesAgenda {
  static final ServicoNotificacoesAgenda _instancia =
      ServicoNotificacoesAgenda._interno();

  factory ServicoNotificacoesAgenda({
    NotificationPluginWrapper? wrapper,
    FutureOr<String?> Function()? ianaTimeZoneProvider,
  }) {
    if (wrapper != null || ianaTimeZoneProvider != null) {
      return ServicoNotificacoesAgenda._comWrapper(wrapper, ianaTimeZoneProvider);
    }
    return _instancia;
  }

  ServicoNotificacoesAgenda._interno()
      : _wrapper = DefaultNotificationPluginWrapper(
            FlutterLocalNotificationsPlugin()),
        _ianaTimeZoneProvider = null;

  ServicoNotificacoesAgenda._comWrapper(
    NotificationPluginWrapper? wrapper,
    FutureOr<String?> Function()? ianaTimeZoneProvider,
  )   : _wrapper = wrapper ??
            DefaultNotificationPluginWrapper(FlutterLocalNotificationsPlugin()),
        _ianaTimeZoneProvider = ianaTimeZoneProvider;

  final NotificationPluginWrapper _wrapper;
  final FutureOr<String?> Function()? _ianaTimeZoneProvider;

  bool _inicializado = false;
  bool _isUsingFallback = false;
  String? _resolvedTimeZoneName;

  bool get isUsingFallback => _isUsingFallback;
  String? get resolvedTimeZoneName => _resolvedTimeZoneName;

  final Map<String, ItemAgendadoAtivo> _agendadosAtivos = {};
  Map<String, ItemAgendadoAtivo> get agendadosAtivos =>
      Map.unmodifiable(_agendadosAtivos);

  Future<void> inicializar({
    void Function(NotificationResponse)? onDidReceiveNotificationResponse,
  }) async {
    if (_inicializado) return;

    await _configurarFusoHorario();

    const androidSettings =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);

    await _wrapper.initialize(
      initSettings,
      onDidReceiveNotificationResponse: onDidReceiveNotificationResponse,
    );

    _inicializado = true;
  }

  Future<void> _configurarFusoHorario() async {
    tz_data.initializeTimeZones();

    String? id;
    try {
      final provider = _ianaTimeZoneProvider;
      if (provider != null) {
        id = await provider();
      } else {
        id = await obterFusoIanaNativo();
      }
    } catch (e) {
      if (kDebugMode) {
        print('[ServicoNotificacoesAgenda] Exceção no provider IANA: $e');
      }
      id = null;
    }

    if (id != null &&
        id.trim().isNotEmpty &&
        tz.timeZoneDatabase.locations.containsKey(id)) {
      tz.setLocalLocation(tz.getLocation(id));
      _resolvedTimeZoneName = id;
      _isUsingFallback = false;
    } else {
      // Fallback explícito baseado no instante UTC, sem falsas deduções por offset
      tz.setLocalLocation(tz.UTC);
      _resolvedTimeZoneName = 'UTC';
      _isUsingFallback = true;
      if (kDebugMode) {
        print(
            '[ServicoNotificacoesAgenda] Fuso IANA indisponível ou inválido ("$id"). Utilizando fallback UTC explícito.');
      }
    }
  }

  tz.TZDateTime _paraTZDateTime(DateTime dataHora) {
    if (_isUsingFallback) {
      return tz.TZDateTime.from(dataHora.toUtc(), tz.UTC);
    }
    return tz.TZDateTime.from(dataHora, tz.local);
  }

  Future<ResultadoAgendamentoNotificacao> agendarCompromisso({
    required int id,
    required String clienteId,
    required String nomeCliente,
    required DateTime horarioCompromisso,
    String? endereco,
  }) async {
    await inicializar();

    final agora = DateTime.now();
    if (horarioCompromisso.isBefore(agora)) {
      return ResultadoAgendamentoNotificacao.horarioPassado;
    }

    final permNotif = await _wrapper.requestNotificationsPermission();
    if (permNotif == false) {
      return ResultadoAgendamentoNotificacao.permissaoNegada;
    }

    bool alarmeExatoPermitido = true;
    final permExato = await _wrapper.requestExactAlarmsPermission();
    if (permExato == false) {
      alarmeExatoPermitido = false;
    }

    final scheduleMode = alarmeExatoPermitido
        ? AndroidScheduleMode.exactAllowWhileIdle
        : AndroidScheduleMode.inexactAllowWhileIdle;

    const androidDetails = AndroidNotificationDetails(
      'agenda_compromissos',
      'Compromissos da Agenda',
      channelDescription: 'Lembretes de visitas e compromissos com clientes',
      importance: Importance.max,
      priority: Priority.high,
      showWhen: true,
    );
    const notificationDetails = NotificationDetails(android: androidDetails);

    final id30min = id * 2;
    final idExato = id * 2 + 1;
    bool primeiroAgendado = false;

    try {
      // 1. Notificação 30 minutos antes
      final horario30min =
          horarioCompromisso.subtract(const Duration(minutes: 30));
      if (horario30min.isAfter(agora)) {
        await _wrapper.zonedSchedule(
          id30min,
          'Compromisso em 30 minutos',
          'Visita com $nomeCliente${endereco != null ? ' - $endereco' : ''}',
          _paraTZDateTime(horario30min),
          notificationDetails,
          androidScheduleMode: scheduleMode,
        );
        primeiroAgendado = true;
      }

      // 2. Notificação no horário exato
      await _wrapper.zonedSchedule(
        idExato,
        'Horário do compromisso',
        'Visita com $nomeCliente agora${endereco != null ? ' - $endereco' : ''}',
        _paraTZDateTime(horarioCompromisso),
        notificationDetails,
        androidScheduleMode: scheduleMode,
      );

      final resultado = alarmeExatoPermitido
          ? ResultadoAgendamentoNotificacao.agendadoExato
          : ResultadoAgendamentoNotificacao.agendadoAproximado;

      _agendadosAtivos[clienteId] = ItemAgendadoAtivo(
        notificationId: id,
        clienteId: clienteId,
        titulo: 'Visita com $nomeCliente',
        horarioCompromisso: horarioCompromisso,
        status: resultado,
      );

      return resultado;
    } catch (e) {
      // Rollback se a segunda chamada falhar para não deixar alarme órfão
      if (primeiroAgendado) {
        try {
          await _wrapper.cancel(id30min);
        } catch (_) {}
      }
      _agendadosAtivos.remove(clienteId);
      if (kDebugMode) {
        print('[ServicoNotificacoesAgenda] Erro ao agendar notificação: $e');
      }
      return ResultadoAgendamentoNotificacao.falha;
    }
  }

  Future<void> cancelarCompromisso(int id, {String? clienteId}) async {
    await _wrapper.cancel(id * 2);
    await _wrapper.cancel(id * 2 + 1);
    if (clienteId != null) {
      _agendadosAtivos.remove(clienteId);
    }
  }

  Future<void> cancelarTodos() async {
    await _wrapper.cancelAll();
    _agendadosAtivos.clear();
  }

  Future<void> sincronizarNotificacoesComClientes(
      List<Map<String, dynamic>> clientes) async {
    await inicializar();

    for (final cliente in clientes) {
      final dataStr = cliente['appointmentDate']?.toString();
      final clienteId = cliente['id']?.toString() ?? '';
      if (dataStr == null || dataStr.isEmpty || clienteId.isEmpty) continue;

      final dataHora = DateTime.tryParse(dataStr);
      if (dataHora == null || dataHora.isBefore(DateTime.now())) {
        if (_agendadosAtivos.containsKey(clienteId)) {
          final idExistente = _agendadosAtivos[clienteId]!.notificationId;
          await cancelarCompromisso(idExistente, clienteId: clienteId);
        }
        continue;
      }

      if (_agendadosAtivos.containsKey(clienteId)) {
        final agendado = _agendadosAtivos[clienteId]!;
        if (agendado.horarioCompromisso.isAtSameMomentAs(dataHora) &&
            (agendado.status == ResultadoAgendamentoNotificacao.agendadoExato ||
                agendado.status ==
                    ResultadoAgendamentoNotificacao.agendadoAproximado)) {
          continue;
        }
      }

      final notifId = clienteId.hashCode.abs() % 100000;
      final nome = cliente['name']?.toString() ?? 'Cliente';
      final end = cliente['address']?.toString();

      await agendarCompromisso(
        id: notifId,
        clienteId: clienteId,
        nomeCliente: nome,
        horarioCompromisso: dataHora,
        endereco: end,
      );
    }
  }

  Future<ResultadoAgendamentoNotificacao> agendarLembreteCompromisso({
    required int id,
    required String titulo,
    required String descricao,
    required DateTime horarioCompromisso,
    String? clienteId,
  }) {
    return agendarCompromisso(
      id: id,
      clienteId: clienteId ?? 'notif_$id',
      nomeCliente: titulo,
      horarioCompromisso: horarioCompromisso,
      endereco: descricao,
    );
  }

  Future<void> sincronizarLembretesLista(List<dynamic> appointments) async {
    final clientList = <Map<String, dynamic>>[];
    for (final appt in appointments) {
      if (appt is Map<String, dynamic>) {
        clientList.add({
          'id': appt['id'] ?? appt['clientId'] ?? '',
          'name': appt['title'] ?? appt['clientName'] ?? 'Compromisso',
          'appointmentDate': appt['dateTime'] ?? appt['appointmentDate'],
          'address': appt['address'] ?? appt['description'],
        });
      }
    }
    await sincronizarNotificacoesComClientes(clientList);
  }
}
