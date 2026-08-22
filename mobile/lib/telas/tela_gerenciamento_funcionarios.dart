import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:signature/signature.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_midia.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';



class EmployeeManagementScreen extends StatefulWidget {
  const EmployeeManagementScreen({super.key});

  @override
  State<EmployeeManagementScreen> createState() => _EmployeeManagementScreenState();
}

class _EmployeeManagementScreenState extends State<EmployeeManagementScreen> {
  final ApiService _apiService = ApiService();
  bool _isLoading = true;
  List<dynamic> _employees = [];
  List<dynamic> _teams = [];
  List<dynamic> _cars = [];

  @override
  void initState() {
    super.initState();
    _fetchData();
  }

  Future<void> _fetchData() async {
    setState(() => _isLoading = true);
    try {
      final emps = await _apiService.getUsers();
      final teams = await _apiService.getTeams();
      final cars = await _apiService.getCars();
      
      if (!mounted) return;
      setState(() {
        _employees = emps.where((u) => u['role'] != 'ADMIN').toList();
        _teams = teams;
        _cars = cars;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar: $e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _deleteEmployee(String id) async {
    try {
      await _apiService.deleteUser(id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Excluído com sucesso!'), backgroundColor: Colors.green));
      _fetchData();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao excluir'), backgroundColor: Colors.red));
    }
  }

  void _showEmployeeForm([Map<String, dynamic>? employee]) {
    showDialog(
      context: context,
      builder: (context) => _EmployeeFormDialog(
        employee: employee,
        teams: _teams,
        cars: _cars,
        onSaved: _fetchData,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)));
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          title: const Text('RH', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          bottom: const TabBar(
            indicatorColor: Color(0xFFCE93D8),
            labelColor: Color(0xFFCE93D8),
            unselectedLabelColor: Colors.white54,
            tabs: [
              Tab(text: 'Funcionários', icon: Icon(Icons.people)),
              Tab(text: 'Checklist de Chaves', icon: Icon(Icons.car_rental)),
            ],
          ),
          actions: const [],
        ),
        floatingActionButton: Builder(
          builder: (context) {
            final tabController = DefaultTabController.of(context);
            if (tabController.index == 0) {
              return FloatingActionButton.extended(
                onPressed: () => _showEmployeeForm(),
                backgroundColor: const Color(0xFFCE93D8),
                icon: const Icon(Icons.person_add, color: Colors.white),
                label: const Text('Novo Funcionário', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              );
            }
            return const SizedBox.shrink();
          }
        ),
        body: TabBarView(
          children: [
            // Tab 1: Equipes
            SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_employees.isEmpty)
                    const Text('Nenhum funcionário cadastrado.', style: TextStyle(color: Colors.white54)),
                  
                  ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _employees.length,
                    itemBuilder: (context, index) {
                      final emp = _employees[index];
                      final String role = emp['role'] == 'SELLER' ? 'Vendedor' : (emp['role'] == 'PHOTOGRAPHER' ? 'Fotógrafo' : (emp['role'] == 'SELLER_MANAGER' ? 'Vendedor Gerente' : 'Contato'));
                      
                      String carInfo = 'Nenhum';
                      if (emp['usesOwnCar'] == true) {
                        carInfo = 'Próprio';
                      } else if (emp['currentCars'] != null && (emp['currentCars'] as List).isNotEmpty) {
                        carInfo = 'Empresa (${emp['currentCars'][0]['model']})';
                      }

                      return LedCard(
                        color: const Color(0xFF1A1A2E),
                        margin: const EdgeInsets.only(bottom: 12),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: Colors.white12,
                            backgroundImage: AuthenticatedImage.provider(emp['profilePhotoUrl']),
                            child: emp['profilePhotoUrl'] == null ? const Icon(Icons.person, color: Colors.white54) : null,
                          ),
                          title: Text(emp['name'], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          subtitle: Text('$role | Carro: $carInfo${emp['photographerCode'] != null ? ' | Cód: ${emp['photographerCode']}' : ''}', style: const TextStyle(color: Colors.white70)),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.edit, color: Colors.blueAccent),
                                onPressed: () => _showEmployeeForm(emp),
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete, color: Colors.redAccent),
                                onPressed: () => _deleteEmployee(emp['id']),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            // Tab 2: Checklist
            _FleetChecklistTab(cars: _cars, employees: _employees, apiService: _apiService, onSaved: _fetchData),
          ],
        ),
      ),
    );
  }
}

class _EmployeeFormDialog extends StatefulWidget {
  final Map<String, dynamic>? employee;
  final List<dynamic> teams;
  final List<dynamic> cars;
  final VoidCallback onSaved;

  const _EmployeeFormDialog({this.employee, required this.teams, required this.cars, required this.onSaved});

  @override
  State<_EmployeeFormDialog> createState() => _EmployeeFormDialogState();
}

class _EmployeeFormDialogState extends State<_EmployeeFormDialog> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _nameCtrl;
  late TextEditingController _passwordCtrl;
  late TextEditingController _cpfCtrl;
  late TextEditingController _rgCtrl;
  late TextEditingController _phoneCtrl;
  late TextEditingController _emergencyCtrl;
  late TextEditingController _addressCtrl;
  late TextEditingController _photographerCodeCtrl;

  String _role = 'SELLER';
  String _salesType = 'BOOK';
  String? _teamId;
  String? _carId;
  bool _usesOwnCar = false;
  
  File? _profilePhoto;
  File? _criminalRecord;
  
  bool _isSaving = false;

  Future<void> _createTeamInline() async {
    final nameCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Nova Equipe', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: nameCtrl,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(labelText: 'Nome da Equipe', labelStyle: TextStyle(color: Colors.white54)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          LedButton(
            onPressed: () async {
              if (nameCtrl.text.trim().isEmpty) return;
              try {
                final api = ApiService();
                final newTeam = await api.createTeam({'name': nameCtrl.text.trim(), 'type': 'PRODUCTION'});
                if (!mounted) return;
                setState(() {
                  widget.teams.add(newTeam);
                  _teamId = newTeam['id'];
                });
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Equipe criada!')));
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                }
              }
            },
            style: LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
            child: const Text('Criar e Selecionar', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    final emp = widget.employee;
    _nameCtrl = TextEditingController(text: emp?['name'] ?? '');
    _passwordCtrl = TextEditingController();
    _cpfCtrl = TextEditingController(text: emp?['cpf'] ?? '');
    _rgCtrl = TextEditingController(text: emp?['rg'] ?? '');
    _phoneCtrl = TextEditingController(text: emp?['phone'] ?? '');
    _emergencyCtrl = TextEditingController(text: emp?['emergencyPhone'] ?? '');
    _addressCtrl = TextEditingController(text: emp?['address'] ?? '');
    _photographerCodeCtrl = TextEditingController(text: emp?['photographerCode'] ?? '');
    
    if (emp != null) {
      _role = emp['role'] ?? 'SELLER';
      _salesType = emp['salesType'] ?? 'BOOK';
      _teamId = emp['teamId'];
      _usesOwnCar = emp['usesOwnCar'] ?? false;
      if (emp['currentCars'] != null && (emp['currentCars'] as List).isNotEmpty) {
        _carId = emp['currentCars'][0]['id'];
      }
    }
  }

  Future<void> _pickImage(bool isProfile) async {
    final result = isProfile
        ? await MediaPickerService().pickProfilePhoto(context)
        : await MediaPickerService().pickDocumentOrImage(context, title: 'Antecedentes Criminais / Documento');
    if (!mounted || result == null) return;
    setState(() {
      if (isProfile) {
        _profilePhoto = result.file;
      } else {
        _criminalRecord = result.file;
      }
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);

    try {
      String finalSalesType = _salesType;
      String finalTeamId = _teamId ?? '';
        
      if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT') {
        finalSalesType = '';
      }

      final formData = FormData.fromMap({
        'name': _nameCtrl.text.trim(),
        'password': _passwordCtrl.text.trim(),
        'role': _role,
        'salesType': finalSalesType,
        'cpf': _cpfCtrl.text.trim(),
        'rg': _rgCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        'emergencyPhone': _emergencyCtrl.text.trim(),
        'address': _addressCtrl.text.trim(),
        'teamId': finalTeamId,
        'carId': _carId ?? '',
        'usesOwnCar': _usesOwnCar.toString(),
        'photographerCode': _photographerCodeCtrl.text.trim(),
      });

      if (_profilePhoto != null) {
        formData.files.add(MapEntry('profilePhoto', await MultipartFile.fromFile(_profilePhoto!.path)));
      }
      if (_criminalRecord != null) {
        formData.files.add(MapEntry('criminalRecord', await MultipartFile.fromFile(_criminalRecord!.path)));
      }

      if (widget.employee == null) {
        if (_passwordCtrl.text.isEmpty) {
          throw Exception("Senha é obrigatória para novos cadastros.");
        }
        await _apiService.createUser(formData);
      } else {
        await _apiService.updateUser(widget.employee!['id'], formData);
      }

      if (!mounted) return;
      Navigator.of(context).pop();
      widget.onSaved();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Salvo com sucesso!'), backgroundColor: Colors.green));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final isNarrow = screenWidth < 600;
    final dialogWidth = isNarrow ? screenWidth * 0.94 : 600.0;

    return Dialog(
      backgroundColor: const Color(0xFF1A1A2E),
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: dialogWidth,
        padding: EdgeInsets.all(isNarrow ? 16 : 24),
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  widget.employee == null ? 'Novo Funcionário' : 'Editar Funcionário',
                  style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                
                // ── Bloco de Fotos (Perfil somente câmera | Antecedentes câmera ou galeria)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF121224),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      // Perfil (Câmera obrigatória)
                      Column(
                        children: [
                          GestureDetector(
                            onTap: () => _pickImage(true),
                            child: CircleAvatar(
                              radius: 42,
                              backgroundColor: Colors.white12,
                              backgroundImage: _profilePhoto != null ? FileImage(_profilePhoto!) : null,
                              child: _profilePhoto == null
                                  ? const Icon(Icons.camera_alt, color: Color(0xFFCE93D8), size: 32)
                                  : null,
                            ),
                          ),
                          const SizedBox(height: 6),
                          const Text('Foto de Perfil', style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w600)),
                          const Text('(Somente Câmera)', style: TextStyle(color: Colors.white38, fontSize: 9)),
                        ],
                      ),

                      // Antecedentes (Câmera ou Galeria/PDF)
                      Column(
                        children: [
                          GestureDetector(
                            onTap: () => _pickImage(false),
                            child: Container(
                              width: 84,
                              height: 84,
                              decoration: BoxDecoration(
                                color: Colors.white12,
                                borderRadius: BorderRadius.circular(8),
                                image: _criminalRecord != null
                                    ? DecorationImage(image: FileImage(_criminalRecord!), fit: BoxFit.cover)
                                    : null,
                              ),
                              child: _criminalRecord == null
                                  ? const Icon(Icons.document_scanner, color: Color(0xFF90CAF9), size: 32)
                                  : null,
                            ),
                          ),
                          const SizedBox(height: 6),
                          const Text('Antecedentes', style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w600)),
                          const Text('(Foto ou Documento)', style: TextStyle(color: Colors.white38, fontSize: 9)),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // ── Campos de Dados Pessoais
                TextFormField(
                  controller: _nameCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Nome Completo',
                    labelStyle: TextStyle(color: Colors.white54),
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Obrigatório' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _cpfCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'CPF (Login)',
                    labelStyle: TextStyle(color: Colors.white54),
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Obrigatório' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _passwordCtrl,
                  obscureText: true,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: widget.employee == null ? 'Senha de Acesso' : 'Nova Senha (deixe vazio para manter)',
                    labelStyle: const TextStyle(color: Colors.white54),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                  validator: (v) => ((v == null || v.isEmpty) && widget.employee == null) ? 'Obrigatório para novo funcionário' : null,
                ),
                const SizedBox(height: 10),

                TextFormField(
                  controller: _rgCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'RG',
                    labelStyle: TextStyle(color: Colors.white54),
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                ),
                const SizedBox(height: 10),

                if (isNarrow) ...[
                  TextFormField(
                    controller: _phoneCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Telefone',
                      labelStyle: TextStyle(color: Colors.white54),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _emergencyCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Tel. Emergência',
                      labelStyle: TextStyle(color: Colors.white54),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    ),
                  ),
                ] else ...[
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _phoneCtrl,
                          style: const TextStyle(color: Colors.white),
                          decoration: const InputDecoration(
                            labelText: 'Telefone',
                            labelStyle: TextStyle(color: Colors.white54),
                            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _emergencyCtrl,
                          style: const TextStyle(color: Colors.white),
                          decoration: const InputDecoration(
                            labelText: 'Tel. Emergência',
                            labelStyle: TextStyle(color: Colors.white54),
                            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],

                const SizedBox(height: 10),
                TextFormField(
                  controller: _addressCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Endereço Completo',
                    labelStyle: TextStyle(color: Colors.white54),
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                ),

                const SizedBox(height: 20),
                const Text('Função e Vínculos', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 10),

                DropdownButtonFormField<String>(
                  value: _role,
                  isExpanded: true,
                  dropdownColor: const Color(0xFF111122),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Cargo',
                    labelStyle: TextStyle(color: Colors.white54),
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'SELLER', child: Text('Vendedor')),
                    DropdownMenuItem(value: 'SELLER_MANAGER', child: Text('Vendedor Gerente (Distribuição)')),
                    DropdownMenuItem(value: 'PHOTOGRAPHER', child: Text('Fotógrafo')),
                    DropdownMenuItem(value: 'CONTACT', child: Text('Contato (Assistente)')),
                  ],
                  onChanged: (v) => setState(() => _role = v!),
                ),

                if (_role != 'PHOTOGRAPHER' && _role != 'CONTACT') ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: _salesType,
                    isExpanded: true,
                    dropdownColor: const Color(0xFF111122),
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Tipo de Venda',
                      labelStyle: TextStyle(color: Colors.white54),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'BOOK', child: Text('Book')),
                      DropdownMenuItem(value: 'REBOLO', child: Text('Rebolo')),
                    ],
                    onChanged: (v) => setState(() => _salesType = v!),
                  ),
                ],

                if (_role == 'PHOTOGRAPHER') ...[
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _photographerCodeCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Código do Fotógrafo (ex: 0001)',
                      labelStyle: TextStyle(color: Colors.white54),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ],

                if (!_usesOwnCar) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: _carId,
                    isExpanded: true,
                    dropdownColor: const Color(0xFF1A1A2E),
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Veículo Vinculado (Opcional)',
                      labelStyle: TextStyle(color: Colors.white54),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    ),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('Nenhum Veículo')),
                      ...widget.cars
                        .where((c) => c['status'] == 'AVAILABLE' || c['id'] == _carId)
                        .map((c) => DropdownMenuItem(value: c['id'] as String, child: Text('${c['plate']} - ${c['model']}'))),
                    ],
                    onChanged: (v) => setState(() => _carId = v),
                  ),
                ],
                
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Text('Usa carro próprio?', style: TextStyle(color: Colors.white70, fontSize: 13)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Row(
                        children: [
                          Expanded(
                            child: RadioListTile<bool>(
                              contentPadding: EdgeInsets.zero,
                              title: const Text('Sim', style: TextStyle(color: Colors.white, fontSize: 13)),
                              value: true,
                              groupValue: _usesOwnCar,
                              activeColor: const Color(0xFFCE93D8),
                              onChanged: (v) {
                                setState(() {
                                  _usesOwnCar = v!;
                                  _carId = null;
                                });
                              },
                            ),
                          ),
                          Expanded(
                            child: RadioListTile<bool>(
                              contentPadding: EdgeInsets.zero,
                              title: const Text('Não', style: TextStyle(color: Colors.white, fontSize: 13)),
                              value: false,
                              groupValue: _usesOwnCar,
                              activeColor: const Color(0xFFCE93D8),
                              onChanged: (v) => setState(() => _usesOwnCar = v!),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                        minimumSize: const Size(80, 48),
                      ),
                      onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
                      child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                    ),
                    const SizedBox(width: 12),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFCE93D8),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                        minimumSize: const Size(110, 48),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      onPressed: _isSaving ? null : _save,
                      child: _isSaving 
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : const Text('Salvar', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                  ],
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FleetChecklistTab extends StatefulWidget {
  final List<dynamic> cars;
  final List<dynamic> employees;
  final ApiService apiService;
  final VoidCallback onSaved;

  const _FleetChecklistTab({required this.cars, required this.employees, required this.apiService, required this.onSaved});

  @override
  State<_FleetChecklistTab> createState() => _FleetChecklistTabState();
}

class _FleetChecklistTabState extends State<_FleetChecklistTab> {
  final _formKey = GlobalKey<FormState>();
  String _type = 'CHECKOUT';
  String? _selectedCarId;
  String? _selectedDriverId;
  String _fuelLevel = 'EMPTY';
  bool _reuseInitialPhotos = false;
  final _mileageCtrl = TextEditingController();
  final _damageCtrl = TextEditingController();
  
  final Map<String, File?> _photos = {
    'frontPhoto': null,
    'backPhoto': null,
    'leftPhoto': null,
    'rightPhoto': null,
    'dashboardPhoto': null,
    'enginePhoto': null,
    'trunkPhoto': null,
  };

  final SignatureController _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );

  bool _isSaving = false;

  Future<void> _pickPhoto(String key) async {
    final result = await MediaPickerService().pickGeneralAttachment(context, title: 'Foto da Vistoria ($key)');
    if (result != null) {
      setState(() => _photos[key] = result.file);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    
    // Check if signature is empty
    if (_signatureController.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A assinatura é obrigatória!'), backgroundColor: Colors.red));
      return;
    }

    setState(() => _isSaving = true);
    
    try {
      final Uint8List? signatureData = await _signatureController.toPngBytes();
      if (signatureData == null) throw Exception("Falha ao gerar imagem da assinatura.");
      
      // Save signature to temporary file
      final tempDir = await getTemporaryDirectory();
      final sigFile = File('${tempDir.path}/signature_${DateTime.now().millisecondsSinceEpoch}.png');
      await sigFile.writeAsBytes(signatureData);

      final formData = FormData.fromMap({
        'carId': _selectedCarId,
        'driverId': _selectedDriverId,
        'type': _type,
        'mileage': _mileageCtrl.text,
        'fuelLevel': _fuelLevel,
        'damageReport': _damageCtrl.text,
        'reuseInitialPhotos': _reuseInitialPhotos.toString(),
      });

      // Add photos
      for (var entry in _photos.entries) {
        if (entry.value != null) {
          formData.files.add(MapEntry(entry.key, await MultipartFile.fromFile(entry.value!.path)));
        }
      }
      
      // Add signature
      formData.files.add(MapEntry('signature', await MultipartFile.fromFile(sigFile.path)));

      await widget.apiService.submitChecklist(formData);
      
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Checklist salvo com sucesso!'), backgroundColor: Colors.green));
      
      // Reset form
      setState(() {
        _photos.updateAll((key, value) => null);
        _mileageCtrl.clear();
        _damageCtrl.clear();
        _signatureController.clear();
      });
      widget.onSaved();

    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  Widget _buildPhotoButton(String label, String key) {
    final hasPhoto = _photos[key] != null;
    return InkWell(
      onTap: () => _pickPhoto(key),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: hasPhoto ? Colors.green.withOpacity(0.2) : Colors.white12,
          border: Border.all(color: hasPhoto ? Colors.green : Colors.white24),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(hasPhoto ? Icons.check_circle : Icons.camera_alt, color: hasPhoto ? Colors.green : Colors.white54),
            const SizedBox(width: 12),
            Expanded(child: Text(label, style: const TextStyle(color: Colors.white))),
            if (hasPhoto)
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(_photos[key]!, width: 40, height: 40, fit: BoxFit.cover),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Novo Checklist de Veículo', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),
            
            Row(
              children: [
                Expanded(
                  child: RadioListTile<String>(
                    title: const Text('Saída (CHECKOUT)', style: TextStyle(color: Colors.white)),
                    value: 'CHECKOUT',
                    groupValue: _type,
                    activeColor: const Color(0xFFCE93D8),
                    onChanged: (val) => setState(() { _type = val!; _selectedCarId = null; }),
                  ),
                ),
                Expanded(
                  child: RadioListTile<String>(
                    title: const Text('Entrada (CHECKIN)', style: TextStyle(color: Colors.white)),
                    value: 'CHECKIN',
                    groupValue: _type,
                    activeColor: const Color(0xFFCE93D8),
                    onChanged: (val) => setState(() { _type = val!; _selectedCarId = null; }),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            
            DropdownButtonFormField<String>(
              decoration: InputDecoration(labelText: 'Carro', filled: true, fillColor: const Color(0xFF1A1A2E), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
              style: const TextStyle(color: Colors.white),
              dropdownColor: const Color(0xFF2A2A3E),
              value: _selectedCarId,
              items: widget.cars.where((c) {
                if (_type == 'CHECKOUT') return c['status'] == 'AVAILABLE';
                return c['status'] == 'IN_USE';
              }).map((c) => DropdownMenuItem(value: c['id'] as String, child: Text('${c['model']} - ${c['plate']}'))).toList(),
              onChanged: (val) => setState(() => _selectedCarId = val),
              validator: (val) => val == null ? 'Obrigatório' : null,
            ),
            const SizedBox(height: 16),
            
            DropdownButtonFormField<String>(
              decoration: InputDecoration(labelText: 'Funcionário', filled: true, fillColor: const Color(0xFF1A1A2E), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
              style: const TextStyle(color: Colors.white),
              dropdownColor: const Color(0xFF2A2A3E),
              value: _selectedDriverId,
              items: widget.employees.map((e) => DropdownMenuItem(value: e['id'] as String, child: Text(e['name']))).toList(),
              onChanged: (val) => setState(() => _selectedDriverId = val),
              validator: (val) => val == null ? 'Obrigatório' : null,
            ),
            const SizedBox(height: 16),
            
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _mileageCtrl,
                    style: const TextStyle(color: Colors.white),
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(labelText: 'KM Atual', filled: true, fillColor: const Color(0xFF1A1A2E), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
                    validator: (val) => val!.isEmpty ? 'Obrigatório' : null,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    decoration: InputDecoration(labelText: 'Combustível', filled: true, fillColor: const Color(0xFF1A1A2E), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
                    style: const TextStyle(color: Colors.white),
                    dropdownColor: const Color(0xFF2A2A3E),
                    value: _fuelLevel,
                    items: const [
                      DropdownMenuItem(value: 'EMPTY', child: Text('Vazio (Reserva)')),
                      DropdownMenuItem(value: 'QUARTER', child: Text('1/4')),
                      DropdownMenuItem(value: 'HALF', child: Text('Meio (1/2)')),
                      DropdownMenuItem(value: 'THREE_QUARTERS', child: Text('3/4')),
                      DropdownMenuItem(value: 'FULL', child: Text('Cheio')),
                    ],
                    onChanged: (val) => setState(() => _fuelLevel = val!),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            
            TextFormField(
              controller: _damageCtrl,
              style: const TextStyle(color: Colors.white),
              maxLines: 3,
              decoration: InputDecoration(labelText: 'Observações / Avarias', filled: true, fillColor: const Color(0xFF1A1A2E), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
            ),
            const SizedBox(height: 16),
            
            SwitchListTile(
              title: const Text('Reutilizar fotos do cadastro inicial', style: TextStyle(color: Colors.white)),
              value: _reuseInitialPhotos,
              activeColor: const Color(0xFFCE93D8),
              onChanged: (val) {
                setState(() {
                  _reuseInitialPhotos = val;
                  if (val) {
                    final selectedCar = widget.cars.firstWhere((c) => c['id'] == _selectedCarId, orElse: () => null);
                    if (selectedCar != null && selectedCar['initialChecklist'] != null) {
                      _damageCtrl.text = selectedCar['initialChecklist'];
                    }
                  }
                });
              },
            ),
            const SizedBox(height: 8),
            
            if (!_reuseInitialPhotos)
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Fotos do Veículo (Comprimidas)', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  _buildPhotoButton('Frente', 'frontPhoto'),
                  _buildPhotoButton('Traseira', 'backPhoto'),
                  _buildPhotoButton('Lateral Esquerda', 'leftPhoto'),
                  _buildPhotoButton('Lateral Direita', 'rightPhoto'),
                  _buildPhotoButton('Painel/Interior', 'dashboardPhoto'),
                  _buildPhotoButton('Motor', 'enginePhoto'),
                  _buildPhotoButton('Porta-malas', 'trunkPhoto'),
                ],
              ),
            
            const SizedBox(height: 24),
            

            
            const SizedBox(height: 24),
            const Text('Assinatura do Funcionário', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white24),
                borderRadius: BorderRadius.circular(12),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Signature(
                  controller: _signatureController,
                  height: 150,
                  backgroundColor: Colors.white,
                ),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => _signatureController.clear(),
                  child: const Text('Limpar Assinatura', style: TextStyle(color: Colors.redAccent)),
                ),
              ],
            ),
            
            const SizedBox(height: 32),
            LedButton(
              onPressed: _isSaving ? null : _submit,
              style: LedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: _isSaving
                  ? const CircularProgressIndicator(color: Colors.white)
                  : const Text('Salvar Checklist', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}

