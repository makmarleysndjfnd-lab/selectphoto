import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class VisaoConferenciaAdmin extends StatefulWidget {
  const VisaoConferenciaAdmin({super.key});

  @override
  State<VisaoConferenciaAdmin> createState() => _VisaoConferenciaAdminState();
}

class _VisaoConferenciaAdminState extends State<VisaoConferenciaAdmin> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  String? _errorMessage;
  List<dynamic> _groups = [];
  String _selectedFilter = 'ALL'; // ALL, DIVERGENT, CONFIRMED, SKIPPED, PENDING

  final NumberFormat _currencyFormat =
      NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final DateFormat _dateFormat = DateFormat('dd/MM/yyyy HH:mm');

  // Controladores de justificativa por ID de venda
  final Map<String, TextEditingController> _resolutionControllers = {};
  final Set<String> _resolvingSales = {};

  @override
  void initState() {
    super.initState();
    _carregarConferencias();
  }

  @override
  void dispose() {
    for (final c in _resolutionControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _carregarConferencias() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      bool? hasDivergence;
      bool? isSkipped;
      String? status;

      if (_selectedFilter == 'DIVERGENT') {
        hasDivergence = true;
      } else if (_selectedFilter == 'CONFIRMED') {
        status = 'CONFIRMED';
      } else if (_selectedFilter == 'SKIPPED') {
        isSkipped = true;
      } else if (_selectedFilter == 'PENDING') {
        status = 'PENDING';
      }

      final res = await _api.listBuyerConfirmationsReview(
        groupBy: 'batch',
        hasDivergence: hasDivergence,
        isSkipped: isSkipped,
        status: status,
      );

      final groupsList = res['groups'] as List<dynamic>? ?? [];
      setState(() {
        _groups = groupsList;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Falha ao carregar conferências: $e';
      });
    }
  }

  Future<void> _concluirRevisao(String saleId) async {
    final controller = _resolutionControllers[saleId];
    final notes = controller?.text.trim() ?? '';
    if (notes.length < 5) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'A justificativa é obrigatória para concluir a revisão (mínimo 5 caracteres).'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _resolvingSales.add(saleId));

    try {
      await _api.resolveBuyerConfirmationReview(
        saleId,
        resolutionNotes: notes,
      );
      controller?.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Revisão concluída com sucesso!'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
      _carregarConferencias();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao concluir revisão: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _resolvingSales.remove(saleId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    const bgColor = Color(0xFF0D0714);
    const cardColor = Color(0xFF160D24);
    const accentNeonPurple = Color(0xFFA855F7);

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: cardColor,
        elevation: 0,
        title: const Text(
          'Conferência e Auditoria (QR)',
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: accentNeonPurple),
            onPressed: _carregarConferencias,
          ),
        ],
      ),
      body: Column(
        children: [
          _buildFilterBar(),
          Expanded(
            child: _isLoading
                ? const Center(
                    child: CircularProgressIndicator(color: accentNeonPurple))
                : _errorMessage != null
                    ? _buildErrorView()
                    : _groups.isEmpty
                        ? _buildEmptyView()
                        : _buildGroupsList(),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: const Color(0xFF160D24),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _buildFilterChip('Todos', 'ALL'),
            const SizedBox(width: 8),
            _buildFilterChip('Divergências', 'DIVERGENT', isAlert: true),
            const SizedBox(width: 8),
            _buildFilterChip('Confirmados', 'CONFIRMED'),
            const SizedBox(width: 8),
            _buildFilterChip('Convites Pulados', 'SKIPPED'),
            const SizedBox(width: 8),
            _buildFilterChip('Pendentes', 'PENDING'),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip(String label, String value, {bool isAlert = false}) {
    final isSelected = _selectedFilter == value;
    final color = isAlert ? const Color(0xFFEF4444) : const Color(0xFFA855F7);

    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      selectedColor: color.withOpacity(0.3),
      backgroundColor: const Color(0xFF221638),
      labelStyle: TextStyle(
        color: isSelected ? color : Colors.white70,
        fontSize: 12,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
      side: BorderSide(
        color: isSelected ? color : Colors.white12,
      ),
      onSelected: (selected) {
        if (selected) {
          setState(() => _selectedFilter = value);
          _carregarConferencias();
        }
      },
    );
  }

  Widget _buildEmptyView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: const [
          Icon(Icons.verified_outlined, size: 54, color: Colors.white24),
          SizedBox(height: 12),
          Text(
            'Nenhuma conferência encontrada para o filtro.',
            style: TextStyle(color: Colors.white54, fontSize: 14),
          ),
        ],
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
            const Icon(Icons.error_outline, size: 48, color: Color(0xFFEF4444)),
            const SizedBox(height: 12),
            Text(
              _errorMessage ?? 'Erro inesperado',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFA855F7)),
              onPressed: _carregarConferencias,
              child: const Text('Tentar novamente',
                  style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGroupsList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _groups.length,
      itemBuilder: (context, index) {
        final group = _groups[index] as Map<String, dynamic>;
        final batch = group['batch'] as Map<String, dynamic>?;
        final confirmations =
            (group['confirmations'] as List<dynamic>?) ?? [];

        final batchName =
            batch?['batchName']?.toString() ?? 'Sem lote vinculado';
        final city = batch?['city']?.toString();
        final photographer = batch?['photographerName']?.toString();

        return Container(
          margin: const EdgeInsets.only(bottom: 20),
          decoration: BoxDecoration(
            color: const Color(0xFF160D24),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFA855F7).withOpacity(0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Cabeçalho do Lote Operacional (BookBatch)
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFF221638),
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(15)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.folder_shared_rounded,
                        color: Color(0xFFA855F7), size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            batchName,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (city != null || photographer != null)
                            Text(
                              [
                                if (city != null) 'Cidade: $city',
                                if (photographer != null)
                                  'Fotógrafo: $photographer'
                              ].join(' • '),
                              style: const TextStyle(
                                  color: Colors.white54, fontSize: 11),
                            ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFA855F7).withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '${confirmations.length} ${confirmations.length == 1 ? 'venda' : 'vendas'}',
                        style: const TextStyle(
                            color: Color(0xFFA855F7),
                            fontSize: 11,
                            fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),

              // Lista de conferências do lote
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.all(12),
                itemCount: confirmations.length,
                separatorBuilder: (_, __) =>
                    const Divider(color: Colors.white12, height: 24),
                itemBuilder: (context, cIndex) {
                  final item = confirmations[cIndex] as Map<String, dynamic>;
                  return _buildConfirmationCard(item);
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildConfirmationCard(Map<String, dynamic> item) {
    final saleId = item['saleId']?.toString() ?? '';
    final status = item['status']?.toString() ?? 'PENDING';
    final hasDivergence = item['hasDivergence'] == true;
    final isSkipped = item['isSkipped'] == true;
    final skippedReason = item['skippedReason']?.toString();
    final seller = item['sellerDeclared'] as Map<String, dynamic>?;
    final buyer = item['buyerReported'] as Map<String, dynamic>?;
    final reasons = item['divergenceReasons'] as List<dynamic>? ?? [];
    final resolution = item['reviewResolution'] as Map<String, dynamic>?;

    final sellerTotal = seller?['totalBrl'] != null
        ? _currencyFormat.format(seller!['totalBrl'])
        : '---';
    final sellerPaid = seller?['paidBrl'] != null
        ? _currencyFormat.format(seller!['paidBrl'])
        : '---';
    final sellerMethod = seller?['paymentMethod']?.toString() ?? '---';

    final buyerTotal = buyer?['totalBrl'] != null
        ? _currencyFormat.format(buyer!['totalBrl'])
        : 'Não informado';
    final buyerPaid = buyer?['paidBrl'] != null
        ? _currencyFormat.format(buyer!['paidBrl'])
        : 'Não informado';
    final buyerMethod = buyer?['paymentMethod']?.toString() ?? '---';

    // Status badge
    Widget statusBadge;
    if (status == 'CONFIRMED') {
      statusBadge = _badge(
          'Confirmado', const Color(0xFF10B981), Icons.check_circle_rounded);
    } else if (hasDivergence) {
      statusBadge =
          _badge('Divergência', const Color(0xFFEF4444), Icons.warning_rounded);
    } else if (isSkipped) {
      statusBadge = _badge(
          'Convite Pulado (${skippedReason ?? 'Recusa/Sinal'})',
          const Color(0xFFF59E0B),
          Icons.skip_next_rounded);
    } else if (status == 'EXPIRED') {
      statusBadge = _badge('Expirado', Colors.grey, Icons.timer_off_rounded);
    } else {
      statusBadge = _badge(
          'Aguardando cliente', const Color(0xFF00E5FF), Icons.hourglass_top);
    }

    if (!_resolutionControllers.containsKey(saleId)) {
      _resolutionControllers[saleId] = TextEditingController();
    }
    final resolutionCtrl = _resolutionControllers[saleId]!;
    final isResolving = _resolvingSales.contains(saleId);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1230),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: hasDivergence
              ? const Color(0xFFEF4444).withOpacity(0.5)
              : Colors.white12,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Venda: ${saleId.length > 8 ? saleId.substring(0, 8).toUpperCase() : saleId}',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
              statusBadge,
            ],
          ),
          const SizedBox(height: 12),

          // Tabela Lado a Lado (Vendedor vs Cliente)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF160D24),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              children: [
                Row(
                  children: const [
                    Expanded(
                        flex: 3,
                        child: Text('Item',
                            style: TextStyle(
                                color: Colors.white54,
                                fontSize: 11,
                                fontWeight: FontWeight.bold))),
                    Expanded(
                        flex: 4,
                        child: Text('Vendedor',
                            style: TextStyle(
                                color: Color(0xFFCE93D8),
                                fontSize: 11,
                                fontWeight: FontWeight.bold))),
                    Expanded(
                        flex: 4,
                        child: Text('Cliente',
                            style: TextStyle(
                                color: Color(0xFF00E5FF),
                                fontSize: 11,
                                fontWeight: FontWeight.bold))),
                  ],
                ),
                const Divider(color: Colors.white12, height: 14),
                _buildComparisonRow('Total', sellerTotal, buyerTotal,
                    isMismatch: reasons.contains('TOTAL_MISMATCH')),
                const SizedBox(height: 6),
                _buildComparisonRow('Pago no ato', sellerPaid, buyerPaid,
                    isMismatch: reasons.contains('PAID_MISMATCH')),
                const SizedBox(height: 6),
                _buildComparisonRow('Forma', sellerMethod, buyerMethod,
                    isMismatch: reasons.contains('PAYMENT_METHOD_MISMATCH')),
                if (seller?['hasCreditAgreement'] == true) ...[
                  const SizedBox(height: 6),
                  _buildComparisonRow(
                    'Parcelas',
                    '${seller?['installmentsCount'] ?? 1}x',
                    buyer?['installmentsCount'] != null
                        ? '${buyer!['installmentsCount']}x'
                        : '---',
                    isMismatch:
                        reasons.contains('CREDIT_INSTALLMENTS_COUNT_MISMATCH'),
                  ),
                ],
              ],
            ),
          ),

          // Detalhes da divergência (se houver)
          if (hasDivergence) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFEF4444).withOpacity(0.12),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFEF4444).withOpacity(0.4)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.info_outline,
                      color: Color(0xFFEF4444), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      item['divergenceSummary']?.toString() ??
                          'Divergência detectada entre os relatos.',
                      style: const TextStyle(
                          color: Color(0xFFFCA5A5), fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Conclusão da Revisão (Auditada)
          const SizedBox(height: 12),
          if (resolution != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                    color: const Color(0xFF10B981).withOpacity(0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.check_circle_outline,
                          color: Color(0xFF10B981), size: 16),
                      const SizedBox(width: 6),
                      Text(
                        'Revisão Concluída por ${resolution['resolvedByName'] ?? 'Admin'}',
                        style: const TextStyle(
                            color: Color(0xFF10B981),
                            fontSize: 12,
                            fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Justificativa: ${resolution['resolutionNotes'] ?? '---'}',
                    style:
                        const TextStyle(color: Colors.white70, fontSize: 11),
                  ),
                ],
              ),
            ),
          ] else if (hasDivergence) ...[
            // Formulário para registrar conclusão da revisão
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: resolutionCtrl,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  decoration: InputDecoration(
                    hintText: 'Justificativa para concluir a revisão...',
                    hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
                    filled: true,
                    fillColor: const Color(0xFF160D24),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: Colors.white24),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide:
                          const BorderSide(color: Color(0xFFA855F7)),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                ElevatedButton.icon(
                  onPressed:
                      isResolving ? null : () => _concluirRevisao(saleId),
                  icon: isResolving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.check, size: 16),
                  label: const Text('Concluir Revisão (Admin)',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFA855F7),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildComparisonRow(String label, String v1, String v2,
      {bool isMismatch = false}) {
    final alertColor =
        isMismatch ? const Color(0xFFEF4444) : Colors.white70;

    return Row(
      children: [
        Expanded(
          flex: 3,
          child: Text(label,
              style: const TextStyle(color: Colors.white54, fontSize: 11)),
        ),
        Expanded(
          flex: 4,
          child: Text(
            v1,
            style: TextStyle(
                color: isMismatch ? const Color(0xFFFCA5A5) : Colors.white,
                fontSize: 11,
                fontWeight: isMismatch ? FontWeight.bold : FontWeight.normal),
          ),
        ),
        Expanded(
          flex: 4,
          child: Text(
            v2,
            style: TextStyle(
                color: alertColor,
                fontSize: 11,
                fontWeight: isMismatch ? FontWeight.bold : FontWeight.normal),
          ),
        ),
      ],
    );
  }

  Widget _badge(String text, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.18),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            text,
            style: TextStyle(
                color: color, fontSize: 10, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}

