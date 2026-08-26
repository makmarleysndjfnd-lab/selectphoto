import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

/// Serviço central de lembretes e notificações nativas da agenda.
/// Utiliza o AlarmManager do Android (via zonedSchedule) para garantir
/// que notificações toquem e vibrem mesmo quando o aplicativo estiver fechado.
class ServicoNotificacoesAgenda {
  static final ServicoNotificacoesAgenda _instance = ServicoNotificacoesAgenda._internal();
  factory ServicoNotificacoesAgenda() => _instance;
  ServicoNotificacoesAgenda._internal();

  final FlutterLocalNotificationsPlugin _notificationsPlugin = FlutterLocalNotificationsPlugin();
  bool _isInitialized = false;

  @visibleForTesting
  FlutterLocalNotificationsPlugin get notificationsPlugin => _notificationsPlugin;

  Future<void> inicializar() async {
    if (_isInitialized) return;
    try {
      tz.initializeTimeZones();
      try {
        tz.setLocalLocation(tz.getLocation('America/Sao_Paulo'));
      } catch (_) {
        tz.setLocalLocation(tz.local);
      }

      const AndroidInitializationSettings initializationSettingsAndroid =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const InitializationSettings initializationSettings = InitializationSettings(
        android: initializationSettingsAndroid,
      );

      await _notificationsPlugin.initialize(initializationSettings);

      // Solicitar permissão de notificação no Android 13+ (POST_NOTIFICATIONS)
      final androidImpl = _notificationsPlugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (androidImpl != null) {
        await androidImpl.requestNotificationsPermission();
      }

      _isInitialized = true;
    } catch (e) {
      debugPrint('Aviso ao inicializar ServicoNotificacoesAgenda: $e');
    }
  }

  /// Agenda lembretes no AlarmManager nativo para disparar com o app aberto ou fechado.
  Future<void> agendarLembreteCompromisso({
    required int id,
    required String titulo,
    required String descricao,
    required DateTime horarioCompromisso,
  }) async {
    await inicializar();

    final agora = DateTime.now();
    final lembrete30Min = horarioCompromisso.subtract(const Duration(minutes: 30));

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

    // 1. Lembrete prévio de 30 minutos
    if (lembrete30Min.isAfter(agora)) {
      try {
        final tzPre = tz.TZDateTime.from(lembrete30Min, tz.local);
        await _notificationsPlugin.zonedSchedule(
          id * 2,
          'Lembrete em 30 min: $titulo',
          descricao.isNotEmpty ? descricao : 'Seu compromisso está agendado para daqui a 30 minutos.',
          tzPre,
          platformDetails,
          androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
        );
      } catch (e) {
        debugPrint('Aviso ao agendar lembrete prévio (30 min): $e');
      }
    }

    // 2. Lembrete no horário exato do compromisso
    if (horarioCompromisso.isAfter(agora)) {
      try {
        final tzExact = tz.TZDateTime.from(horarioCompromisso, tz.local);
        await _notificationsPlugin.zonedSchedule(
          id * 2 + 1,
          'Agendamento Agora: $titulo',
          descricao.isNotEmpty ? descricao : 'Horário do compromisso agendado na sua agenda.',
          tzExact,
          platformDetails,
          androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
        );
      } catch (e) {
        debugPrint('Aviso ao agendar lembrete no horário exato: $e');
      }
    }
  }

  /// Cancela lembretes agendados pelo ID base
  Future<void> cancelarLembrete(int id) async {
    try {
      await _notificationsPlugin.cancel(id * 2);
      await _notificationsPlugin.cancel(id * 2 + 1);
    } catch (e) {
      debugPrint('Aviso ao cancelar lembrete: $e');
    }
  }

  /// Itera sobre uma lista de compromissos vindos da API e agenda os alarmes nativos para todos os futuros
  Future<void> sincronizarLembretesLista(List<dynamic> items) async {
    final agora = DateTime.now();
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

        if (dt != null && dt.isAfter(agora)) {
          final rawId = item['id']?.toString() ?? dt.millisecondsSinceEpoch.toString();
          final int notificationId = rawId.hashCode.abs() % 100000;
          final title = item['title']?.toString() ?? item['clientName']?.toString() ?? 'Compromisso da Agenda';
          final desc = item['notes']?.toString() ?? item['description']?.toString() ?? '';

          await agendarLembreteCompromisso(
            id: notificationId,
            titulo: title,
            descricao: desc,
            horarioCompromisso: dt,
          );
        }
      } catch (e) {
        debugPrint('Aviso ao processar lembrete de item: $e');
      }
    }
  }
}
