import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../servicos/servico_api.dart';

class CashFlowAdminView extends StatefulWidget {
  const CashFlowAdminView({super.key});

  @override
  State<CashFlowAdminView> createState() => _CashFlowAdminViewState();
}

class _CashFlowAdminViewState extends State<CashFlowAdminView> {
  final ApiService _apiService = ApiService();
  bool _isLoading = true;
  
  Map<String, dynamic> _overviewData = {};
  List<dynamic> _pendingCosts = [];
  Map<String, dynamic> _kpis = {};
  Map<String, dynamic> _charts = {};

  @override
  void initState() {
    super.initState();
    _fetchData();
  }

  Future<void> _fetchData() async {
    setState(() => _isLoading = true);
    try {
      final overview = await _apiService.getFinanceOverview();
      final pending = await _apiService.getPendingCosts();
      final health = await _apiService.getHealthDashboard();
      
      setState(() {
        _overviewData = overview;
        _pendingCosts = pending;
        _kpis = health['kpis'] ?? {};
        _charts = health['charts'] ?? {};
      });
    } catch (e) {
      print('Erro ao buscar dados financeiros/saúde: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar dados: $e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String _formatCurrency(double value) {
    return 'R\$ ${value.toStringAsFixed(2).replaceAll('.', ',')}';
  }

  Future<void> _approveCost(String id) async {
    try {
      await _apiService.updateCostStatus(id, 'APPROVED');
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Custo aprovado! Caixa atualizado.'), backgroundColor: Colors.green));
      _fetchData();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao aprovar.'), backgroundColor: Colors.red));
    }
  }

  Future<void> _rejectCost(String id) async {
    try {
      await _apiService.updateCostStatus(id, 'REJECTED');
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Custo reprovado.'), backgroundColor: Colors.amber));
      _fetchData();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao reprovar.'), backgroundColor: Colors.red));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)));
    }

    final double entradas = (_overviewData['totalEntradas'] ?? 0).toDouble();
    final double saidas = (_overviewData['totalSaidas'] ?? 0).toDouble();
    final double saldo = (_overviewData['saldo'] ?? 0).toDouble();
    final double futuro = (_overviewData['totalFuturo'] ?? 0).toDouble();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Fluxo de Caixa Global',
            style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 24),
          
          // Cards de Resumo
          LayoutBuilder(
            builder: (context, constraints) {
              final isSmall = constraints.maxWidth < 600;
              return isSmall 
                  ? Column(children: _buildSummaryCards(entradas, saidas, saldo, futuro))
                  : Row(children: _buildSummaryCards(entradas, saidas, saldo, futuro).map((w) => Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: w))).toList());
            },
          ),

          const SizedBox(height: 40),

          // Fila de Auditoria
          const Text(
            'Fila de Auditoria (Aprovar Custos)',
            style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          if (_pendingCosts.isEmpty)
            const Text('Nenhum custo pendente de aprovação.', style: TextStyle(color: Colors.white54)),
          ..._pendingCosts.map((cost) => _buildPendingCostCard(cost)),

          const SizedBox(height: 40),

          // Tabela de Últimos Lançamentos
          const Text(
            'Últimos Lançamentos',
            style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildRecentTransactionsTable(),

          const SizedBox(height: 40),
          
          // Tabela de Lançamentos Futuros
          const Text(
            'Lançamentos Futuros (Prospectos)',
            style: TextStyle(color: Colors.greenAccent, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildFutureTransactionsTable(),
          
          const SizedBox(height: 40),
          
          // Gráficos de Saúde Financeira
          if (_charts.isNotEmpty) _buildChartsSection(),
          
        ],
      ),
    );
  }

  List<Widget> _buildSummaryCards(double entradas, double saidas, double saldo, double futuro) {
    return [
      _buildCard('Total Entradas', entradas, Colors.green, Icons.arrow_upward),
      const SizedBox(height: 16),
      _buildCard('Total Saídas', saidas, Colors.redAccent, Icons.arrow_downward),
      const SizedBox(height: 16),
      _buildCard('Saldo Atual', saldo, Colors.blueAccent, Icons.account_balance_wallet),
      const SizedBox(height: 16),
      _buildCard('Receita Prevista', futuro, Colors.greenAccent, Icons.trending_up),
    ];
  }

