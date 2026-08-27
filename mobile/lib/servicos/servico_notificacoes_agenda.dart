import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

/// Resultado explícito da tentativa de agendamento de notificação.
enum ResultadoAgendamentoNotificacao {
  agendadoExato,
  agendadoAproximado,
  permissaoNegada,
  horarioPassado,
  falha,
}

/// Registro imutável de agendamento ativo em memória.
class ItemAgendadoAtivo {
  final int notificationId;
  final ResultadoAgendamentoNotificacao resultado;

  const ItemAgendadoAtivo({
    required this.notificationId,
    required this.resultado,
  });
}

/// Interface abstrata para encapsular operações do FlutterLocalNotificationsPlugin
/// permitindo injeção de dependência completa e eliminando dependências nativas em testes.
abstract class INotificationPluginWrapper {
  Future<bool?> initialize(InitializationSettings settings);
  Future<bool?> requestNotificationsPermission();
  Future<bool?> canScheduleExactNotifications();
  Future<bool?> requestExactAlarmsPermission();
  Future<void> zonedSchedule(
    int id,
    String? title,
    String? body,
    tz.TZDateTime scheduledDate,
    NotificationDetails notificationDetails, {
    required AndroidScheduleMode androidScheduleMode,
    required UILocalNotificationDateInterpretation uiLocalNotificationDateInterpretation,
  });
  Future<void> cancel(int id);
}

/// Implementação padrão que delega para o FlutterLocalNotificationsPlugin nativo.
class FlutterLocalNotificationsPluginWrapper implements INotificationPluginWrapper {
  final FlutterLocalNotificationsPlugin _plugin;

  FlutterLocalNotificationsPluginWrapper([FlutterLocalNotificationsPlugin? plugin])
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  @override
  Future<bool?> initialize(InitializationSettings settings) =>
      _plugin.initialize(settings);

  @override
  Future<bool?> requestNotificationsPermission() async {
    final androidImpl = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    return await androidImpl?.requestNotificationsPermission();
  }

  @override
  Future<bool?> canScheduleExactNotifications() async {
    final androidImpl = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    return await androidImpl?.canScheduleExactNotifications();
  }

  @override
  Future<bool?> requestExactAlarmsPermission() async {
    final androidImpl = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    return await androidImpl?.requestExactAlarmsPermission();
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
  }) =>
      _plugin.zonedSchedule(
        id,
        title,
        body,
        scheduledDate,
        notificationDetails,
        androidScheduleMode: androidScheduleMode,
        uiLocalNotificationDateInterpretation: uiLocalNotificationDateInterpretation,
      );

  @override
  Future<void> cancel(int id) => _plugin.cancel(id);
}

/// Serviço central de lembretes e notificações nativas da agenda.
class ServicoNotificacoesAgenda {
  static ServicoNotificacoesAgenda _instance = ServicoNotificacoesAgenda._internal();
  factory ServicoNotificacoesAgenda() => _instance;

  INotificationPluginWrapper _wrapper;
  final String Function()? ianaTimeZoneProvider;
  bool _isInitialized = false;

  // Rastreia itens agendados atualmente: chave -> ItemAgendadoAtivo
  final Map<String, ItemAgendadoAtivo> _agendadosAtivos = {};

  ServicoNotificacoesAgenda._internal([
    INotificationPluginWrapper? wrapper,
    this.ianaTimeZoneProvider,
  ]) : _wrapper = wrapper ?? FlutterLocalNotificationsPluginWrapper();

  @visibleForTesting
  static void setMockInstance(ServicoNotificacoesAgenda mockInstance) {
    _instance = mockInstance;
  }

  @visibleForTesting
  static void resetInstance([
    INotificationPluginWrapper? wrapper,
    String Function()? ianaTimeZoneProvider,
  ]) {
    _instance = ServicoNotificacoesAgenda._internal(wrapper, ianaTimeZoneProvider);
  }

  @visibleForTesting
  Map<String, ItemAgendadoAtivo> get agendadosAtivos =>
      Map.unmodifiable(_agendadosAtivos);

  @visibleForTesting
  bool get isInitialized => _isInitialized;

  /// Obtém a localização de timezone do dispositivo com resolução IANA real e fallback seguro.
  tz.Location resolverFusoAparelho() {
    try {
      tz.initializeTimeZones();
      if (ianaTimeZoneProvider != null) {
        final zone = ianaTimeZoneProvider!();
        if (tz.timeZoneDatabase.locations.containsKey(zone)) {
          return tz.getLocation(zone);
        }
      }

      final localName = DateTime.now().timeZoneName;
      if (tz.timeZoneDatabase.locations.containsKey(localName)) {
        return tz.getLocation(localName);
      }

      // Mapeamento baseado no offset de fuso brasileiro caso o identificador não seja padrão IANA
      final offsetHours = DateTime.now().timeZoneOffset.inHours;
      if (offsetHours == -4 && tz.timeZoneDatabase.locations.containsKey('America/Campo_Grande')) {
        return tz.getLocation('America/Campo_Grande');
      }
      if (offsetHours == -3 && tz.timeZoneDatabase.locations.containsKey('America/Sao_Paulo')) {
        return tz.getLocation('America/Sao_Paulo');
      }
      if (offsetHours == -5 && tz.timeZoneDatabase.locations.containsKey('America/Rio_Branco')) {
        return tz.getLocation('America/Rio_Branco');
      }
      if (offsetHours == -2 && tz.timeZoneDatabase.locations.containsKey('America/Noronha')) {
        return tz.getLocation('America/Noronha');
      }
    } catch (_) {}
    return tz.local;
  }

