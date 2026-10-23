import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class TelaCarteiraCrediarioVendedor extends StatefulWidget {
  const TelaCarteiraCrediarioVendedor({super.key});

  @override
  State<TelaCarteiraCrediarioVendedor> createState() =>
      _TelaCarteiraCrediarioVendedorState();
}

class _TelaCarteiraCrediarioVendedorState
    extends State<TelaCarteiraCrediarioVendedor>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final ApiService _api = ApiService();

  bool _isLoading = true;
  String? _errorMessage;

  // Dados do Portfólio de Contratos
  Map<String, dynamic>? _portfolioData;
  List<dynamic> _agreements = [];
  List<dynamic> _filteredAgreements = [];
  String _searchQuery = '';
  String _selectedStatusFilter = 'TODOS'; // TODOS, ACTIVE, OVERDUE, SETTLED

  // Dados dos 4 Estados Visíveis de Comissão
  Map<String, dynamic>? _fourStatesData;
  List<dynamic> _monthlyClosings = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadAllData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait([
        _api.getSellerCreditPortfolio(),
        _api.getSellerFourStates(),
        _api.getMonthlyCreditClosings(),
      ]);

      if (mounted) {
        setState(() {
          _portfolioData = results[0] as Map<String, dynamic>?;
          _agreements = (_portfolioData?['agreements'] as List<dynamic>?) ?? [];
          _fourStatesData = results[1] as Map<String, dynamic>?;
          _monthlyClosings = results[2] as List<dynamic>;
          _applyFilters();
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  void _applyFilters() {
    final query = _searchQuery.toLowerCase().trim();
    final now = DateTime.now();

    _filteredAgreements = _agreements.where((a) {
      // Filtro de texto (nome ou documento)
      final buyerName = (a['buyerName'] ?? '').toString().toLowerCase();
      final clientName =
          (a['client']?['name'] ?? '').toString().toLowerCase();
      final cpf = (a['buyerCpf'] ?? '').toString().replaceAll(RegExp(r'\D'), '');

      final matchesQuery = query.isEmpty ||
          buyerName.contains(query) ||
          clientName.contains(query) ||
          cpf.contains(query);

      if (!matchesQuery) return false;

      // Filtro por status
      if (_selectedStatusFilter == 'TODOS') return true;
      if (_selectedStatusFilter == 'SETTLED') {
        return a['status'] == 'SETTLED' || a['remainingPrincipalCents'] == 0;
      }
      if (_selectedStatusFilter == 'ACTIVE') {
        return a['status'] == 'ACTIVE' && (a['remainingPrincipalCents'] ?? 0) > 0;
      }
      if (_selectedStatusFilter == 'OVERDUE') {
        final installments = (a['installments'] as List<dynamic>?) ?? [];
        return installments.any((inst) {
          final due = DateTime.tryParse(inst['dueDate'] ?? '');
          final unpaid = (inst['amountCents'] ?? 0) - (inst['paidCents'] ?? 0);
          return due != null && due.isBefore(now) && unpaid > 0;
        });
      }
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      appBar: AppBar(
        title: const Text(
          'Meus Crediários',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF0D1B2A),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF00E5FF),
          indicatorWeight: 3,
          labelColor: const Color(0xFF00E5FF),
          unselectedLabelColor: Colors.white60,
          labelStyle:
              const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
          tabs: const [
            Tab(icon: Icon(Icons.folder_shared_rounded), text: 'Contratos'),
            Tab(
                icon: Icon(Icons.account_balance_wallet_rounded),
                text: 'Comissão Mensal (10%)'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF00E5FF)),
            )
          : _errorMessage != null
              ? _buildErrorView()
              : RefreshIndicator(
                  color: const Color(0xFF00E5FF),
                  backgroundColor: const Color(0xFF1A2634),
                  onRefresh: _loadAllData,
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildContratosTab(),
                      _buildComissoesTab(),
                    ],
                  ),
                ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            Text(
              _errorMessage ?? 'Erro ao carregar carteira',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 15),
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _loadAllData,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tentar Novamente'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF00E5FF),
                foregroundColor: Colors.black,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // =========================================================================
  // TAB 1: CONTRATOS DO CREDIÁRIO (SOMENTE LEITURA PÓS-VENDA)
  // =========================================================================

  Widget _buildContratosTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Banner Informativo: Somente Leitura
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF00E5FF).withOpacity(0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.3)),
          ),
          child: const Row(
            children: [
              Icon(Icons.info_outline_rounded,
                  color: Color(0xFF00E5FF), size: 22),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Carteira de Consulta: após a venda, baixas e acertos financeiros são registrados exclusivamente pela administração.',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Resumo Métrico
        _buildPortfolioSummaryCards(),
        const SizedBox(height: 16),

        // Barra de Pesquisa
        TextField(
          style: const TextStyle(color: Colors.white),
          onChanged: (val) {
            setState(() {
              _searchQuery = val;
              _applyFilters();
            });
          },
          decoration: InputDecoration(
            hintText: 'Buscar por nome ou CPF...',
            hintStyle: const TextStyle(color: Colors.white38),
            prefixIcon: const Icon(Icons.search_rounded, color: Colors.white60),
            filled: true,
            fillColor: const Color(0xFF1A2634),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          ),
        ),
        const SizedBox(height: 12),

        // Chips de Filtro de Status
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _buildFilterChip('TODOS', 'Todos (${_agreements.length})'),
              const SizedBox(width: 8),
              _buildFilterChip('ACTIVE', 'Ativos'),
              const SizedBox(width: 8),
              _buildFilterChip('OVERDUE', 'Atrasados'),
              const SizedBox(width: 8),
              _buildFilterChip('SETTLED', 'Quitados'),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Lista de Contratos
        if (_filteredAgreements.isEmpty)
          Container(
            padding: const EdgeInsets.all(32),
            alignment: Alignment.center,
            child: const Column(
              children: [
                Icon(Icons.search_off_rounded, color: Colors.white24, size: 48),
                SizedBox(height: 12),
                Text('Nenhum contrato encontrado com os filtros atuais.',
                    style: TextStyle(color: Colors.white54)),
              ],
            ),
          )
        else
          ..._filteredAgreements.map((a) => _buildAgreementCard(a)),
      ],
    );
  }

  Widget _buildFilterChip(String value, String label) {
    final isSelected = _selectedStatusFilter == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (selected) {
        if (selected) {
          setState(() {
            _selectedStatusFilter = value;
            _applyFilters();
          });
        }
      },
      selectedColor: const Color(0xFF00E5FF),
      backgroundColor: const Color(0xFF1A2634),
      labelStyle: TextStyle(
        color: isSelected ? Colors.black : Colors.white70,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        fontSize: 12,
      ),
    );
  }

  Widget _buildPortfolioSummaryCards() {
    final totalVend = (_portfolioData?['totalSalesValue'] is num)
        ? (_portfolioData?['totalSalesValue'] as num).toDouble()
        : 0.0;
    final totalEntrada = (_portfolioData?['totalDownPaymentValue'] is num)
        ? (_portfolioData?['totalDownPaymentValue'] as num).toDouble()
        : 0.0;
    final saldoDevedor = (_portfolioData?['totalRemainingPrincipal'] is num)
        ? (_portfolioData?['totalRemainingPrincipal'] as num).toDouble()
        : 0.0;

    return Row(
      children: [
        Expanded(
          child: _buildMetricCard(
            'Total Vendido',
            'R\$ ${totalVend.toStringAsFixed(2)}',
            Icons.sell_rounded,
            const Color(0xFF00E5FF),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildMetricCard(
            'Entrada Total',
            'R\$ ${totalEntrada.toStringAsFixed(2)}',
            Icons.payments_rounded,
            const Color(0xFF00E676),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildMetricCard(
            'Saldo a Receber',
            'R\$ ${saldoDevedor.toStringAsFixed(2)}',
            Icons.account_balance_rounded,
            saldoDevedor > 0 ? const Color(0xFFFFB74D) : const Color(0xFF00E676),
          ),
        ),
      ],
    );
  }

  Widget _buildMetricCard(
      String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2634),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
                color: color, fontSize: 13, fontWeight: FontWeight.bold),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildAgreementCard(Map<String, dynamic> agreement) {
    final buyerName = agreement['buyerName'] ??
        agreement['client']?['name'] ??
        'Cliente sem nome';
    final totalCents = agreement['totalSaleCents'] ?? 0;
    final downCents = agreement['downPaymentCents'] ?? 0;
    final remainingCents = agreement['remainingPrincipalCents'] ?? 0;
    final initialRate = (agreement['initialCommissionRate'] ?? 0.20) * 100;

    // Próximo vencimento
    final installments = (agreement['installments'] as List<dynamic>?) ?? [];
    DateTime? nextDue;
    bool isOverdue = false;
    final now = DateTime.now();

    for (final inst in installments) {
      final unpaid = (inst['amountCents'] ?? 0) - (inst['paidCents'] ?? 0);
      if (unpaid > 0) {
        final d = DateTime.tryParse(inst['dueDate'] ?? '');
        if (d != null) {
          if (nextDue == null || d.isBefore(nextDue)) {
            nextDue = d;
          }
          if (d.isBefore(now)) {
            isOverdue = true;
          }
        }
      }
    }

    final isSettled = remainingCents == 0 || agreement['status'] == 'SETTLED';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2634),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isOverdue
              ? Colors.redAccent.withOpacity(0.5)
              : (isSettled
                  ? Colors.greenAccent.withOpacity(0.4)
                  : Colors.white12),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _showAgreementDetailsModal(agreement),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          buyerName,
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.bold),
                        ),
                        if (agreement['client']?['sequenceNumber'] != null)
                          Text(
                            'Ficha #${agreement['client']?['sequenceNumber']}',
                            style: const TextStyle(
                                color: Color(0xFF90CAF9), fontSize: 11),
                          ),
                      ],
                    ),
                  ),
                  _buildStatusBadge(
                      isSettled ? 'QUITADO' : (isOverdue ? 'EM ATRASO' : 'ATIVO')),
                ],
              ),
              const Divider(color: Colors.white10, height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildMiniInfo(
                      'Total da Venda', 'R\$ ${(totalCents / 100).toStringAsFixed(2)}'),
                  _buildMiniInfo('Entrada (${initialRate.toInt()}%)',
                      'R\$ ${(downCents / 100).toStringAsFixed(2)}'),
                  _buildMiniInfo('Saldo Devedor',
                      'R\$ ${(remainingCents / 100).toStringAsFixed(2)}',
                      color: remainingCents > 0
                          ? (isOverdue ? Colors.redAccent : const Color(0xFFFFB74D))
                          : Colors.greenAccent),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    nextDue != null
                        ? 'Próximo Venc: ${nextDue.day.toString().padLeft(2, '0')}/${nextDue.month.toString().padLeft(2, '0')}/${nextDue.year}'
                        : (isSettled ? 'Contrato Quitado' : 'Sem parcelas pendentes'),
                    style: TextStyle(
                      color: isOverdue ? Colors.redAccent : Colors.white60,
                      fontSize: 11,
                      fontWeight:
                          isOverdue ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  const Row(
                    children: [
                      Text('Ver detalhes',
                          style: TextStyle(
                              color: Color(0xFF00E5FF), fontSize: 11)),
                      Icon(Icons.chevron_right_rounded,
                          color: Color(0xFF00E5FF), size: 16),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMiniInfo(String label, String value, {Color? color}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white38, fontSize: 10)),
        const SizedBox(height: 2),
        Text(value,
            style: TextStyle(
                color: color ?? Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color fg;
    if (status == 'QUITADO') {
      bg = Colors.green.withOpacity(0.2);
      fg = Colors.greenAccent;
    } else if (status == 'EM ATRASO') {
      bg = Colors.red.withOpacity(0.2);
      fg = Colors.redAccent;
    } else {
      bg = Colors.blue.withOpacity(0.2);
      fg = const Color(0xFF90CAF9);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status,
        style: TextStyle(color: fg, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }

  void _showAgreementDetailsModal(Map<String, dynamic> agreement) {
    final buyerName = agreement['buyerName'] ??
        agreement['client']?['name'] ??
        'Cliente sem nome';
    final installments = (agreement['installments'] as List<dynamic>?) ?? [];
    final payments = (agreement['payments'] as List<dynamic>?) ?? [];
    final totalCents = agreement['totalSaleCents'] ?? 0;
    final downCents = agreement['downPaymentCents'] ?? 0;
    final remainingCents = agreement['remainingPrincipalCents'] ?? 0;
    final initialRate = (agreement['initialCommissionRate'] ?? 0.20) * 100;
    final now = DateTime.now();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F1923),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.85,
          maxChildSize: 0.95,
          minChildSize: 0.5,
          expand: false,
          builder: (_, scrollCtrl) {
            return ListView(
              controller: scrollCtrl,
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  buyerName,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                Text(
                  'Taxas Gravadas: Entrada ${initialRate.toInt()}% | Parcelas 10%',
                  style: const TextStyle(color: Color(0xFF00E5FF), fontSize: 12),
                ),
                const SizedBox(height: 16),

                // Resumo do contrato
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A2634),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    children: [
                      _buildModalRow(
                          'Valor Total', 'R\$ ${(totalCents / 100).toStringAsFixed(2)}'),
                      _buildModalRow(
                          'Entrada', 'R\$ ${(downCents / 100).toStringAsFixed(2)}'),
                      _buildModalRow('Saldo Devedor',
                          'R\$ ${(remainingCents / 100).toStringAsFixed(2)}',
                          bold: true,
                          color: remainingCents > 0
                              ? const Color(0xFFFFB74D)
                              : Colors.greenAccent),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                // Cronograma de Parcelas
                const Text(
                  'Cronograma de Parcelas',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 10),

                ...installments.map((inst) {
                  final instNum = inst['installmentNumber'];
                  final amountCents = inst['amountCents'] ?? 0;
                  final paidCents = inst['paidCents'] ?? 0;
                  final unpaidCents = amountCents - paidCents;
                  final due = DateTime.tryParse(inst['dueDate'] ?? '');
                  final isInstOverdue = due != null && due.isBefore(now) && unpaidCents > 0;

                  String instStatus = inst['status'] ?? 'PENDING';
                  if (instStatus == 'PAID' || unpaidCents == 0) {
                    instStatus = 'PAGA';
                  } else if (paidCents > 0) {
                    instStatus = isInstOverdue ? 'PARCIAL (ATRASADA)' : 'PARCIAL';
                  } else if (isInstOverdue) {
                    instStatus = 'ATRASADA';
                  } else {
                    instStatus = 'PENDENTE';
                  }

                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF141E28),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: isInstOverdue
                            ? Colors.redAccent.withOpacity(0.4)
                            : Colors.white10,
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Parcela $instNum',
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold)),
                            if (due != null)
                              Text(
                                'Venc: ${due.day.toString().padLeft(2, '0')}/${due.month.toString().padLeft(2, '0')}/${due.year}',
                                style: TextStyle(
                                    color: isInstOverdue
                                        ? Colors.redAccent
                                        : Colors.white54,
                                    fontSize: 11),
                              ),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              'R\$ ${(amountCents / 100).toStringAsFixed(2)}',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold),
                            ),
                            Text(
                              instStatus,
                              style: TextStyle(
                                  color: (instStatus == 'PAGA')
                                      ? Colors.greenAccent
                                      : (isInstOverdue
                                          ? Colors.redAccent
                                          : Colors.orangeAccent),
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                      ],
                    ),
                  );
                }),

                if (payments.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  const Text(
                    'Histórico de Recebimentos Confirmados',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 10),
                  ...payments.map((p) {
                    final pDate = DateTime.tryParse(p['paidAt'] ?? '');
                    final pAmount = (p['amountCents'] ?? 0) / 100;
                    final isRev = p['isReversed'] == true;

                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF141E28),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: isRev ? Colors.redAccent.withOpacity(0.3) : Colors.white10),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                isRev ? 'ESTORNADO' : 'Recebimento Confirmado',
                                style: TextStyle(
                                    color: isRev ? Colors.redAccent : Colors.greenAccent,
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold),
                              ),
                              if (pDate != null)
                                Text(
                                  'Data: ${pDate.day.toString().padLeft(2, '0')}/${pDate.month.toString().padLeft(2, '0')}/${pDate.year}',
                                  style: const TextStyle(
                                      color: Colors.white38, fontSize: 11),
                                ),
                            ],
                          ),
                          Text(
                            'R\$ ${pAmount.toStringAsFixed(2)}',
                            style: TextStyle(
                                color: isRev ? Colors.white38 : Colors.white,
                                decoration: isRev ? TextDecoration.lineThrough : null,
                                fontWeight: FontWeight.bold,
                                fontSize: 13),
                          ),
                        ],
                      ),
                    );
                  }),
                ],

                const SizedBox(height: 24),
                // Banner de confirmação de somente leitura
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.04),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Text(
                    'Este contrato não aceita alterações por parte do vendedor. Pagamentos ou renegociações devem ser alinhados com o setor administrativo.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white38, fontSize: 11),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildModalRow(String label, String value,
      {bool bold = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white60, fontSize: 13)),
          Text(value,
              style: TextStyle(
                  color: color ?? Colors.white,
                  fontSize: 13,
                  fontWeight: bold ? FontWeight.bold : FontWeight.normal)),
        ],
      ),
    );
  }

  // =========================================================================
  // TAB 2: COMISSÕES DOS 10% (4 ESTADOS VISÍVEIS E FECHAMENTO MENSAL)
  // =========================================================================

  Widget _buildComissoesTab() {
    final states = _fourStatesData?['states'] as Map<String, dynamic>?;

    final futureComm =
        (states?['future']?['futureCommission'] as num?)?.toDouble() ?? 0.0;
    final openMonthComm =
        (states?['accumulatedCurrentMonth']?['commission'] as num?)?.toDouble() ?? 0.0;
    final closedAwaitingComm =
        (states?['closedAwaitingPayment']?['totalAwaiting'] as num?)?.toDouble() ?? 0.0;
    final paidComm =
        (states?['paid']?['totalPaid'] as num?)?.toDouble() ?? 0.0;

    final currentComp = _fourStatesData?['currentOpenCompetence'] ?? '';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Banner explicativo da regra dos 10%
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF00E5FF).withOpacity(0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.3)),
          ),
          child: const Row(
            children: [
              Icon(Icons.calendar_month_rounded,
                  color: Color(0xFF00E5FF), size: 22),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Regra do Crediário: comissão de 10% sobre o principal das parcelas recebidas a cada mês-calendário (do dia 1 ao último dia do mês).',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Os 4 Estados Visíveis de Comissão
        const Text(
          'Estados da Comissão de Parcelas (10%)',
          style: TextStyle(
              color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),

        // Estado 1: Prevista / Futura
        _buildStateCard(
          '1. Prevista / Futura',
          'R\$ ${futureComm.toStringAsFixed(2)}',
          'Depende de principal ainda não pago pelo cliente nas parcelas futuras.',
          Icons.schedule_rounded,
          const Color(0xFF90CAF9),
        ),
        const SizedBox(height: 10),

        // Estado 2: Acumulada no Mês Aberto
        _buildStateCard(
          '2. Acumulada no Mês ($currentComp)',
          'R\$ ${openMonthComm.toStringAsFixed(2)}',
          'Comissão gerada por recebimentos confirmados na competência aberta corrente (não é dinheiro já pago).',
          Icons.trending_up_rounded,
          const Color(0xFF00E5FF),
        ),
        const SizedBox(height: 10),

        // Estado 3: Mês Fechado — A Pagar
        _buildStateCard(
          '3. Mês Fechado — A Pagar',
          'R\$ ${closedAwaitingComm.toStringAsFixed(2)}',
          'Total líquido apurado de meses encerrados, pronto para acerto pelo Admin.',
          Icons.pending_actions_rounded,
          closedAwaitingComm > 0
              ? const Color(0xFFFFB74D)
              : Colors.greenAccent,
        ),
        const SizedBox(height: 10),

        // Estado 4: Parcialmente Paga / Paga
        _buildStateCard(
          '4. Comissão Paga',
          'R\$ ${paidComm.toStringAsFixed(2)}',
          'Total de comissão de parcelas já liquidado com comprovante pelo Admin.',
          Icons.check_circle_rounded,
          const Color(0xFF00E676),
        ),
        const SizedBox(height: 24),

        // Histórico de Fechamentos Mensais
        const Text(
          'Fechamentos Mensais Persistidos',
          style: TextStyle(
              color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),

        if (_monthlyClosings.isEmpty)
          Container(
            padding: const EdgeInsets.all(24),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFF1A2634),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Column(
              children: [
                Icon(Icons.history_rounded, color: Colors.white24, size: 40),
                SizedBox(height: 8),
                Text('Nenhum fechamento mensal encerrado ainda.',
                    style: TextStyle(color: Colors.white54, fontSize: 13)),
                Text(
                  'O fechamento ocorre automaticamente no 1º instante do mês seguinte.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white38, fontSize: 11),
                ),
              ],
            ),
          )
        else
          ..._monthlyClosings.map((c) => _buildMonthlyClosingCard(c)),
      ],
    );
  }

  Widget _buildStateCard(String title, String amount, String explanation,
      IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2634),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.bold),
                    ),
                    Text(
                      amount,
                      style: TextStyle(
                          color: color,
                          fontSize: 16,
                          fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  explanation,
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMonthlyClosingCard(Map<String, dynamic> closing) {
    final comp = closing['competence'] ?? '';
    final netComm = (closing['netCommission'] as num?)?.toDouble() ?? 0.0;
    final paidAmt = (closing['paidAmount'] as num?)?.toDouble() ?? 0.0;
    final remaining = (closing['remainingBalance'] as num?)?.toDouble() ?? 0.0;
    final principal = (closing['totalPrincipalReceived'] as num?)?.toDouble() ?? 0.0;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2634),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: remaining == 0
              ? Colors.greenAccent.withOpacity(0.3)
              : const Color(0xFFFFB74D).withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.date_range_rounded,
                      color: Color(0xFF00E5FF), size: 18),
                  const SizedBox(width: 6),
                  Text(
                    'Competência $comp',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              _buildStatusBadge(remaining == 0
                  ? 'QUITADO'
                  : (paidAmt > 0 ? 'PARCIAL' : 'A PAGAR')),
            ],
          ),
          const Divider(color: Colors.white10, height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildMiniInfo(
                  'Principal Recebido', 'R\$ ${principal.toStringAsFixed(2)}'),
              _buildMiniInfo(
                  'Comissão (10%)', 'R\$ ${netComm.toStringAsFixed(2)}'),
              _buildMiniInfo('Saldo a Receber', 'R\$ ${remaining.toStringAsFixed(2)}',
                  color: remaining > 0 ? const Color(0xFFFFB74D) : Colors.greenAccent),
            ],
          ),
        ],
      ),
    );
  }
}
