import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import '../widgets/led_button.dart';
import '../widgets/led_choice_chip.dart';
import 'package:fl_chart/fl_chart.dart';
import '../widgets/led_card.dart';

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

  Future<String> _resolveMovementId({
    required String sellerId,
    required int quantity,
    required String operation,
    required String origin,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('pending_cover_movement');
    if (raw != null && raw.isNotEmpty) {
      try {
        final decoded = json.decode(raw);
        if (decoded is Map &&
            decoded['sellerId'] == sellerId &&
            decoded['quantity'] == quantity &&
            decoded['operation'] == operation &&
            decoded['origin'] == origin &&
            decoded['id'] is String &&
            (decoded['id'] as String).isNotEmpty) {
          return decoded['id'] as String;
        }
      } catch (_) {}
    }

    final newId = 'cov_${DateTime.now().millisecondsSinceEpoch}_${SyncService.generateUuid().substring(0, 8)}';
    final payload = {
      'id': newId,
      'sellerId': sellerId,
      'quantity': quantity,
      'operation': operation,
      'origin': origin,
    };
    await prefs.setString('pending_cover_movement', json.encode(payload));
    return newId;
  }

  Future<void> _clearPendingMovement() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('pending_cover_movement');
  }

  Future<void> _showTransferDialog(Map<String, dynamic>? seller) async {
    final TextEditingController quantityController = TextEditingController();
    int transferType = 0; // 0 = Admin -> Vend, 1 = Vend -> Admin, 2 = Defeituosa
    final sellerInfo = seller != null && seller['seller'] is Map ? seller['seller'] as Map : null;
    String? dialogSellerId = sellerInfo != null ? sellerInfo['id']?.toString() : null;
    bool isSubmitting = false;

    await showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final sellerName = sellerInfo != null ? (sellerInfo['name'] ?? 'Vendedor') : 'Vendedor';
            return AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: Text(
                seller != null ? 'Gerenciar Capas: $sellerName' : 'Nova Transferência',
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
                          value: s['seller']?['id']?.toString(),
                          child: Text(s['seller']?['name'] ?? 'Sem Nome'),
                        );
                      }).toList(),
                      onChanged: (val) {
                        setDialogState(() => dialogSellerId = val);
                      },
                    ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.center,
                    children: [
                      LedChoiceChip(
                        label: 'Enviar (Admin -> Vend)',
                        selected: transferType == 0,
                        color: Colors.greenAccent,
                        onSelected: (val) {
                          if (val) setDialogState(() => transferType = 0);
                        },
                      ),
                      LedChoiceChip(
                        label: 'Devolver (Vend -> Admin)',
                        selected: transferType == 1,
                        color: Colors.orangeAccent,
                        onSelected: (val) {
                          if (val) setDialogState(() => transferType = 1);
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  LedChoiceChip(
                    label: 'Descartar Defeituosas',
                    selected: transferType == 2,
                    color: Colors.redAccent,
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
                  onPressed: isSubmitting ? null : () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                isSubmitting
                    ? const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16.0),
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFCE93D8)),
                        ),
                      )
                    : LedButton(
                        text: 'Confirmar',
                        isSuccess: true,
                        onPressed: () async {
                          final targetId = sellerInfo != null ? sellerInfo['id']?.toString() : dialogSellerId;
                          if (targetId == null) {
                            ScaffoldMessenger.of(context).clearSnackBars();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Selecione um vendedor'), backgroundColor: Colors.orange),
                            );
                            return;
                          }

                          final qty = int.tryParse(quantityController.text) ?? 0;
                          if (qty <= 0) {
                            ScaffoldMessenger.of(context).clearSnackBars();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Informe uma quantidade válida maior que zero'), backgroundColor: Colors.orange),
                            );
                            return;
                          }

                          final opString = transferType == 2 ? 'DEFECTIVE' : (transferType == 1 ? 'RETURN' : 'SEND');
                          final originString = transferType == 2 ? 'SELLER' : 'ADMIN';

                          setDialogState(() => isSubmitting = true);
                          final messenger = ScaffoldMessenger.of(context);

                          try {
                            final movementKey = await _resolveMovementId(
                              sellerId: targetId,
                              quantity: qty,
                              operation: opString,
                              origin: originString,
                            );

                            if (transferType == 2) {
                              await ApiService().returnDefectiveCovers(
                                targetId,
                                qty,
                                origin: 'SELLER',
                                idempotencyKey: movementKey,
                              );
                            } else if (transferType == 1) {
                              await ApiService().transferCovers(
                                targetId,
                                qty,
                                operation: 'RETURN',
                                idempotencyKey: movementKey,
                              );
                            } else {
                              await ApiService().transferCovers(
                                targetId,
                                qty,
                                operation: 'SEND',
                                idempotencyKey: movementKey,
                              );
                            }

                            await _clearPendingMovement();

                            if (mounted) {
                              Navigator.pop(context);
                              messenger.clearSnackBars();
                              messenger.showSnackBar(
                                const SnackBar(content: Text('Movimentação realizada com sucesso!'), backgroundColor: Colors.green),
                              );
                              setState(() => _isLoading = true);
                              _loadCapas();
                            }
                          } catch (e) {
                            if (mounted) {
                              setDialogState(() => isSubmitting = false);
                              messenger.clearSnackBars();
                              messenger.showSnackBar(
                                SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
                              );
                            }
                          }
                        },
                      ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _showAdminStockDialog(bool isAdding) async {
    final TextEditingController quantityController = TextEditingController();
    bool isSubmitting = false;

    await showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
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
                  onPressed: isSubmitting ? null : () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                isSubmitting
                    ? const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16.0),
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFCE93D8)),
                        ),
                      )
                    : LedButton(
                        text: 'Confirmar',
                        isSuccess: true,
                        onPressed: () async {
                          final qty = int.tryParse(quantityController.text) ?? 0;
                          if (qty <= 0) {
                            ScaffoldMessenger.of(context).clearSnackBars();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Informe uma quantidade válida maior que zero'), backgroundColor: Colors.orange),
                            );
                            return;
                          }

                          setDialogState(() => isSubmitting = true);
                          final messenger = ScaffoldMessenger.of(context);

                          try {
                            final finalQty = isAdding ? qty : -qty;
                            await ApiService().addAdminCoverStock(finalQty);
                            if (mounted) {
                              Navigator.pop(context);
                              messenger.clearSnackBars();
                              messenger.showSnackBar(
                                const SnackBar(content: Text('Estoque central atualizado!'), backgroundColor: Colors.green),
                              );
                              setState(() => _isLoading = true);
                              _loadCapas();
                            }
                          } catch (e) {
                            if (mounted) {
                              setDialogState(() => isSubmitting = false);
                              messenger.clearSnackBars();
                              messenger.showSnackBar(
                                SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
                              );
                            }
                          }
                        },
                      ),
              ],
            );
          },
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
          ),
        ],
      ),
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

    final chartWidth = (_sellers.length * 64.0).clamp(MediaQuery.of(context).size.width - 72, double.infinity);

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
          const Text('Capas por Vendedor', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          SizedBox(
            height: 220,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SizedBox(
                width: chartWidth,
                child: BarChart(
                  BarChartData(
                    alignment: BarChartAlignment.spaceAround,
                    maxY: maxY,
                    barTouchData: BarTouchData(
                      touchTooltipData: BarTouchTooltipData(
                        getTooltipItem: (group, groupIndex, rod, rodIndex) {
                          String name = _sellers[groupIndex]['seller']?['name'] ?? 'Sem Nome';
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
                            String name = _sellers[index]['seller']?['name'] ?? 'Vendedor';
                            if (name.contains(' ')) {
                              name = name.split(' ')[0];
                            }
                            if (name.length > 9) name = name.substring(0, 9);
                            return Padding(
                              padding: const EdgeInsets.only(top: 8.0),
                              child: Text(name, style: const TextStyle(color: Colors.white70, fontSize: 11)),
                            );
                          },
                          reservedSize: 28,
                        ),
                      ),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 36,
                          getTitlesWidget: (value, meta) {
                            if (value == maxY) return const SizedBox.shrink();
                            return Text(value.toInt().toString(), style: const TextStyle(color: Colors.white54, fontSize: 11));
                          },
                        ),
                      ),
                      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    ),
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      getDrawingHorizontalLine: (value) => const FlLine(color: Colors.white12, strokeWidth: 1),
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
                            width: 18,
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                          )
                        ],
                      );
                    }),
                  ),
                ),
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
          const Text('Vendedores e Saldo em Posse', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_sellers.isEmpty)
            const Text('Nenhum vendedor encontrado.', style: TextStyle(color: Colors.white54)),
          ..._sellers.map((s) {
            final sellerData = s['seller'] ?? {};
            final name = sellerData['name'] ?? 'Sem Nome';
            final email = sellerData['email'] ?? '';
            final covers = s['balance'] ?? 0;
            final initial = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : 'V';

            return LedCard(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: const Color(0xFFCE93D8).withOpacity(0.2),
                      child: Text(initial, style: const TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                          ),
                          if (email.isNotEmpty)
                            Text(
                              email,
                              style: const TextStyle(color: Colors.white54, fontSize: 11),
                              overflow: TextOverflow.ellipsis,
                              maxLines: 1,
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF00E676).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFF00E676).withOpacity(0.4)),
                      ),
                      child: Text(
                        '$covers capas',
                        style: const TextStyle(color: Color(0xFF00E676), fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      icon: const Icon(Icons.swap_horiz_rounded, color: Color(0xFF4FC3F7)),
                      tooltip: 'Gerenciar / Transferir',
                      onPressed: () => _showTransferDialog(s),
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
