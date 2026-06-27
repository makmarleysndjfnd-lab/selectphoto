import 'package:flutter/material.dart';
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
      
      setState(() {
        _overviewData = overview;
        _pendingCosts = pending;
      });
    } catch (e) {
      print('Erro ao buscar dados financeiros: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar fluxo: $e'), backgroundColor: Colors.red));
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
}
