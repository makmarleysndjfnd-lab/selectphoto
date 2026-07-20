import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class VisaoEstoqueAdmin extends StatefulWidget {
  const VisaoEstoqueAdmin({super.key});

  @override
  State<VisaoEstoqueAdmin> createState() => _VisaoEstoqueAdminState();
}

class _VisaoEstoqueAdminState extends State<VisaoEstoqueAdmin> {
  int _totalAdminCapas = 0;
  int _totalSellerCapas = 0;
  List<dynamic> _sellers = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadCapas();
  }

  Future<void> _loadCapas() async {
    try {
      final info = await ApiService().getCoverStockInfo();
      if (mounted) {
        setState(() {
          _totalAdminCapas = info['totalInAdmin'] ?? 0;
          _totalSellerCapas = info['totalWithSellers'] ?? 0;
          _sellers = info['sellers'] ?? [];
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar capas: $e')));
      }
    }
  }

  Future<void> _showTransferDialog(Map<String, dynamic>? seller) async {
    final TextEditingController quantityController = TextEditingController();
    bool isAdd = true; // true = Admin -> Vendedor, false = Vendedor -> Admin

    await showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: Text(
                seller != null ? 'Gerenciar Capas: ${seller['seller']['name']}' : 'Nova Transferência',
                style: const TextStyle(color: Colors.white),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (seller == null)
                    DropdownButtonFormField<String>(
                      dropdownColor: const Color(0xFF2A2A3C),
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Vendedor',
                        labelStyle: TextStyle(color: Colors.white54),
                        enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                        focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFFCE93D8))),
                      ),
                      items: _sellers.map((s) {
                        return DropdownMenuItem<String>(
                          value: s['seller']['id'],
                          child: Text(s['name']),
                        );
                      }).toList(),
                      onChanged: (val) {},
                    ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      ChoiceChip(
                        label: const Text('Enviar (Admin -> Vend)'),
                        selected: isAdd,
                        selectedColor: Colors.green.withOpacity(0.3),
                        labelStyle: TextStyle(color: isAdd ? Colors.greenAccent : Colors.white),
                        onSelected: (val) {
                          if (val) setDialogState(() => isAdd = true);
                        },
                      ),
                      ChoiceChip(
                        label: const Text('Retirar (Vend -> Admin)'),
                        selected: !isAdd,
                        selectedColor: Colors.orange.withOpacity(0.3),
                        labelStyle: TextStyle(color: !isAdd ? Colors.orangeAccent : Colors.white),
                        onSelected: (val) {
                          if (val) setDialogState(() => isAdd = false);
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: quantityController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Quantidade',
                      labelStyle: TextStyle(color: Colors.white54),
                      enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                      focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFFCE93D8))),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                ElevatedButton(
                  onPressed: () async {
                    final qty = int.tryParse(quantityController.text) ?? 0;
                    if (qty <= 0) return;
                    
                    try {
                      // Se for retirar, passa quantidade negativa
                      final finalQty = isAdd ? qty : -qty;
                      await ApiService().transferCovers(seller!['seller']['id'], finalQty);
                      if (mounted) {
                        Navigator.pop(context);
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sucesso!'), backgroundColor: Colors.green));
                        setState(() => _isLoading = true);
                        _loadCapas();
                      }
                    } catch (e) {
                      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
                    }
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Confirmar', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                ),
              ],
            );
          }
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('Estoque de Capas', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1A0030),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
        : SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                 Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Gestão de Capas', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                    IconButton(
                      icon: const Icon(Icons.refresh, color: Colors.white),
                      onPressed: () {
                        setState(() => _isLoading = true);
                        _loadCapas();
                      },
                    )
                  ]
                ),
                const SizedBox(height: 20),
                _buildResumoGeral(),
                const SizedBox(height: 20),
                _buildListaVendedores(),
                const SizedBox(height: 40),
              ],
            ),
          ),
    );
  }

  Widget _buildResumoGeral() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Resumo de Capas', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _infoBox('Capas no Admin', '$_totalAdminCapas', Colors.blueAccent),
              _infoBox('Com Vendedores', '$_totalSellerCapas', Colors.orangeAccent),
              _infoBox('Total Geral', '${_totalAdminCapas + _totalSellerCapas}', Colors.greenAccent),
            ],
          )
        ],
      )
    );
  }

  Widget _infoBox(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildListaVendedores() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Vendedores', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_sellers.isEmpty)
            const Text('Nenhum vendedor encontrado.', style: TextStyle(color: Colors.white54)),
          ..._sellers.map((s) {
            final name = (s['seller'] != null ? s['seller']['name'] : 'Sem Nome');
            final covers = s['balance'] ?? 0;

            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.person, color: Colors.white),
                ),
                title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Possui $covers capas', style: const TextStyle(color: Colors.white70)),
                trailing: ElevatedButton(
                  onPressed: () => _showTransferDialog(s),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white12,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('Editar / Transferir'),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
