import 'package:flutter/material.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../servicos/servico_api.dart';
import '../utils/ui_helpers.dart';
import 'dart:math';

class TelaAgenda extends StatefulWidget {
  final Map<String, dynamic> initialClientData;

  const TelaAgenda({super.key, this.initialClientData = const {}});

  @override
  State<TelaAgenda> createState() => _TelaAgendaState();
}

class _TelaAgendaState extends State<TelaAgenda> {
  DateTime _focusedDay = DateTime.now();
  DateTime? _selectedDay = DateTime.now();
  
  Map<DateTime, List<dynamic>> _events = {};
  bool _isLoading = true;

  final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

  @override
  void initState() {
    super.initState();
    _initializeNotifications();
    _fetchAgenda();
  }

  Future<void> _initializeNotifications() async {
    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const InitializationSettings initializationSettings = InitializationSettings(
        android: initializationSettingsAndroid);
    await flutterLocalNotificationsPlugin.initialize(initializationSettings);
  }

  Future<void> _scheduleNotification(String title, String body, DateTime scheduledTime) async {
    final notificationTime = scheduledTime.subtract(const Duration(minutes: 30));
    
    // Se o evento já está a menos de 30 minutos, não agenda.
    if (notificationTime.isBefore(DateTime.now())) return;

    final androidPlatformChannelSpecifics = AndroidNotificationDetails(
      'agenda_channel_id',
      'Lembretes da Agenda',
      channelDescription: 'Lembretes para agendamentos pessoais e clientes.',
      importance: Importance.max,
      priority: Priority.high,
      ticker: 'ticker',
      enableVibration: true,
    );
    
    final platformChannelSpecifics = NotificationDetails(android: androidPlatformChannelSpecifics);

    final notificationId = Random().nextInt(100000);

    final delay = notificationTime.difference(DateTime.now());
    
    Future.delayed(delay, () {
      flutterLocalNotificationsPlugin.show(
        notificationId,
        title,
        body,
        platformChannelSpecifics,
      );
    });
  }

  Future<void> _fetchAgenda() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiService();
      final clients = await api.getClientsBySeller();
      
      final userId = await UIHelpers.getUserId();
      final List<dynamic> appointments = userId != null ? await api.getPersonalAppointments(userId) : [];

      final newEvents = <DateTime, List<dynamic>>{};

      for (var client in clients) {
        if (client['scheduleDate'] != null) {
          final date = DateTime.parse(client['scheduleDate']).toLocal();
          final dayKey = DateTime(date.year, date.month, date.day);
          
          if (newEvents[dayKey] == null) newEvents[dayKey] = [];
          newEvents[dayKey]!.add({
            'type': 'client',
            'data': client,
            'time': date,
          });
        }
      }

      for (var appt in appointments) {
        if (appt['dateTime'] != null) {
          final date = DateTime.parse(appt['dateTime']).toLocal();
          final dayKey = DateTime(date.year, date.month, date.day);
          
          if (newEvents[dayKey] == null) newEvents[dayKey] = [];
          newEvents[dayKey]!.add({
            'type': 'personal',
            'data': appt,
            'time': date,
          });
        }
      }

      if (mounted) {
        setState(() {
          _events = newEvents;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao buscar agenda: $e')));
      }
    }
  }

  List<dynamic> _getEventsForDay(DateTime day) {
    final dayKey = DateTime(day.year, day.month, day.day);
    final events = _events[dayKey] ?? [];
    events.sort((a, b) => (a['time'] as DateTime).compareTo(b['time'] as DateTime));
    return events;
  }

