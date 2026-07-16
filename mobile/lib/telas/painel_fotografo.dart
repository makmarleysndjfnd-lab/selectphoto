import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'dart:convert';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_login.dart';
import 'tela_sincronizacao.dart' as tela_sincronizacao;

import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'tela_cadastro_custos.dart';
import 'tela_config_impressora.dart';

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

class PhotographerDashboard extends StatefulWidget {
  const PhotographerDashboard({super.key});

  @override
  State<PhotographerDashboard> createState() => _PhotographerDashboardState();
}

class _PhotographerDashboardState extends State<PhotographerDashboard> with SingleTickerProviderStateMixin {
  // Lote Memory State
  String? _currentCityLote;
  String? _currentEventName;
  int _sequenceCount = 1;

  // Form State
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _cepController = TextEditingController();
  final _streetController = TextEditingController();
  final _numberController = TextEditingController();
  final _condoController = TextEditingController();
  final _blockController = TextEditingController();
  final _aptController = TextEditingController();
  final _neighborhoodController = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _phoneController = TextEditingController();
  final _referenceController = TextEditingController();
  final _professionController = TextEditingController();

  Color? _selectedHouseColor;
  Color? _selectedGateColor;
  final _gateObservationController = TextEditingController();
  TimeOfDay? _visitTime;
  
  // Children
  final List<Map<String, String>> _children = [];
  final _clothesColorController = TextEditingController();

