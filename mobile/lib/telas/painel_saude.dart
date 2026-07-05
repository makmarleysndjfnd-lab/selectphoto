import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../servicos/servico_api.dart';

class HealthDashboardView extends StatefulWidget {
  const HealthDashboardView({super.key});

  @override
  State<HealthDashboardView> createState() => _HealthDashboardViewState();
}

class _HealthDashboardViewState extends State<HealthDashboardView> {
  final ApiService _apiService = ApiService();
  bool _isLoading = true;
  Map<String, dynamic> _kpis = {};
  Map<String, dynamic> _charts = {};

  @override
  void initState() {
    super.initState();
    _fetchHealthData();
  }

  Future<void> _fetchHealthData() async {
    setState(() => _isLoading = true);
    try {
      final data = await _apiService.getHealthDashboard();
      if (mounted) {
        setState(() {
          _kpis = data['kpis'];
          _charts = data['charts'];
          _isLoading = false;
        });
      }
    } catch (e) {
      print('Erro ao buscar painel de saúde: $e');
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String _formatCurrency(double value) {
    return 'R\$ ${value.toStringAsFixed(2).replaceAll('.', ',')}';
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)));
    }

    if (_kpis.isEmpty) {
      return const Center(child: Text('Erro ao carregar os dados financeiros.', style: TextStyle(color: Colors.white)));
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Saúde da Empresa',
            style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 24),
          _buildKpiGrid(),
          const SizedBox(height: 40),
          _buildChartsSection(),
        ],
      ),
    );
  }

  Widget _buildKpiGrid() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final crossAxisCount = constraints.maxWidth > 800 ? 3 : (constraints.maxWidth > 500 ? 2 : 1);
        return GridView.count(
          crossAxisCount: crossAxisCount,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 16,
          crossAxisSpacing: 16,
          childAspectRatio: 2.5,
          children: [
            _kpiCard('Caixa (Total)', (_kpis['caixa'] ?? 0).toDouble(), Icons.account_balance_wallet, Colors.blue),
            _kpiCard('Receita', (_kpis['receita'] ?? 0).toDouble(), Icons.trending_up, Colors.green),
            _kpiCard('Lucro', (_kpis['lucro'] ?? 0).toDouble(), Icons.monetization_on, Colors.amber),
            _kpiCard('Custos', (_kpis['custos'] ?? 0).toDouble(), Icons.trending_down, Colors.redAccent),
            _kpiCard('Gastos da Frota', (_kpis['frota'] ?? 0).toDouble(), Icons.directions_car, Colors.purple),
          ],
        );
      },
    );
  }

  Widget _kpiCard(String title, double value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.3), width: 2),
        boxShadow: [
          BoxShadow(color: color.withOpacity(0.1), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: color.withOpacity(0.2), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(title, style: const TextStyle(color: Colors.white54, fontSize: 14)),
                const SizedBox(height: 4),
                Text(_formatCurrency(value), style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
              ],
            ),
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
        LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth > 800) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
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
