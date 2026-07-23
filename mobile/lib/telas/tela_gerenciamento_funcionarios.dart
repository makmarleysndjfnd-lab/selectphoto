import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:signature/signature.dart';
import '../servicos/servico_api.dart';

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
      
      setState(() {
        _employees = emps.where((u) => u['role'] != 'ADMIN').toList();
        _teams = teams;
        _cars = cars;
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar: $e'), backgroundColor: Colors.red));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _deleteEmployee(String id) async {
    try {
      await _apiService.deleteUser(id);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Excluído com sucesso!'), backgroundColor: Colors.green));
      _fetchData();
    } catch (e) {
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
              Tab(text: 'Equipe e Funcionários', icon: Icon(Icons.people)),
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
                icon: const Icon(Icons.person_add, color: Colors.black),
                label: const Text('Novo Funcionário', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
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
                      final bool isLeader = emp['isTeamLeader'] == true;
                      
                      return Card(
                        color: const Color(0xFF1A1A2E),
                        margin: const EdgeInsets.only(bottom: 12),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: Colors.white12,
                            backgroundImage: emp['profilePhotoUrl'] != null 
                              ? NetworkImage('http://192.168.1.6:3000${emp['profilePhotoUrl']}') 
                              : null,
                            child: emp['profilePhotoUrl'] == null ? const Icon(Icons.person, color: Colors.white54) : null,
                          ),
                          title: Text(emp['name'], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          subtitle: Text('$role ${isLeader ? '(Líder/Gerente)' : ''} | Equipe: ${emp['team']?['name'] ?? 'Nenhuma'}', style: const TextStyle(color: Colors.white70)),
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

  String _role = 'SELLER';
  String _salesType = 'BOOK';
  String? _teamId;
  String? _carId;
  bool _isTeamLeader = false;
  bool _usesOwnCar = false;
  
  File? _profilePhoto;
  File? _criminalRecord;
  final ImagePicker _picker = ImagePicker();
  
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
          ElevatedButton(
            onPressed: () async {
              if (nameCtrl.text.trim().isEmpty) return;
              try {
                final api = ApiService();
                final newTeam = await api.createTeam({'name': nameCtrl.text.trim(), 'type': 'PRODUCTION'});
                setState(() {
                  widget.teams.add(newTeam);
                  _teamId = newTeam['id'];
                });
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Equipe criada!')));
              } catch (e) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
            child: const Text('Criar e Selecionar', style: TextStyle(color: Colors.black)),
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
    
    if (emp != null) {
      _role = emp['role'] ?? 'SELLER';
      _salesType = emp['salesType'] ?? 'BOOK';
      _teamId = emp['teamId'];
      _isTeamLeader = emp['isTeamLeader'] ?? false;
      _usesOwnCar = emp['usesOwnCar'] ?? false;
      if (emp['currentCars'] != null && (emp['currentCars'] as List).isNotEmpty) {
        _carId = emp['currentCars'][0]['id'];
      }
    }
  }

  Future<void> _pickImage(bool isProfile) async {
    final pickedFile = await _picker.pickImage(source: ImageSource.gallery);
    if (pickedFile != null) {
      setState(() {
        if (isProfile) {
          _profilePhoto = File(pickedFile.path);
        } else {
          _criminalRecord = File(pickedFile.path);
        }
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);

    try {
      String finalSalesType = _salesType;
        String finalTeamId = _teamId ?? '';
        bool finalIsTeamLeader = _isTeamLeader;
        
        if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT') {
          finalSalesType = '';
        } else {
          finalTeamId = '';
          finalIsTeamLeader = false;
        }

        final formData = FormData.fromMap({
          'name': _nameCtrl.text,
          'password': _passwordCtrl.text,
          'role': _role,
          'salesType': finalSalesType,
          'cpf': _cpfCtrl.text,
          'rg': _rgCtrl.text,
          'phone': _phoneCtrl.text,
          'emergencyPhone': _emergencyCtrl.text,
          'address': _addressCtrl.text,
          'teamId': finalTeamId,
          'carId': _carId ?? '',
          'isTeamLeader': finalIsTeamLeader.toString(),
          'usesOwnCar': _usesOwnCar.toString(),
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

      Navigator.of(context).pop();
      widget.onSaved();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Salvo com sucesso!'), backgroundColor: Colors.green));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
    } finally {
      setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: 600,
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.employee == null ? 'Novo Funcionário' : 'Editar Funcionário', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 20),
                
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Coluna de Imagens
                    Column(
                      children: [
                        GestureDetector(
                          onTap: () => _pickImage(true),
                          child: CircleAvatar(
                            radius: 50,
                            backgroundColor: Colors.white12,
                            backgroundImage: _profilePhoto != null ? FileImage(_profilePhoto!) : null,
                            child: _profilePhoto == null ? const Icon(Icons.camera_alt, color: Colors.white54, size: 40) : null,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text('book Perfil', style: TextStyle(color: Colors.white70, fontSize: 12)),
                        
                        const SizedBox(height: 20),
                        
                        GestureDetector(
                          onTap: () => _pickImage(false),
                          child: Container(
                            width: 100, height: 100,
                            decoration: BoxDecoration(
                              color: Colors.white12,
                              borderRadius: BorderRadius.circular(8),
                              image: _criminalRecord != null ? DecorationImage(image: FileImage(_criminalRecord!), fit: BoxFit.cover) : null,
                            ),
                            child: _criminalRecord == null ? const Icon(Icons.document_scanner, color: Colors.white54, size: 40) : null,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text('Antecedentes', style: TextStyle(color: Colors.white70, fontSize: 12)),
                      ],
                    ),
                    const SizedBox(width: 24),
                    
                    // Coluna de Dados
                    Expanded(
                      child: Column(
                        children: [
                          TextFormField(
                            controller: _nameCtrl,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Nome Completo', labelStyle: TextStyle(color: Colors.white54)),
                            validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                          ),
                          TextFormField(
                            controller: _cpfCtrl,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'CPF (Login)', labelStyle: TextStyle(color: Colors.white54)),
                            validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                          ),
                          TextFormField(
                            controller: _passwordCtrl,
                            obscureText: true,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Senha de Acesso', labelStyle: TextStyle(color: Colors.white54)),
                            validator: (v) => (v!.isEmpty && widget.employee == null) ? 'Obrigatório para novo funcionário' : null,
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextFormField(
                                  controller: _rgCtrl,
                                  style: const TextStyle(color: Colors.white),
                                  decoration: const InputDecoration(labelText: 'RG', labelStyle: TextStyle(color: Colors.white54)),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: TextFormField(
                                  controller: _rgCtrl,
                                  style: const TextStyle(color: Colors.white),
                                  decoration: const InputDecoration(labelText: 'RG', labelStyle: TextStyle(color: Colors.white54)),
                                ),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextFormField(
                                  controller: _phoneCtrl,
                                  style: const TextStyle(color: Colors.white),
                                  decoration: const InputDecoration(labelText: 'Telefone', labelStyle: TextStyle(color: Colors.white54)),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: TextFormField(
                                  controller: _emergencyCtrl,
                                  style: const TextStyle(color: Colors.white),
                                  decoration: const InputDecoration(labelText: 'Tel. Emergência', labelStyle: TextStyle(color: Colors.white54)),
                                ),
                              ),
                            ],
                          ),
                          TextFormField(
                            controller: _addressCtrl,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Endereço Completo', labelStyle: TextStyle(color: Colors.white54)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                
                const SizedBox(height: 24),
                const Text('Função e Vínculos', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _role,
                        dropdownColor: const Color(0xFF111122),
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(labelText: 'Cargo', labelStyle: TextStyle(color: Colors.white54)),
                        items: const [
                          DropdownMenuItem(value: 'SELLER', child: Text('Vendedor')),
                          DropdownMenuItem(value: 'SELLER_MANAGER', child: Text('Vendedor Gerente (Distribuição)')),
                          DropdownMenuItem(value: 'PHOTOGRAPHER', child: Text('Fotógrafo')),
                          DropdownMenuItem(value: 'CONTACT', child: Text('Contato (Assistente)')),
                        ],
                        onChanged: (v) => setState(() => _role = v!),
                      ),
                    ),
                    const SizedBox(width: 16),
                    if (_role != 'PHOTOGRAPHER' && _role != 'CONTACT')
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _salesType,
                        dropdownColor: const Color(0xFF111122),
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(labelText: 'Tipo de Venda', labelStyle: TextStyle(color: Colors.white54)),
                        items: const [
                          DropdownMenuItem(value: 'BOOK', child: Text('Book')),
                          DropdownMenuItem(value: 'REBOLO', child: Text('Rebolo')),
                        ],
                        onChanged: (v) => setState(() => _salesType = v!),
                      ),
                    ),
                    if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT')
                      const Expanded(child: SizedBox()),
                  ],
                ),
                const SizedBox(height: 12),
                if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT')
                  DropdownButtonFormField<String>(
                  value: _teamId,
                  dropdownColor: const Color(0xFF1A1A2E),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Equipe (Opcional)',
                    labelStyle: const TextStyle(color: Colors.white54),
                    filled: true,
                    fillColor: const Color(0xFF0D0D1A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Nenhuma Equipe')),
                    ...widget.teams.map((t) => DropdownMenuItem(value: t['id'] as String, child: Text('${t['name']} (${t['type']})'))),
                  ],
                  onChanged: (v) => setState(() => _teamId = v),
                ),
                const SizedBox(height: 12),
                if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT')
                  CheckboxListTile(
                  title: const Text('Chefe de Equipe?', style: TextStyle(color: Colors.white)),
                  value: _isTeamLeader,
                  onChanged: (v) => setState(() => _isTeamLeader = v ?? false),
                  activeColor: const Color(0xFFCE93D8),
                  checkColor: Colors.black,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                ),
                const SizedBox(height: 12),
                if (!_usesOwnCar)
                  DropdownButtonFormField<String>(
                  value: _carId,
                  dropdownColor: const Color(0xFF1A1A2E),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Veículo Vinculado (Opcional)',
                    labelStyle: const TextStyle(color: Colors.white54),
                    filled: true,
                    fillColor: const Color(0xFF0D0D1A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Nenhum Veículo')),
                    ...widget.cars.map((c) => DropdownMenuItem(value: c['id'] as String, child: Text('${c['plate']} - ${c['model']}'))),
                  ],
                  onChanged: (v) => setState(() => _carId = v),
                ),
                const SizedBox(height: 12),
                
                const Text('Usa carro próprio?', style: TextStyle(color: Colors.white)),
                Row(
                  children: [
                    Expanded(
                      child: RadioListTile<bool>(
                        title: const Text('Sim', style: TextStyle(color: Colors.white)),
                        value: true,
                        groupValue: _usesOwnCar,
                        activeColor: const Color(0xFFCE93D8),
                        onChanged: (v) {
                          setState(() {
                            _usesOwnCar = v!;
                            _carId = null; // reset if they use own car
                          });
                        },
                      ),
                    ),
                    Expanded(
                      child: RadioListTile<bool>(
                        title: const Text('Não', style: TextStyle(color: Colors.white)),
                        value: false,
                        groupValue: _usesOwnCar,
                        activeColor: const Color(0xFFCE93D8),
                        onChanged: (v) => setState(() => _usesOwnCar = v!),
                      ),
                    ),
                  ],
                ),
                
                const SizedBox(height: 32),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                    ),
                    const SizedBox(width: 16),
                    ElevatedButton(
                      onPressed: _isSaving ? null : _save,
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                      child: _isSaving 
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2))
                        : const Text('Salvar', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
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
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.camera, imageQuality: 50);
    if (picked != null) {
      setState(() => _photos[key] = File(picked.path));
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
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
    } finally {
      setState(() => _isSaving = false);
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
                    onChanged: (val) => setState(() => _type = val!),
                  ),
                ),
                Expanded(
                  child: RadioListTile<String>(
                    title: const Text('Entrada (CHECKIN)', style: TextStyle(color: Colors.white)),
                    value: 'CHECKIN',
                    groupValue: _type,
                    activeColor: const Color(0xFFCE93D8),
                    onChanged: (val) => setState(() => _type = val!),
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
              items: widget.cars.map((c) => DropdownMenuItem(value: c['id'] as String, child: Text('${c['model']} - ${c['plate']}'))).toList(),
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
            ElevatedButton(
              onPressed: _isSaving ? null : _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: _isSaving
                  ? const CircularProgressIndicator(color: Colors.black)
                  : const Text('Salvar Checklist', style: TextStyle(color: Colors.black, fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}

