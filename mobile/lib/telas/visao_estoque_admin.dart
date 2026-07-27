import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import 'package:fl_chart/fl_chart.dart';

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
    int transferType = 0; // 0 = Admin -> Vend, 1 = Vend -> Admin, 2 = Defeituosa

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
                        selected: transferType == 0,
                        selectedColor: Colors.green.withOpacity(0.3),
                        labelStyle: TextStyle(color: transferType == 0 ? Colors.greenAccent : Colors.white),
                        onSelected: (val) {
                          if (val) setDialogState(() => transferType = 0);
                        },
                      ),
                      ChoiceChip(
                        label: const Text('Devolver (Vend -> Admin)'),
                        selected: transferType == 1,
                        selectedColor: Colors.orange.withOpacity(0.3),
                        labelStyle: TextStyle(color: transferType == 1 ? Colors.orangeAccent : Colors.white),
                        onSelected: (val) {
                          if (val) setDialogState(() => transferType = 1);
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ChoiceChip(
                    label: const Text('Descartar Defeituosas'),
                    selected: transferType == 2,
                    selectedColor: Colors.red.withOpacity(0.3),
                    labelStyle: TextStyle(color: transferType == 2 ? Colors.redAccent : Colors.white),
                    onSelected: (val) {
                      if (val) setDialogState(() => transferType = 2);
                    },
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
                      if (transferType == 2) {
                        await ApiService().returnDefectiveCovers(seller!['seller']['id'], qty);
                      } else {
                        final finalQty = transferType == 0 ? qty : -qty;
                        await ApiService().transferCovers(seller!['seller']['id'], finalQty);
                      }
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

  Future<void> _showAdminStockDialog(bool isAdding) async {
    final TextEditingController quantityController = TextEditingController();

    await showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: Text(
            isAdding ? 'Inserir Capas no Admin' : 'Remover Capas do Admin',
            style: const TextStyle(color: Colors.white),
          ),
          content: TextField(
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
                  final finalQty = isAdding ? qty : -qty;
                  await ApiService().addAdminCoverStock(finalQty);
                  if (mounted) {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Estoque atualizado!'), backgroundColor: Colors.green));
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
                _buildGraficoTorres(),
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
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              OutlinedButton.icon(
                onPressed: () => _showAdminStockDialog(true),
                icon: const Icon(Icons.add, color: Colors.greenAccent),
                label: const Text('Inserir Capas', style: TextStyle(color: Colors.white)),
                style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.greenAccent)),
              ),
              OutlinedButton.icon(
                onPressed: () => _showAdminStockDialog(false),
                icon: const Icon(Icons.remove, color: Colors.redAccent),
                label: const Text('Remover Capas', style: TextStyle(color: Colors.white)),
                style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.redAccent)),
              ),
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

  Widget _buildGraficoTorres() {
    if (_sellers.isEmpty) return const SizedBox.shrink();

    double maxY = 10;
    for (var s in _sellers) {
      final covers = s['balance'] ?? 0;
      if (covers > maxY) maxY = covers.toDouble();
    }
    maxY += (maxY * 0.2); // 20% margin top

    return Container(
      height: 300,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Capas por Vendedor', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          Expanded(
            child: BarChart(
              BarChartData(
                alignment: BarChartAlignment.spaceAround,
                maxY: maxY,
                barTouchData: BarTouchData(
                  touchTooltipData: BarTouchTooltipData(
                    getTooltipItem: (group, groupIndex, rod, rodIndex) {
                      String name = _sellers[groupIndex]['seller']['name'] ?? 'Sem Nome';
                      return BarTooltipItem(
                        '$name\n${rod.toY.round()} capas',
                        const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      );
                    },
                  ),
                ),
                titlesData: FlTitlesData(
                  show: true,
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (double value, TitleMeta meta) {
                        final index = value.toInt();
                        if (index < 0 || index >= _sellers.length) return const SizedBox.shrink();
                        String name = _sellers[index]['seller']['name'] ?? 'Vendedor';
                        if (name.contains(' ')) {
                          name = name.split(' ')[0];
                        }
                        if (name.length > 8) name = name.substring(0, 8);
                        return Padding(
                          padding: const EdgeInsets.only(top: 8.0),
                          child: Text(name, style: const TextStyle(color: Colors.white70, fontSize: 10)),
                        );
                      },
                      reservedSize: 28,
                    ),
                  ),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 40,
                      getTitlesWidget: (value, meta) {
                        if (value == maxY) return const SizedBox.shrink();
                        return Text(value.toInt().toString(), style: const TextStyle(color: Colors.white54, fontSize: 12));
                      },
                    ),
                  ),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  getDrawingHorizontalLine: (value) => FlLine(color: Colors.white12, strokeWidth: 1),
                ),
                borderData: FlBorderData(show: false),
                barGroups: List.generate(_sellers.length, (i) {
                  final s = _sellers[i];
                  final covers = (s['balance'] ?? 0).toDouble();
                  return BarChartGroupData(
                    x: i,
                    barRods: [
                      BarChartRodData(
                        toY: covers,
                        color: const Color(0xFFCE93D8),
                        width: 16,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                      )
                    ],
                  );
                }),
              ),
            ),
          ),
        ],
      ),
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
