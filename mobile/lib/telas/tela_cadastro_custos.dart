import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import '../servicos/servico_midia.dart';
import '../servicos/ajudante_bd.dart';
import 'tela_sincronizacao.dart' as tela_sincronizacao;
import '../widgets/led_button.dart';


class CostEntryScreen extends StatefulWidget {
  const CostEntryScreen({super.key});

  @override
  State<CostEntryScreen> createState() => _CostEntryScreenState();
}

class _CostEntryScreenState extends State<CostEntryScreen> {
  final _amountController = TextEditingController();
  final _descController = TextEditingController();
  final _nextOilChangeKmController = TextEditingController();
  String _category = 'Produção';
  String? _carId;
  String _paymentMethod = 'Dinheiro';

  File? _receiptPhoto;

  final List<String> _categories = [
    'Produção',
    'Equipamentos',
    'Operacional',
    'Alimentação',
    'Combustível',
    'Manutenção/Óleo',
    'Hotel',
    'Conserto Carro',
    'Outros'
  ];

  List<dynamic> _realCars = [];
  bool _isLoadingCars = true;

  @override
  void initState() {
    super.initState();
    _fetchCars();
  }

  Future<void> _fetchCars() async {
    try {
      final apiService = Provider.of<ApiService>(context, listen: false);
      final cars = await apiService.getCars();
      if (mounted) {
        setState(() {
          _realCars = cars;
          _isLoadingCars = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoadingCars = false;
        });
      }
    }
  }

  Future<void> _takePhoto() async {
    final result = await MediaPickerService().pickDocumentOrImage(context, title: 'Comprovante de Despesa');
    if (result != null) {
      setState(() {
        _receiptPhoto = result.file;
      });
    }
  }