  final SignatureController _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );
  
  bool _isLoading = false;
  String? _generatedQrCodeData; 

  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  List<String> _professionsCache = [];

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim = CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
    
    _loadProfessions();

    // Check if Lote is configured immediately after frame renders
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_currentCityLote == null || _currentEventName == null) {
        _showLoteConfigDialog();
      }
    });
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

  @override
  void dispose() {
    _animController.dispose();
    _nameController.dispose();
    _cepController.dispose();
    _streetController.dispose();
    _numberController.dispose();
    _condoController.dispose();
    _blockController.dispose();
    _aptController.dispose();
    _neighborhoodController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _phoneController.dispose();
    _referenceController.dispose();
    _professionController.dispose();
    _clothesColorController.dispose();
    _gateObservationController.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  // ── Lote Config ─────────────────────────────────────────────────────────────
  Future<void> _showLoteConfigDialog() async {
    final loteCtrl = TextEditingController(text: _currentCityLote ?? '');
    final eventCtrl = TextEditingController(text: _currentEventName ?? '');
    final formKey = GlobalKey<FormState>();

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text('Configurar Lote e Evento', style: TextStyle(color: Colors.white)),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: loteCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Cidade / Lote (Ex: SP, CAMPINAS01)', labelStyle: TextStyle(color: Colors.white54)),
                  validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: eventCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Nome do Evento (Ex: Shopping)', labelStyle: TextStyle(color: Colors.white54)),
                  validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                ),
              ],
            ),
          ),
          actions: [
            ElevatedButton(
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  setState(() {
                    _currentCityLote = loteCtrl.text.toUpperCase();
                    _currentEventName = eventCtrl.text;
                  });
                  Navigator.pop(context);
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Salvar Sessão', style: TextStyle(color: Colors.black)),
            ),
          ],
        );
      }
    );
  }

  // ── Mocks ───────────────────────────────────────────────────────────────────
  Future<void> _onCepChanged(String value) async {
    final cleanCep = value.replaceAll(RegExp(r'[^0-9]'), '');
    if (cleanCep.length == 8) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Buscando CEP...'), duration: Duration(milliseconds: 1000)));
      try {
        final response = await http.get(Uri.parse('https://viacep.com.br/ws/$cleanCep/json/'));
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['erro'] != true) {
            setState(() {
              _streetController.text = data['logradouro'] ?? '';
              _neighborhoodController.text = data['bairro'] ?? '';
              _cityController.text = data['localidade'] ?? '';
              _stateController.text = data['uf'] ?? '';
            });
            if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Endereço preenchido!'), backgroundColor: Colors.green, duration: Duration(milliseconds: 1500)));
          }
        }
      } catch (e) {
        // Ignorar erros de rede
      }
    }
  }

  // ── Form Actions ────────────────────────────────────────────────────────────
  void _addChild() {
    final nameCtrl = TextEditingController();
    final ageCtrl = TextEditingController();
    
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text('Adicionar Criança', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameCtrl, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Nome', labelStyle: TextStyle(color: Colors.white54))),
              const SizedBox(height: 12),
              TextField(controller: ageCtrl, keyboardType: TextInputType.number, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Idade', labelStyle: TextStyle(color: Colors.white54))),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              onPressed: () {
                if (nameCtrl.text.isNotEmpty && ageCtrl.text.isNotEmpty) {
                  setState(() {
                    _children.add({'name': nameCtrl.text, 'age': ageCtrl.text});
                  });
                  Navigator.pop(context);
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Adicionar', style: TextStyle(color: Colors.black)),
            ),
          ],
        );
      }
    );
  }

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

  void _submitForm() async {
    if (!_formKey.currentState!.validate()) return;
    
    if (_signatureController.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A assinatura do responsável é obrigatória.')));
      return;
    }
    
    if (_selectedHouseColor == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A cor da casa é obrigatória.')));
      return;
    }
    
    if (_selectedGateColor == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A cor do portão é obrigatória.')));
      return;
    }
    
    if (_visitTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('O horário de visita é obrigatório.')));
      return;
    }
    
    if (_children.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('É obrigatório adicionar pelo menos uma criança.')));
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
          title: const Text('Aviso Legal', style: TextStyle(color: Colors.white)),
          content: const Text(
            'Autorizo fotografar minha criança(s) ganhar uma book presente e demonstrar as outras books sem compromisso de compra em até 90 dias.',
            style: TextStyle(color: Colors.white70),
          ),
          actions: [
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              child: const Text('Li e Aceito', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      }
    );

    if (accepted != true) return;

    setState(() => _isLoading = true);

    try {
      final signatureBytes = await _signatureController.toPngBytes();
      final base64Signature = base64Encode(signatureBytes!);
      
      // Auto Generate Sequence
      final seqString = _sequenceCount.toString().padLeft(4, '0');
      final sequenceNumber = '$_currentCityLote-$seqString'; 

      final apiService = Provider.of<ApiService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);
      
      final payload = {
        'sequenceNumber': sequenceNumber,
        'event': _currentEventName,
        'name': _nameController.text,
        'phone1': _phoneController.text,
        'cep': _cepController.text,
        'street': _streetController.text,
        'number': _numberController.text,
        'condo': _condoController.text,
        'block': _blockController.text,
        'apartment': _aptController.text,
        'neighborhood': _neighborhoodController.text,
        'city': _cityController.text,
        'state': _stateController.text,
        'referencePoint': _referenceController.text,
        'houseColor': _selectedHouseColor?.value.toString(),
        'gateColor': _selectedGateColor?.value.toString(),
        'gateObservation': _gateObservationController.text,
        'profession': _professionController.text,
        'visitTime': _visitTime != null ? '${_visitTime!.hour.toString().padLeft(2, '0')}:${_visitTime!.minute.toString().padLeft(2, '0')}' : null,
        'clothesColor': _clothesColorController.text,
        'children': _children,
        'signatureBase64': base64Signature,
      };

      try {
        await apiService.syncClients([payload]);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sincronizado com o servidor!'), backgroundColor: Colors.green));
      } catch (e) {
        await syncService.addPendingRequest('SYNC_CLIENTS', payload);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Salvo no Backup Offline! Não esqueça de sincronizar depois.'), backgroundColor: Colors.orange));
      }

      setState(() {
        _generatedQrCodeData = sequenceNumber;
        _sequenceCount++; // Increment for next client
      });
      
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _resetForm() {
    _nameController.clear();
    _cepController.clear();
    _streetController.clear();
    _numberController.clear();
    _condoController.clear();
    _blockController.clear();
    _aptController.clear();
    _neighborhoodController.clear();
    _cityController.clear();
    _stateController.clear();
    _phoneController.clear();
    _referenceController.clear();
    _professionController.clear();
    _clothesColorController.clear();
    _gateObservationController.clear();
    _children.clear();
    _selectedHouseColor = null;
    _selectedGateColor = null;
    _visitTime = null;
    _signatureController.clear();
    
    setState(() {
      _generatedQrCodeData = null;
    });
  }

  void _printFicha() async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhuma impressora conectada! Vá nas configurações.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
      return;
    }
    
    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FICHA COMPLETA", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Evento: $_currentEventName", 1, 0);
    bluetooth.printCustom("Lote/Cidade: $_currentCityLote", 1, 0);
    bluetooth.printCustom("Ficha: $_generatedQrCodeData", 1, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Nome: ${_nameController.text}", 0, 0);
    bluetooth.printCustom("Telefone: ${_phoneController.text}", 0, 0);
    bluetooth.printCustom("Profissao: ${_professionController.text}", 0, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Endereco", 1, 0);
    bluetooth.printCustom("${_streetController.text}, ${_numberController.text}", 0, 0);
    bluetooth.printCustom("Bairro: ${_neighborhoodController.text}", 0, 0);
    bluetooth.printCustom("Cep: ${_cepController.text}", 0, 0);
    bluetooth.printCustom("Ref: ${_referenceController.text}", 0, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Cor da Casa: ${_selectedHouseColor?.value}", 0, 0);
    bluetooth.printCustom("Cor do Portao: ${_selectedGateColor?.value}", 0, 0);
    bluetooth.printCustom("Horario Visita: ${_visitTime != null ? '${_visitTime!.hour.toString().padLeft(2, '0')}:${_visitTime!.minute.toString().padLeft(2, '0')}' : ''}", 0, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("Criancas:", 1, 0);
    for (var child in _children) {
      bluetooth.printCustom("- ${child['name']} (${child['age']} anos)", 0, 0);
    }
    bluetooth.printCustom("Roupa: ${_clothesColorController.text}", 0, 0);
    bluetooth.printNewLine();
    bluetooth.printQRcode(_generatedQrCodeData!, 200, 200, 1);
    bluetooth.printNewLine();
    bluetooth.printNewLine();
    bluetooth.printNewLine();
  }

  void _printLote() async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhuma impressora conectada! Vá nas configurações.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Imprimindo fechamento do lote...', style: TextStyle(color: Colors.white)), backgroundColor: Colors.green));
    }
  }

  void _showFechamentoDialog() {
    if (_currentCityLote == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhum lote configurado para fechar!'), backgroundColor: Colors.red));
      return;
    }
    
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text('Finalizar Lote/Cidade', style: TextStyle(color: Colors.white)),
          content: Text('Deseja realmente finalizar a produção do Lote $_currentCityLote? O admin será notificado na tela de liberação.', style: const TextStyle(color: Colors.white70)),
          actionsAlignment: MainAxisAlignment.spaceBetween,
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    _printLote();
                  },
                  icon: const Icon(Icons.print, color: Colors.orangeAccent),
                  label: const Text('Imprimir', style: TextStyle(color: Colors.orangeAccent)),
                  style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.orangeAccent)),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () async {
                    final cityToFinish = _currentCityLote!;
                    Navigator.pop(context);
                    
                    try {
                      await ApiService().createBookBatch(cityToFinish);
                      if (mounted) {
                        setState(() {
                          _currentCityLote = null;
                          _sequenceCount = 1;
                        });
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Lote finalizado com sucesso! Admin notificado.'), backgroundColor: Colors.green));
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao finalizar lote: $e'), backgroundColor: Colors.red));
                      }
                    }
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Finalizar', style: TextStyle(color: Colors.black)),
                ),
              ],
            ),
          ],
        );
      }
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
          colors: [Color(0xFF2A0D2E), Color(0xFF4A0E4E)], // Purple tint for photographer
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
                      gradient: const LinearGradient(colors: [Color(0xFFCE93D8), Color(0xFF8E24AA)]),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(color: const Color(0xFF8E24AA).withOpacity(0.4), blurRadius: 12, offset: const Offset(0, 4)),
                      ],
                    ),
                    child: const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 22),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Painel do Fotógrafo', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
                        Text('Captação em Campo', style: TextStyle(color: Color(0xFFE1BEE7), fontSize: 12)),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const tela_sincronizacao.SyncScreen()));
                    },
                    icon: Consumer<SyncService>(
                      builder: (context, sync, child) {
                        return Stack(
                          alignment: Alignment.center,
                          children: [
                            const Icon(Icons.cloud_sync, color: Color(0xFFE1BEE7)),
                            if (sync.pendingRequests.isNotEmpty)
                              Positioned(
                                right: 0,
                                top: 0,
                                child: Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: const BoxDecoration(
                                    color: Colors.red,
                                    shape: BoxShape.circle,
                                  ),
                                  constraints: const BoxConstraints(minWidth: 12, minHeight: 12),
                                  child: Text(
                                    '${sync.pendingRequests.length}',
                                    style: const TextStyle(color: Colors.white, fontSize: 8),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              ),
                          ],
                        );
                      }
                    ),
                    tooltip: 'Backups Offline',
                  ),
                  IconButton(
                    onPressed: () {
                      _showFechamentoDialog();
                    },
                    icon: const Icon(Icons.done_all_rounded, color: Color(0xFFE1BEE7)),
                    tooltip: 'Finalizar Fechamento do Evento',
                  ),
                  IconButton(
                    onPressed: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const PrinterConfigScreen()));
                    },
                    icon: const Icon(Icons.print_rounded, color: Color(0xFFCE93D8)),
                    tooltip: 'Impressora Bluetooth',
                  ),
                  IconButton(
                    onPressed: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const CostEntryScreen()));
                    },
                    icon: const Icon(Icons.receipt_long_rounded, color: Color(0xFFCE93D8)),
                    tooltip: 'Lançar Despesa',
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen())),
                    icon: const Icon(Icons.logout_rounded, color: Color(0xFFE1BEE7)),
                    tooltip: 'Sair',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Lote indicator
              GestureDetector(
                onTap: _showLoteConfigDialog,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.white24),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.event_note, color: Colors.white70, size: 16),
                          const SizedBox(width: 8),
                          Text(
                            _currentCityLote == null ? 'Lote Não Configurado' : 'Lote: $_currentCityLote | Evento: $_currentEventName',
                            style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                      Row(
                        children: [
                          if (_currentCityLote != null)
                            IconButton(
                              onPressed: _printLote,
                              icon: const Icon(Icons.print, color: Color(0xFF4FC3F7), size: 20),
                              tooltip: 'Imprimir Fechamento de Lote',
                            ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: const Color(0xFFCE93D8).withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                            child: Text('${_sequenceCount - 1} Fichas Hoje', style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 12, fontWeight: FontWeight.bold)),
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
      padding: const EdgeInsets.all(20.0),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Nova Ficha de Cadastro', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            
            // ── Dados Básicos
            _buildSectionTitle('Dados Básicos'),
            _buildTextField(_nameController, 'Nome do Responsável', Icons.person),
            const Padding(
              padding: EdgeInsets.only(top: 4, left: 4),
              child: Text('Só preencha se for PAI, MÃE, AVÓ, AVÕ OU TUTOR LEGAL.', style: TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 12),
            _buildTextField(_phoneController, 'Telefone / WhatsApp', Icons.phone, keyboardType: TextInputType.phone),
            const SizedBox(height: 12),
            RawAutocomplete<String>(
              textEditingController: _professionController,
              focusNode: FocusNode(),
              optionsBuilder: (TextEditingValue textEditingValue) {
                if (textEditingValue.text.isEmpty) return _professionsCache;
                return _professionsCache.where((String option) => option.toLowerCase().contains(textEditingValue.text.toLowerCase()));
              },
              onSelected: (String selection) {
                _professionController.text = selection;
              },
              optionsViewBuilder: (BuildContext context, AutocompleteOnSelected<String> onSelected, Iterable<String> options) {
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
                              title: Text(option, style: const TextStyle(color: Colors.white)),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                );
              },
              fieldViewBuilder: (BuildContext context, TextEditingController textEditingController, FocusNode focusNode, VoidCallback onFieldSubmitted) {
                return TextFormField(
                  controller: textEditingController,
                  focusNode: focusNode,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Profissão (Opcional)',
                    labelStyle: const TextStyle(color: Colors.white54),
                    filled: true,
                    fillColor: const Color(0xFF1A2535),
                    prefixIcon: const Icon(Icons.work, color: Colors.white54, size: 20),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white12)),
                    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCE93D8), width: 1.5)),
                  ),
                  onFieldSubmitted: (String value) => onFieldSubmitted(),
                );
              },
            ),
            
            const SizedBox(height: 24),
            
            // ── Endereço
            _buildSectionTitle('Endereço & Localização'),
            _buildTextField(_cepController, 'CEP', Icons.map, keyboardType: TextInputType.number, onChanged: _onCepChanged),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(flex: 3, child: _buildTextField(_streetController, 'Rua/Av', Icons.location_on)),
                const SizedBox(width: 8),
                Expanded(flex: 1, child: _buildTextField(_numberController, 'Num', Icons.numbers)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _buildTextField(_neighborhoodController, 'Bairro', Icons.holiday_village)),
                const SizedBox(width: 8),
                Expanded(child: _buildTextField(_cityController, 'Cidade', Icons.location_city)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _buildTextField(_condoController, 'Condomínio (Opcional)', Icons.apartment)),
                const SizedBox(width: 8),
                Expanded(child: _buildTextField(_blockController, 'Bloco (Opcional)', null)),
                const SizedBox(width: 8),
                Expanded(child: _buildTextField(_aptController, 'Apto (Opcional)', null)),
              ],
            ),
            const SizedBox(height: 12),
            _buildTextField(_referenceController, 'Ponto de Referência (Pesquisa de Local)', Icons.place),
            
            const SizedBox(height: 24),

            // ── Cor da Casa (Visual)
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
                    onTap: () => setState(() => _selectedHouseColor = color),
                    child: Container(
                      width: 40,
                      margin: const EdgeInsets.only(right: 12),
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                        border: Border.all(color: isSelected ? const Color(0xFFCE93D8) : Colors.white24, width: isSelected ? 3 : 1),
                        boxShadow: isSelected ? [BoxShadow(color: const Color(0xFFCE93D8).withOpacity(0.5), blurRadius: 8)] : [],
                      ),
                      child: isSelected ? Icon(Icons.check, color: color.computeLuminance() > 0.5 ? Colors.black : Colors.white, size: 20) : null,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 24),

            // ── Cor do Portão (Visual)
            _buildSectionTitle('Cor do Portão'),
            SizedBox(
              height: 50,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _houseColors.length,
                itemBuilder: (context, index) {
                  final color = _houseColors[index];
                  final isSelected = _selectedGateColor == color;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedGateColor = color),
                    child: Container(
                      width: 40,
                      margin: const EdgeInsets.only(right: 12),
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                        border: Border.all(color: isSelected ? const Color(0xFFCE93D8) : Colors.white24, width: isSelected ? 3 : 1),
                        boxShadow: isSelected ? [BoxShadow(color: const Color(0xFFCE93D8).withOpacity(0.5), blurRadius: 8)] : [],
                      ),
                      child: isSelected ? Icon(Icons.check, color: color.computeLuminance() > 0.5 ? Colors.black : Colors.white, size: 20) : null,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            _buildTextField(_gateObservationController, 'Observação sobre o Portão (Opcional)', Icons.edit_note),

            const SizedBox(height: 24),

            // ── Informações da Visita
            _buildSectionTitle('Detalhes da Visita & Crianças'),
            GestureDetector(
              onTap: _pickTime,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                decoration: BoxDecoration(color: const Color(0xFF1A2535), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white12)),
                child: Row(
                  children: [
                    const Icon(Icons.access_time, color: Colors.white54),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _visitTime == null ? 'Melhor horário de visita' : 'Horário: ${_visitTime!.hour.toString().padLeft(2, '0')}:${_visitTime!.minute.toString().padLeft(2, '0')}',
                        style: TextStyle(color: _visitTime == null ? Colors.white54 : Colors.white, fontSize: 16),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFF1A2535), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Crianças / Identificação', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                      IconButton(onPressed: _addChild, icon: const Icon(Icons.add_circle, color: Color(0xFFCE93D8))),
                    ],
                  ),
                  if (_children.isEmpty) const Text('Nenhuma criança adicionada.', style: TextStyle(color: Colors.white54, fontSize: 12)),
                  ..._children.map((c) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text('• ${c['name']} (${c['age']} anos)', style: const TextStyle(color: Colors.white70)),
                  )),
                  const SizedBox(height: 12),
                  _buildTextField(_clothesColorController, 'Cores de Roupa da(s) criança(s)', Icons.checkroom),
                ],
              ),
            ),

            const SizedBox(height: 32),

            // ── Assinatura
            _buildSectionTitle('Assinatura do Responsável'),
            Container(
              decoration: BoxDecoration(border: Border.all(color: const Color(0xFFCE93D8), width: 2), borderRadius: BorderRadius.circular(12)),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Signature(controller: _signatureController, height: 260, backgroundColor: Colors.white),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => _signatureController.clear(),
                icon: const Icon(Icons.clear, color: Colors.white54, size: 16),
                label: const Text('Limpar Assinatura', style: TextStyle(color: Colors.white54)),
              ),
            ),

            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _isLoading ? null : _submitForm,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: _isLoading 
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) 
                : const Text('Finalizar e Gerar QR Code', style: TextStyle(color: Colors.black, fontSize: 16, fontWeight: FontWeight.bold)),
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
          Text(title, style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 14, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String label, IconData? icon, {TextInputType? keyboardType, void Function(String)? onChanged}) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      onChanged: onChanged,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white54),
        filled: true,
        fillColor: const Color(0xFF1A2535),
        prefixIcon: icon != null ? Icon(icon, color: Colors.white54, size: 20) : null,
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white12)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCE93D8), width: 1.5)),
      ),
      validator: (v) => label.contains('Opcional') ? null : (v!.isEmpty ? 'Obrigatório' : null),
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
              decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.green.withOpacity(0.5), width: 2)),
              child: Column(
                children: [
                  const Icon(Icons.check_circle_rounded, color: Colors.green, size: 60),
                  const SizedBox(height: 16),
                  const Text('Ficha Gerada com Sucesso!', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                  const SizedBox(height: 8),
                  const Text('Peça para o fotógrafo tirar uma book deste QR Code na casa do cliente.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                    child: QrImageView(data: _generatedQrCodeData!, version: QrVersions.auto, size: 220.0),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(8)),
                    child: Text('Ficha: $_generatedQrCodeData', style: const TextStyle(color: Color(0xFF4FC3F7), fontWeight: FontWeight.bold, fontSize: 18, fontFamily: 'monospace')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _printFicha,
                    icon: const Icon(Icons.print, color: Colors.white),
                    label: const Text('Imprimir Ficha', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF4FC3F7), padding: const EdgeInsets.symmetric(vertical: 16), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _resetForm,
                    icon: const Icon(Icons.add, color: Colors.black),
                    label: const Text('Nova Ficha', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8), padding: const EdgeInsets.symmetric(vertical: 16), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
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
