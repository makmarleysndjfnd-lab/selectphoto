import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class TelaConfigBuscaEventosIa extends StatefulWidget {
  final String? companyId;
  final String? companyName;
  final ApiService? apiService;

  const TelaConfigBuscaEventosIa({
    super.key,
    this.companyId,
    this.companyName,
    this.apiService,
  });

  @override
  State<TelaConfigBuscaEventosIa> createState() =>
      _TelaConfigBuscaEventosIaState();
}

class _TelaConfigBuscaEventosIaState extends State<TelaConfigBuscaEventosIa> {
  static const _bg = Color(0xFF0D0714);
  static const _cardBg = Color(0xFF160D24);
  static const _accent = Color(0xFFA855F7);
  static const _accentSoft = Color(0xFFD8B4FE);
  static const _green = Color(0xFF10B981);
  static const _red = Color(0xFFEF4444);

  static const List<Map<String, String>> _weekdays = [
    {'code': 'SEG', 'label': 'Seg'},
    {'code': 'TER', 'label': 'Ter'},
    {'code': 'QUA', 'label': 'Qua'},
    {'code': 'QUI', 'label': 'Qui'},
    {'code': 'SEX', 'label': 'Sex'},
    {'code': 'SAB', 'label': 'Sáb'},
    {'code': 'DOM', 'label': 'Dom'},
  ];

  late final ApiService _api = widget.apiService ?? ApiService();

  bool _loading = true;
  bool _saving = false;
  bool _isDefault = true;
  String? _error;
  String? _configHash;
  String? _serverPromptPreview;

  final TextEditingController _descriptionCtrl = TextEditingController();
  final TextEditingController _horizonCtrl = TextEditingController();
  final TextEditingController _geoFocusCtrl = TextEditingController();

  List<Map<String, dynamic>> _eventTypes = [];
  Set<String> _selectedWeekdays = {
    'SEG',
    'TER',
    'QUA',
    'QUI',
    'SEX',
    'SAB',
    'DOM',
  };
  bool _includeHolidays = true;
  List<Map<String, dynamic>> _exclusions = [];