  /// Gera ID determinístico estável a partir de identificador textual.
  static int gerarIdDeterminante(String key) {
    int hash = 5381;
    for (int i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) + key.codeUnitAt(i);
      hash &= 0x7FFFFFFF;
    }
    return hash % 1000000;
  }

  /// Inicializa o plugin de notificações e configurações de fuso.
  Future<bool> inicializar() async {
    if (_isInitialized) return true;
    try {
      tz.initializeTimeZones();
      tz.setLocalLocation(resolverFusoAparelho());

      const AndroidInitializationSettings initializationSettingsAndroid =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const InitializationSettings initializationSettings = InitializationSettings(
        android: initializationSettingsAndroid,
      );

      final initOk = await _wrapper.initialize(initializationSettings);
      _isInitialized = initOk ?? true;
      return _isInitialized;
    } catch (e) {
      debugPrint('Aviso ao inicializar ServicoNotificacoesAgenda: $e');
      return false;
    }
  }

  /// Agenda lembretes no gerenciador nativo de alarmes.
  /// Retorna o status detalhado do agendamento (exato, aproximado, permissaoNegada, horarioPassado ou falha).
  Future<ResultadoAgendamentoNotificacao> agendarLembreteCompromisso({
    required int id,
    required String titulo,
    required String descricao,
    required DateTime horarioCompromisso,
  }) async {
    final initSuccess = await inicializar();
    if (!initSuccess) {
      return ResultadoAgendamentoNotificacao.falha;
    }

    final agora = DateTime.now();
    if (!horarioCompromisso.isAfter(agora)) {
      return ResultadoAgendamentoNotificacao.horarioPassado;
    }

    // 1. Verifica permissão geral de exibição de notificações (POST_NOTIFICATIONS)
    try {
      final notifPerm = await _wrapper.requestNotificationsPermission();
      if (notifPerm == false) {
        return ResultadoAgendamentoNotificacao.permissaoNegada;
      }
    } catch (e) {
      debugPrint('Aviso ao verificar permissão geral de notificações: $e');
      return ResultadoAgendamentoNotificacao.falha;
    }

    // 2. Verifica se possui permissão para alarmes exatos (SCHEDULE_EXACT_ALARM)
    bool podeExato = false;
    try {
      final canExact = await _wrapper.canScheduleExactNotifications();
      podeExato = canExact == true;
      if (!podeExato) {
        final reqExact = await _wrapper.requestExactAlarmsPermission();
        podeExato = reqExact == true;
      }
    } catch (e) {
      debugPrint('Aviso ao verificar permissão de alarme exato: $e');
      podeExato = false;
    }

    // Fallback aproximado aplica-se unicamente se o alarme exato não for permitido
    final scheduleMode = podeExato
        ? AndroidScheduleMode.exactAllowWhileIdle
        : AndroidScheduleMode.inexactAllowWhileIdle;

    const androidDetails = AndroidNotificationDetails(
      'agenda_channel_id',
      'Lembretes da Agenda',
      channelDescription: 'Lembretes para agendamentos de clientes e compromissos da agenda.',
      importance: Importance.max,
      priority: Priority.high,
      ticker: 'ticker',
      enableVibration: true,
      playSound: true,
    );
    const platformDetails = NotificationDetails(android: androidDetails);

    final fuso = resolverFusoAparelho();
    final lembrete30Min = horarioCompromisso.subtract(const Duration(minutes: 30));

    bool primeiroAgendado = false;
    try {
      // 1. Lembrete prévio de 30 minutos (caso ainda seja futuro)
      if (lembrete30Min.isAfter(agora)) {
        final tzPre = tz.TZDateTime.from(lembrete30Min, fuso);
        await _wrapper.zonedSchedule(
          id * 2,
          'Lembrete em 30 min: $titulo',
          descricao.isNotEmpty ? descricao : 'Seu compromisso está agendado para daqui a 30 minutos.',
          tzPre,
          platformDetails,
          androidScheduleMode: scheduleMode,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
        );
        primeiroAgendado = true;
      }

      // 2. Lembrete no horário exato do compromisso
      final tzExact = tz.TZDateTime.from(horarioCompromisso, fuso);
      await _wrapper.zonedSchedule(
        id * 2 + 1,
        'Agendamento Agora: $titulo',
        descricao.isNotEmpty ? descricao : 'Horário do compromisso agendado na sua agenda.',
        tzExact,
        platformDetails,
        androidScheduleMode: scheduleMode,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
      );

      return podeExato
          ? ResultadoAgendamentoNotificacao.agendadoExato
          : ResultadoAgendamentoNotificacao.agendadoAproximado;
    } catch (e) {
      debugPrint('Erro ao agendar notificação: $e');
      // Caso ocorra falha no segundo agendamento, desfaz o primeiro imediatamente
      // para evitar lembretes parciais inconsistentes
      if (primeiroAgendado) {
        try {
          await _wrapper.cancel(id * 2);
        } catch (_) {}
      }
      return ResultadoAgendamentoNotificacao.falha;
    }
  }

  /// Cancela lembretes agendados pelo ID base.
  Future<void> cancelarLembrete(int id) async {
    try {
      await _wrapper.cancel(id * 2);
      await _wrapper.cancel(id * 2 + 1);
    } catch (e) {
      debugPrint('Aviso ao cancelar lembrete: $e');
    }
  }

  /// Sincroniza a lista de compromissos:
  /// - Cancela alarmes de compromissos removidos ou reagendados;
  /// - Evita agendar duplicados repetidamente a cada recarga;
  /// - Itens com falha NÃO são marcados como ativos e são retentados na próxima sincronização;
  /// - Preserva o resultado real (agendadoExato ou agendadoAproximado);
  /// - Retorna mapa com os resultados de cada item.
  Future<Map<String, ResultadoAgendamentoNotificacao>> sincronizarLembretesLista(
      List<dynamic> items) async {
    await inicializar();
    final agora = DateTime.now();
    final novosAgendadosSucesso = <String, ItemAgendadoAtivo>{};
    final chavesValidasPresentes = <String>{};
    final resultados = <String, ResultadoAgendamentoNotificacao>{};

    for (final item in items) {
      if (item is! Map) continue;
      try {
        DateTime? dt;
        if (item['dateTime'] != null) {
          dt = DateTime.tryParse(item['dateTime'].toString());
        } else if (item['date'] != null) {
          final d = DateTime.tryParse(item['date'].toString());
          if (d != null) {
            final timeStr = item['time']?.toString() ?? '09:00';
            final parts = timeStr.split(':');
            final h = parts.isNotEmpty ? int.tryParse(parts[0]) ?? 9 : 9;
            final m = parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0;
            dt = DateTime(d.year, d.month, d.day, h, m);
          }
        }

        if (dt == null || !dt.isAfter(agora)) continue;

        final rawId = item['id']?.toString() ?? dt.millisecondsSinceEpoch.toString();
        final chaveUnica = '${rawId}_${dt.millisecondsSinceEpoch}';
        chavesValidasPresentes.add(chaveUnica);

        // Se já está agendado com sucesso e inalterado, preserva o resultado real sem duplicar
        if (_agendadosAtivos.containsKey(chaveUnica)) {
          final ativo = _agendadosAtivos[chaveUnica]!;
          resultados[chaveUnica] = ativo.resultado;
          novosAgendadosSucesso[chaveUnica] = ativo;
          continue;
        }

        final int notificationId = gerarIdDeterminante(chaveUnica);
        final title = item['title']?.toString() ??
            item['clientName']?.toString() ??
            'Compromisso da Agenda';
        final desc = item['notes']?.toString() ?? item['description']?.toString() ?? '';

        final res = await agendarLembreteCompromisso(
          id: notificationId,
          titulo: title,
          descricao: desc,
          horarioCompromisso: dt,
        );
        resultados[chaveUnica] = res;

        // Somente registra como ativo se teve sucesso real (exato ou aproximado)
        if (res == ResultadoAgendamentoNotificacao.agendadoExato ||
            res == ResultadoAgendamentoNotificacao.agendadoAproximado) {
          novosAgendadosSucesso[chaveUnica] = ItemAgendadoAtivo(
            notificationId: notificationId,
            resultado: res,
          );
        }
      } catch (e) {
        debugPrint('Aviso ao processar item de agenda: $e');
      }
    }

    // Cancelar alarmes de itens que não estão mais na lista de compromissos
    final removidos = _agendadosAtivos.keys
        .where((k) => !chavesValidasPresentes.contains(k))
        .toList();

    for (final chaveRemovida in removidos) {
      final ativo = _agendadosAtivos[chaveRemovida];
      if (ativo != null) {
        await cancelarLembrete(ativo.notificationId);
      }
      _agendadosAtivos.remove(chaveRemovida);
    }

    // Registra apenas os itens de sucesso ativo
    _agendadosAtivos.addAll(novosAgendadosSucesso);

    return resultados;
  }
}
