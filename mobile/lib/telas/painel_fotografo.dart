import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:provider/provider.dart';
import 'tela_configuracoes.dart';
import 'package:signature/signature.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

import 'lista_fichas_fotografo.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_sincronizacao.dart' as tela_sincronizacao;

import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../utils/km_request_dialog.dart';
import '../utils/ui_helpers.dart';
import '../utils/brazilian_phone_formatter.dart';
import '../widgets/led_button.dart';

// ── Palette for House Colors ──────────────────────────────────────────────────
const List<Color> _houseColors = [
  Colors.white,
  Colors.grey,
  Colors.black,
  Colors.red,
  Colors.orange,
  Colors.yellow,
  Colors.green,
  Colors.blue,
  Colors.purple,
  Colors.pink,
  Colors.brown,
];

const Set<String> _validBrazilianUfs = {
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
};

typedef PhoneInputFormatter = BrazilianPhoneFormatter;

class _ChildFormItem {
  final TextEditingController nameController;
  final TextEditingController ageController;
  final FocusNode nameFocusNode;

  _ChildFormItem({String name = '', String age = ''})
      : nameController = TextEditingController(text: name),
        ageController = TextEditingController(text: age),
        nameFocusNode = FocusNode();

  void dispose() {
    nameController.dispose();
    ageController.dispose();
    nameFocusNode.dispose();
  }
}

class PhotographerDashboard extends StatefulWidget {
  const PhotographerDashboard({super.key});

  @override
  State<PhotographerDashboard> createState() => _PhotographerDashboardState();
}

