import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
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

  void _showTeamsDialog() {
    showDialog(
      context: context,
      builder: (context) => _TeamsManagementDialog(
        teams: _teams,
        onSaved: _fetchData,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)));
    }

    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showEmployeeForm(),
        backgroundColor: const Color(0xFFCE93D8),
        icon: const Icon(Icons.person_add, color: Colors.black),
        label: const Text('Novo Funcionário', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Gerenciamento de Funcionários (RH)',
                  style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold),
                ),
                ElevatedButton.icon(
                  onPressed: _showTeamsDialog,
                  icon: const Icon(Icons.groups, color: Colors.white),
                  label: const Text('Gerenciar Equipes', style: TextStyle(color: Colors.white)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF3A0068),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            if (_employees.isEmpty)
              const Text('Nenhum funcionário cadastrado.', style: TextStyle(color: Colors.white54)),
            
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _employees.length,
              itemBuilder: (context, index) {
                final emp = _employees[index];
                final String role = emp['role'] == 'SELLER' ? 'Vendedor' : (emp['role'] == 'PHOTOGRAPHER' ? 'Fotógrafo' : 'Contato');
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
  late TextEditingController _emailCtrl;
  late TextEditingController _passwordCtrl;
  late TextEditingController _cpfCtrl;
  late TextEditingController _rgCtrl;
  late TextEditingController _phoneCtrl;
  late TextEditingController _emergencyCtrl;
  late TextEditingController _addressCtrl;

  String _role = 'SELLER';
  String? _teamId;
  String? _carId;
  bool _isTeamLeader = false;
  bool _usesOwnCar = false;
  
  File? _profilePhoto;
  File? _criminalRecord;
  final ImagePicker _picker = ImagePicker();
  
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    final emp = widget.employee;
    _nameCtrl = TextEditingController(text: emp?['name'] ?? '');
    _emailCtrl = TextEditingController(text: emp?['email'] ?? '');
    _passwordCtrl = TextEditingController();
    _cpfCtrl = TextEditingController(text: emp?['cpf'] ?? '');
    _rgCtrl = TextEditingController(text: emp?['rg'] ?? '');
    _phoneCtrl = TextEditingController(text: emp?['phone'] ?? '');
    _emergencyCtrl = TextEditingController(text: emp?['emergencyPhone'] ?? '');
    _addressCtrl = TextEditingController(text: emp?['address'] ?? '');
    
    if (emp != null) {
      _role = emp['role'] ?? 'SELLER';
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
      final formData = FormData.fromMap({
        'name': _nameCtrl.text,
        'email': _emailCtrl.text,
        'password': _passwordCtrl.text, // Backend handles empty password logic for PUT
        'role': _role,
        'cpf': _cpfCtrl.text,
        'rg': _rgCtrl.text,
        'phone': _phoneCtrl.text,
        'emergencyPhone': _emergencyCtrl.text,
        'address': _addressCtrl.text,
        'teamId': _teamId ?? '',
        'carId': _carId ?? '',
        'isTeamLeader': _isTeamLeader.toString(),
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
                        const Text('Foto Perfil', style: TextStyle(color: Colors.white70, fontSize: 12)),
                        
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
                            controller: _emailCtrl,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Email (Login)', labelStyle: TextStyle(color: Colors.white54)),
                            validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                          ),
                          TextFormField(
                            controller: _passwordCtrl,
                            obscureText: true,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Senha', labelStyle: TextStyle(color: Colors.white54)),
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextFormField(
                                  controller: _cpfCtrl,
                                  style: const TextStyle(color: Colors.white),
                                  decoration: const InputDecoration(labelText: 'CPF', labelStyle: TextStyle(color: Colors.white54)),
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
                          DropdownMenuItem(value: 'PHOTOGRAPHER', child: Text('Fotógrafo')),
                          DropdownMenuItem(value: 'CONTACT', child: Text('Contato (Assistente)')),
                        ],
                        onChanged: (v) => setState(() => _role = v!),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
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
                CheckboxListTile(
                  title: const Text('Usa carro próprio?', style: TextStyle(color: Colors.white)),
                  value: _usesOwnCar,
                  activeColor: const Color(0xFFCE93D8),
                  checkColor: Colors.black,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  onChanged: (v) => setState(() => _usesOwnCar = v!),
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

class _TeamsManagementDialog extends StatefulWidget {
  final List<dynamic> teams;
  final VoidCallback onSaved;

  const _TeamsManagementDialog({required this.teams, required this.onSaved});

  @override
  State<_TeamsManagementDialog> createState() => _TeamsManagementDialogState();
}

class _TeamsManagementDialogState extends State<_TeamsManagementDialog> {
  final ApiService _apiService = ApiService();
  bool _isLoading = false;

  Future<void> _createTeam() async {
    final nameCtrl = TextEditingController();
    final prefixCtrl = TextEditingController();
    String type = 'SALES';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setStateDialog) => AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text('Nova Equipe', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Nome da Equipe', labelStyle: TextStyle(color: Colors.white54)),
              ),
              TextField(
                controller: prefixCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Prefixo (Ex: EQV1)', labelStyle: TextStyle(color: Colors.white54)),
              ),
              const SizedBox(height: 12),
              DropdownButton<String>(
                value: type,
                dropdownColor: const Color(0xFF1A1A2E),
                style: const TextStyle(color: Colors.white),
                isExpanded: true,
                items: const [
                  DropdownMenuItem(value: 'SALES', child: Text('Equipe de Vendas')),
                  DropdownMenuItem(value: 'PHOTOGRAPHY', child: Text('Equipe de Fotografia')),
                ],
                onChanged: (v) => setStateDialog(() => type = v!),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: () async {
                if (nameCtrl.text.isEmpty || prefixCtrl.text.isEmpty) return;
                Navigator.pop(ctx);
                setState(() => _isLoading = true);
                try {
                  await _apiService.createTeam({
                    'name': nameCtrl.text,
                    'prefix': prefixCtrl.text,
                    'type': type,
                  });
                  widget.onSaved();
                  Navigator.pop(context); // Close the teams dialog to force refresh
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                  setState(() => _isLoading = false);
                }
              },
              child: const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteTeam(String id) async {
    setState(() => _isLoading = true);
    try {
      await _apiService.deleteTeam(id);
      widget.onSaved();
      Navigator.pop(context); // Close dialog
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao deletar: $e')));
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: 500,
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Gerenciar Equipes', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                IconButton(icon: const Icon(Icons.close, color: Colors.white54), onPressed: () => Navigator.pop(context)),
              ],
            ),
            const Divider(color: Colors.white24),
            const SizedBox(height: 12),
            if (_isLoading) const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8))),
            if (!_isLoading) ...[
              widget.teams.isEmpty
                  ? const Text('Nenhuma equipe cadastrada.', style: TextStyle(color: Colors.white54))
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: widget.teams.length,
                      itemBuilder: (ctx, i) {
                        final t = widget.teams[i];
                        return ListTile(
                          title: Text(t['name'], style: const TextStyle(color: Colors.white)),
                          subtitle: Text('Prefixo: ${t['prefix']} | Tipo: ${t['type'] == "SALES" ? "Vendas" : "Fotografia"}', style: const TextStyle(color: Colors.white54)),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete, color: Colors.redAccent),
                            onPressed: () => _deleteTeam(t['id']),
                          ),
                        );
                      },
                    ),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                onPressed: _createTeam,
                icon: const Icon(Icons.add, color: Colors.black),
                label: const Text('Nova Equipe', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              ),
            ]
          ],
        ),
      ),
    );
  }
}