  Widget _buildCard(String title, double value, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.3), width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: const TextStyle(color: Colors.white54, fontSize: 14))),
            ],
          ),
          const SizedBox(height: 12),
          Text(_formatCurrency(value), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Future<void> _editTransactionDialog(Map<String, dynamic> t) async {
    final isOut = t['type'] == 'OUT';
    final amountController = TextEditingController(text: t['amount'].toString());
    final descController = TextEditingController(text: t['desc']);
    final methodController = TextEditingController(text: t['method']);
    
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: Text('Editar ${isOut ? "Custo" : "Venda"}', style: const TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: descController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Descrição', labelStyle: TextStyle(color: Colors.white54)),
              ),
              TextField(
                controller: amountController,
                style: const TextStyle(color: Colors.white),
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Valor (R\$)', labelStyle: TextStyle(color: Colors.white54)),
              ),
              TextField(
                controller: methodController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Método (CASH, PIX...)', labelStyle: TextStyle(color: Colors.white54)),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              onPressed: () async {
                try {
                  final data = {
                    'description': descController.text,
                    'product': descController.text, // sales use product
                    'amount': amountController.text, // costs use amount
                    'value': amountController.text, // sales use value
                    'paymentMethod': methodController.text,
                  };
                  if (isOut) {
                    await _apiService.editCost(t['id'], data);
                  } else {
                    await _apiService.editSale(t['id'], data);
                  }
                  Navigator.pop(context);
                  _fetchData();
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Atualizado com sucesso!', style: TextStyle(color: Colors.white)), backgroundColor: Colors.green));
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e', style: const TextStyle(color: Colors.white)), backgroundColor: Colors.red));
                }
              },
              child: const Text('Salvar', style: TextStyle(color: Colors.white)),
            )
          ],
        );
      }
    );
  }

  Widget _buildRecentTransactionsTable() {
    final recentSales = List<Map<String, dynamic>>.from(_overviewData['recentSales'] ?? []);
    final recentCosts = List<Map<String, dynamic>>.from(_overviewData['recentCosts'] ?? []);

    // Combine and sort by date descending
    final List<Map<String, dynamic>> allTransactions = [
      ...recentSales.map((e) => {...e, 'type': 'IN'}),
      ...recentCosts.map((e) => {...e, 'type': 'OUT'}),
    ];
    
    allTransactions.sort((a, b) {
      final da = DateTime.parse(a['date']);
      final db = DateTime.parse(b['date']);
      return db.compareTo(da);
    });

    if (allTransactions.isEmpty) {
      return const Text('Nenhuma transação encontrada.', style: TextStyle(color: Colors.white54));
    }

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white12),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowColor: WidgetStateProperty.all(const Color(0xFF111122)),
          columns: const [
            DataColumn(label: Text('Data', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Tipo', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Descrição', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Responsável', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Forma Pagto', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Valor', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Ações', style: TextStyle(color: Colors.white))),
          ],
          rows: allTransactions.map((t) {
            final isIncome = t['type'] == 'IN';
            final date = DateTime.parse(t['date']);
            final dateStr = '${date.day.toString().padLeft(2,'0')}/${date.month.toString().padLeft(2,'0')} ${date.hour.toString().padLeft(2,'0')}:${date.minute.toString().padLeft(2,'0')}';
            final isOut = t['type'] == 'OUT';
            return DataRow(cells: [
              DataCell(Text(t['date'].toString().split('T')[0], style: const TextStyle(color: Colors.white70))),
              DataCell(Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: isOut ? Colors.red.withOpacity(0.2) : Colors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                child: Text(isOut ? 'SAÍDA' : 'ENTRADA', style: TextStyle(color: isOut ? Colors.redAccent : Colors.greenAccent, fontSize: 12)),
              )),
              DataCell(Text(t['desc'].toString(), style: const TextStyle(color: Colors.white))),
              DataCell(Text(t['user'].toString(), style: const TextStyle(color: Colors.white))),
              DataCell(Text(t['method'].toString(), style: const TextStyle(color: Colors.white))),
              DataCell(Text(_formatCurrency(double.parse(t['amount'].toString())), style: TextStyle(color: isOut ? Colors.redAccent : Colors.greenAccent, fontWeight: FontWeight.bold))),
              DataCell(IconButton(
                icon: const Icon(Icons.edit, color: Colors.white54, size: 20),
                onPressed: () => _editTransactionDialog(t),
              )),
            ]);
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildFutureTransactionsTable() {
    final futureEntries = List<Map<String, dynamic>>.from(_overviewData['futureEntries'] ?? []);
    
    if (futureEntries.isEmpty) {
      return const Text('Nenhuma receita prevista cadastrada.', style: TextStyle(color: Colors.white54));
    }

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.greenAccent.withOpacity(0.3)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowColor: WidgetStateProperty.all(const Color(0xFF111122)),
          columns: const [
            DataColumn(label: Text('Data Prevista', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Descrição', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Cidade', style: TextStyle(color: Colors.white))),
            DataColumn(label: Text('Valor Esperado', style: TextStyle(color: Colors.greenAccent))),
          ],
          rows: futureEntries.map((t) {
            return DataRow(cells: [
              DataCell(Text(t['date'] != null ? t['date'].toString().split('T')[0] : 'N/A', style: const TextStyle(color: Colors.white70))),
              DataCell(Text(t['desc'].toString(), style: const TextStyle(color: Colors.white))),
              DataCell(Text(t['user'].toString(), style: const TextStyle(color: Colors.white))),
              DataCell(Text(_formatCurrency(double.parse(t['amount'].toString())), style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold))),
            ]);
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildPendingCostCard(Map<String, dynamic> cost) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.amber.withOpacity(0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: Colors.black26,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.white24),
            ),
            child: const Icon(Icons.receipt_long, color: Colors.white54, size: 30),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${cost['category']} - ${_formatCurrency((cost['amount'] as num).toDouble())}',
                  style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                Text('Por: ${cost['user']?['name'] ?? 'Desconhecido'} (${cost['team']?['prefix'] ?? ''})', style: const TextStyle(color: Colors.white70)),
                Text('Detalhes: ${cost['description'] ?? 'Sem descrição'}', style: const TextStyle(color: Colors.white54)),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: Colors.amber.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                  child: Text('Método: ${cost['paymentMethod']}', style: const TextStyle(color: Colors.amber, fontSize: 12)),
                )
              ],
            ),
          ),
          Column(
            children: [
              ElevatedButton.icon(
                onPressed: () => _approveCost(cost['id']),
                icon: const Icon(Icons.check, color: Colors.white, size: 18),
                label: const Text('Aprovar', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () => _rejectCost(cost['id']),
                icon: const Icon(Icons.close, color: Colors.redAccent, size: 18),
                label: const Text('Recusar', style: TextStyle(color: Colors.redAccent)),
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildChartsSection() {
    final costsByCategory = Map<String, dynamic>.from(_charts['costsByCategory'] ?? {});
    final costsByCar = Map<String, dynamic>.from(_charts['costsByCar'] ?? {});

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Análise Gráfica de Custos',
          style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth > 800) {
              return Row(
                children: [
                  Expanded(child: _buildPieChart('Custos por Categoria', costsByCategory)),
                  const SizedBox(width: 20),
                  Expanded(child: _buildBarChart('Custos por Veículo', costsByCar)),
                ],
              );
            } else {
              return Column(
                children: [
                  _buildPieChart('Custos por Categoria', costsByCategory),
                  const SizedBox(height: 20),
                  _buildBarChart('Custos por Veículo', costsByCar),
                ],
              );
            }
          },
        )
      ],
    );
  }

  Widget _buildPieChart(String title, Map<String, dynamic> data) {
    if (data.isEmpty) {
      return _emptyChartContainer(title);
    }

    int i = 0;
    final colors = [Colors.blue, Colors.red, Colors.green, Colors.amber, Colors.purple, Colors.orange, Colors.teal, Colors.pink];
    
    final pieSections = data.entries.map((e) {
      final color = colors[i % colors.length];
      i++;
      return PieChartSectionData(
        color: color,
        value: (e.value as num).toDouble(),
        title: '${e.key}\n${_formatCurrency((e.value as num).toDouble())}',
        radius: 60,
        titleStyle: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
      );
    }).toList();

    return Container(
      height: 350,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          Expanded(
            child: PieChart(
              PieChartData(
                sectionsSpace: 2,
                centerSpaceRadius: 40,
                sections: pieSections,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBarChart(String title, Map<String, dynamic> data) {
    if (data.isEmpty) {
      return _emptyChartContainer(title);
    }

    int i = 0;
    final barGroups = data.entries.map((e) {
      final group = BarChartGroupData(
        x: i,
        barRods: [
          BarChartRodData(
            toY: (e.value as num).toDouble(),
            color: Colors.blueAccent,
            width: 16,
            borderRadius: BorderRadius.circular(4),
          ),
        ],
      );
      i++;
      return group;
    }).toList();

    return Container(
      height: 350,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          Expanded(
            child: BarChart(
              BarChartData(
                alignment: BarChartAlignment.spaceAround,
                titlesData: FlTitlesData(
                  show: true,
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (double value, TitleMeta meta) {
                        final index = value.toInt();
                        if (index >= 0 && index < data.keys.length) {
                          return Padding(
                            padding: const EdgeInsets.only(top: 8.0),
                            child: Text(data.keys.elementAt(index), style: const TextStyle(color: Colors.white70, fontSize: 10)),
                          );
                        }
                        return const Text('');
                      },
                    ),
                  ),
                  leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                borderData: FlBorderData(show: false),
                gridData: const FlGridData(show: false),
                barGroups: barGroups,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyChartContainer(String title) {
    return Container(
      height: 350,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          const Expanded(child: Center(child: Text('Sem dados suficientes.', style: TextStyle(color: Colors.white54)))),
        ],
      ),
    );
  }
}
