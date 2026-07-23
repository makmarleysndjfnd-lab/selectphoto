import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import '../servicos/servico_api.dart';

class FleetAdminView extends StatefulWidget {
  const FleetAdminView({super.key});

  @override
  State<FleetAdminView> createState() => _FleetAdminViewState();
}

class _FleetAdminViewState extends State<FleetAdminView> {
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

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)));

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Gestão da Frota',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              ElevatedButton.icon(
                onPressed: () => _showCarFormDialog(),
                icon: const Icon(Icons.add, color: Colors.white),
                label: const Text('Novo Veículo', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF9C27B0),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: _cars.map((car) => _buildCarCard(car)).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildCarCard(dynamic car) {
    // Determine Status Colors
    final isMaintenancePending = car['pendingMaintenance'] != null && car['pendingMaintenance'].toString().isNotEmpty && car['pendingMaintenance'].toString() != 'null';
    final int nextOil = (car['nextOilChangeKm'] as num?)?.toInt() ?? 0;
    final int currentKm = (car['lastMileage'] as num?)?.toInt() ?? 0;
    
    // Logic for color statuses
    // GREEN: OK
    // YELLOW: Close to oil change (less than 1000km)
    // RED: Passed oil change OR has pending maintenance
    Color statusColor = Colors.green;
    String statusText = 'Manutenção em Dia';
    IconData statusIcon = Icons.check_circle_rounded;

    if (isMaintenancePending) {
      statusColor = Colors.red;
      statusText = 'Manutenção Pendente';
      statusIcon = Icons.build_circle_rounded;
    } else if (currentKm >= nextOil) {
      statusColor = Colors.red;
      statusText = 'Óleo Vencido!';
      statusIcon = Icons.warning_rounded;
    } else if ((nextOil - currentKm) <= 1000) {
      statusColor = Colors.amber;
      statusText = 'Próximo à Troca';
      statusIcon = Icons.info_rounded;
    }

    final inUse = car['status'] == 'IN_USE';
    final userName = car['currentUser']?['name'] ?? '';
    final teamPrefix = car['currentUser']?['team']?['prefix'] ?? '';

    return Container(
      width: 320,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: statusColor.withOpacity(0.5), width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                car['plate'],
                style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(statusIcon, color: statusColor, size: 14),
                        const SizedBox(width: 4),
                        Text(statusText, style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.edit, color: Colors.blueAccent, size: 20),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    onPressed: () => _showCarFormDialog(car),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.delete, color: Colors.redAccent, size: 20),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    onPressed: () {
                      showDialog(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          backgroundColor: const Color(0xFF1A1A2E),
                          title: const Text('Excluir Veículo', style: TextStyle(color: Colors.white)),
                          content: const Text('Tem certeza que deseja excluir este veículo?', style: TextStyle(color: Colors.white70)),
                          actions: [
                            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
                            TextButton(
                              onPressed: () {
                                Navigator.pop(ctx);
                                _deleteCar(car['id']);
                              },
                              child: const Text('Excluir', style: TextStyle(color: Colors.redAccent)),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            car['model'],
            style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 13),
          ),
          const SizedBox(height: 16),
          _infoRow(Icons.speed_rounded, 'KM Atual: $currentKm km'),
          const SizedBox(height: 4),
          _infoRow(Icons.oil_barrel_rounded, 'Troca Óleo: $nextOil km'),
          if (car['warrantyParts'] != null && car['warrantyParts'].toString().isNotEmpty && car['warrantyParts'].toString() != 'null') ...[
            const SizedBox(height: 4),
            _infoRow(Icons.verified_rounded, 'Garantia: ${car['warrantyParts']}', color: Colors.blueAccent),
          ],
          if (isMaintenancePending) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.red.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Text(
                'Atenção: ${car['pendingMaintenance']}',
                style: const TextStyle(color: Colors.redAccent, fontSize: 12),
              ),
            ),
          ],
          const SizedBox(height: 16),
          const Divider(color: Colors.white12),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(
                inUse ? Icons.person_rounded : Icons.local_parking_rounded,
                color: inUse ? const Color(0xFFCE93D8) : Colors.green,
                size: 18,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  inUse ? 'Com: $userName ($teamPrefix)' : 'Veículo Livre (Garagem)',
                  style: TextStyle(
                    color: inUse ? const Color(0xFFCE93D8) : Colors.green,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoRow(IconData icon, String text, {Color color = const Color(0xFF546E7A)}) {
    return Row(
      children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(width: 6),
        Text(text, style: TextStyle(color: color == const Color(0xFF546E7A) ? Colors.white70 : color, fontSize: 13)),
      ],
    );
  }
}

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
  File? _frontPhoto;
  File? _backPhoto;
  File? _leftPhoto;
  File? _rightPhoto;
  File? _dashboardPhoto;
  File? _enginePhoto;
  File? _trunkPhoto;

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

Future<void> _pickImage(String type) async {
    final pickedFile = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 50);
    if (pickedFile != null) {
      setState(() {
        if (type == 'photo') {
          _photo = File(pickedFile.path);
        } else if (type == 'frontPhoto') _frontPhoto = File(pickedFile.path);
        else if (type == 'backPhoto') _backPhoto = File(pickedFile.path);
        else if (type == 'leftPhoto') _leftPhoto = File(pickedFile.path);
        else if (type == 'rightPhoto') _rightPhoto = File(pickedFile.path);
        else if (type == 'dashboardPhoto') _dashboardPhoto = File(pickedFile.path);
        else if (type == 'enginePhoto') _enginePhoto = File(pickedFile.path);
        else if (type == 'trunkPhoto') _trunkPhoto = File(pickedFile.path);
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

      Future<void> addFile(String name, File? file) async {
        if (file != null) {
          formData.files.add(MapEntry(name, await MultipartFile.fromFile(file.path)));
        }
      }

      await addFile('photo', _photo);
      await addFile('frontPhoto', _frontPhoto);
      await addFile('backPhoto', _backPhoto);
      await addFile('leftPhoto', _leftPhoto);
      await addFile('rightPhoto', _rightPhoto);
      await addFile('dashboardPhoto', _dashboardPhoto);
      await addFile('enginePhoto', _enginePhoto);
      await addFile('trunkPhoto', _trunkPhoto);

      if (widget.car == null) {
        await _apiService.createCar(formData);
      } else {
        await _apiService.updateCar(widget.car!['id'], formData);
      }

      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Salvo com sucesso!'), backgroundColor: Colors.green));
      }
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
                  const SizedBox(height: 24),
                  const Text('Checklist de Fotos', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      _buildPhotoButton('Foto Principal', 'photo', _photo, widget.car?['photoUrl']),
                      _buildPhotoButton('Frente', 'frontPhoto', _frontPhoto, widget.car?['frontPhotoUrl']),
                      _buildPhotoButton('Traseira', 'backPhoto', _backPhoto, widget.car?['backPhotoUrl']),
                      _buildPhotoButton('Lateral Esquerda', 'leftPhoto', _leftPhoto, widget.car?['leftPhotoUrl']),
                      _buildPhotoButton('Lateral Direita', 'rightPhoto', _rightPhoto, widget.car?['rightPhotoUrl']),
                      _buildPhotoButton('Painel', 'dashboardPhoto', _dashboardPhoto, widget.car?['dashboardPhotoUrl']),
                      _buildPhotoButton('Motor', 'enginePhoto', _enginePhoto, widget.car?['enginePhotoUrl']),
                      _buildPhotoButton('Porta-malas', 'trunkPhoto', _trunkPhoto, widget.car?['trunkPhotoUrl']),
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

  Widget _buildPhotoButton(String label, String type, File? localFile, String? remoteUrl) {
    ImageProvider? image;
    if (localFile != null) {
      image = FileImage(localFile);
    } else if (remoteUrl != null && remoteUrl.isNotEmpty) {
      image = NetworkImage('http://192.168.1.6:3000$remoteUrl');
    }

    return GestureDetector(
      onTap: () => _pickImage(type),
      child: Column(
        children: [
          Container(
            width: 80, height: 80,
            decoration: BoxDecoration(
              color: Colors.white12,
              borderRadius: BorderRadius.circular(8),
              image: image != null ? DecorationImage(image: image, fit: BoxFit.cover) : null,
            ),
            child: image == null ? const Icon(Icons.camera_alt, color: Colors.white54, size: 30) : null,
          ),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 10)),
        ],
      ),
    );
  }
}
