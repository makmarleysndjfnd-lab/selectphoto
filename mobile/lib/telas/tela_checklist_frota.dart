import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import '../servicos/ajudante_bd.dart';

class FleetChecklistScreen extends StatefulWidget {
  final String carId;
  final String plate;

  const FleetChecklistScreen({super.key, required this.carId, required this.plate});

  @override
  State<FleetChecklistScreen> createState() => _FleetChecklistScreenState();
}

class _FleetChecklistScreenState extends State<FleetChecklistScreen> {
  final _kmController = TextEditingController();
  final _damageController = TextEditingController();
  String _fuelLevel = 'HALF';

  File? _frontPhoto;
  File? _backPhoto;
  File? _leftPhoto;
  File? _rightPhoto;
  File? _dashboardPhoto;

  final ImagePicker _picker = ImagePicker();

  Future<void> _takePhoto(String type) async {
    final XFile? photo = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70);
    if (photo != null) {
      setState(() {
        if (type == 'front') _frontPhoto = File(photo.path);
        if (type == 'back') _backPhoto = File(photo.path);
        if (type == 'left') _leftPhoto = File(photo.path);
        if (type == 'right') _rightPhoto = File(photo.path);
        if (type == 'dash') _dashboardPhoto = File(photo.path);
      });
    }
  }

  Future<void> _submitChecklist() async {
    if (_kmController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha a Quilometragem')));
      return;
    }
    if (_frontPhoto == null || _backPhoto == null || _leftPhoto == null || _rightPhoto == null || _dashboardPhoto == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tire todas as 5 books obrigatórias')));
      return;
    }

    final db = await DbHelper.instance.database;
    await db.insert('local_checklists', {
      'carId': widget.carId,
      'mileage': int.tryParse(_kmController.text) ?? 0,
      'fuelLevel': _fuelLevel,
      'damageReport': _damageController.text,
      'frontPhotoPath': _frontPhoto!.path,
      'backPhotoPath': _backPhoto!.path,
      'leftPhotoPath': _leftPhoto!.path,
      'rightPhotoPath': _rightPhoto!.path,
      'dashboardPhotoPath': _dashboardPhoto!.path,
      'date': DateTime.now().toIso8601String(),
    });

    await DbHelper.instance.insertSyncTask(
      '/fleet/checklist',
      'POST',
      {
        'carId': widget.carId,
        'driverId': 'mock_driver_123', // In a real app, from AuthProvider
        'mileage': int.tryParse(_kmController.text) ?? 0,
        'fuelLevel': _fuelLevel,
        'damageReport': _damageController.text,
        'localFiles': [
          {'key': 'frontPhoto', 'path': _frontPhoto!.path},
          {'key': 'backPhoto', 'path': _backPhoto!.path},
          {'key': 'leftPhoto', 'path': _leftPhoto!.path},
          {'key': 'rightPhoto', 'path': _rightPhoto!.path},
          {'key': 'dashboardPhoto', 'path': _dashboardPhoto!.path},
        ]
      }
    );

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Checklist salvo! Sincronizando em background...'), backgroundColor: Colors.green),
    );
    Navigator.of(context).pop();
  }

  Widget _buildPhotoTile(String label, String type, File? file) {
    return GestureDetector(
      onTap: () => _takePhoto(type),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        height: 80,
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: file != null ? Colors.green : Colors.white24),
        ),
        child: Row(
          children: [
            Container(
              width: 80,
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: const BorderRadius.horizontal(left: Radius.circular(12)),
                image: file != null ? DecorationImage(image: FileImage(file), fit: BoxFit.cover) : null,
              ),
              child: file == null ? const Icon(Icons.camera_alt, color: Colors.white54) : null,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: file != null ? Colors.green : Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            if (file != null) const Padding(padding: EdgeInsets.only(right: 16), child: Icon(Icons.check_circle, color: Colors.green)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0030),
        title: Text('Checklist: ${widget.plate}', style: const TextStyle(color: Colors.white, fontSize: 16)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Informações Atuais', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(
              controller: _kmController,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Quilometragem (KM)',
                labelStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                prefixIcon: const Icon(Icons.speed, color: Colors.white54),
              ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _fuelLevel,
              dropdownColor: const Color(0xFF1A1A2E),
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Nível de Combustível',
                labelStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                prefixIcon: const Icon(Icons.local_gas_station, color: Colors.white54),
              ),
              items: const [
                DropdownMenuItem(value: 'EMPTY', child: Text('Reserva / Vazio')),
                DropdownMenuItem(value: 'QUARTER', child: Text('1/4')),
                DropdownMenuItem(value: 'HALF', child: Text('Meio Tanque')),
                DropdownMenuItem(value: 'THREE_QUARTERS', child: Text('3/4')),
                DropdownMenuItem(value: 'FULL', child: Text('Cheio')),
              ],
              onChanged: (v) => setState(() => _fuelLevel = v!),
            ),
            const SizedBox(height: 24),
            const Text('books Obrigatórias', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _buildPhotoTile('Frente', 'front', _frontPhoto),
            _buildPhotoTile('Traseira', 'back', _backPhoto),
            _buildPhotoTile('Lateral Esquerda', 'left', _leftPhoto),
            _buildPhotoTile('Lateral Direita', 'right', _rightPhoto),
            _buildPhotoTile('Painel (KM e Combustível)', 'dash', _dashboardPhoto),
            const SizedBox(height: 24),
            const Text('Avarias / Observações', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(
              controller: _damageController,
              maxLines: 3,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Relate arranhões, barulhos, peças com defeito...',
                hintStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _submitChecklist,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Confirmar Retirada do Veículo', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