  void _addPersonalAppointment() {
    showDialog(
      context: context,
      builder: (context) {
        final titleCtrl = TextEditingController();
        final descCtrl = TextEditingController();
        TimeOfDay selectedTime = TimeOfDay.now();
        
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF111122),
              title: const Text('Novo Agendamento Pessoal', style: TextStyle(color: Colors.white)),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: titleCtrl,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Título', labelStyle: TextStyle(color: Colors.white54)),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: descCtrl,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Descrição (opcional)', labelStyle: TextStyle(color: Colors.white54)),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        const Text('Horário: ', style: TextStyle(color: Colors.white70)),
                        TextButton(
                          onPressed: () async {
                            final time = await showTimePicker(
                              context: context,
                              initialTime: selectedTime,
                            );
                            if (time != null) {
                              setDialogState(() => selectedTime = time);
                            }
                          },
                          child: Text('${selectedTime.hour.toString().padLeft(2, '0')}:${selectedTime.minute.toString().padLeft(2, '0')}'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                ElevatedButton(
                  onPressed: () async {
                    final userId = await UIHelpers.getUserId();
                    if (userId == null) return;
                    
                    final dt = DateTime(
                      _selectedDay!.year, _selectedDay!.month, _selectedDay!.day,
                      selectedTime.hour, selectedTime.minute,
                    );

                    try {
                      final api = ApiService();
                      // Para brevidade, usando Dio direto aqui, ou podemos adicionar createPersonalAppointment no ApiService
                      await api.dio.post('/appointments', data: {
                        'sellerId': userId,
                        'title': titleCtrl.text,
                        'description': descCtrl.text,
                        'dateTime': dt.toIso8601String(),
                      });
                      
                      _scheduleNotification(titleCtrl.text, descCtrl.text, dt);
                      Navigator.pop(context);
                      _fetchAgenda(); // Recarrega
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Agendado com sucesso!')));
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar agendamento: $e')));
                    }
                  },
                  child: const Text('Salvar'),
                ),
              ],
            );
          }
        );
      }
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedEvents = _selectedDay != null ? _getEventsForDay(_selectedDay!) : [];

    return Scaffold(
      backgroundColor: const Color(0xFF000000),
      appBar: AppBar(
        title: const Text('Minha Agenda', style: TextStyle(color: Colors.white)),
        backgroundColor: Colors.transparent,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addPersonalAppointment,
        icon: const Icon(Icons.add),
        label: const Text('Agendamento Pessoal'),
        backgroundColor: const Color(0xFF00E5FF),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                TableCalendar(
                  firstDay: DateTime.utc(2020, 1, 1),
                  lastDay: DateTime.utc(2030, 12, 31),
                  focusedDay: _focusedDay,
                  selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
                  onDaySelected: (selectedDay, focusedDay) {
                    setState(() {
                      _selectedDay = selectedDay;
                      _focusedDay = focusedDay;
                    });
                  },
                  calendarFormat: CalendarFormat.week,
                  headerStyle: const HeaderStyle(
                    formatButtonVisible: false,
                    titleCentered: true,
                    titleTextStyle: TextStyle(color: Colors.white, fontSize: 18),
                    leftChevronIcon: Icon(Icons.chevron_left, color: Colors.white),
                    rightChevronIcon: Icon(Icons.chevron_right, color: Colors.white),
                  ),
                  daysOfWeekStyle: const DaysOfWeekStyle(
                    weekdayStyle: TextStyle(color: Colors.white70),
                    weekendStyle: TextStyle(color: Colors.white54),
                  ),
                  calendarStyle: CalendarStyle(
                    defaultTextStyle: const TextStyle(color: Colors.white),
                    weekendTextStyle: const TextStyle(color: Colors.white54),
                    selectedDecoration: const BoxDecoration(
                      color: Color(0xFF00E5FF),
                      shape: BoxShape.circle,
                    ),
                    selectedTextStyle: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
                    todayDecoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      shape: BoxShape.circle,
                    ),
                    markerDecoration: const BoxDecoration(
                      color: Colors.amber,
                      shape: BoxShape.circle,
                    ),
                  ),
                  eventLoader: _getEventsForDay,
                ),
                const Divider(color: Colors.white24, height: 32),
                Expanded(
                  child: selectedEvents.isEmpty
                      ? const Center(
                          child: Text(
                            'Nenhum agendamento para este dia.',
                            style: TextStyle(color: Colors.white54, fontSize: 16),
                          ),
                        )
                      : ListView.builder(
                          itemCount: selectedEvents.length,
                          itemBuilder: (context, index) {
                            final event = selectedEvents[index];
                            final time = event['time'] as DateTime;
                            final timeString = DateFormat('HH:mm').format(time);
                            
                            if (event['type'] == 'client') {
                              final data = event['data'];
                              return ListTile(
                                leading: Text(timeString, style: const TextStyle(color: Color(0xFF00E5FF), fontWeight: FontWeight.bold, fontSize: 16)),
                                title: Text(data['name'] ?? 'Sem Nome', style: const TextStyle(color: Colors.white)),
                                subtitle: Text('Ficha ${data['sequenceNumber']} - ${data['city'] ?? ''}', style: const TextStyle(color: Colors.white70)),
                                trailing: const Icon(Icons.business_center, color: Colors.white54),
                              );
                            } else {
                              final data = event['data'];
                              return ListTile(
                                leading: Text(timeString, style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 16)),
                                title: Text(data['title'] ?? 'Compromisso', style: const TextStyle(color: Colors.white)),
                                subtitle: Text(data['description'] ?? '', style: const TextStyle(color: Colors.white70)),
                                trailing: const Icon(Icons.person, color: Colors.amber),
                              );
                            }
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
