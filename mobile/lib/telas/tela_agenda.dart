import 'package:flutter/material.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
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
        if (appt['dateTime'] != null || appt['brDate'] != null) {
          final DateTime date = _parseBrEventDateTime(appt);
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

  DateTime _parseBrEventDateTime(dynamic appt) {
    final brDate = appt['brDate']?.toString();
    final brTime = appt['brTime']?.toString();
    if (brDate != null && RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(brDate)) {
      final dp = brDate.split('-').map(int.parse).toList();
      int hh = 8;
      int mm = 0;
      if (brTime != null && brTime.contains(':')) {
        final tp = brTime.split(':').map(int.tryParse).toList();
        if (tp.length >= 2 && tp[0] != null && tp[1] != null) {
          hh = tp[0]!;
          mm = tp[1]!;
        }
      }
      return DateTime(dp[0], dp[1], dp[2], hh, mm);
    }
    return DateTime.parse(appt['dateTime'].toString()).toLocal();
  }

  List<dynamic> _getEventsForDay(DateTime day) {
    final dayKey = DateTime(day.year, day.month, day.day);
    final events = _events[dayKey] ?? [];
    events.sort((a, b) => (a['time'] as DateTime).compareTo(b['time'] as DateTime));
    return events;
  }

  void _openEventActions(Map<String, dynamic> event) {
    final data = Map<String, dynamic>.from(event['data'] as Map);
    final isClient = event['type'] == 'client';
    final eventId = data['id']?.toString() ?? '';
    final initialDt = event['time'] as DateTime;
    final title = (data['title'] ?? data['clientName'] ?? 'Compromisso').toString();
    final desc = (data['description'] ?? '').toString();

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF111122),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetCtx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(
                    isClient ? Icons.business_center : Icons.person,
                    color: isClient ? const Color(0xFF00E5FF) : Colors.amber,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'Data e Horário: ${DateFormat('dd/MM/yyyy HH:mm').format(initialDt)}',
                style: const TextStyle(color: Color(0xFF00E5FF), fontSize: 13),
              ),
              if (isClient &&
                  ((data['sequenceNumber'] ?? '').toString().isNotEmpty ||
                      (data['city'] ?? '').toString().isNotEmpty))
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Ficha ${data['sequenceNumber'] ?? ''} · ${data['city'] ?? ''}',
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ),
              if (desc.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(desc, style: const TextStyle(color: Colors.white60, fontSize: 12)),
                ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(sheetCtx);
                        _editEventDialog(eventId, isClient, initialDt, title, desc);
                      },
                      icon: const Icon(Icons.edit_calendar_rounded, color: Color(0xFF00E5FF)),
                      label: const Text('Editar Data/Horário',
                          style: TextStyle(color: Color(0xFF00E5FF))),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFF00E5FF)),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(sheetCtx);
                        _confirmDeleteEvent(eventId, title);
                      },
                      icon: const Icon(Icons.delete_outline_rounded),
                      label: const Text('Excluir'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.redAccent,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _editEventDialog(
    String eventId,
    bool isClient,
    DateTime initialDt,
    String initialTitle,
    String initialDesc,
  ) {
    if (eventId.isEmpty) return;
    DateTime selectedDate = DateTime(initialDt.year, initialDt.month, initialDt.day);
    String selectedHour =
        '${initialDt.hour.clamp(6, 22).toString().padLeft(2, '0')}:00';
    TimeOfDay customTime = TimeOfDay(hour: initialDt.hour, minute: initialDt.minute);
    final titleCtrl = TextEditingController(text: initialTitle);
    final descCtrl = TextEditingController(text: initialDesc);
    bool saving = false;

    final List<String> allowedHours = List.generate(
      17,
      (i) => '${(6 + i).toString().padLeft(2, '0')}:00',
    );
    if (!allowedHours.contains(selectedHour)) {
      selectedHour = '08:00';
    }

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF111122),
          title: Text(
            isClient ? 'Editar Agendamento da Ficha' : 'Editar Agendamento Pessoal',
            style: const TextStyle(color: Colors.white, fontSize: 16),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!isClient) ...[
                  TextField(
                    controller: titleCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Título',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                Row(
                  children: [
                    const Text('Data: ', style: TextStyle(color: Colors.white70)),
                    TextButton.icon(
                      onPressed: () async {
                        final picked = await showDatePicker(
                          context: ctx,
                          initialDate: selectedDate,
                          firstDate: DateTime(2020),
                          lastDate: DateTime(2030),
                        );
                        if (picked != null) {
                          setDialogState(() => selectedDate = picked);
                        }
                      },
                      icon: const Icon(Icons.calendar_today, size: 16, color: Color(0xFF00E5FF)),
                      label: Text(
                        DateFormat('dd/MM/yyyy').format(selectedDate),
                        style: const TextStyle(color: Color(0xFF00E5FF)),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: selectedHour,
                  dropdownColor: const Color(0xFF1A1A2E),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Horário (06:00 às 22:00)',
                    labelStyle: TextStyle(color: Colors.white54),
                  ),
                  items: allowedHours
                      .map((h) => DropdownMenuItem(value: h, child: Text(h)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) {
                      setDialogState(() {
                        selectedHour = v;
                        customTime = TimeOfDay(
                          hour: int.parse(v.split(':')[0]),
                          minute: 0,
                        );
                      });
                    }
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descCtrl,
                  maxLines: 2,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: isClient ? 'Observação' : 'Descrição (opcional)',
                    labelStyle: const TextStyle(color: Colors.white54),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: saving
                  ? null
                  : () async {
                      setDialogState(() => saving = true);
                      final ymd =
                          '${selectedDate.year.toString().padLeft(4, '0')}-${selectedDate.month.toString().padLeft(2, '0')}-${selectedDate.day.toString().padLeft(2, '0')}';
                      final hhmm =
                          '${customTime.hour.toString().padLeft(2, '0')}:${customTime.minute.toString().padLeft(2, '0')}';
                      try {
                        await ApiService().updateAppointment(
                          eventId,
                          title: !isClient ? titleCtrl.text.trim() : null,
                          description: !isClient ? descCtrl.text.trim() : null,
                          observation: isClient ? descCtrl.text.trim() : null,
                          date: ymd,
                          time: hhmm,
                          dateTime: '${ymd}T$hhmm:00-03:00',
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        setState(() {
                          _selectedDay = selectedDate;
                          _focusedDay = selectedDate;
                        });
                        await _fetchAgenda();
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Agendamento atualizado com sucesso!'),
                              backgroundColor: Colors.green,
                            ),
                          );
                        }
                      } catch (e) {
                        setDialogState(() => saving = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Erro ao atualizar: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                        }
                      }
                    },
              child: Text(saving ? 'Salvando...' : 'Salvar Alterações'),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmDeleteEvent(String eventId, String title) {
    if (eventId.isEmpty) return;
    bool deleting = false;
    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF111122),
          title: const Text('Excluir Agendamento', style: TextStyle(color: Colors.white)),
          content: Text(
            'Deseja excluir o agendamento "$title"?',
            style: const TextStyle(color: Colors.white70),
          ),
          actions: [
            TextButton(
              onPressed: deleting ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: deleting
                  ? null
                  : () async {
                      setDialogState(() => deleting = true);
                      try {
                        await ApiService().deleteAppointment(eventId);
                        if (ctx.mounted) Navigator.pop(ctx);
                        await _fetchAgenda();
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Agendamento excluído com sucesso!'),
                              backgroundColor: Colors.green,
                            ),
                          );
                        }
                      } catch (e) {
                        setDialogState(() => deleting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Erro ao excluir: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                        }
                      }
                    },
              child: Text(deleting ? 'Excluindo...' : 'Confirmar Exclusão'),
            ),
          ],
        ),
      ),
    );
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
                                onTap: () => _openEventActions(Map<String, dynamic>.from(event as Map)),
                                leading: Text(timeString, style: const TextStyle(color: Color(0xFF00E5FF), fontWeight: FontWeight.bold, fontSize: 16)),
                                title: Text(data['title'] ?? data['clientName'] ?? 'Visita de Ficha', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                                subtitle: Text(
                                  'Ficha ${data['sequenceNumber'] ?? ''} - ${data['city'] ?? ''}${data['description'] != null && data['description'].toString().trim().isNotEmpty ? '\n${data['description']}' : ''}',
                                  style: const TextStyle(color: Colors.white70),
                                ),
                                trailing: const Icon(Icons.edit_outlined, color: Color(0xFF00E5FF), size: 20),
                              );
                            } else {
                              return ListTile(
                                onTap: () => _openEventActions(Map<String, dynamic>.from(event as Map)),
                                leading: Text(timeString, style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 16)),
                                title: Text(data['title'] ?? 'Compromisso Pessoal', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                                subtitle: Text(data['description'] ?? '', style: const TextStyle(color: Colors.white70)),
                                trailing: const Icon(Icons.edit_outlined, color: Colors.amber, size: 20),
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
