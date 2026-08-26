import 'package:flutter/material.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../servicos/servico_api.dart';
import '../utils/ui_helpers.dart';
import 'dart:math';

import '../servicos/servico_notificacoes_agenda.dart';

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

  final ServicoNotificacoesAgenda _servicoNotificacoes = ServicoNotificacoesAgenda();

  @override
  void initState() {
    super.initState();
    _servicoNotificacoes.inicializar();
    _fetchAgenda();
  }

  Future<void> _scheduleNotification(String title, String body, DateTime scheduledTime) async {
    final notificationId = Random().nextInt(100000);
    await _servicoNotificacoes.agendarLembreteCompromisso(
      id: notificationId,
      titulo: title,
      descricao: body,
      horarioCompromisso: scheduledTime,
    );
  }

  Future<void> _fetchAgenda() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiService();
      final now = DateTime.now();
      final startOfToday = DateTime(now.year, now.month, now.day);
      final fromWindow = startOfToday.subtract(const Duration(days: 4));
      final userId = await UIHelpers.getUserId();

      final List<dynamic> appointments = userId != null
          ? await api.getUnifiedAppointments(userId, from: fromWindow)
          : [];

      final newEvents = <DateTime, List<dynamic>>{};

      for (var appt in appointments) {
        if (appt['dateTime'] != null) {
          final date = DateTime.parse(appt['dateTime']).toLocal();
          final dayKey = DateTime(date.year, date.month, date.day);

          if (newEvents[dayKey] == null) newEvents[dayKey] = [];
          newEvents[dayKey]!.add({
            'type': appt['type'] == 'CLIENT' ? 'client' : 'personal',
            'data': appt,
            'time': date,
          });
        }
      }

      _servicoNotificacoes.sincronizarLembretesLista(appointments);

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
                    final title = titleCtrl.text.trim();
                    if (title.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Por favor, informe o título.')));
                      return;
                    }

                    final userId = await UIHelpers.getUserId();
                    if (userId == null) return;
                    
                    final baseDate = _selectedDay ?? DateTime.now();
                    final dt = DateTime(
                      baseDate.year, baseDate.month, baseDate.day,
                      selectedTime.hour, selectedTime.minute,
                    );

                    try {
                      final api = ApiService();
                      await api.createPersonalAppointment(
                        sellerId: userId,
                        title: title,
                        description: descCtrl.text.trim().isNotEmpty ? descCtrl.text.trim() : null,
                        dateTime: dt,
                      );
                      
                      _scheduleNotification(title, descCtrl.text, dt);
                      if (context.mounted) {
                        Navigator.pop(context);
                      }
                      _fetchAgenda(); // Recarrega imediatamente
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Agendado com sucesso!'), backgroundColor: Colors.green));
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar agendamento: $e'), backgroundColor: Colors.red));
                      }
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
                            final data = event['data'];
                            
                            if (event['type'] == 'client') {
                              return ListTile(
                                leading: Text(timeString, style: const TextStyle(color: Color(0xFF00E5FF), fontWeight: FontWeight.bold, fontSize: 16)),
                                title: Text(data['title'] ?? data['clientName'] ?? 'Visita de Ficha', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                                subtitle: Text(
                                  'Ficha ${data['sequenceNumber'] ?? ''} - ${data['city'] ?? ''}${data['description'] != null && data['description'].toString().trim().isNotEmpty ? '\n${data['description']}' : ''}',
                                  style: const TextStyle(color: Colors.white70),
                                ),
                                trailing: const Icon(Icons.business_center, color: Color(0xFF00E5FF)),
                              );
                            } else {
                              return ListTile(
                                leading: Text(timeString, style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 16)),
                                title: Text(data['title'] ?? 'Compromisso Pessoal', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
