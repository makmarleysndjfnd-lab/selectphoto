import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class TelaCarteiraCrediarioVendedor extends StatefulWidget {
  const TelaCarteiraCrediarioVendedor({super.key});

  @override
  State<TelaCarteiraCrediarioVendedor> createState() =>
      _TelaCarteiraCrediarioVendedorState();
}

class _TelaCarteiraCrediarioVendedorState
    extends State<TelaCarteiraCrediarioVendedor> {
  final ApiService _api = ApiService();

  bool _isLoading = true;
  String? _errorMessage;

  Map<String, dynamic>? _portfolioData;
  Map<String, dynamic>? _closingConfig;
  List<dynamic> _agreements = [];
  List<dynamic> _filteredAgreements = [];
  String _searchQuery = '';
  String _selectedStatusFilter = 'TODOS'; // TODOS, ACTIVE, OVERDUE, SETTLED

  @override
  void initState() {
    super.initState();
    _loadAllData();
  }

  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait([
        _api.getSellerCreditPortfolio(),
        _api.getCreditClosingConfig().catchError((_) => <String, dynamic>{}),
      ]);

      if (mounted) {
        setState(() {
          _portfolioData = results[0];
          final cfgFromPortfolio =
              _portfolioData?['closingConfig'] as Map<String, dynamic>?;
          final cfgDirect = results[1];
          _closingConfig = (cfgFromPortfolio != null && cfgFromPortfolio.isNotEmpty)
              ? cfgFromPortfolio
              : cfgDirect;
          _agreements = (_portfolioData?['agreements'] as List<dynamic>?) ?? [];
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

  String _getContractNumber(Map<String, dynamic> agreement) {
    final seq = agreement['client']?['sequenceNumber']?.toString().trim();
    if (seq != null && seq.isNotEmpty) return '#$seq';
    final vis = agreement['client']?['visibleCode']?.toString().trim();
    if (vis != null && vis.isNotEmpty) return '#$vis';
    final id = agreement['id']?.toString() ?? '';
    return id.length >= 6 ? '#${id.substring(0, 6).toUpperCase()}' : '#---';
  }

  String _formatDate(dynamic raw) {
    if (raw == null) return '--/--/----';
    final d = DateTime.tryParse(raw.toString());
    if (d == null) return '--/--/----';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  void _applyFilters() {
    final query = _searchQuery.toLowerCase().trim();
    final now = DateTime.now();

    _filteredAgreements = _agreements.where((a) {
      final map = a as Map<String, dynamic>;
      final buyerName = (map['buyerName'] ?? '').toString().toLowerCase();
      final clientName =
          (map['client']?['name'] ?? '').toString().toLowerCase();
      final contractNum = _getContractNumber(map).toLowerCase();

      final matchesQuery = query.isEmpty ||
          buyerName.contains(query) ||
          clientName.contains(query) ||
          contractNum.contains(query);

      if (!matchesQuery) return false;

      if (_selectedStatusFilter == 'TODOS') return true;
      if (_selectedStatusFilter == 'SETTLED') {
        return map['status'] == 'SETTLED' ||
            (map['remainingPrincipalCents'] ?? 0) == 0;
      }
      if (_selectedStatusFilter == 'ACTIVE') {
        return map['status'] == 'ACTIVE' &&
            (map['remainingPrincipalCents'] ?? 0) > 0;
      }
      if (_selectedStatusFilter == 'OVERDUE') {
        final installments = (map['installments'] as List<dynamic>?) ?? [];
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
        actions: [
          IconButton(
            onPressed: _loadAllData,
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFF00E5FF)),
            tooltip: 'Atualizar',
          ),
        ],
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
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildClosingSummaryBanner(),
                      const SizedBox(height: 16),
                      _buildSearchField(),
                      const SizedBox(height: 12),
                      _buildStatusFilterRow(),
                      const SizedBox(height: 16),
                      if (_filteredAgreements.isEmpty)
                        _buildEmptyState()
                      else
                        ..._filteredAgreements.map(
                          (a) => _buildAgreementCard(a as Map<String, dynamic>),
                        ),
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

  Widget _buildClosingSummaryBanner() {
    final comissaoMes =
        (_portfolioData?['monthPaidInstallmentCommission'] is num)
            ? (_portfolioData?['monthPaidInstallmentCommission'] as num)
                .toDouble()
            : 0.0;
    final previsaoFutura =
        (_portfolioData?['futureEstimatedCommission'] is num)
            ? (_portfolioData?['futureEstimatedCommission'] as num).toDouble()
            : 0.0;
    final pagamentosNoPeriodo =
        (_portfolioData?['periodPaymentsCount'] as num?)?.toInt() ?? 0;

    final startStr = _formatDate(_closingConfig?['startDate']);
    final endStr = _formatDate(_closingConfig?['endDate']);
    final payoutStr = _formatDate(_closingConfig?['payoutDate']);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF13273A), Color(0xFF1A2634)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF00E5FF).withOpacity(0.4),
          width: 1.2,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.calendar_month_rounded,
                  color: Color(0xFF00E5FF), size: 20),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Fechamento de Comissão dos Boletos',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.black26,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildDateColumn('Início', startStr, const Color(0xFF90CAF9)),
                _buildDateColumn('Término', endStr, const Color(0xFF90CAF9)),
                _buildDateColumn(
                    'Pagamento', payoutStr, const Color(0xFF00E676)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF00E676).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: const Color(0xFF00E676).withOpacity(0.4),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Comissão do Mês (Boletos Pagos)',
                        style: TextStyle(color: Colors.white70, fontSize: 10),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'R\$ ${comissaoMes.toStringAsFixed(2)}',
                        style: const TextStyle(
                          color: Color(0xFF00E676),
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$pagamentosNoPeriodo parcela(s) identificada(s)',
                        style: const TextStyle(
                            color: Colors.white54, fontSize: 10),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFD54F).withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: const Color(0xFFFFD54F).withOpacity(0.35),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Comissão Gradativa a Receber',
                        style: TextStyle(color: Colors.white70, fontSize: 10),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'R\$ ${previsaoFutura.toStringAsFixed(2)}',
                        style: const TextStyle(
                          color: Color(0xFFFFD54F),
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'Conforme clientes pagam',
                        style: TextStyle(color: Colors.white54, fontSize: 10),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDateColumn(String label, String dateValue, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white54, fontSize: 10)),
        const SizedBox(height: 2),
        Text(
          dateValue,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Widget _buildSearchField() {
    return TextField(
      style: const TextStyle(color: Colors.white),
      onChanged: (val) {
        setState(() {
          _searchQuery = val;
          _applyFilters();
        });
      },
      decoration: InputDecoration(
        hintText: 'Buscar por nº do contrato ou nome do cliente...',
        hintStyle: const TextStyle(color: Colors.white38, fontSize: 13),
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
    );
  }

  Widget _buildStatusFilterRow() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildFilterChip('TODOS', 'Todos (${_agreements.length})'),
          const SizedBox(width: 8),
          _buildFilterChip('ACTIVE', 'Parcelas a Pagar'),
          const SizedBox(width: 8),
          _buildFilterChip('OVERDUE', 'Em Atraso'),
          const SizedBox(width: 8),
          _buildFilterChip('SETTLED', 'Quitados'),
        ],
      ),
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

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.all(32),
      alignment: Alignment.center,
      child: const Column(
        children: [
          Icon(Icons.search_off_rounded, color: Colors.white24, size: 48),
          SizedBox(height: 12),
          Text(
            'Nenhum contrato encontrado.',
            style: TextStyle(color: Colors.white54),
          ),
        ],
      ),
    );
  }

  Widget _buildAgreementCard(Map<String, dynamic> agreement) {
    final contractNumber = _getContractNumber(agreement);
    final buyerName = agreement['buyerName'] ??
        agreement['client']?['name'] ??
        'Cliente sem nome';

    final remainingCents = agreement['remainingPrincipalCents'] ?? 0;
    final paidCommCents = agreement['releasedInstallmentCommissionCents'] ?? 0;
    final periodCommCents = agreement['periodPaidCommissionCents'] ?? 0;
    final futureCommCents = agreement['futureEstimatedCommissionCents'] ?? 0;

    final installments = (agreement['installments'] as List<dynamic>?) ?? [];
    DateTime? nextDue;
    bool isOverdue = false;
    final now = DateTime.now();

    for (final inst in installments) {
      final unpaid = (inst['amountCents'] ?? 0) -
          (inst['paidCents'] ?? inst['paidPrincipalCents'] ?? 0);
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

    final totalInst =
        agreement['totalInstallmentsCount'] ?? installments.length;
    final paidInst = agreement['paidInstallmentsCount'] ??
        installments
            .where((i) =>
                i['status'] == 'PAID' ||
                ((i['amountCents'] ?? 0) -
                        (i['paidCents'] ?? i['paidPrincipalCents'] ?? 0) <=
                    0))
            .length;
    final toPayInst = (totalInst - paidInst) > 0 ? (totalInst - paidInst) : 0;
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
        onTap: () => _showAgreementInstallmentsModal(agreement),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Número do Contrato + Nome do Cliente + Status
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF00E5FF).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                          color: const Color(0xFF00E5FF).withOpacity(0.4)),
                    ),
                    child: Text(
                      'Contrato $contractNumber',
                      style: const TextStyle(
                        color: Color(0xFF00E5FF),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      buyerName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  _buildStatusBadge(
                    isSettled
                        ? 'QUITADO'
                        : (isOverdue ? 'EM ATRASO' : 'A PAGAR'),
                  ),
                ],
              ),
              const Divider(color: Colors.white10, height: 16),

              // 2. Parcelas a Pagar
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFF141E28),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.receipt_long_rounded,
                            color: Color(0xFF00E5FF), size: 15),
                        const SizedBox(width: 6),
                        Text(
                          'Parcelas a pagar: $toPayInst de $totalInst ($paidInst paga${paidInst == 1 ? '' : 's'})',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    if (nextDue != null)
                      Text(
                        'Próx: ${nextDue.day.toString().padLeft(2, '0')}/${nextDue.month.toString().padLeft(2, '0')}/${nextDue.year}',
                        style: TextStyle(
                          color: isOverdue ? Colors.redAccent : Colors.white60,
                          fontSize: 11,
                          fontWeight:
                              isOverdue ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),

              // 3. Comissão Gradativa a Receber (Boletos)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Comissão Já Contabilizada',
                            style:
                                TextStyle(color: Colors.white54, fontSize: 10),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'R\$ ${(paidCommCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFF00E676),
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (periodCommCents > 0)
                            Text(
                              'No fechamento atual: R\$ ${(periodCommCents / 100).toStringAsFixed(2)}',
                              style: const TextStyle(
                                color: Color(0xFF00E5FF),
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          const Text(
                            'Comissão a Receber (Gradativa)',
                            style:
                                TextStyle(color: Colors.white54, fontSize: 10),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'R\$ ${(futureCommCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFFFFD54F),
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              const Align(
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Ver parcelas e comissões',
                      style: TextStyle(color: Color(0xFF00E5FF), fontSize: 11),
                    ),
                    Icon(Icons.chevron_right_rounded,
                        color: Color(0xFF00E5FF), size: 16),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color fg;
    if (status == 'QUITADO' || status == 'PAGA') {
      bg = Colors.green.withOpacity(0.2);
      fg = Colors.greenAccent;
    } else if (status == 'EM ATRASO' || status == 'ATRASADA') {
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

  void _showAgreementInstallmentsModal(Map<String, dynamic> agreement) {
    final contractNumber = _getContractNumber(agreement);
    final buyerName = agreement['buyerName'] ??
        agreement['client']?['name'] ??
        'Cliente sem nome';
    final installments = (agreement['installments'] as List<dynamic>?) ?? [];
    final paidCommCents = agreement['releasedInstallmentCommissionCents'] ?? 0;
    final futureCommCents = agreement['futureEstimatedCommissionCents'] ?? 0;
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
          initialChildSize: 0.8,
          maxChildSize: 0.92,
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
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: const Color(0xFF00E5FF).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'Contrato $contractNumber',
                        style: const TextStyle(
                          color: Color(0xFF00E5FF),
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        buyerName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A2634),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Comissão Já Contabilizada',
                            style:
                                TextStyle(color: Colors.white60, fontSize: 11),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'R\$ ${(paidCommCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFF00E676),
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          const Text(
                            'Comissão a Receber (Parcelas a Pagar)',
                            style:
                                TextStyle(color: Colors.white60, fontSize: 11),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'R\$ ${(futureCommCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFFFFD54F),
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Parcelas e Comissão Gradativa',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                ...installments.map((inst) {
                  final instNum = inst['installmentNumber'];
                  final amountCents = inst['amountCents'] ?? 0;
                  final paidPrincipalCents =
                      inst['paidPrincipalCents'] ?? inst['paidCents'] ?? 0;
                  final unpaidPrincipalCents = inst['unpaidPrincipalCents'] ??
                      (amountCents - paidPrincipalCents);
                  final due = DateTime.tryParse(inst['dueDate'] ?? '');
                  final paidDate = DateTime.tryParse(inst['paidAt'] ?? '');
                  final isInstOverdue = due != null &&
                      due.isBefore(now) &&
                      unpaidPrincipalCents > 0;
                  final commCents = inst['commissionCents'] ??
                      ((paidPrincipalCents * 0.10).round());
                  final futureInstCommCents =
                      inst['futureEstimatedCommissionCents'] ??
                          ((unpaidPrincipalCents * 0.10).round());

                  final isPaid =
                      inst['status'] == 'PAID' || unpaidPrincipalCents <= 0;
                  final statusLabel = isPaid
                      ? 'PAGA'
                      : (isInstOverdue ? 'ATRASADA' : 'A PAGAR');

                  return Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF141E28),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: isPaid
                            ? Colors.greenAccent.withOpacity(0.35)
                            : (isInstOverdue
                                ? Colors.redAccent.withOpacity(0.4)
                                : Colors.white10),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Parcela $instNum — R\$ ${(amountCents / 100).toStringAsFixed(2)}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            _buildStatusBadge(statusLabel),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            if (due != null)
                              Text(
                                'Vencimento: ${due.day.toString().padLeft(2, '0')}/${due.month.toString().padLeft(2, '0')}/${due.year}',
                                style: TextStyle(
                                  color: isInstOverdue
                                      ? Colors.redAccent
                                      : Colors.white60,
                                  fontSize: 11,
                                ),
                              ),
                            if (paidDate != null && isPaid)
                              Text(
                                'Pago em: ${paidDate.day.toString().padLeft(2, '0')}/${paidDate.month.toString().padLeft(2, '0')}/${paidDate.year}',
                                style: const TextStyle(
                                  color: Colors.greenAccent,
                                  fontSize: 11,
                                ),
                              ),
                          ],
                        ),
                        const Divider(color: Colors.white10, height: 12),
                        if (paidPrincipalCents > 0)
                          Text(
                            'Comissão Contabilizada: R\$ ${(commCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFF00E676),
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        if (unpaidPrincipalCents > 0)
                          Text(
                            'Comissão a Receber (ao pagar): R\$ ${(futureInstCommCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFFFFD54F),
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                      ],
                    ),
                  );
                }),
              ],
            );
          },
        );
      },
    );
  }
}