  bool get _isSuperAdminMode =>
      widget.companyId != null && widget.companyId!.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  @override
  void dispose() {
    _descriptionCtrl.dispose();
    _horizonCtrl.dispose();
    _geoFocusCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = _isSuperAdminMode
          ? await _api.getSuperAdminEventSearchConfig(widget.companyId!)
          : await _api.getEventSearchConfig();
      _applyServerDto(data);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  void _applyServerDto(Map<String, dynamic> data) {
    final rawTypes = (data['eventTypes'] as List?) ?? [];
    final rawExclusions = (data['exclusions'] as List?) ?? [];
    final rawWeekdays = (data['priorityWeekdays'] as List?) ?? [];

    final horizon = int.tryParse('${data['horizonDays'] ?? 380}') ?? 380;

    _descriptionCtrl.text = (data['searchDescription'] ?? '').toString();
    _horizonCtrl.text = '$horizon';
    _geoFocusCtrl.text = (data['geographicFocus'] ?? '').toString();

    if (!mounted) return;
    setState(() {
      _isDefault = data['isDefault'] == true;
      _configHash = data['configHash']?.toString();
      _serverPromptPreview = data['renderedPromptPreview']?.toString();
      _includeHolidays = data['includeHolidays'] != false;
      _eventTypes = rawTypes
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      _exclusions = rawExclusions
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      _selectedWeekdays = rawWeekdays
          .map((w) => w.toString().trim().toUpperCase())
          .where((w) => w.isNotEmpty)
          .toSet();
      if (_selectedWeekdays.isEmpty) {
        _selectedWeekdays = {'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'};
      }
      _loading = false;
    });
  }

  Map<String, dynamic> _buildPayload() {
    final horizon = int.tryParse(_horizonCtrl.text.trim()) ?? 380;
    final orderedWeekdays = _weekdays
        .map((w) => w['code']!)
        .where((code) => _selectedWeekdays.contains(code))
        .toList();

    return {
      'searchDescription': _descriptionCtrl.text.trim(),
      'horizonDays': horizon,
      'priorityWeekdays': orderedWeekdays,
      'includeHolidays': _includeHolidays,
      'geographicFocus': _geoFocusCtrl.text.trim(),
      'eventTypes': _eventTypes,
      'exclusions': _exclusions,
    };
  }

  String _buildLivePromptPreview() {
    final horizon = int.tryParse(_horizonCtrl.text.trim()) ?? 380;
    final activeTypes =
        _eventTypes.where((t) => t['enabled'] != false).toList();
    final typesText = activeTypes.isEmpty
        ? '- (Nenhum tipo selecionado)'
        : activeTypes
            .map((t) =>
                '- ${t['name'] ?? ''}${(t['detail'] ?? '').toString().trim().isNotEmpty ? ': ${t['detail']}' : ''}')
            .join('\n');

    final orderedWeekdays = _weekdays
        .map((w) => w['code']!)
        .where((code) => _selectedWeekdays.contains(code))
        .join(', ');

    final holidaysText = _includeHolidays
        ? 'Incluir feriados nacionais, estaduais e municipais no período.'
        : 'Não priorizar feriados isolados sem evento confirmado.';

    final geoText = _geoFocusCtrl.text.trim().isNotEmpty
        ? 'FOCO GEOGRÁFICO / RAIO: ${_geoFocusCtrl.text.trim()}\n'
        : '';

    final exclText = _exclusions.isNotEmpty
        ? 'EXCLUSÕES (NÃO RETORNAR):\n${_exclusions.map((e) => '- ${e['text'] ?? ''}').join('\n')}\n'
        : '';

    return '''${_descriptionCtrl.text.trim()}

JANELA OBRIGATÓRIA: Próximos $horizon dias a partir da data da pesquisa.
DIAS PRIORITÁRIOS: ${orderedWeekdays.isEmpty ? 'Nenhum' : orderedWeekdays}. $holidaysText
${geoText}TIPOS DE EVENTOS PROCURADOS:
$typesText

${exclText}Retorno estruturado em JSON (cityInfo + events[]).''';
  }

  Future<void> _saveConfig() async {
    final horizon = int.tryParse(_horizonCtrl.text.trim());
    if (horizon == null || horizon < 1 || horizon > 730) {
      _showMsg('Horizonte em dias deve estar entre 1 e 730.', isError: true);
      return;
    }
    if (_descriptionCtrl.text.trim().isEmpty) {
      _showMsg('Preencha a descrição detalhada da busca.', isError: true);
      return;
    }
    if (_eventTypes.where((t) => t['enabled'] != false).isEmpty) {
      _showMsg('Mantenha pelo menos 1 tipo de evento ativo.', isError: true);
      return;
    }
    if (_selectedWeekdays.isEmpty) {
      _showMsg('Selecione pelo menos 1 dia da semana.', isError: true);
      return;
    }

    setState(() => _saving = true);
    try {
      final payload = _buildPayload();
      final saved = _isSuperAdminMode
          ? await _api.saveSuperAdminEventSearchConfig(
              widget.companyId!, payload)
          : await _api.saveEventSearchConfig(payload);
      _applyServerDto(saved);
      if (mounted) {
        setState(() => _saving = false);
        _showMsg(
          'Configurações da Busca IA salvas e sincronizadas! A próxima busca já usará este prompt.',
          isError: false,
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        _showMsg(e.toString().replaceFirst('Exception: ', ''), isError: true);
      }
    }
  }

  Future<void> _confirmReset() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _cardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: _accent.withOpacity(0.5)),
        ),
        title: const Row(
          children: [
            Icon(Icons.restart_alt_rounded, color: _accent),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Restaurar Padrão Lumora?',
                style: TextStyle(color: Colors.white, fontSize: 16),
              ),
            ),
          ],
        ),
        content: const Text(
          'Todas as personalizações de tipos de eventos, janela de dias, descrição e exclusões desta empresa voltarão ao padrão original da Lumora.',
          style: TextStyle(color: Colors.white70, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: _accent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Restaurar Padrão',
                style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    setState(() => _saving = true);
    try {
      final reset = _isSuperAdminMode
          ? await _api.resetSuperAdminEventSearchConfig(widget.companyId!)
          : await _api.resetEventSearchConfig();
      _applyServerDto(reset);
      if (mounted) {
        setState(() => _saving = false);
        _showMsg('Padrão Lumora restaurado com sucesso.', isError: false);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        _showMsg(e.toString().replaceFirst('Exception: ', ''), isError: true);
      }
    }
  }

  Future<void> _openEventTypeDialog({int? index}) async {
    final existing = index != null ? _eventTypes[index] : null;
    final nameCtrl =
        TextEditingController(text: (existing?['name'] ?? '').toString());
    final detailCtrl =
        TextEditingController(text: (existing?['detail'] ?? '').toString());

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _cardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: _accent.withOpacity(0.5)),
        ),
        title: Text(
          existing == null
              ? 'Adicionar Tipo de Evento'
              : 'Editar Tipo de Evento',
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Nome da categoria / tipo *',
                labelStyle: TextStyle(color: Colors.white70, fontSize: 12),
                filled: true,
                fillColor: _bg,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: detailCtrl,
              maxLines: 3,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Detalhamento para a IA (opcional)',
                labelStyle: TextStyle(color: Colors.white70, fontSize: 12),
                filled: true,
                fillColor: _bg,
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: _accent),
            onPressed: () {
              if (nameCtrl.text.trim().isEmpty) {
                _showMsg('Informe o nome do tipo de evento.', isError: true);
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: Text(existing == null ? 'Adicionar' : 'Aplicar',
                style: const TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (ok == true) {
      final item = {
        'id': existing?['id'] ??
            'custom_${DateTime.now().millisecondsSinceEpoch}',
        'name': nameCtrl.text.trim(),
        'detail': detailCtrl.text.trim(),
        'enabled': existing?['enabled'] ?? true,
      };
      setState(() {
        if (index == null) {
          _eventTypes.add(item);
        } else {
          _eventTypes[index] = item;
        }
      });
    }
    nameCtrl.dispose();
    detailCtrl.dispose();
  }

  Future<void> _openExclusionDialog({int? index}) async {
    final existing = index != null ? _exclusions[index] : null;
    final textCtrl =
        TextEditingController(text: (existing?['text'] ?? '').toString());

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _cardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: _accent.withOpacity(0.5)),
        ),
        title: Text(
          existing == null ? 'Adicionar Exclusão' : 'Editar Exclusão',
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
        content: TextField(
          controller: textCtrl,
          maxLines: 3,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            labelText: 'O que a IA NÃO deve trazer *',
            labelStyle: TextStyle(color: Colors.white70, fontSize: 12),
            filled: true,
            fillColor: _bg,
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: _accent),
            onPressed: () {
              if (textCtrl.text.trim().isEmpty) {
                _showMsg('Descreva o critério de exclusão.', isError: true);
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: Text(existing == null ? 'Adicionar' : 'Aplicar',
                style: const TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (ok == true) {
      final item = {
        'id':
            existing?['id'] ?? 'excl_${DateTime.now().millisecondsSinceEpoch}',
        'text': textCtrl.text.trim(),
      };
      setState(() {
        if (index == null) {
          _exclusions.add(item);
        } else {
          _exclusions[index] = item;
        }
      });
    }
    textCtrl.dispose();
  }

  void _showMsg(String message, {required bool isError}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? _red : _green,
      ),
    );
  }

  Widget _sectionCard({
    required IconData icon,
    required String title,
    String? subtitle,
    Widget? trailing,
    required Widget child,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _accent.withOpacity(0.42)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: _accent, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 11,
                        ),
                      ),
                  ],
                ),
              ),
              if (trailing != null) trailing,
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentHorizon = int.tryParse(_horizonCtrl.text.trim()) ?? 380;

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _cardBg,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Configurar Busca de Eventos IA',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (_isSuperAdminMode &&
                (widget.companyName ?? '').trim().isNotEmpty)
              Text(
                'Empresa: ${widget.companyName}',
                style: const TextStyle(color: _accentSoft, fontSize: 11),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Recarregar configuração',
            onPressed: (_loading || _saving) ? null : _loadConfig,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _accent))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline,
                            color: _red, size: 42),
                        const SizedBox(height: 12),
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white70),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          style:
                              ElevatedButton.styleFrom(backgroundColor: _accent),
                          onPressed: _loadConfig,
                          child: const Text('Tentar Novamente',
                              style: TextStyle(color: Colors.white)),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _cardBg,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: (_isDefault ? _accent : _green)
                                .withOpacity(0.5)),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            _isDefault
                                ? Icons.auto_awesome_rounded
                                : Icons.tune_rounded,
                            color: _isDefault ? _accentSoft : _green,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _isDefault
                                      ? 'Usando Padrão Canônico Lumora'
                                      : 'Configuração Personalizada Ativa',
                                  style: TextStyle(
                                    color: _isDefault ? _accentSoft : _green,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                Text(
                                  'Admin e SuperAdmin operam no mesmo perfil sincronizado${_configHash != null ? ' • Hash ${_configHash!.substring(0, 8)}' : ''}',
                                  style: const TextStyle(
                                      color: Colors.white60, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    _sectionCard(
                      icon: Icons.category_rounded,
                      title: 'Tipos de Eventos Procurados',
                      subtitle:
                          'Adicione, edite, pause ou remova categorias usadas na busca IA.',
                      trailing: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          side: BorderSide(color: _accent.withOpacity(0.7)),
                          foregroundColor: _accentSoft,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 6),
                        ),
                        icon: const Icon(Icons.add_rounded, size: 16),
                        label: const Text('Adicionar',
                            style: TextStyle(fontSize: 12)),
                        onPressed: () => _openEventTypeDialog(),
                      ),
                      child: _eventTypes.isEmpty
                          ? const Text(
                              'Nenhum tipo cadastrado. Adicione ao menos 1 tipo ativo.',
                              style: TextStyle(
                                  color: Colors.white60, fontSize: 12),
                            )
                          : Column(
                              children:
                                  List.generate(_eventTypes.length, (index) {
                                final item = _eventTypes[index];
                                final enabled = item['enabled'] != false;
                                return Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: _bg,
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                      color: enabled
                                          ? _accent.withOpacity(0.38)
                                          : Colors.white12,
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      Switch(
                                        value: enabled,
                                        activeColor: _accent,
                                        onChanged: (val) {
                                          setState(() {
                                            _eventTypes[index]['enabled'] = val;
                                          });
                                        },
                                      ),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              (item['name'] ?? '').toString(),
                                              style: TextStyle(
                                                color: enabled
                                                    ? Colors.white
                                                    : Colors.white54,
                                                fontWeight: FontWeight.bold,
                                                fontSize: 13,
                                                decoration: enabled
                                                    ? null
                                                    : TextDecoration
                                                        .lineThrough,
                                              ),
                                            ),
                                            if ((item['detail'] ?? '')
                                                .toString()
                                                .trim()
                                                .isNotEmpty)
                                              Text(
                                                (item['detail'] ?? '')
                                                    .toString(),
                                                style: const TextStyle(
                                                    color: Colors.white60,
                                                    fontSize: 11),
                                              ),
                                          ],
                                        ),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.edit_rounded,
                                            color: _accentSoft, size: 18),
                                        tooltip: 'Editar tipo',
                                        onPressed: () =>
                                            _openEventTypeDialog(index: index),
                                      ),
                                      IconButton(
                                        icon: const Icon(
                                            Icons.delete_outline_rounded,
                                            color: Colors.redAccent,
                                            size: 18),
                                        tooltip: 'Excluir tipo',
                                        onPressed: () {
                                          setState(() {
                                            _eventTypes.removeAt(index);
                                          });
                                        },
                                      ),
                                    ],
                                  ),
                                );
                              }),
                            ),
                    ),
                    _sectionCard(
                      icon: Icons.date_range_rounded,
                      title: 'Dias e Janela de Busca',
                      subtitle:
                          'Defina quantos dias à frente pesquisar, dias prioritários, feriados e raio.',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Horizonte da pesquisa (dias):',
                            style: TextStyle(
                                color: Colors.white70,
                                fontSize: 12,
                                fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: [30, 60, 90, 380].map((days) {
                              final selected = currentHorizon == days;
                              return ChoiceChip(
                                label: Text('$days dias',
                                    style: TextStyle(
                                      color: selected
                                          ? Colors.white
                                          : Colors.white70,
                                      fontSize: 12,
                                      fontWeight: selected
                                          ? FontWeight.bold
                                          : FontWeight.normal,
                                    )),
                                selected: selected,
                                selectedColor: _accent,
                                backgroundColor: _bg,
                                onSelected: (_) {
                                  setState(() {
                                    _horizonCtrl.text = '$days';
                                  });
                                },
                              );
                            }).toList(),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _horizonCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                              labelText: 'Campo livre de dias (1 a 730)',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 14),
                          const Text(
                            'Dias da semana prioritários:',
                            style: TextStyle(
                                color: Colors.white70,
                                fontSize: 12,
                                fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: _weekdays.map((w) {
                              final code = w['code']!;
                              final selected = _selectedWeekdays.contains(code);
                              return FilterChip(
                                label: Text(
                                  w['label']!,
                                  style: TextStyle(
                                    color:
                                        selected ? Colors.white : Colors.white60,
                                    fontSize: 12,
                                  ),
                                ),
                                selected: selected,
                                selectedColor: _accent,
                                checkmarkColor: Colors.white,
                                backgroundColor: _bg,
                                onSelected: (val) {
                                  setState(() {
                                    if (val) {
                                      _selectedWeekdays.add(code);
                                    } else {
                                      _selectedWeekdays.remove(code);
                                    }
                                  });
                                },
                              );
                            }).toList(),
                          ),
                          const SizedBox(height: 8),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            activeColor: _accent,
                            title: const Text(
                              'Incluir Feriados',
                              style:
                                  TextStyle(color: Colors.white, fontSize: 13),
                            ),
                            subtitle: const Text(
                              'Considerar feriados nacionais, estaduais e municipais na janela.',
                              style: TextStyle(
                                  color: Colors.white54, fontSize: 11),
                            ),
                            value: _includeHolidays,
                            onChanged: (v) =>
                                setState(() => _includeHolidays = v),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _geoFocusCtrl,
                            style: const TextStyle(color: Colors.white),
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                              labelText: 'Foco Geográfico / Raio (opcional)',
                              hintText: 'Ex.: Cidades-polo em um raio de 120 km',
                              hintStyle: TextStyle(
                                  color: Colors.white30, fontSize: 12),
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _sectionCard(
                      icon: Icons.description_rounded,
                      title: 'Descrição Detalhada da Busca',
                      subtitle:
                          'Instrução principal enviada ao modelo Gemini sobre foco e critérios de qualidade.',
                      child: TextField(
                        controller: _descriptionCtrl,
                        minLines: 4,
                        maxLines: 8,
                        style:
                            const TextStyle(color: Colors.white, fontSize: 13),
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(
                          filled: true,
                          fillColor: _bg,
                          border: OutlineInputBorder(),
                          hintText:
                              'Descreva exatamente como a IA deve investigar os eventos...',
                          hintStyle:
                              TextStyle(color: Colors.white30, fontSize: 12),
                        ),
                      ),
                    ),
                    _sectionCard(
                      icon: Icons.block_rounded,
                      title: 'Exclusões (O que NÃO trazer)',
                      subtitle:
                          'Filtros negativos explícitos para evitar ruído nos resultados.',
                      trailing: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          side: BorderSide(color: _accent.withOpacity(0.7)),
                          foregroundColor: _accentSoft,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 6),
                        ),
                        icon: const Icon(Icons.add_rounded, size: 16),
                        label: const Text('Adicionar',
                            style: TextStyle(fontSize: 12)),
                        onPressed: () => _openExclusionDialog(),
                      ),
                      child: _exclusions.isEmpty
                          ? const Text(
                              'Nenhuma exclusão adicionada.',
                              style: TextStyle(
                                  color: Colors.white60, fontSize: 12),
                            )
                          : Column(
                              children:
                                  List.generate(_exclusions.length, (index) {
                                final item = _exclusions[index];
                                return Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: _bg,
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                        color: _red.withOpacity(0.28)),
                                  ),
                                  child: Row(
                                    children: [
                                      const Icon(Icons.remove_circle_outline,
                                          color: Colors.redAccent, size: 16),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Text(
                                          (item['text'] ?? '').toString(),
                                          style: const TextStyle(
                                              color: Colors.white70,
                                              fontSize: 12),
                                        ),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.edit_rounded,
                                            color: _accentSoft, size: 18),
                                        tooltip: 'Editar exclusão',
                                        onPressed: () =>
                                            _openExclusionDialog(index: index),
                                      ),
                                      IconButton(
                                        icon: const Icon(
                                            Icons.delete_outline_rounded,
                                            color: Colors.redAccent,
                                            size: 18),
                                        tooltip: 'Excluir critério',
                                        onPressed: () {
                                          setState(() {
                                            _exclusions.removeAt(index);
                                          });
                                        },
                                      ),
                                    ],
                                  ),
                                );
                              }),
                            ),
                    ),
                    Container(
                      margin: const EdgeInsets.only(bottom: 20),
                      decoration: BoxDecoration(
                        color: _cardBg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: _accent.withOpacity(0.42)),
                      ),
                      child: ExpansionTile(
                        iconColor: _accent,
                        collapsedIconColor: Colors.white60,
                        leading:
                            const Icon(Icons.visibility_rounded, color: _accent),
                        title: const Text(
                          'Prévia do Prompt Final',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.bold),
                        ),
                        subtitle: Text(
                          _serverPromptPreview != null
                              ? 'Atualizado em tempo real para o Google Gemini'
                              : 'Visualização do comando consolidado',
                          style: const TextStyle(
                              color: Colors.white60, fontSize: 11),
                        ),
                        children: [
                          Container(
                            width: double.infinity,
                            margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: _bg,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: SelectableText(
                              _buildLivePromptPreview(),
                              style: const TextStyle(
                                color: Color(0xFFE2E8F0),
                                fontSize: 11,
                                fontFamily: 'monospace',
                                height: 1.4,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(color: _accent.withOpacity(0.7)),
                              foregroundColor: _accentSoft,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                            ),
                            icon: const Icon(Icons.restart_alt_rounded, size: 18),
                            label: const Text('Restaurar Padrão'),
                            onPressed: _saving ? null : _confirmReset,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 2,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _accent,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                            ),
                            icon: _saving
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white),
                                  )
                                : const Icon(Icons.save_rounded, size: 18),
                            label: Text(_saving
                                ? 'Salvando...'
                                : 'Salvar Configurações'),
                            onPressed: _saving ? null : _saveConfig,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
    );
  }
}
