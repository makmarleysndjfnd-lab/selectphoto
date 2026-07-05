import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import '../servicos/ajudante_bd.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';

class CostEntryScreen extends StatefulWidget {
  const CostEntryScreen({super.key});

  @override
  State<CostEntryScreen> createState() => _CostEntryScreenState();
}

class _CostEntryScreenState extends State<CostEntryScreen> {
  final _amountController = TextEditingController();
  final _descController = TextEditingController();
  String _category = 'Produção';
  String? _carId;
  String _paymentMethod = 'Dinheiro';

  File? _receiptPhoto;
  final ImagePicker _picker = ImagePicker();

  final List<String> _categories = [
    'Produção',
    'Equipamentos',
    'Operacional',
    'Alimentação',
    'Combustível',
    'Hotel',
    'Conserto Carro',
    'Outros'
  ];

  final List<Map<String, String>> _mockCars = [
    {'id': 'car_1', 'plate': 'ABC-1234'},
    {'id': 'car_2', 'plate': 'XYZ-9876'},
  ];

  @override
  void initState() {
    super.initState();
  }

  Future<void> _takePhoto() async {
    final XFile? photo = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70);
    if (photo != null) {
      setState(() {
        _receiptPhoto = File(photo.path);
      });
    }
  }

  Future<void> _submitCost() async {
    if (_amountController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha o valor')));
      return;
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

    await DbHelper.instance.insertSyncTask(
      '/costs',
      'POST',
      {
        'userId': 'mock_user_123', 
        'teamId': 'mock_team_123', 
        'amount': amount,
        'category': _category,
        'description': _descController.text,
        'paymentMethod': _paymentMethod,
        'localFiles': _receiptPhoto != null ? [
          {'key': 'receipt', 'path': _receiptPhoto!.path},
        ] : []
      }
    );

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Despesa registrada com sucesso!'), backgroundColor: Colors.green),
    );
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
            ElevatedButton(
              onPressed: _submitCost,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Registrar Despesa', style: TextStyle(color: Colors.black, fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}