class _PhotographerDashboardState extends State<PhotographerDashboard>
    with SingleTickerProviderStateMixin {
  // Lote Memory State
  String? _currentCityLote;
  String? _currentEventName;
  int _sequenceCount = 1;
  int _fichasHojeCount = 0;
  int _pendingFichasCount = 0;
  bool _isResetting = false;
  List<String> _sessionFichas = [];

  // Form State
  final _formKey = GlobalKey<FormState>();
  final _formScrollController = ScrollController();
  final _nameController = TextEditingController();
  final _cepController = TextEditingController();
  final _streetController = TextEditingController();
  final _numberController = TextEditingController();
  final _complementController = TextEditingController();
  final _condoController = TextEditingController();
  final _blockController = TextEditingController();
  final _aptController = TextEditingController();
  final _neighborhoodController = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _phoneController = TextEditingController();
  final _phone2Controller = TextEditingController();
  final _referenceController = TextEditingController();
  final _professionController = TextEditingController();

  bool _noNumber = false;
  String? _propertyType; // 'CASA', 'APARTAMENTO', 'OUTRO'
  bool _showAdditionalAddressFields = false;

  Color? _selectedHouseColor;
  String? _houseFinish; // 'NO_REBOCO', 'SEM_REBOCO'
  Color? _selectedGateColor;
  bool _hasNoGate = false;
  final _gateObservationController = TextEditingController();
  TimeOfDay? _visitTime;

  // Children Inline
  final List<_ChildFormItem> _childFormItems = [];
  final _clothesColorController = TextEditingController();

  final SignatureController _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );

  bool _isLoading = false;
  String? _generatedQrCodeData;
  String? _currentFichaUuid;
  String? _confirmedVisibleCode;
  bool _isFichaSynced = false;

  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  List<String> _professionsCache = [];

  String _userName = '';
  String _greeting = 'Olá';
  String _verse = '';

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim = CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();

    if (_childFormItems.isEmpty) {
      _childFormItems.add(_createChildItem());
    }

    _loadProfessions();
    _restoreFormDraft();

    final controllersToWatch = [
      _nameController,
      _phoneController,
      _phone2Controller,
      _professionController,
      _cepController,
      _streetController,
      _numberController,
      _complementController,
      _condoController,
      _blockController,
      _aptController,
      _neighborhoodController,
      _cityController,
      _stateController,
      _referenceController,
      _gateObservationController,
      _clothesColorController,
    ];
    for (final ctrl in controllersToWatch) {
      ctrl.addListener(_saveFormDraft);
    }

    _loadFichasHojeCount();
    _loadUserData();

    try {
      final syncService = Provider.of<SyncService>(context, listen: false);
      syncService.addListener(_onSyncUpdate);
    } catch (_) {}

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initLoteAndCheckKm();
    });
  }

  void _onSyncUpdate() {
    if (mounted) {
      _loadFichasHojeCount();
    }
  }

  Future<void> _initLoteAndCheckKm() async {
    final prefs = await SharedPreferences.getInstance();
    final city = prefs.getString('lote_city');
    final event = prefs.getString('lote_event_name');
    final photographerCode = prefs.getString('photographer_code') ?? '0000';
    int seq = 1;
    if (city != null && event != null) {
      final eventAbbrev = _abbreviateEvent(event);
      final seqKey = _getSequenceKey(photographerCode, eventAbbrev, city);
      seq = prefs.getInt(seqKey) ?? prefs.getInt('lote_sequence_count') ?? 1;
    } else {
      seq = prefs.getInt('lote_sequence_count') ?? 1;
    }
    final fichas = prefs.getStringList('lote_session_fichas') ?? <String>[];

    if (mounted) {
      setState(() {
        _currentCityLote = city;
        _currentEventName = event;
        _sequenceCount = seq;
        _sessionFichas = List<String>.from(fichas);
      });
    }

    if (!mounted) return;

    if (_currentCityLote == null ||
        _currentCityLote!.isEmpty ||
        _currentEventName == null ||
        _currentEventName!.isEmpty) {
      await _showLoteConfigDialog();
    }

    if (mounted) {
      KmRequestHelper.checkKmRequests(context);
    }
  }

  Future<void> _loadUserData() async {
    final name = await UIHelpers.getUserName();
    final quote = await ApiService().getDailyQuote();
    if (mounted) {
      setState(() {
        _userName = name;
        _greeting = UIHelpers.getGreeting();
        _verse = quote.isNotEmpty
            ? quote
            : '"A persistência realiza o impossível." - Provérbio Chinês';
      });
    }
  }

  Future<void> _loadFichasHojeCount() async {
    try {
      final now = DateTime.now();
      final todayStart = DateTime(now.year, now.month, now.day);
      final todayEnd = DateTime(now.year, now.month, now.day, 23, 59, 59, 999);

      final Set<String> todayFichaKeys = {};
      int pendingCount = 0;

      // 1. Tentar buscar do servidor se houver conexão
      try {
        final serverFichas = await ApiService().getClientsByPhotographer();
        for (final f in serverFichas) {
          final dtStr = f['createdAt']?.toString();
          if (dtStr != null) {
            final parsed = DateTime.tryParse(dtStr)?.toLocal();
            if (parsed != null &&
                !parsed.isBefore(todayStart) &&
                !parsed.isAfter(todayEnd)) {
              final key = f['uuid']?.toString() ??
                  f['id']?.toString() ??
                  f['sequenceNumber']?.toString();
              if (key != null && key.isNotEmpty) {
                todayFichaKeys.add(key);
              }
            }
          }
        }
      } catch (_) {
        // Offline ou erro de rede: preserva contagem local
      }

      // 2. Mesclar com pendências locais do SyncService
      if (mounted) {
        final syncService = Provider.of<SyncService>(context, listen: false);
        final pendingClientReqs = syncService.pendingRequests.where((r) =>
            r.type == 'SYNC_CLIENTS' ||
            r.type == 'REGISTER_CLIENT' ||
            r.type == 'CREATE_CLIENT');

        for (final req in pendingClientReqs) {
          final reqDate = req.createdAt.toLocal();
          if (!reqDate.isBefore(todayStart) && !reqDate.isAfter(todayEnd)) {
            final payload = req.payload;
            final key = payload['uuid']?.toString() ??
                payload['localId']?.toString() ??
                req.id;
            if (key.isNotEmpty) {
              if (!todayFichaKeys.contains(key)) {
                todayFichaKeys.add(key);
                pendingCount++;
              }
            }
          }
        }
      }

      if (mounted) {
        setState(() {
          _fichasHojeCount = todayFichaKeys.length;
          _pendingFichasCount = pendingCount;
        });
      }
    } catch (_) {}
  }

  Future<void> _loadProfessions() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _professionsCache = prefs.getStringList('professions_cache') ?? [];
    });
  }

  Future<void> _saveProfession(String prof) async {
    if (prof.isEmpty) return;
    if (!_professionsCache.contains(prof)) {
      _professionsCache.add(prof);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList('professions_cache', _professionsCache);
    }
  }

  _ChildFormItem _createChildItem({String name = '', String age = ''}) {
    final item = _ChildFormItem(name: name, age: age);
    item.nameController.addListener(_saveFormDraft);
    item.ageController.addListener(_saveFormDraft);
    return item;
  }

  void _addNewChildItem() {
    final newItem = _createChildItem();
    setState(() {
      _childFormItems.add(newItem);
    });
    _saveFormDraft();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      newItem.nameFocusNode.requestFocus();
      if (_formScrollController.hasClients) {
        _formScrollController.animateTo(
          _formScrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _confirmRemoveChild(int index) async {
    if (index >= _childFormItems.length) return;
    final item = _childFormItems[index];
    final hasContent = item.nameController.text.trim().isNotEmpty ||
        item.ageController.text.trim().isNotEmpty;

    if (hasContent) {
      final nameToShow = item.nameController.text.trim().isNotEmpty
          ? item.nameController.text.trim()
          : 'Criança ${index + 1}';
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text('Remover criança?',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          content: Text('Deseja realmente remover os dados de "$nameToShow"?',
              style: const TextStyle(color: Colors.white70)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
              child: const Text('Remover', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      );
      if (confirm != true) return;
    }

    setState(() {
      final removed = _childFormItems.removeAt(index);
      removed.dispose();
      if (_childFormItems.isEmpty) {
        _childFormItems.add(_createChildItem());
      }
    });
    _saveFormDraft();
  }

  Future<void> _saveFormDraft() async {
    if (_isResetting) return;
    if (_generatedQrCodeData != null) return;
    final hasAnyData = _nameController.text.trim().isNotEmpty ||
        _phoneController.text.trim().isNotEmpty ||
        _phone2Controller.text.trim().isNotEmpty ||
        _streetController.text.trim().isNotEmpty ||
        _childFormItems.any((c) => c.nameController.text.trim().isNotEmpty);
    if (!hasAnyData) {
      await _clearFormDraft();
      return;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      _currentFichaUuid ??= SyncService.generateUuid();
      final draft = {
        'currentFichaUuid': _currentFichaUuid,
        'confirmedVisibleCode': _confirmedVisibleCode,
        'isFichaSynced': _isFichaSynced,
        'name': _nameController.text,
        'phone': _phoneController.text,
        'phone2': _phone2Controller.text,
        'profession': _professionController.text,
        'cep': _cepController.text,
        'street': _streetController.text,
        'number': _numberController.text,
        'noNumber': _noNumber,
        'propertyType': _propertyType,
        'showAdditionalAddressFields': _showAdditionalAddressFields,
        'complement': _complementController.text,
        'condo': _condoController.text,
        'block': _blockController.text,
        'apt': _aptController.text,
        'neighborhood': _neighborhoodController.text,
        'city': _cityController.text,
        'state': _stateController.text,
        'reference': _referenceController.text,
        'houseColor': _selectedHouseColor?.value,
        'houseFinish': _houseFinish,
        'hasNoGate': _hasNoGate,
        'gateColor': _selectedGateColor?.value,
        'gateObs': _gateObservationController.text,
        'clothesColor': _clothesColorController.text,
        'children': _childFormItems
            .map((c) => {
                  'name': c.nameController.text,
                  'age': c.ageController.text,
                })
            .toList(),
        'visitTimeHour': _visitTime?.hour,
        'visitTimeMinute': _visitTime?.minute,
      };
      await prefs.setString('fotografo_form_draft_v1', jsonEncode(draft));
    } catch (_) {}
  }

  Future<void> _restoreFormDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final draftStr = prefs.getString('fotografo_form_draft_v1');
      if (draftStr != null && draftStr.isNotEmpty) {
        final draft = jsonDecode(draftStr) as Map<String, dynamic>;
        setState(() {
          _currentFichaUuid = draft['currentFichaUuid']?.toString() ?? SyncService.generateUuid();
          _confirmedVisibleCode = draft['confirmedVisibleCode']?.toString();
          _isFichaSynced = draft['isFichaSynced'] == true;
          _nameController.text = draft['name'] ?? '';
          _phoneController.text = draft['phone'] ?? '';
          _phone2Controller.text = draft['phone2'] ?? '';
          _professionController.text = draft['profession'] ?? '';
          _cepController.text = draft['cep'] ?? '';
          _streetController.text = draft['street'] ?? '';
          _numberController.text = draft['number'] ?? '';
          _noNumber = draft['noNumber'] == true;
          _propertyType = draft['propertyType']?.toString();
          _complementController.text = draft['complement'] ?? '';
          _condoController.text = draft['condo'] ?? '';
          _blockController.text = draft['block'] ?? '';
          _aptController.text = draft['apt'] ?? '';
          _neighborhoodController.text = draft['neighborhood'] ?? '';
          _cityController.text = draft['city'] ?? '';
          _stateController.text = draft['state'] ?? '';
          _referenceController.text = draft['reference'] ?? '';
          _gateObservationController.text = draft['gateObs'] ?? '';
          _clothesColorController.text = draft['clothesColor'] ?? '';

          final hasAdditionalData = _complementController.text.isNotEmpty ||
              _condoController.text.isNotEmpty ||
              _blockController.text.isNotEmpty ||
              _aptController.text.isNotEmpty;
          _showAdditionalAddressFields = draft['showAdditionalAddressFields'] == true ||
              _propertyType == 'APARTAMENTO' ||
              hasAdditionalData;

          _houseFinish = draft['houseFinish']?.toString();
          _hasNoGate = draft['hasNoGate'] == true;

          if (draft['children'] != null && draft['children'] is List) {
            for (final item in _childFormItems) {
              item.dispose();
            }
            _childFormItems.clear();
            for (final c in draft['children']) {
              if (c is Map) {
                _childFormItems.add(_createChildItem(
                  name: c['name']?.toString() ?? '',
                  age: c['age']?.toString() ?? '',
                ));
              }
            }
          }
          if (_childFormItems.isEmpty) {
            _childFormItems.add(_createChildItem());
          }

          if (draft['houseColor'] != null) {
            _selectedHouseColor = Color(draft['houseColor'] as int);
          }
          if (draft['gateColor'] != null) {
            _selectedGateColor = Color(draft['gateColor'] as int);
          }
          if (draft['visitTimeHour'] != null &&
              draft['visitTimeMinute'] != null) {
            _visitTime = TimeOfDay(
              hour: draft['visitTimeHour'] as int,
              minute: draft['visitTimeMinute'] as int,
            );
          }
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                  'Rascunho de ficha salvo automaticamente foi restaurado!'),
              backgroundColor: Colors.blueAccent,
              duration: Duration(seconds: 3),
            ),
          );
        }
      }
    } catch (_) {}
  }

  Future<void> _clearFormDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('fotografo_form_draft_v1');
    } catch (_) {}
  }

  @override
  void dispose() {
    try {
      final syncService = Provider.of<SyncService>(context, listen: false);
      syncService.removeListener(_onSyncUpdate);
    } catch (_) {}
    _animController.dispose();
    _nameController.dispose();
    _cepController.dispose();
    _streetController.dispose();
    _numberController.dispose();
    _complementController.dispose();
    _condoController.dispose();
    _blockController.dispose();
    _aptController.dispose();
    _neighborhoodController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _phoneController.dispose();
    _phone2Controller.dispose();
    _referenceController.dispose();
    _professionController.dispose();
    _clothesColorController.dispose();
    _gateObservationController.dispose();
    _signatureController.dispose();

    for (final item in _childFormItems) {
      item.dispose();
    }

    super.dispose();
  }

  // ── Lote Config ─────────────────────────────────────────────────────────────
  Future<void> _showLoteConfigDialog() async {
    final loteCtrl = TextEditingController(text: _currentCityLote ?? '');
    final eventCtrl = TextEditingController(text: _currentEventName ?? '');
    final formKey = GlobalKey<FormState>();

    // Fetch upcoming events to suggest
    List<String> eventSuggestions = [];
    try {
      final upcoming = await ApiService().getUpcomingEvents();
      eventSuggestions =
          upcoming.map((e) => (e['name'] ?? '').toString()).toList();
    } catch (_) {}

    if (!mounted) return;

    await showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) {
          return AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            title: const Text('Configurar Lote da Sessão e Evento',
                style: TextStyle(color: Colors.white)),
            content: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: loteCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                        labelText: 'Rótulo do Lote da Sessão (Ex: LOTE-01, BSB-MANHA)',
                        labelStyle: TextStyle(color: Colors.white54),
                        hintText: 'Identificador do lote de fotos deste momento',
                        hintStyle: TextStyle(color: Colors.white24)),
                    validator: (v) =>
                        v == null || v.trim().isEmpty ? 'Obrigatório' : null,
                  ),
                  const SizedBox(height: 12),
                  Autocomplete<String>(
                    initialValue:
                        TextEditingValue(text: _currentEventName ?? ''),
                    optionsBuilder: (TextEditingValue textEditingValue) {
                      if (textEditingValue.text.isEmpty) {
                        return eventSuggestions;
                      }
                      return eventSuggestions.where((String option) {
                        return option
                            .toLowerCase()
                            .contains(textEditingValue.text.toLowerCase());
                      });
                    },
                    onSelected: (String selection) {
                      eventCtrl.text = selection;
                    },
                    fieldViewBuilder:
                        (context, controller, focusNode, onFieldSubmitted) {
                      // Sync the autocomplete controller with our eventCtrl
                      controller.addListener(() {
                        eventCtrl.text = controller.text;
                      });
                      return TextFormField(
                        controller: controller,
                        focusNode: focusNode,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          labelText: 'Nome do Evento (Sugestões automáticas)',
                          labelStyle: TextStyle(color: Colors.white54),
                          hintText: 'Digite ou selecione um evento...',
                          hintStyle: TextStyle(color: Colors.white24),
                        ),
                        validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                      );
                    },
                    optionsViewBuilder: (context, onSelected, options) {
                      return Align(
                        alignment: Alignment.topLeft,
                        child: Material(
                          elevation: 4.0,
                          color: const Color(0xFF2A2A3E),
                          borderRadius: BorderRadius.circular(8),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(
                                maxHeight: 200, maxWidth: 250),
                            child: ListView.builder(
                              padding: EdgeInsets.zero,
                              itemCount: options.length,
                              itemBuilder: (BuildContext context, int index) {
                                final String option = options.elementAt(index);
                                return InkWell(
                                  onTap: () => onSelected(option),
                                  child: Padding(
                                    padding: const EdgeInsets.all(16.0),
                                    child: Text(option,
                                        style: const TextStyle(
                                            color: Colors.white)),
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            actions: [
              if (_currentCityLote != null &&
                  _currentCityLote!.isNotEmpty &&
                  _currentEventName != null &&
                  _currentEventName!.isNotEmpty)
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar',
                      style: TextStyle(color: Colors.white54)),
                ),
              LedButton(
                onPressed: () async {
                  if (formKey.currentState!.validate()) {
                    final city = loteCtrl.text.toUpperCase();
                    final event = eventCtrl.text;

                    final prefs = await SharedPreferences.getInstance();
                    final photographerCode =
                        prefs.getString('photographer_code') ?? '0000';
                    final eventAbbrev = _abbreviateEvent(event);
                    final seqKey =
                        _getSequenceKey(photographerCode, eventAbbrev, city);
                    final seq = prefs.getInt(seqKey) ??
                        prefs.getInt('lote_sequence_count') ??
                        1;

                    await prefs.setString('lote_city', city);
                    await prefs.setString('lote_event_name', event);
                    await prefs.setStringList('lote_session_fichas', []);
                    await prefs.setInt('lote_sequence_count', seq);

                    if (mounted) {
                      setState(() {
                        _currentCityLote = city;
                        _currentEventName = event;
                        _sequenceCount = seq;
                        _sessionFichas = [];
                      });
                      Navigator.pop(context);
                    }
                  }
                },
                style: LedButton.styleFrom(
                    backgroundColor: const Color(0xFFCE93D8)),
                child: const Text('Salvar Sessão',
                    style: TextStyle(color: Colors.white)),
              ),
            ],
          );
        });
  }

  // ── CEP Lookup ───────────────────────────────────────────────────────────────
  Future<void> _onCepChanged(String value) async {
    final cleanCep = value.replaceAll(RegExp(r'[^0-9]'), '');
    if (cleanCep.length == 8) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Buscando CEP...'),
            duration: Duration(milliseconds: 1000)));
      }
      try {
        final response = await http
            .get(Uri.parse('https://viacep.com.br/ws/$cleanCep/json/'));
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['erro'] != true) {
            setState(() {
              _streetController.text = data['logradouro'] ?? '';
              _neighborhoodController.text = data['bairro'] ?? '';
              _cityController.text = data['localidade'] ?? '';
              _stateController.text =
                  (data['uf'] ?? '').toString().toUpperCase();
              final comp = data['complemento']?.toString() ?? '';
              if (comp.isNotEmpty &&
                  _complementController.text.trim().isEmpty) {
                _complementController.text = comp;
              }
            });
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Endereço preenchido com sucesso!'),
                  backgroundColor: Colors.green,
                  duration: Duration(milliseconds: 1500)));
            }
          } else {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text(
                      'CEP não encontrado. Preencha o endereço manualmente.'),
                  backgroundColor: Colors.orange,
                  duration: Duration(seconds: 3)));
            }
          }
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text(
                  'Não foi possível consultar o CEP online. Você pode preencher manualmente.'),
              backgroundColor: Colors.blueGrey,
              duration: Duration(seconds: 2)));
        }
      }
    }
  }

  // ── Form Actions ────────────────────────────────────────────────────────────
  Future<void> _pickTime() async {
    final TimeOfDay? picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.now(),
      builder: (BuildContext context, Widget? child) {
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
          child: child!,
        );
      },
    );
    if (picked != null && picked != _visitTime) {
      setState(() {
        _visitTime = picked;
      });
    }
  }

  void _scrollToTop() {
    if (_formScrollController.hasClients) {
      _formScrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeOut,
      );
    }
  }

  void _submitForm() async {
    if (!_formKey.currentState!.validate()) {
      _scrollToTop();
      return;
    }

    if (!_noNumber && _numberController.text.trim().isEmpty) {
      _scrollToTop();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Informe o número do imóvel ou marque "Sem número".')));
      return;
    }

    if (_selectedHouseColor == null && _houseFinish == null) {
      _scrollToTop();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('A cor da casa ou acabamento é obrigatório.')));
      return;
    }

    if (!_hasNoGate && _selectedGateColor == null) {
      _scrollToTop();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content:
              Text('A cor do portão é obrigatória (ou marque "Sem portão").')));
      return;
    }

    if (_visitTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('O horário de visita é obrigatório.')));
      return;
    }

    final validChildren = _childFormItems
        .where((c) => c.nameController.text.trim().isNotEmpty)
        .map((c) => {
              'name': c.nameController.text.trim(),
              'age': c.ageController.text.trim(),
            })
        .toList();

    if (validChildren.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('É obrigatório adicionar pelo menos uma criança.')));
      return;
    }

    if (_signatureController.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('A assinatura do responsável é obrigatória.')));
      return;
    }

    if (_currentCityLote == null || _currentEventName == null) {
      _showLoteConfigDialog();
      return;
    }

    await _saveProfession(_professionController.text.trim());

    bool? accepted = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (context) {
          return AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            title: const Text('Aviso Legal',
                style: TextStyle(color: Colors.white)),
            content: const Text(
              'Autorizo fotografar minha criança(s) ganhar uma book presente e demonstrar as outras books sem compromisso de compra em até 90 dias.',
              style: TextStyle(color: Colors.white70),
            ),
            actions: [
              LedButton(
                onPressed: () => Navigator.of(context).pop(true),
                style: LedButton.styleFrom(backgroundColor: Colors.green),
                child: const Text('Li e Aceito',
                    style: TextStyle(color: Colors.white)),
              ),
            ],
          );
        });

    if (accepted != true) return;

    setState(() => _isLoading = true);

    try {
      final signatureBytes = await _signatureController.toPngBytes();
      if (signatureBytes == null || signatureBytes.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('A assinatura é obrigatória.'),
              backgroundColor: Colors.red));
        }
        return;
      }
      final base64Signature = base64Encode(signatureBytes);

      final seqString = _sequenceCount.toString().padLeft(4, '0');

      final prefs = await SharedPreferences.getInstance();
      final photographerCode = prefs.getString('photographer_code') ?? '0000';
      final eventAbbrev = _abbreviateEvent(_currentEventName!);
      final seqKey =
          _getSequenceKey(photographerCode, eventAbbrev, _currentCityLote!);

      final sequenceNumber =
          '$photographerCode-$eventAbbrev-$_currentCityLote-$seqString';

      _currentFichaUuid ??= SyncService.generateUuid();
      final fichaUuid = _currentFichaUuid!;
      final localId = SyncService.generateUuid();

      final apiService = Provider.of<ApiService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);

      _cityController.text = _sanitizeCityName(_cityController.text);
      _stateController.text = _stateController.text.trim().toUpperCase();

      final finalNumber = (_noNumber && _numberController.text.trim().isEmpty)
          ? 'S/N'
          : _numberController.text.trim();

      final houseColorValue = _selectedHouseColor != null
          ? (_houseFinish != null
              ? '${_selectedHouseColor!.value};$_houseFinish'
              : _selectedHouseColor!.value.toString())
          : (_houseFinish != null ? ';$_houseFinish' : null);

      final gateColorValue =
          _hasNoGate ? 'NO_GATE' : _selectedGateColor?.value.toString();

      final payload = {
        'localId': localId,
        'uuid': fichaUuid,
        'sequenceNumber': sequenceNumber,
        'createdAt': DateTime.now().toIso8601String(),
        'event': _currentEventName,
        'name': _nameController.text.trim(),
        'phone1': _phoneController.text.trim(),
        'phone2': _phone2Controller.text.trim(),
        'cep': _cepController.text.trim(),
        'street': _streetController.text.trim(),
        'number': finalNumber,
        'propertyType': _propertyType,
        'complement': _complementController.text.trim(),
        'condo': _condoController.text.trim(),
        'block': _blockController.text.trim(),
        'apartment': _aptController.text.trim(),
        'neighborhood': _neighborhoodController.text.trim(),
        'city': _cityController.text.trim(),
        'state': _stateController.text.trim().toUpperCase(),
        'referencePoint': _referenceController.text.trim(),
        'houseColor': houseColorValue,
        'houseFinish': _houseFinish,
        'hasNoGate': _hasNoGate,
        'hasGate': !_hasNoGate,
        'gateColor': gateColorValue,
        'gateObservation':
            _hasNoGate ? '' : _gateObservationController.text.trim(),
        'profession': _professionController.text.trim(),
        'visitTime': _visitTime != null
            ? '${_visitTime!.hour.toString().padLeft(2, '0')}:${_visitTime!.minute.toString().padLeft(2, '0')}'
            : null,
        'clothesColor': _clothesColorController.text.trim(),
        'children': validChildren,
        'signatureBase64': base64Signature,
      };

      bool persistedSuccessfully = false;
      try {
        final syncResult = await apiService.syncClients([payload]);
        final failed = syncResult['failed'];
        if (failed is int && failed > 0) {
          throw Exception('Rejeitado pelo servidor');
        }
        persistedSuccessfully = true;
        final details = syncResult['details'];
        String? confirmedCode;
        if (details is List && details.isNotEmpty && details[0] is Map) {
          confirmedCode = details[0]['visibleCode']?.toString() ??
              details[0]['sequenceNumber']?.toString();
        }
        _confirmedVisibleCode =
            (confirmedCode != null && confirmedCode.isNotEmpty)
                ? confirmedCode
                : sequenceNumber;
        _isFichaSynced = true;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Ficha salva e sincronizada com o servidor!'),
              backgroundColor: Colors.green));
        }
      } catch (e) {
        _confirmedVisibleCode = null;
        _isFichaSynced = false;
        final enqueued =
            await syncService.addPendingRequest('SYNC_CLIENTS', payload);
        if (enqueued) {
          persistedSuccessfully = true;
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Cadastro salvo no aparelho e aguardando sincronização.'),
                backgroundColor: Colors.orange));
          }
        } else {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Erro: falha ao salvar ficha no aparelho. Tente novamente.'),
                backgroundColor: Colors.red));
          }
          return;
        }
      }

      if (persistedSuccessfully) {
        await _clearFormDraft();
        if (!_sessionFichas.contains(sequenceNumber)) {
          _sessionFichas.add(sequenceNumber);
        }

        setState(() {
          _generatedQrCodeData = fichaUuid;
          _sequenceCount++; // Increment for next client
        });
        _loadFichasHojeCount();
        await prefs.setInt(seqKey, _sequenceCount);
        await prefs.setInt('lote_sequence_count', _sequenceCount);
        await prefs.setStringList('lote_session_fichas', _sessionFichas);
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _sanitizeCityName(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return '';
    return trimmed.split(RegExp(r'\s+')).map((word) {
      if (word.isEmpty) return '';
      final lower = word.toLowerCase();
      if (['de', 'da', 'do', 'das', 'dos', 'e'].contains(lower)) {
        return lower;
      }
      return '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}';
    }).join(' ');
  }

  void _resetForm() async {
    _isResetting = true;
    try {
      await _clearFormDraft();
      _currentFichaUuid = null;
      _confirmedVisibleCode = null;
      _isFichaSynced = false;
      _nameController.clear();
      _cepController.clear();
      _streetController.clear();
      _numberController.clear();
      _noNumber = false;
      _propertyType = null;
      _showAdditionalAddressFields = false;
      _complementController.clear();
      _condoController.clear();
      _blockController.clear();
      _aptController.clear();
      _neighborhoodController.clear();
      _cityController.clear();
      _stateController.clear();
      _phoneController.clear();
      _phone2Controller.clear();
      _referenceController.clear();
      _professionController.clear();
      _clothesColorController.clear();
      _gateObservationController.clear();

      for (final item in _childFormItems) {
        item.dispose();
      }
      _childFormItems.clear();
      _childFormItems.add(_createChildItem());

      _selectedHouseColor = null;
      _houseFinish = null;
      _selectedGateColor = null;
      _hasNoGate = false;
      _visitTime = null;
      _signatureController.clear();

      setState(() {
        _generatedQrCodeData = null;
      });
      _loadFichasHojeCount();
    } finally {
      _isResetting = false;
    }
  }

  void _printFicha() async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Nenhuma impressora conectada! Vá nas configurações.',
                style: TextStyle(color: Colors.white)),
            backgroundColor: Colors.red));
      return;
    }

    final displayCode = _isFichaSynced
        ? ((_confirmedVisibleCode != null && _confirmedVisibleCode!.isNotEmpty)
            ? _confirmedVisibleCode!
            : (_currentFichaUuid ?? 'CONFIRMADA'))
        : 'PROV-${(_currentFichaUuid ?? _generatedQrCodeData ?? "").substring(0, (_currentFichaUuid ?? _generatedQrCodeData ?? "").length >= 8 ? 8 : (_currentFichaUuid ?? _generatedQrCodeData ?? "").length).toUpperCase()} (Aguardando sincronização)';

    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FICHA COMPLETA", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Evento: $_currentEventName", 1, 0);
    bluetooth.printCustom("Lote/Cidade: $_currentCityLote", 1, 0);
    bluetooth.printCustom("Ficha: $displayCode", 1, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Nome: ${_nameController.text}", 0, 0);
    bluetooth.printCustom("Telefone: ${_phoneController.text}", 0, 0);
    bluetooth.printCustom("Profissao: ${_professionController.text}", 0, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Endereco", 1, 0);
    bluetooth.printCustom(
        "${_streetController.text}, ${_numberController.text}", 0, 0);
    if (_condoController.text.isNotEmpty ||
        _blockController.text.isNotEmpty ||
        _aptController.text.isNotEmpty ||
        _complementController.text.isNotEmpty) {
      final compStr = [
        if (_condoController.text.isNotEmpty) 'Cond: ${_condoController.text}',
        if (_blockController.text.isNotEmpty) 'Bl: ${_blockController.text}',
        if (_aptController.text.isNotEmpty) 'Apto: ${_aptController.text}',
        if (_complementController.text.isNotEmpty)
          'Compl: ${_complementController.text}',
      ].join(' | ');
      bluetooth.printCustom(compStr, 0, 0);
    }
    bluetooth.printCustom("Bairro: ${_neighborhoodController.text}", 0, 0);
    bluetooth.printCustom("Cep: ${_cepController.text}", 0, 0);
    bluetooth.printCustom("Ref: ${_referenceController.text}", 0, 0);
    bluetooth.printNewLine();
    if (_selectedHouseColor != null) {
      bluetooth.printCustom("Cor da Casa: ${_selectedHouseColor?.value}", 0, 0);
    }
    if (_houseFinish != null) {
      bluetooth.printCustom(
          "Acabamento Casa: ${_houseFinish == 'NO_REBOCO' ? 'No reboco' : 'Sem reboco'}",
          0,
          0);
    }
    if (_hasNoGate) {
      bluetooth.printCustom("Portao: Sem portao", 0, 0);
    } else {
      bluetooth.printCustom(
          "Cor do Portao: ${_selectedGateColor?.value}", 0, 0);
      if (_gateObservationController.text.isNotEmpty) {
        bluetooth.printCustom(
            "Obs Portao: ${_gateObservationController.text}", 0, 0);
      }
    }
    bluetooth.printCustom(
        "Horario Visita: ${_visitTime != null ? '${_visitTime!.hour.toString().padLeft(2, '0')}:${_visitTime!.minute.toString().padLeft(2, '0')}' : ''}",
        0,
        0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Criancas:", 1, 0);
    final validChildren = _childFormItems
        .where((c) => c.nameController.text.trim().isNotEmpty)
        .toList();
    for (var child in validChildren) {
      final name = child.nameController.text.trim();
      final age = child.ageController.text.trim();
      final ageStr =
          age.isNotEmpty ? (age == '1' ? ' — 1 ano' : ' — $age anos') : '';
      bluetooth.printCustom("- $name$ageStr", 0, 0);
    }
    bluetooth.printCustom("Roupa: ${_clothesColorController.text}", 0, 0);
    bluetooth.printNewLine();
    bluetooth.printQRcode(_generatedQrCodeData!, 200, 200, 1);
    bluetooth.printNewLine();
    bluetooth.printNewLine();
    bluetooth.printNewLine();
  }

  String _abbreviateEvent(String eventName) {
    final words = eventName.trim().split(RegExp(r'\s+'));
    if (words.length > 1) {
      final abbrev = words.map((w) => w[0]).join('');
      return abbrev.length > 5
          ? abbrev.substring(0, 5).toUpperCase()
          : abbrev.toUpperCase();
    }
    final single = eventName.trim().replaceAll(RegExp(r'[^a-zA-Z0-9]'), '');
    return single.length > 5
        ? single.substring(0, 5).toUpperCase()
        : single.toUpperCase();
  }

  String _getSequenceKey(
      String photographerCode, String eventAbbrev, String city) {
    final cleanCity =
        city.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');
    final cleanEvent = eventAbbrev.trim().toLowerCase();
    return 'lote_seq_${photographerCode}_${cleanEvent}_${cleanCity}';
  }

  void _printLote() async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Nenhuma impressora conectada! Vá nas configurações.',
                style: TextStyle(color: Colors.white)),
            backgroundColor: Colors.red));
      return;
    }

    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FECHAMENTO DE LOTE", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Evento: $_currentEventName", 1, 1);
    bluetooth.printCustom("Lote/Cidade: $_currentCityLote", 1, 1);
    bluetooth.printCustom("Total de Fichas: ${_sequenceCount - 1}", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("_________________________________", 0, 1);
    bluetooth.printCustom("Assinatura do Fotografo", 0, 1);
    bluetooth.printNewLine();
    bluetooth.printNewLine();
    bluetooth.printNewLine();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Imprimindo fechamento do lote...',
              style: TextStyle(color: Colors.white)),
          backgroundColor: Colors.green));
    }
  }

  void _showFechamentoDialog() {
    if (_currentEventName == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Nenhum lote/evento configurado para fechar!'),
          backgroundColor: Colors.red));
      return;
    }

    if (_sessionFichas.isEmpty) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Nenhuma ficha registrada nesta sessão para fechar o lote.'),
        backgroundColor: Colors.orange,
      ));
      return;
    }

    final syncService = Provider.of<SyncService>(context, listen: false);
    final hasPendingFichas = syncService.pendingRequests.any((req) {
      if (req.type == 'SYNC_CLIENTS' || req.type == 'REGISTER_CLIENT' || req.type == 'CREATE_CLIENT') {
        final seq = req.payload['sequenceNumber']?.toString() ?? req.payload['id']?.toString() ?? req.payload['code']?.toString();
        if (seq != null && _sessionFichas.contains(seq)) return true;
        if (req.payload['clients'] is List) {
          final list = req.payload['clients'] as List;
          return list.any((c) {
            final cSeq = c['sequenceNumber']?.toString() ?? c['id']?.toString() ?? c['code']?.toString();
            return cSeq != null && _sessionFichas.contains(cSeq);
          });
        }
        return true;
      }
      return false;
    });

    if (hasPendingFichas) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Existem fichas locais aguardando confirmação no servidor. Sincronize antes de finalizar o lote.'),
        backgroundColor: Colors.orange,
      ));
      return;
    }

    showDialog(
        context: context,
        builder: (context) {
          return AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            title: const Text('Finalizar Lote/Evento',
                style: TextStyle(color: Colors.white)),
            content: Text(
                'Deseja realmente finalizar a produção do Evento $_currentEventName (Lote: $_currentCityLote) com ${_sessionFichas.length} ficha(s)? O admin será notificado na tela de liberação.',
                style: const TextStyle(color: Colors.white70)),
            actionsAlignment: MainAxisAlignment.end,
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancelar',
                    style: TextStyle(color: Colors.white54)),
              ),
              LedButton(
                onPressed: () async {
                  final eventToFinish = _currentEventName!;
                  final cityToFinish = _currentCityLote;
                  final fichasToFinish = List<String>.from(_sessionFichas);
                  Navigator.pop(context);

                  try {
                    final res = await ApiService().createBookBatch(
                      eventToFinish,
                      city: cityToFinish,
                      clientIds: fichasToFinish,
                    );

                    final prefs = await SharedPreferences.getInstance();
                    await prefs.remove('lote_city');
                    await prefs.remove('lote_event_name');
                    await prefs.remove('lote_sequence_count');
                    await prefs.remove('lote_session_fichas');

                    final cachedStr = prefs.getString('cached_photographer_fichas');
                    if (cachedStr != null) {
                      try {
                        final list = jsonDecode(cachedStr) as List;
                        final updated = list.where((f) {
                          final id = f['id']?.toString();
                          final seq = f['sequenceNumber']?.toString();
                          final code = f['code']?.toString();
                          return !fichasToFinish.contains(id) &&
                                 !fichasToFinish.contains(seq) &&
                                 !fichasToFinish.contains(code);
                        }).toList();
                        await prefs.setString('cached_photographer_fichas', jsonEncode(updated));
                      } catch (_) {}
                    }

                    if (mounted) {
                      setState(() {
                        _currentCityLote = null;
                        _currentEventName = null;
                        _sequenceCount = 1;
                        _sessionFichas = [];
                      });
                      final successMsg = res['message']?.toString() ?? 'Lote finalizado com sucesso! Admin notificado.';
                      ScaffoldMessenger.of(context).clearSnackBars();
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text(successMsg),
                          backgroundColor: Colors.green));

                      // Automatically open config dialog for next event session
                      _showLoteConfigDialog();
                    }
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).clearSnackBars();
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text('Erro ao finalizar lote: $e'),
                          backgroundColor: Colors.red));
                    }
                  }
                },
                style: LedButton.styleFrom(
                    backgroundColor: const Color(0xFFCE93D8)),
                child: const Text('Finalizar Lote',
                    style: TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ],
          );
        });
  }

  void _showSettingsMenuModal() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: SingleChildScrollView(
            child: Container(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                        color: Colors.white30,
                        borderRadius: BorderRadius.circular(2)),
                  ),
                  const SizedBox(height: 16),
                  const Text('Menu de Configurações & Ações',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 20),
                  ListTile(
                    leading: const CircleAvatar(
                        backgroundColor: Colors.white12,
                        child: Icon(Icons.print, color: Colors.orangeAccent)),
                    title: const Text('Imprimir Lote Atual',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    subtitle: const Text(
                        'Imprime o relatório de fechamento do lote em uso',
                        style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.pop(ctx);
                      _printLote();
                    },
                  ),
                  ListTile(
                    leading: const CircleAvatar(
                        backgroundColor: Colors.white12,
                        child: Icon(Icons.done_all_rounded,
                            color: Color(0xFFCE93D8))),
                    title: const Text('Finalizar Fechamento do Evento',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    subtitle: const Text(
                        'Notifica o admin e encerra a produção deste lote',
                        style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.pop(ctx);
                      _showFechamentoDialog();
                    },
                  ),
                  ListTile(
                    leading: const CircleAvatar(
                        backgroundColor: Colors.white12,
                        child: Icon(Icons.sync, color: Colors.blueAccent)),
                    title: const Text('Sincronização Offline',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    subtitle: const Text(
                        'Sincroniza fichas e fotos locais com o servidor',
                        style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.pop(ctx);
                      Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) =>
                                  const tela_sincronizacao.SyncScreen()));
                    },
                  ),
                  ListTile(
                    leading: const CircleAvatar(
                        backgroundColor: Colors.white12,
                        child: Icon(Icons.settings, color: Colors.white70)),
                    title: const Text('Configurações do App & Impressora',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    subtitle: const Text(
                        'Configurar impressora bluetooth e parâmetros',
                        style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.pop(ctx);
                      Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const SettingsScreen(
                                  canManageRoi: false, isFotografo: true)));
                    },
                  ),
                  const SizedBox(height: 12),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // ── UI Building ─────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      body: FadeTransition(
        opacity: _fadeAnim,
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: _generatedQrCodeData != null
                  ? _buildQrCodeScreen()
                  : _buildRegistrationForm(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF2A0D2E),
            Color(0xFF4A0E4E)
          ], // Purple tint for photographer
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [Color(0xFFCE93D8), Color(0xFF8E24AA)]),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                            color: const Color(0xFF8E24AA).withOpacity(0.4),
                            blurRadius: 12,
                            offset: const Offset(0, 4)),
                      ],
                    ),
                    child: const Icon(Icons.camera_alt_rounded,
                        color: Colors.white, size: 22),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text('$_greeting, $_userName',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold)),
                        ),
                        const Text('Painel do Fotógrafo',
                            style: TextStyle(
                                color: Color(0xFFE1BEE7), fontSize: 12)),
                        const SizedBox(height: 4),
                        Text(_verse,
                            style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 11,
                                fontStyle: FontStyle.italic)),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const ListaFichasFotografo()));
                    },
                    icon: const Icon(Icons.list_alt_rounded,
                        color: Color(0xFFCE93D8)),
                    tooltip: 'Fichas Produzidas',
                  ),
                  IconButton(
                    icon: const Icon(Icons.settings, color: Colors.white70),
                    onPressed: _showSettingsMenuModal,
                    tooltip: 'Configurações & Ações',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Lote indicator
              GestureDetector(
                onTap: _showLoteConfigDialog,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.white24),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Row(
                          children: [
                            const Icon(Icons.event_note,
                                color: Colors.white70, size: 16),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _currentCityLote == null
                                    ? 'Lote Não Configurado'
                                    : 'Lote: $_currentCityLote | Evento: $_currentEventName',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_currentCityLote != null)
                            IconButton(
                              onPressed: _printLote,
                              icon: const Icon(Icons.print,
                                  color: Color(0xFF4FC3F7), size: 20),
                              tooltip: 'Imprimir Fechamento de Lote',
                            ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                                color: const Color(0xFFCE93D8).withOpacity(0.2),
                                borderRadius: BorderRadius.circular(4)),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('$_fichasHojeCount Fichas Hoje',
                                    style: const TextStyle(
                                        color: Color(0xFFCE93D8),
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold)),
                                if (_pendingFichasCount > 0)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 2),
                                    child: Text(
                                        '⏳ $_pendingFichasCount aguardando envio',
                                        style: const TextStyle(
                                            color: Colors.orangeAccent,
                                            fontSize: 10,
                                            fontWeight: FontWeight.w600)),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      )
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRegistrationForm() {
    return SingleChildScrollView(
      controller: _formScrollController,
      padding: const EdgeInsets.all(20.0),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Nova Ficha de Cadastro',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),

            // ── Dados Básicos
            _buildSectionTitle('Dados Básicos'),
            _buildTextField(
              _nameController,
              'Nome do Responsável',
              Icons.person,
              validator: (v) {
                if (v == null || v.trim().isEmpty)
                  return 'Nome do responsável é obrigatório';
                final words = v.trim().split(RegExp(r'\s+'));
                if (words.length < 2)
                  return 'Informe Nome e Sobrenome (mínimo 2 palavras)';
                return null;
              },
            ),
            const Padding(
              padding: EdgeInsets.only(top: 4, left: 4),
              child: Text(
                  'Só preencha se for PAI, MÃE, AVÓ, AVÕ OU TUTOR LEGAL.',
                  style: TextStyle(
                      color: Colors.red,
                      fontSize: 12,
                      fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 12),
            _buildTextField(
              _phoneController,
              'WhatsApp 1',
              FontAwesomeIcons.whatsapp,
              keyboardType: TextInputType.phone,
              inputFormatters: [PhoneInputFormatter()],
              validator: (v) {
                if (v == null || v.trim().isEmpty)
                  return 'WhatsApp 1 é obrigatório';
                final digits = v.replaceAll(RegExp(r'\D'), '');
                if (digits.length < 10)
                  return 'WhatsApp inválido (mínimo 10 dígitos com DDD)';
                return null;
              },
            ),
            const SizedBox(height: 12),
            _buildTextField(
              _phone2Controller,
              'WhatsApp 2 (Opcional)',
              FontAwesomeIcons.whatsapp,
              keyboardType: TextInputType.phone,
              inputFormatters: [PhoneInputFormatter()],
              validator: (v) {
                if (v != null && v.trim().isNotEmpty) {
                  final digits = v.replaceAll(RegExp(r'\D'), '');
                  if (digits.length < 10)
                    return 'WhatsApp inválido (mínimo 10 dígitos com DDD)';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            RawAutocomplete<String>(
              textEditingController: _professionController,
              focusNode: FocusNode(),
              optionsBuilder: (TextEditingValue textEditingValue) {
                if (textEditingValue.text.isEmpty) return _professionsCache;
                return _professionsCache.where((String option) => option
                    .toLowerCase()
                    .contains(textEditingValue.text.toLowerCase()));
              },
              onSelected: (String selection) {
                _professionController.text = selection;
              },
              optionsViewBuilder: (BuildContext context,
                  AutocompleteOnSelected<String> onSelected,
                  Iterable<String> options) {
                return Align(
                  alignment: Alignment.topLeft,
                  child: Material(
                    elevation: 4.0,
                    color: const Color(0xFF1A2535),
                    child: SizedBox(
                      height: 200.0,
                      width: MediaQuery.of(context).size.width - 40,
                      child: ListView.builder(
                        padding: EdgeInsets.zero,
                        itemCount: options.length,
                        itemBuilder: (BuildContext context, int index) {
                          final String option = options.elementAt(index);
                          return GestureDetector(
                            onTap: () => onSelected(option),
                            child: ListTile(
                              title: Text(option,
                                  style: const TextStyle(color: Colors.white)),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                );
              },
              fieldViewBuilder: (BuildContext context,
                  TextEditingController textEditingController,
                  FocusNode focusNode,
                  VoidCallback onFieldSubmitted) {
                return TextFormField(
                  controller: textEditingController,
                  focusNode: focusNode,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Profissão (Opcional)',
                    labelStyle: const TextStyle(color: Colors.white54),
                    filled: true,
                    fillColor: const Color(0xFF1A2535),
                    prefixIcon:
                        const Icon(Icons.work, color: Colors.white54, size: 20),
                    enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: Colors.white12)),
                    focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(
                            color: Color(0xFFCE93D8), width: 1.5)),
                  ),
                  onFieldSubmitted: (String value) => onFieldSubmitted(),
                );
              },
            ),

            const SizedBox(height: 24),

            // ── Endereço
            _buildSectionTitle('Endereço do cliente'),
            _buildTextField(
              _cepController,
              'CEP',
              Icons.map,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(8),
              ],
              onChanged: _onCepChanged,
            ),
            const SizedBox(height: 12),
            _buildTextField(
              _streetController,
              'Rua / Logradouro',
              Icons.location_on,
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Rua / Logradouro é obrigatório'
                  : null,
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 3,
                  child: _buildTextField(
                    _numberController,
                    _noNumber ? 'Número (S/N)' : 'Número',
                    Icons.numbers,
                    enabled: !_noNumber,
                    validator: (v) {
                      if (_noNumber) return null;
                      if (v == null || v.trim().isEmpty) {
                        return 'Obrigatório';
                      }
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: InkWell(
                    onTap: () {
                      setState(() {
                        _noNumber = !_noNumber;
                        if (_noNumber) {
                          _numberController.text = 'S/N';
                        } else if (_numberController.text == 'S/N') {
                          _numberController.clear();
                        }
                      });
                      _saveFormDraft();
                    },
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      height: 58,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      decoration: BoxDecoration(
                        color: _noNumber
                            ? const Color(0xFFCE93D8).withOpacity(0.15)
                            : const Color(0xFF1A2535),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: _noNumber
                              ? const Color(0xFFCE93D8)
                              : Colors.white12,
                          width: _noNumber ? 1.5 : 1.0,
                        ),
                      ),
                      child: Row(
                        children: [
                          Checkbox(
                            value: _noNumber,
                            onChanged: (val) {
                              setState(() {
                                _noNumber = val ?? false;
                                if (_noNumber) {
                                  _numberController.text = 'S/N';
                                } else if (_numberController.text == 'S/N') {
                                  _numberController.clear();
                                }
                              });
                              _saveFormDraft();
                            },
                            activeColor: const Color(0xFFCE93D8),
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ),
                          const Expanded(
                            child: Text(
                              'Sem número',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _buildTextField(
              _neighborhoodController,
              'Bairro',
              Icons.holiday_village,
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Bairro é obrigatório'
                  : null,
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _buildTextField(
                    _cityController,
                    'Cidade',
                    Icons.location_city,
                    textCapitalization: TextCapitalization.words,
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'Cidade é obrigatória'
                        : null,
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 85,
                  child: _buildTextField(
                    _stateController,
                    'UF',
                    Icons.flag,
                    textCapitalization: TextCapitalization.characters,
                    inputFormatters: [
                      LengthLimitingTextInputFormatter(2),
                      FilteringTextInputFormatter.allow(RegExp(r'[a-zA-Z]')),
                    ],
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return 'UF';
                      final uf = v.trim().toUpperCase();
                      if (!_validBrazilianUfs.contains(uf)) return 'Inválida';
                      return null;
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _buildTextField(
              _referenceController,
              'Ponto de Referência (Pesquisa de Local)',
              Icons.place,
            ),

            const SizedBox(height: 16),

            // ── Tipo de Imóvel e Campos Adicionais
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Tipo de Imóvel',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: _buildPropertyTypeOption(
                        'CASA',
                        'Casa',
                        Icons.home,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _buildPropertyTypeOption(
                        'APARTAMENTO',
                        'Apto / Cond.',
                        Icons.apartment,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _buildPropertyTypeOption(
                        'OUTRO',
                        'Outro',
                        Icons.business,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _showAdditionalAddressFields =
                            !_showAdditionalAddressFields;
                      });
                      _saveFormDraft();
                    },
                    icon: Icon(
                      _showAdditionalAddressFields
                          ? Icons.remove_circle_outline
                          : Icons.add_circle_outline,
                      size: 16,
                      color: const Color(0xFFCE93D8),
                    ),
                    label: Text(
                      _showAdditionalAddressFields
                          ? 'Ocultar complemento / condomínio'
                          : '+ Complemento / condomínio / bloco / apartamento',
                      style: const TextStyle(
                        color: Color(0xFFCE93D8),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 4, vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ),
                if (_showAdditionalAddressFields) ...[
                  const SizedBox(height: 10),
                  _buildTextField(
                    _condoController,
                    'Nome do condomínio (Opcional)',
                    Icons.apartment,
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _buildTextField(
                          _blockController,
                          'Bloco / Torre (Opcional)',
                          Icons.domain,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _buildTextField(
                          _aptController,
                          'Apto / Unidade (Opcional)',
                          Icons.meeting_room,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _buildTextField(
                    _complementController,
                    'Complemento adicional (Opcional)',
                    Icons.info_outline,
                  ),
                ],
              ],
            ),

            const SizedBox(height: 24),

            // ── Cor da Casa (Visual) + Acabamento
            _buildSectionTitle('Cor da Casa'),
            SizedBox(
              height: 50,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _houseColors.length,
                itemBuilder: (context, index) {
                  final color = _houseColors[index];
                  final isSelected = _selectedHouseColor == color;
                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        if (_selectedHouseColor == color) {
                          _selectedHouseColor = null;
                        } else {
                          _selectedHouseColor = color;
                        }
                      });
                      _saveFormDraft();
                    },
                    child: Container(
                      width: 40,
                      margin: const EdgeInsets.only(right: 12),
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                        border: Border.all(
                            color: isSelected
                                ? const Color(0xFFCE93D8)
                                : Colors.white24,
                            width: isSelected ? 3 : 1),
                        boxShadow: isSelected
                            ? [
                                BoxShadow(
                                    color: const Color(0xFFCE93D8)
                                        .withOpacity(0.5),
                                    blurRadius: 8)
                              ]
                            : [],
                      ),
                      child: isSelected
                          ? Icon(Icons.check,
                              color: color.computeLuminance() > 0.5
                                  ? Colors.black
                                  : Colors.white,
                              size: 20)
                          : null,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () {
                      setState(() {
                        _houseFinish = (_houseFinish == 'NO_REBOCO')
                            ? null
                            : 'NO_REBOCO';
                      });
                      _saveFormDraft();
                    },
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 8),
                      decoration: BoxDecoration(
                        color: _houseFinish == 'NO_REBOCO'
                            ? const Color(0xFFCE93D8).withOpacity(0.15)
                            : const Color(0xFF1A2535),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: _houseFinish == 'NO_REBOCO'
                              ? const Color(0xFFCE93D8)
                              : Colors.white12,
                          width: _houseFinish == 'NO_REBOCO' ? 1.5 : 1.0,
                        ),
                      ),
                      child: Row(
                        children: [
                          Checkbox(
                            value: _houseFinish == 'NO_REBOCO',
                            onChanged: (val) {
                              setState(() {
                                _houseFinish =
                                    (val == true) ? 'NO_REBOCO' : null;
                              });
                              _saveFormDraft();
                            },
                            activeColor: const Color(0xFFCE93D8),
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ),
                          const Expanded(
                            child: Text(
                              'No reboco',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: InkWell(
                    onTap: () {
                      setState(() {
                        _houseFinish = (_houseFinish == 'SEM_REBOCO')
                            ? null
                            : 'SEM_REBOCO';
                      });
                      _saveFormDraft();
                    },
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 8),
                      decoration: BoxDecoration(
                        color: _houseFinish == 'SEM_REBOCO'
                            ? const Color(0xFFCE93D8).withOpacity(0.15)
                            : const Color(0xFF1A2535),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: _houseFinish == 'SEM_REBOCO'
                              ? const Color(0xFFCE93D8)
                              : Colors.white12,
                          width: _houseFinish == 'SEM_REBOCO' ? 1.5 : 1.0,
                        ),
                      ),
                      child: Row(
                        children: [
                          Checkbox(
                            value: _houseFinish == 'SEM_REBOCO',
                            onChanged: (val) {
                              setState(() {
                                _houseFinish =
                                    (val == true) ? 'SEM_REBOCO' : null;
                              });
                              _saveFormDraft();
                            },
                            activeColor: const Color(0xFFCE93D8),
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ),
                          const Expanded(
                            child: Text(
                              'Sem reboco',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 24),

            // ── Cor do Portão (Visual) + Sem portão
            Row(
              children: [
                Expanded(child: _buildSectionTitle('Cor do Portão')),
                InkWell(
                  onTap: () {
                    setState(() {
                      _hasNoGate = !_hasNoGate;
                    });
                    _saveFormDraft();
                  },
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Checkbox(
                          value: _hasNoGate,
                          onChanged: (val) {
                            setState(() {
                              _hasNoGate = val ?? false;
                            });
                            _saveFormDraft();
                          },
                          activeColor: const Color(0xFFCE93D8),
                          materialTapTargetSize:
                              MaterialTapTargetSize.shrinkWrap,
                        ),
                        const Text(
                          'Sem portão',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            if (_hasNoGate)
              Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.orange.withOpacity(0.4)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline,
                        color: Colors.orangeAccent, size: 16),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Imóvel marcado como sem portão. Cores e observação desabilitadas.',
                        style:
                            TextStyle(color: Colors.orangeAccent, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            Opacity(
              opacity: _hasNoGate ? 0.35 : 1.0,
              child: IgnorePointer(
                ignoring: _hasNoGate,
                child: Column(
                  children: [
                    SizedBox(
                      height: 50,
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        itemCount: _houseColors.length,
                        itemBuilder: (context, index) {
                          final color = _houseColors[index];
                          final isSelected =
                              !_hasNoGate && _selectedGateColor == color;
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                if (_selectedGateColor == color) {
                                  _selectedGateColor = null;
                                } else {
                                  _selectedGateColor = color;
                                }
                              });
                              _saveFormDraft();
                            },
                            child: Container(
                              width: 40,
                              margin: const EdgeInsets.only(right: 12),
                              decoration: BoxDecoration(
                                color: color,
                                shape: BoxShape.circle,
                                border: Border.all(
                                    color: isSelected
                                        ? const Color(0xFFCE93D8)
                                        : Colors.white24,
                                    width: isSelected ? 3 : 1),
                                boxShadow: isSelected
                                    ? [
                                        BoxShadow(
                                            color: const Color(0xFFCE93D8)
                                                .withOpacity(0.5),
                                            blurRadius: 8)
                                      ]
                                    : [],
                              ),
                              child: isSelected
                                  ? Icon(Icons.check,
                                      color: color.computeLuminance() > 0.5
                                          ? Colors.black
                                          : Colors.white,
                                      size: 20)
                                  : null,
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 12),
                    _buildTextField(
                      _gateObservationController,
                      'Observação sobre o Portão (Opcional)',
                      Icons.edit_note,
                      enabled: !_hasNoGate,
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // ── Informações da Visita & Crianças Inline
            _buildSectionTitle('Detalhes da Visita & Crianças'),
            GestureDetector(
              onTap: _pickTime,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                decoration: BoxDecoration(
                    color: const Color(0xFF1A2535),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.white12)),
                child: Row(
                  children: [
                    const Icon(Icons.access_time, color: Colors.white54),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _visitTime == null
                            ? 'Melhor horário de visita'
                            : 'Horário: ${_visitTime!.hour.toString().padLeft(2, '0')}:${_visitTime!.minute.toString().padLeft(2, '0')}',
                        style: TextStyle(
                            color: _visitTime == null
                                ? Colors.white54
                                : Colors.white,
                            fontSize: 16),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                  color: const Color(0xFF1A2535),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.face,
                          color: Color(0xFFCE93D8), size: 18),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'Crianças / Identificação',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 14),
                        ),
                      ),
                      Text(
                        '${_childFormItems.where((c) => c.nameController.text.trim().isNotEmpty).length} cadastrada(s)',
                        style: const TextStyle(
                            color: Colors.white54, fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _childFormItems.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (ctx, index) {
                      final item = _childFormItems[index];
                      final isOnlyItem = _childFormItems.length == 1;
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 5,
                            child: _buildTextField(
                              item.nameController,
                              'Nome da criança ${index + 1}',
                              Icons.child_care,
                              focusNode: item.nameFocusNode,
                              textCapitalization: TextCapitalization.words,
                              validator: (v) {
                                if (index == 0 &&
                                    (v == null || v.trim().isEmpty)) {
                                  return 'Informe o nome da criança';
                                }
                                return null;
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 3,
                            child: _buildTextField(
                              item.ageController,
                              'Idade (anos)',
                              Icons.cake,
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                                LengthLimitingTextInputFormatter(2),
                              ],
                            ),
                          ),
                          const SizedBox(width: 4),
                          IconButton(
                            icon: Icon(
                              isOnlyItem
                                  ? Icons.clear
                                  : Icons.delete_outline,
                              color: isOnlyItem
                                  ? Colors.white38
                                  : Colors.redAccent.withOpacity(0.85),
                              size: 20,
                            ),
                            tooltip: isOnlyItem
                                ? 'Limpar campos da criança'
                                : 'Remover criança',
                            onPressed: () => _confirmRemoveChild(index),
                          ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _addNewChildItem,
                      icon: const Icon(Icons.add_rounded,
                          color: Color(0xFFCE93D8), size: 18),
                      label: const Text(
                        'Adicionar outra criança',
                        style: TextStyle(
                            color: Color(0xFFCE93D8),
                            fontWeight: FontWeight.bold,
                            fontSize: 13),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(
                            color: Color(0xFFCE93D8), width: 1.2),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  _buildTextField(
                    _clothesColorController,
                    'Cores de Roupa da(s) criança(s) (Opcional)',
                    Icons.checkroom,
                  ),
                ],
              ),
            ),

            const SizedBox(height: 32),

            // ── Assinatura
            _buildSectionTitle('Assinatura do Responsável'),
            Container(
              decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xFFCE93D8), width: 2),
                  borderRadius: BorderRadius.circular(12)),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Signature(
                    controller: _signatureController,
                    height: 260,
                    backgroundColor: Colors.white),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => _signatureController.clear(),
                icon: const Icon(Icons.clear, color: Colors.white54, size: 16),
                label: const Text('Limpar Assinatura',
                    style: TextStyle(color: Colors.white54)),
              ),
            ),

            const SizedBox(height: 24),
            LedButton(
              onPressed: _isLoading ? null : _submitForm,
              style: LedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: _isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Text('Finalizar e Gerar QR Code',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          const Icon(Icons.arrow_right, color: Color(0xFFCE93D8)),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: Color(0xFFCE93D8),
                  fontSize: 14,
                  fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(
    TextEditingController controller,
    String label,
    IconData? icon, {
    TextInputType? keyboardType,
    List<TextInputFormatter>? inputFormatters,
    String? Function(String?)? validator,
    void Function(String)? onChanged,
    FocusNode? focusNode,
    bool enabled = true,
    TextCapitalization textCapitalization = TextCapitalization.none,
  }) {
    return TextFormField(
      controller: controller,
      focusNode: focusNode,
      enabled: enabled,
      textCapitalization: textCapitalization,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      onChanged: onChanged,
      style: TextStyle(color: enabled ? Colors.white : Colors.white38),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: enabled ? Colors.white54 : Colors.white24),
        filled: true,
        fillColor: enabled ? const Color(0xFF1A2535) : const Color(0xFF141C28),
        prefixIcon:
            icon != null ? Icon(icon, color: enabled ? Colors.white54 : Colors.white24, size: 20) : null,
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Colors.white12)),
        disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Colors.white10)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFCE93D8), width: 1.5)),
        errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Colors.redAccent, width: 1.5)),
        focusedErrorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Colors.redAccent, width: 2)),
      ),
      validator: validator ??
          (v) => label.contains('Opcional')
              ? null
              : (v == null || v.trim().isEmpty ? 'Obrigatório' : null),
    );
  }

  Widget _buildPropertyTypeOption(String value, String label, IconData icon) {
    final isSelected = _propertyType == value;
    return InkWell(
      onTap: () {
        setState(() {
          if (_propertyType == value) {
            _propertyType = null;
          } else {
            _propertyType = value;
            if (value == 'APARTAMENTO') {
              _showAdditionalAddressFields = true;
            }
          }
        });
        _saveFormDraft();
      },
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0xFFCE93D8).withOpacity(0.2)
              : const Color(0xFF1A2535),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? const Color(0xFFCE93D8) : Colors.white12,
            width: isSelected ? 1.5 : 1.0,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 20,
              color: isSelected ? const Color(0xFFCE93D8) : Colors.white54,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: isSelected ? Colors.white : Colors.white70,
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQrCodeScreen() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                  color: const Color(0xFF1A1A2E),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                      color: Colors.green.withOpacity(0.5), width: 2)),
              child: Column(
                children: [
                  const Icon(Icons.check_circle_rounded,
                      color: Colors.green, size: 60),
                  const SizedBox(height: 16),
                  const Text('Ficha Gerada com Sucesso!',
                      style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: Colors.white)),
                  const SizedBox(height: 8),
                  const Text(
                      'Peça para o fotógrafo tirar uma book deste QR Code na casa do cliente.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16)),
                    child: QrImageView(
                        data: _generatedQrCodeData!,
                        version: QrVersions.auto,
                        size: 220.0),
                  ),
                  const SizedBox(height: 24),
                  if (_isFichaSynced) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                              color: const Color(0xFF4FC3F7).withOpacity(0.5))),
                      child: Column(
                        children: [
                          Text(
                            'Ficha: ${_confirmedVisibleCode ?? _currentFichaUuid ?? 'CONFIRMADA'}',
                            style: const TextStyle(
                                color: Color(0xFF4FC3F7),
                                fontWeight: FontWeight.bold,
                                fontSize: 20,
                                fontFamily: 'monospace'),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: const [
                              Icon(Icons.check_circle,
                                  color: Colors.greenAccent, size: 16),
                              SizedBox(width: 6),
                              Text(
                                'Sincronizada com o servidor',
                                style: TextStyle(
                                    color: Colors.greenAccent,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 12),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                          color: Colors.orange.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                              color: Colors.orangeAccent.withOpacity(0.7))),
                      child: Column(
                        children: [
                          Text(
                            'Provisório: PROV-${(_currentFichaUuid ?? _generatedQrCodeData ?? "").substring(0, (_currentFichaUuid ?? _generatedQrCodeData ?? "").length >= 8 ? 8 : (_currentFichaUuid ?? _generatedQrCodeData ?? "").length).toUpperCase()}',
                            style: const TextStyle(
                                color: Colors.orangeAccent,
                                fontWeight: FontWeight.bold,
                                fontSize: 18,
                                fontFamily: 'monospace'),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: const [
                              Icon(Icons.sync_problem,
                                  color: Colors.orangeAccent, size: 16),
                              SizedBox(width: 6),
                              Text(
                                'Aguardando sincronização',
                                style: TextStyle(
                                    color: Colors.orangeAccent,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 32),
            Row(
              children: [
                Expanded(
                  child: LedButton.icon(
                    onPressed: _printFicha,
                    icon: const Icon(Icons.print, color: Colors.white),
                    label: const Text('Imprimir Ficha',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    style: LedButton.styleFrom(
                        backgroundColor: const Color(0xFF4FC3F7),
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12))),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: LedButton.icon(
                    onPressed: _resetForm,
                    icon: const Icon(Icons.add, color: Colors.white),
                    label: const Text('Nova Ficha',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    style: LedButton.styleFrom(
                        backgroundColor: const Color(0xFFCE93D8),
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12))),
                  ),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