  Future<void> _submitCost() async {
    if (_amountController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha o valor')));
      return;
    }

    if (_category == 'Manutenção/Óleo') {
      if (_carId == null) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Selecione um carro para a manutenção.')));
        return;
      }
      if (_nextOilChangeKmController.text.isNotEmpty) {
        final nextKm = int.tryParse(_nextOilChangeKmController.text);
        if (nextKm == null) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('KM inválido')));
          return;
        }

        final selectedCar = _realCars.firstWhere((c) => c['id'] == _carId, orElse: () => null);
        if (selectedCar != null) {
          final currentKm = (selectedCar['currentKm'] as num?)?.toInt() ?? 0;
          if (nextKm < currentKm + 9000 || nextKm > currentKm + 14000) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('O KM da próxima troca deve ser entre ${currentKm + 9000} e ${currentKm + 14000} (9k a 14k a mais que o atual). Caso haja erro no KM atual, contate o Admin.'),
                backgroundColor: Colors.red,
                duration: const Duration(seconds: 5),
              )
            );
            return;
          }
        }
      }
    }
    final cleanAmount = _amountController.text.replaceAll(RegExp(r'[^0-9,]'), '').replaceAll(',', '.');
    final amount = double.tryParse(cleanAmount) ?? 0.0;

    final db = await DbHelper.instance.database;
    await db.insert('local_costs', {
      'amount': amount,
      'category': _category,
      'description': _descController.text,
      'paymentMethod': _paymentMethod,
      'receiptPhotoPath': _receiptPhoto?.path ?? '',
      'date': DateTime.now().toIso8601String(),
    });

    try {
      final apiService = Provider.of<ApiService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);
      
      String receiptUrl = '';
      // Se a foto falhar no envio, não salvamos o arquivo local no payload de backup para evitar payload gigante,
      // ou então teríamos que converter a foto em base64. O ideal seria base64, mas por simplicidade salvaremos sem o path.
      if (_receiptPhoto != null) {
        try {
          receiptUrl = await apiService.uploadFile(_receiptPhoto!.path);
        } catch (e) {
          print('Erro no upload da foto: $e');
        }
      }
      
      final payload = {
        'amount': amount,
        'category': _category,
        'description': _descController.text,
        'paymentMethod': _paymentMethod,
        'carId': _carId,
        'receiptUrl': receiptUrl,
        if (_category == 'Manutenção/Óleo' && _nextOilChangeKmController.text.isNotEmpty)
          'nextOilChangeKm': _nextOilChangeKmController.text,
      };

      try {
        await apiService.submitCost(payload);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Despesa registrada com sucesso!'), backgroundColor: Colors.green));
      } catch (e) {
        await syncService.addPendingRequest('SUBMIT_COST', payload);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Salvo no Backup Offline!'), backgroundColor: Colors.orange));
      }

    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro interno: $e'), backgroundColor: Colors.red));
      return;
    }

    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0030),
        title: const Text('Lançar Despesa', style: TextStyle(color: Colors.white, fontSize: 16)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
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
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Comprovante Fiscal', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: _takePhoto,
              child: Container(
                height: 150,
                decoration: BoxDecoration(
                  color: const Color(0xFF1A1A2E),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _receiptPhoto != null ? Colors.green : Colors.white24, width: 2),
                  image: _receiptPhoto != null ? DecorationImage(image: FileImage(_receiptPhoto!), fit: BoxFit.cover) : null,
                ),
                child: _receiptPhoto == null
                    ? const Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.camera_alt, color: Colors.white54, size: 40),
                          SizedBox(height: 8),
                          Text('Tirar book do Recibo (Opcional)', style: TextStyle(color: Colors.white54)),
                        ],
                      )
                    : null,
              ),
            ),
            const SizedBox(height: 24),
            
            const Text('Detalhes do Gasto', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            
            TextField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [CurrencyTextInputFormatter.currency(locale: 'pt_BR', symbol: 'R\$')],
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Valor (R\$)',
                labelStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                prefixIcon: const Icon(Icons.attach_money, color: Colors.white54),
              ),
            ),
            const SizedBox(height: 16),
            
            DropdownButtonFormField<String>(
              value: _category,
              dropdownColor: const Color(0xFF1A1A2E),
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Categoria',
                labelStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
              items: _categories.map((cat) {
                return DropdownMenuItem(value: cat, child: Text(cat));
              }).toList(),
              onChanged: (v) {
                setState(() {
                  _category = v!;
                });
              },
            ),
            
            if (_category == 'Manutenção/Óleo') ...[
              const SizedBox(height: 16),
              if (_isLoadingCars)
                const CircularProgressIndicator()
              else
                DropdownButtonFormField<String>(
                  value: _carId,
                  dropdownColor: const Color(0xFF1A1A2E),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Veículo',
                    labelStyle: const TextStyle(color: Colors.white54),
                    filled: true,
                    fillColor: const Color(0xFF1A1A2E),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    prefixIcon: const Icon(Icons.directions_car, color: Colors.white54),
                  ),
                  items: _realCars.map((c) {
                    return DropdownMenuItem<String>(
                      value: c['id'],
                      child: Text('${c['plate']} - ${c['model'] ?? ''} (KM: ${c['currentKm'] ?? 0})'),
                    );
                  }).toList(),
                  onChanged: (v) {
                    setState(() {
                      _carId = v;
                    });
                  },
                ),
            ],
            
            if (_category == 'Manutenção/Óleo') ...[
              const SizedBox(height: 16),
              TextField(
                controller: _nextOilChangeKmController,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'KM da Próxima Troca de Óleo',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: const Color(0xFF1A1A2E),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  prefixIcon: const Icon(Icons.speed, color: Colors.white54),
                ),
              ),
            ],
            const SizedBox(height: 16),


            const SizedBox(height: 16),

            DropdownButtonFormField<String>(
              value: _paymentMethod,
              dropdownColor: const Color(0xFF1A1A2E),
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Forma de Pagamento Utilizada',
                labelStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
              items: const [
                DropdownMenuItem(value: 'Dinheiro', child: Text('Dinheiro Físico')),
                DropdownMenuItem(value: 'PIX', child: Text('PIX da Empresa')),
                DropdownMenuItem(value: 'Cartão de Crédito', child: Text('Cartão de Crédito Corporativo')),
              ],
              onChanged: (v) => setState(() => _paymentMethod = v!),
            ),
            const SizedBox(height: 16),

            TextField(
              controller: _descController,
              maxLines: 2,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Descrição breve (Opcional)',
                hintStyle: const TextStyle(color: Colors.white54),
                filled: true,
                fillColor: const Color(0xFF1A1A2E),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            
            const SizedBox(height: 32),
            LedButton(
              onPressed: _submitCost,
              style: LedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Registrar Despesa', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}
