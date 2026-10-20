import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_button.dart';

class VisaoCrediarioAdmin extends StatefulWidget {
  const VisaoCrediarioAdmin({super.key});

  @override
  State<VisaoCrediarioAdmin> createState() => _VisaoCrediarioAdminState();
}

class _VisaoCrediarioAdminState extends State<VisaoCrediarioAdmin> {
  final ApiService _api = ApiService();
  final TextEditingController _searchController = TextEditingController();

  bool _isLoading = true;
  String? _errorMessage;

  Map<String, dynamic> _overview = {};
  List<dynamic> _agreements = [];
  List<dynamic> _sellers = [];

  String _selectedStatus = 'ALL';
  String? _selectedSellerId;

  final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final dateFormat = DateFormat('dd/MM/yyyy');

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final overviewFuture = _api.getCreditOverview(
        sellerId: _selectedSellerId,
      );
      final agreementsFuture = _api.getCreditAgreements(
        search: _searchController.text.trim(),
        status: _selectedStatus == 'ALL' ? null : _selectedStatus,
        sellerId: _selectedSellerId,
      );
      final sellersFuture = _api.getSellers();

      final results = await Future.wait([overviewFuture, agreementsFuture, sellersFuture]);

      if (mounted) {
        setState(() {
          _overview = results[0] as Map<String, dynamic>;
          _agreements = results[1] as List<dynamic>;
          _sellers = results[2] as List<dynamic>;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _refresh() async {
    await _loadAll();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0714), // Dark purple theme
      appBar: AppBar(
        backgroundColor: const Color(0xFF160D24),
        elevation: 0,
        title: Row(
          children: const [
            Icon(Icons.credit_score_rounded, color: Color(0xFFA855F7), size: 22),
            SizedBox(width: 10),
            Text(
              'Crediário e Cobranças',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFFA855F7)),
            tooltip: 'Atualizar',
            onPressed: _refresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        color: const Color(0xFFA855F7),
        backgroundColor: const Color(0xFF160D24),
        onRefresh: _refresh,
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: Color(0xFFA855F7)),
              )
            : _errorMessage != null
                ? _buildErrorView()
                : SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildKpiSection(),
                        const SizedBox(height: 20),
                        _buildInadimplenciaBanner(),
                        const SizedBox(height: 20),
                        _buildFilterSection(),
                        const SizedBox(height: 16),
                        _buildAgreementsList(),
                      ],
                    ),
                  ),
      ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline_rounded, color: Color(0xFFEF4444), size: 48),
            const SizedBox(height: 12),
            Text(
              'Erro ao carregar dados do crediário:\n$_errorMessage',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _refresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFA855F7),
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildKpiSection() {
    final remaining = (_overview['totalRemainingPrincipal'] as num?)?.toDouble() ?? 0.0;
    final overdue = (_overview['totalOverduePrincipal'] as num?)?.toDouble() ?? 0.0;
    final overdueCount = (_overview['overdueInstallmentsCount'] as num?)?.toInt() ?? 0;
    final received = (_overview['periodReceived'] as num?)?.toDouble() ?? 0.0;
    final commissions = (_overview['pendingCommissions'] as num?)?.toDouble() ?? 0.0;
    final rate = (_overview['delinquencyRate'] as num?)?.toDouble() ?? 0.0;

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _buildKpiCard(
                title: 'Carteira Ativa',
                subtitle: 'Total a Receber',
                value: currencyFormat.format(remaining),
                icon: Icons.account_balance_wallet_rounded,
                accentColor: const Color(0xFFA855F7),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildKpiCard(
                title: 'Principal Vencido',
                subtitle: '$overdueCount parcela(s) vencida(s)',
                value: currencyFormat.format(overdue),
                icon: Icons.warning_amber_rounded,
                accentColor: overdue > 0 ? const Color(0xFFEF4444) : const Color(0xFF10B981),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildKpiCard(
                title: 'Recebido no Período',
                subtitle: 'Baixas confirmadas',
                value: currencyFormat.format(received),
                icon: Icons.check_circle_outline_rounded,
                accentColor: const Color(0xFF10B981),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildKpiCard(
                title: 'Comissões Pendentes',
                subtitle: 'Liberadas para vendedores',
                value: currencyFormat.format(commissions),
                icon: Icons.monetization_on_outlined,
                accentColor: const Color(0xFFF59E0B),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildKpiCard({
    required String title,
    required String subtitle,
    required String value,
    required IconData icon,
    required Color accentColor,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF160D24),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF2A1B3D), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(icon, color: accentColor, size: 18),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              color: accentColor,
              fontSize: 16,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: TextStyle(
              color: Colors.white.withOpacity(0.45),
              fontSize: 10,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildInadimplenciaBanner() {
    final rate = (_overview['delinquencyRate'] as num?)?.toDouble() ?? 0.0;
    final formula = _overview['delinquencyFormula']?.toString() ??
        'Taxa de Inadimplência = (Principal Vencido / Saldo a Receber) * 100';

    final isHigh = rate >= 15.0;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isHigh ? const Color(0xFFEF4444).withOpacity(0.12) : const Color(0xFF2A1B3D).withOpacity(0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isHigh ? const Color(0xFFEF4444).withOpacity(0.6) : const Color(0xFFA855F7).withOpacity(0.3),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isHigh ? Icons.crisis_alert_rounded : Icons.info_outline_rounded,
            color: isHigh ? const Color(0xFFEF4444) : const Color(0xFFA855F7),
            size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Taxa de Inadimplência',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      '${rate.toStringAsFixed(1)}%',
                      style: TextStyle(
                        color: isHigh ? const Color(0xFFEF4444) : const Color(0xFF10B981),
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  formula,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.6),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Busca
        TextField(
          controller: _searchController,
          style: const TextStyle(color: Colors.white, fontSize: 13),
          decoration: InputDecoration(
            hintText: 'Buscar por cliente, CPF, cidade ou vendedor...',
            hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
            prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFFA855F7), size: 18),
            suffixIcon: _searchController.text.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear, color: Colors.white38, size: 16),
                    onPressed: () {
                      _searchController.clear();
                      _loadAll();
                    },
                  )
                : null,
            filled: true,
            fillColor: const Color(0xFF160D24),
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFF2A1B3D)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFFA855F7)),
            ),
          ),
          onSubmitted: (_) => _loadAll(),
        ),
        const SizedBox(height: 12),
        // Status chips
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _buildFilterChip('Todos', 'ALL'),
              const SizedBox(width: 8),
              _buildFilterChip('Em Aberto / Em dia', 'ACTIVE'),
              const SizedBox(width: 8),
              _buildFilterChip('Quitados', 'SETTLED'),
              const SizedBox(width: 8),
              _buildFilterChip('Renegociados', 'RENEGOTIATED'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFilterChip(String label, String statusKey) {
    final isSelected = _selectedStatus == statusKey;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (val) {
        if (val) {
          setState(() => _selectedStatus = statusKey);
          _loadAll();
        }
      },
      selectedColor: const Color(0xFFA855F7).withOpacity(0.3),
      backgroundColor: const Color(0xFF160D24),
      side: BorderSide(
        color: isSelected ? const Color(0xFFA855F7) : const Color(0xFF2A1B3D),
      ),
      labelStyle: TextStyle(
        color: isSelected ? const Color(0xFFA855F7) : Colors.white70,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        fontSize: 11,
      ),
    );
  }

  Widget _buildAgreementsList() {
    if (_agreements.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(32),
        alignment: Alignment.center,
        child: Column(
          children: [
            const Icon(Icons.receipt_long_outlined, color: Colors.white24, size: 48),
            const SizedBox(height: 12),
            const Text(
              'Nenhum contrato de crediário encontrado com os filtros atuais.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _agreements.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final agreement = _agreements[index] as Map<String, dynamic>;
        return _buildAgreementCard(agreement);
      },
    );
  }

  Widget _buildAgreementCard(Map<String, dynamic> a) {
    final id = a['id']?.toString() ?? '';
    final buyerName = a['buyerName']?.toString() ?? 'Cliente';
    final buyerCpf = a['buyerCpf']?.toString() ?? '---';
    final city = a['city']?.toString() ?? '';
    final sellerName = a['sellerName']?.toString() ?? 'Vendedor';
    final remaining = (a['remainingPrincipal'] as num?)?.toDouble() ?? 0.0;
    final total = (a['totalSale'] as num?)?.toDouble() ?? 0.0;
    final downPayment = (a['downPayment'] as num?)?.toDouble() ?? 0.0;
    final financed = (a['financedPrincipal'] as num?)?.toDouble() ?? 0.0;
    final installmentsCount = a['installmentsCount'] ?? 1;
    final overdueCount = (a['overdueCount'] as num?)?.toInt() ?? 0;
    final status = a['status']?.toString() ?? 'ACTIVE';

    final bool isOverdue = overdueCount > 0;
    final bool isSettled = status == 'SETTLED' || remaining == 0;
    final bool isRenegotiated = status == 'RENEGOTIATED';

    Color statusColor = const Color(0xFFA855F7);
    String statusLabel = 'EM DIA';
    if (isSettled) {
      statusColor = const Color(0xFF10B981);
      statusLabel = 'QUITADO';
    } else if (isOverdue) {
      statusColor = const Color(0xFFEF4444);
      statusLabel = '$overdueCount VENCIDA(S)';
    } else if (isRenegotiated) {
      statusColor = const Color(0xFFF59E0B);
      statusLabel = 'RENEGOCIADO';
    }

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF160D24),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isOverdue ? const Color(0xFFEF4444).withOpacity(0.5) : const Color(0xFF2A1B3D),
          width: isOverdue ? 1.5 : 1.0,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => _openAgreementDetailsModal(id),
          child: Padding(
            padding: const EdgeInsets.all(16),
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
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 3),
                          Text(
                            'CPF: $buyerCpf · $city',
                            style: TextStyle(
                              color: Colors.white.withOpacity(0.6),
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: statusColor.withOpacity(0.6)),
                      ),
                      child: Text(
                        statusLabel,
                        style: TextStyle(
                          color: statusColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Divider(color: Color(0xFF2A1B3D), height: 1),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Total da Venda',
                          style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 10),
                        ),
                        Text(
                          currencyFormat.format(total),
                          style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Entrada',
                          style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 10),
                        ),
                        Text(
                          currencyFormat.format(downPayment),
                          style: const TextStyle(color: Color(0xFF10B981), fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          'Saldo em Aberto',
                          style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 10),
                        ),
                        Text(
                          currencyFormat.format(remaining),
                          style: TextStyle(
                            color: remaining > 0 ? const Color(0xFFA855F7) : const Color(0xFF10B981),
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.person_outline, size: 14, color: Color(0xFFA855F7)),
                        const SizedBox(width: 4),
                        Text(
                          'Vendedor: $sellerName',
                          style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 11),
                        ),
                      ],
                    ),
                    Text(
                      '$installmentsCount parcelas',
                      style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 11),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DE DETALHES DO CONTRATO
  // ══════════════════════════════════════════════════════════════════════════
  Future<void> _openAgreementDetailsModal(String agreementId) async {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF160D24),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.85,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          expand: false,
          builder: (_, scrollController) {
            return FutureBuilder<Map<String, dynamic>>(
              future: _api.getCreditAgreementDetails(agreementId),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(
                    child: CircularProgressIndicator(color: Color(0xFFA855F7)),
                  );
                }
                if (snapshot.hasError || !snapshot.hasData) {
                  return Center(
                    child: Text(
                      'Erro ao carregar detalhes: ${snapshot.error}',
                      style: const TextStyle(color: Color(0xFFEF4444)),
                    ),
                  );
                }

                final agreement = snapshot.data!;
                return _buildModalContent(agreement, scrollController);
              },
            );
          },
        );
      },
    );
  }

  Widget _buildModalContent(Map<String, dynamic> a, ScrollController scrollController) {
    final buyerName = a['buyerName']?.toString() ?? 'Cliente';
    final buyerCpf = a['buyerCpf']?.toString() ?? '---';
    final city = a['city']?.toString() ?? '';
    final state = a['state']?.toString() ?? '';
    final street = a['street']?.toString() ?? '';
    final number = a['number']?.toString() ?? '';
    final neighborhood = a['neighborhood']?.toString() ?? '';
    final complement = a['complement']?.toString() ?? '';
    final postalCode = a['postalCode']?.toString() ?? '';
    final buyerPhone = a['buyerPhone']?.toString() ?? '';

    final totalSale = ((a['totalSaleCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
    final downPayment = ((a['downPaymentCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
    final remaining = ((a['remainingPrincipalCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
    final paid = ((a['paidPrincipalCents'] as num?)?.toDouble() ?? 0.0) / 100.0;

    final installments = (a['installments'] as List?) ?? [];
    final payments = (a['payments'] as List?) ?? [];
    final renegotiations = (a['renegotiations'] as List?) ?? [];

    final isSettled = remaining == 0;

    return SingleChildScrollView(
      controller: scrollController,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
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
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  buyerName,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close, color: Colors.white70),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          Text(
            'CPF: $buyerCpf · Telefone: $buyerPhone',
            style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 12),
          ),
          const SizedBox(height: 4),
          Text(
            'Endereço: $street, $number ${complement.isNotEmpty ? "($complement)" : ""} - $neighborhood, $city - $state ($postalCode)',
            style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 11),
          ),
          const SizedBox(height: 16),

          // Resumo Financeiro
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF0D0714),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF2A1B3D)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildModalStat('Total', currencyFormat.format(totalSale), Colors.white),
                _buildModalStat('Entrada', currencyFormat.format(downPayment), const Color(0xFF10B981)),
                _buildModalStat('Amortizado', currencyFormat.format(paid), const Color(0xFF38BDF8)),
                _buildModalStat(
                  'Saldo Devedor',
                  currencyFormat.format(remaining),
                  isSettled ? const Color(0xFF10B981) : const Color(0xFFA855F7),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),

          // Ações do Contrato (Registrar Baixa / Renegociar)
          if (!isSettled) ...[
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    icon: const Icon(Icons.payments_outlined, size: 18),
                    label: const Text('Registrar Baixa'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF10B981),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    onPressed: () {
                      Navigator.pop(context);
                      _showRegisterPaymentDialog(a);
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.sync_alt_rounded, size: 18),
                    label: const Text('Renegociar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFF59E0B),
                      side: const BorderSide(color: Color(0xFFF59E0B)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    onPressed: () {
                      Navigator.pop(context);
                      _showRenegotiateDialog(a);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
          ],

          // Cronograma de Parcelas
          const Text(
            'Cronograma de Parcelas',
            style: TextStyle(
              color: Color(0xFFA855F7),
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 10),
          _buildInstallmentsTable(installments),

          const SizedBox(height: 20),

          // Histórico de Recebimentos
          const Text(
            'Histórico de Recebimentos',
            style: TextStyle(
              color: Color(0xFF10B981),
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 10),
          _buildPaymentsHistory(payments),

          if (renegotiations.isNotEmpty) ...[
            const SizedBox(height: 20),
            const Text(
              'Histórico de Renegociações',
              style: TextStyle(
                color: Color(0xFFF59E0B),
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 10),
            _buildRenegotiationsHistory(renegotiations),
          ],
        ],
      ),
    );
  }

  Widget _buildModalStat(String label, String value, Color color) {
    return Column(
      children: [
        Text(label, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 10)),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13),
        ),
      ],
    );
  }

  Widget _buildInstallmentsTable(List installments) {
    if (installments.isEmpty) {
      return const Text('Nenhuma parcela cadastrada.', style: TextStyle(color: Colors.white54, fontSize: 12));
    }

    final now = DateTime.now();

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF0D0714),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF2A1B3D)),
      ),
      child: Column(
        children: installments.map((inst) {
          final number = inst['installmentNumber'];
          final due = DateTime.tryParse(inst['dueDate'] ?? '');
          final dueStr = due != null ? dateFormat.format(due) : '---';
          final amount = ((inst['amountCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
          final paid = ((inst['paidCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
          final status = inst['status']?.toString() ?? 'PENDING';

          final isPaid = status == 'PAID';
          final isOverdue = !isPaid && due != null && due.isBefore(now);

          Color badgeColor = const Color(0xFFA855F7);
          String badgeText = 'PENDENTE';
          if (isPaid) {
            badgeColor = const Color(0xFF10B981);
            badgeText = 'PAGO';
          } else if (isOverdue) {
            badgeColor = const Color(0xFFEF4444);
            badgeText = 'VENCIDA';
          }

          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: Color(0xFF2A1B3D), width: 0.5)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Parcela $number',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12),
                ),
                Text(
                  'Venc: $dueStr',
                  style: TextStyle(
                    color: isOverdue ? const Color(0xFFEF4444) : Colors.white70,
                    fontSize: 12,
                    fontWeight: isOverdue ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
                Text(
                  currencyFormat.format(amount),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: badgeColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: badgeColor.withOpacity(0.5)),
                  ),
                  child: Text(
                    badgeText,
                    style: TextStyle(color: badgeColor, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildPaymentsHistory(List payments) {
    if (payments.isEmpty) {
      return const Text('Nenhum pagamento registrado ainda.', style: TextStyle(color: Colors.white54, fontSize: 12));
    }

    return Column(
      children: payments.map((p) {
        final paymentId = p['id']?.toString() ?? '';
        final amount = ((p['amountCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
        final date = DateTime.tryParse(p['paidAt'] ?? '');
        final dateStr = date != null ? dateFormat.format(date) : '';
        final method = p['paymentMethod']?.toString() ?? 'CASH';
        final receiver = p['receiver']?['name'] ?? 'Admin';
        final isReversed = p['isReversed'] == true;

        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF0D0714),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isReversed ? const Color(0xFFEF4444).withOpacity(0.3) : const Color(0xFF2A1B3D),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        currencyFormat.format(amount),
                        style: TextStyle(
                          color: isReversed ? const Color(0xFFEF4444) : const Color(0xFF10B981),
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          decoration: isReversed ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      if (isReversed) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEF4444).withOpacity(0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text('ESTORNADO', style: TextStyle(color: Color(0xFFEF4444), fontSize: 9)),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$dateStr · $method · Recebido por: $receiver',
                    style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 10),
                  ),
                ],
              ),
              if (!isReversed)
                TextButton(
                  onPressed: () => _showReversePaymentDialog(paymentId, amount),
                  child: const Text(
                    'Estornar',
                    style: TextStyle(color: Color(0xFFEF4444), fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildRenegotiationsHistory(List renegotiations) {
    return Column(
      children: renegotiations.map((r) {
        final reason = r['reason']?.toString() ?? '';
        final count = r['newInstallmentsCount'] ?? 1;
        final date = DateTime.tryParse(r['createdAt'] ?? '');
        final dateStr = date != null ? dateFormat.format(date) : '';
        final author = r['author']?['name'] ?? 'Admin';

        return Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFF0D0714),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFF2A1B3D)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Em $dateStr por $author ($count parcelas)',
                style: const TextStyle(color: Color(0xFFF59E0B), fontSize: 11, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 2),
              Text(
                'Motivo: $reason',
                style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 11),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIÁLOGOS DE AÇÃO
  // ══════════════════════════════════════════════════════════════════════════
  void _showRegisterPaymentDialog(Map<String, dynamic> agreement) {
    final remaining = ((agreement['remainingPrincipalCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
    final amountController = TextEditingController(text: remaining.toStringAsFixed(2));
    final notesController = TextEditingController();
    String selectedMethod = 'CASH';
    String selectedDestination = 'SELLER_HANDS';
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFF2A1B3D)),
          ),
          title: const Text('Registrar Baixa de Parcela', style: TextStyle(color: Colors.white, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Saldo em aberto: ${currencyFormat.format(remaining)}',
                  style: const TextStyle(color: Color(0xFFA855F7), fontWeight: FontWeight.bold, fontSize: 13),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Valor do Recebimento (R\$)',
                    labelStyle: TextStyle(color: Colors.white70),
                    prefixText: 'R\$ ',
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: selectedMethod,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Forma de Pagamento',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'CASH', child: Text('Dinheiro')),
                    DropdownMenuItem(value: 'PIX', child: Text('Pix')),
                    DropdownMenuItem(value: 'CREDIT', child: Text('Cartão de Crédito')),
                    DropdownMenuItem(value: 'DEBIT', child: Text('Cartão de Débito')),
                  ],
                  onChanged: (v) => setDialogState(() => selectedMethod = v!),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: selectedDestination,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Destino do Recurso',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'SELLER_HANDS', child: Text('Em mãos do Vendedor')),
                    DropdownMenuItem(value: 'COMPANY_ACCOUNT', child: Text('Conta da Empresa')),
                  ],
                  onChanged: (v) => setDialogState(() => selectedDestination = v!),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: notesController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Observações (opcional)',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981), foregroundColor: Colors.white),
              onPressed: isSubmitting
                  ? null
                  : () async {
                      final val = double.tryParse(amountController.text.replaceAll(',', '.')) ?? 0.0;
                      if (val <= 0 || val > remaining) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Valor inválido ou superior ao saldo devedor.')),
                        );
                        return;
                      }

                      setDialogState(() => isSubmitting = true);
                      try {
                        await _api.registerCreditPayment(agreement['id'], {
                          'amount': val,
                          'paymentMethod': selectedMethod,
                          'destination': selectedDestination,
                          'notes': notesController.text.trim(),
                        });
                        if (mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Pagamento registrado com sucesso!'),
                              backgroundColor: Color(0xFF10B981),
                            ),
                          );
                          _refresh();
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Erro ao registrar pagamento: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
              child: isSubmitting
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Confirmar Baixa'),
            ),
          ],
        ),
      ),
    );
  }

  void _showRenegotiateDialog(Map<String, dynamic> agreement) {
    final remaining = ((agreement['remainingPrincipalCents'] as num?)?.toDouble() ?? 0.0) / 100.0;
    int installmentsCount = 3;
    String periodicity = 'MONTHLY';
    DateTime firstDueDate = DateTime.now().add(const Duration(days: 30));
    final reasonController = TextEditingController();
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFF2A1B3D)),
          ),
          title: const Text('Renegociar Saldo em Aberto', style: TextStyle(color: Colors.white, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Saldo a renegociar: ${currencyFormat.format(remaining)}',
                  style: const TextStyle(color: Color(0xFFF59E0B), fontWeight: FontWeight.bold, fontSize: 13),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<int>(
                  value: installmentsCount,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Novo Número de Parcelas',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                  items: List.generate(24, (i) => i + 1)
                      .map((n) => DropdownMenuItem(value: n, child: Text('$n parcela(s)')))
                      .toList(),
                  onChanged: (v) => setDialogState(() => installmentsCount = v!),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: periodicity,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Periodicidade',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'MONTHLY', child: Text('Mensal (30 em 30 dias)')),
                    DropdownMenuItem(value: 'BIWEEKLY', child: Text('Quinzenal (15 em 15 dias)')),
                  ],
                  onChanged: (v) {
                    setDialogState(() {
                      periodicity = v!;
                      firstDueDate = DateTime.now().add(Duration(days: periodicity == 'BIWEEKLY' ? 15 : 30));
                    });
                  },
                ),
                const SizedBox(height: 14),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: firstDueDate,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (picked != null) {
                      setDialogState(() => firstDueDate = picked);
                    }
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Primeiro Vencimento',
                      labelStyle: TextStyle(color: Colors.white70),
                      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    ),
                    child: Text(dateFormat.format(firstDueDate), style: const TextStyle(color: Colors.white)),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: reasonController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Justificativa da Renegociação *',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFA855F7))),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.white),
              onPressed: isSubmitting
                  ? null
                  : () async {
                      if (reasonController.text.trim().isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Informe a justificativa da renegociação.')),
                        );
                        return;
                      }

                      setDialogState(() => isSubmitting = true);
                      try {
                        await _api.renegotiateCreditAgreement(agreement['id'], {
                          'newInstallmentsCount': installmentsCount,
                          'periodicity': periodicity,
                          'firstDueDate': firstDueDate.toIso8601String(),
                          'reason': reasonController.text.trim(),
                        });
                        if (mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Contrato renegociado com sucesso!'),
                              backgroundColor: Color(0xFFF59E0B),
                            ),
                          );
                          _refresh();
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Erro ao renegociar: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
              child: isSubmitting
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Salvar Renegociação'),
            ),
          ],
        ),
      ),
    );
  }

  void _showReversePaymentDialog(String paymentId, double amount) {
    final reasonController = TextEditingController();
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFFEF4444)),
          ),
          title: const Text('Estornar Recebimento', style: TextStyle(color: Color(0xFFEF4444), fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Valor a ser estornado: ${currencyFormat.format(amount)}',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
              ),
              const SizedBox(height: 10),
              const Text(
                'Esta ação recomporá o saldo devedor do contrato, reabrirá as parcelas e cancelará a comissão do vendedor.',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: reasonController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Justificativa do Estorno *',
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF2A1B3D))),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFEF4444))),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEF4444), foregroundColor: Colors.white),
              onPressed: isSubmitting
                  ? null
                  : () async {
                      if (reasonController.text.trim().isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Informe o motivo do estorno.')),
                        );
                        return;
                      }

                      setDialogState(() => isSubmitting = true);
                      try {
                        await _api.reverseCreditPayment(paymentId, reason: reasonController.text.trim());
                        if (mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Recebimento estornado com sucesso!'),
                              backgroundColor: Color(0xFFEF4444),
                            ),
                          );
                          _refresh();
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Erro ao estornar: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
              child: isSubmitting
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Confirmar Estorno'),
            ),
          ],
        ),
      ),
    );
  }
}
