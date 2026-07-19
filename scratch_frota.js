const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'mobile', 'lib', 'telas', 'visao_frota_admin.dart');
let content = fs.readFileSync(file, 'utf8');

// The new imports
const newImports = `import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import '../servicos/servico_api.dart';`;

content = content.replace("import 'package:flutter/material.dart';", newImports);

// The state
const newState = `class _FleetAdminViewState extends State<FleetAdminView> {
  final ApiService _apiService = ApiService();
  bool _isLoading = true;
  List<dynamic> _cars = [];

  @override
  void initState() {
    super.initState();
    _fetchCars();
  }

  Future<void> _fetchCars() async {
    setState(() => _isLoading = true);
    try {
      final cars = await _apiService.getCars();
      setState(() {
        _cars = cars;
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar frota: $e'), backgroundColor: Colors.red));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _deleteCar(String id) async {
    setState(() => _isLoading = true);
    try {
      await _apiService.deleteCar(id);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Veículo excluído com sucesso!'), backgroundColor: Colors.green));
      _fetchCars();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao excluir: $e'), backgroundColor: Colors.red));
      setState(() => _isLoading = false);
    }
  }

  void _showCarFormDialog([Map<String, dynamic>? car]) {
    showDialog(
      context: context,
      builder: (context) => _CarFormDialog(
        car: car,
        onSaved: _fetchCars,
      ),
    );
  }
`;

content = content.replace(/class _FleetAdminViewState extends State<FleetAdminView> \{[\s\S]*?Widget build\(BuildContext context\) \{/, newState + '\n  @override\n  Widget build(BuildContext context) {\n    if (_isLoading) return const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)));\n');

// Replace the Add button onPressed
content = content.replace(/onPressed: \(\) \{\},[\s\S]*?icon: const Icon\(Icons\.add, color: Colors\.white\),/g, `onPressed: () => _showCarFormDialog(),\n                icon: const Icon(Icons.add, color: Colors.white),`);

// Fix _buildCarCard signature
content = content.replace(/Widget _buildCarCard\(Map<String, dynamic> car\) \{/g, `Widget _buildCarCard(dynamic car) {`);

// Add Edit and Delete buttons to car card
const actionsRow = `Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(icon: const Icon(Icons.edit, color: Colors.blueAccent, size: 20), onPressed: () => _showCarFormDialog(car)),
                IconButton(icon: const Icon(Icons.delete, color: Colors.redAccent, size: 20), onPressed: () => _deleteCar(car['id'])),
              ],
            ),`;

// I'll append the form dialog at the end of the file
const formDialog = `
class _CarFormDialog extends StatefulWidget {
  final Map<String, dynamic>? car;
  final VoidCallback onSaved;

  const _CarFormDialog({this.car, required this.onSaved});

  @override
  State<_CarFormDialog> createState() => _CarFormDialogState();
}

class _CarFormDialogState extends State<_CarFormDialog> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _plateCtrl;
  late TextEditingController _modelCtrl;
  late TextEditingController _trackerLinkCtrl;
  late TextEditingController _warrantyCtrl;
  late TextEditingController _nextOilCtrl;
  late TextEditingController _checklistCtrl;

  File? _photo;
  final ImagePicker _picker = ImagePicker();
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    final c = widget.car;
    _plateCtrl = TextEditingController(text: c?['plate'] ?? '');
    _modelCtrl = TextEditingController(text: c?['model'] ?? '');
    _trackerLinkCtrl = TextEditingController(text: c?['trackerLink'] ?? '');
    _warrantyCtrl = TextEditingController(text: c?['warrantyParts'] ?? '');
    _nextOilCtrl = TextEditingController(text: (c?['nextOilChangeKm'] ?? 0).toString());
    _checklistCtrl = TextEditingController(text: c?['initialChecklist'] ?? '');
  }

  Future<void> _pickImage() async {
    final pickedFile = await _picker.pickImage(source: ImageSource.gallery);
    if (pickedFile != null) {
      setState(() {
        _photo = File(pickedFile.path);
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);

    try {
      final formData = FormData.fromMap({
        'plate': _plateCtrl.text,
        'model': _modelCtrl.text,
        'trackerLink': _trackerLinkCtrl.text,
        'warrantyParts': _warrantyCtrl.text,
        'nextOilChangeKm': _nextOilCtrl.text,
        'initialChecklist': _checklistCtrl.text,
      });

      if (_photo != null) {
        formData.files.add(MapEntry('photo', await MultipartFile.fromFile(_photo!.path)));
      }

      if (widget.car == null) {
        await _apiService.createCar(formData);
      } else {
        await _apiService.updateCar(widget.car!['id'], {
            'plate': _plateCtrl.text,
            'model': _modelCtrl.text,
            'trackerLink': _trackerLinkCtrl.text,
            'warrantyParts': _warrantyCtrl.text,
            'nextOilChangeKm': int.tryParse(_nextOilCtrl.text) ?? 0,
            'initialChecklist': _checklistCtrl.text,
        }); // updateCar uses Map currently or we can adapt to FormData. Let's just use JSON since edit photo isn't requested explicitly yet.
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
        width: 500,
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.car == null ? 'Novo Veículo' : 'Editar Veículo', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 20),
                
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (widget.car == null)
                    Column(
                      children: [
                        GestureDetector(
                          onTap: _pickImage,
                          child: Container(
                            width: 100, height: 100,
                            decoration: BoxDecoration(
                              color: Colors.white12,
                              borderRadius: BorderRadius.circular(8),
                              image: _photo != null ? DecorationImage(image: FileImage(_photo!), fit: BoxFit.cover) : null,
                            ),
                            child: _photo == null ? const Icon(Icons.directions_car, color: Colors.white54, size: 40) : null,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text('Foto do Veículo', style: TextStyle(color: Colors.white70, fontSize: 12)),
                      ],
                    ),
                    if (widget.car == null) const SizedBox(width: 24),
                    
                    Expanded(
                      child: Column(
                        children: [
                          TextFormField(
                            controller: _plateCtrl,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Placa', labelStyle: TextStyle(color: Colors.white54)),
                            validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                          ),
                          TextFormField(
                            controller: _modelCtrl,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Modelo', labelStyle: TextStyle(color: Colors.white54)),
                            validator: (v) => v!.isEmpty ? 'Obrigatório' : null,
                          ),
                          TextFormField(
                            controller: _nextOilCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Próxima Troca de Óleo (km)', labelStyle: TextStyle(color: Colors.white54)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                
                TextFormField(
                  controller: _trackerLinkCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Link do Rastreador', labelStyle: TextStyle(color: Colors.white54)),
                ),
                TextFormField(
                  controller: _warrantyCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Peças na Garantia', labelStyle: TextStyle(color: Colors.white54)),
                ),
                TextFormField(
                  controller: _checklistCtrl,
                  maxLines: 2,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Checklist / Observações Iniciais', labelStyle: TextStyle(color: Colors.white54)),
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
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF9C27B0)),
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
`;

content += formDialog;

fs.writeFileSync(file, content);
