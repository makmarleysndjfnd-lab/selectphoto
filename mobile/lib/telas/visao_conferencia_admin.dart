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
  Map<String, dynamic>? _summary;
  String? _selectedSellerId;
  String _selectedFilter = 'ALL'; // ALL, DIVERGENT, CONFIRMED, SKIPPED, PENDING

  final NumberFormat _currencyFormat =
      NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final DateFormat _dateFormat = DateFormat('dd/MM/yyyy HH:mm');

  // Controladores de justificativa por ID de venda
  final Map<String, TextEditingController> _resolutionControllers = {};
  final Set<String> _resolvingSales = {};
  final Set<String> _unblockingSellers = {};
  final Map<String, String> _selectedActions = {};
  final Map<String, bool> _selectedSellerBlock = {};

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
        groupBy: 'seller',
        hasDivergence: hasDivergence,
        isSkipped: isSkipped,
        status: status,
      );

      final groupsList = (res['sellerGroups'] as List<dynamic>?) ??
          (res['groups'] as List<dynamic>?) ??
          [];
      final summaryMap = res['summary'] is Map
          ? Map<String, dynamic>.from(res['summary'] as Map)
          : null;
      setState(() {
        _groups = groupsList;
        _summary = summaryMap;
        if (_selectedSellerId != null &&
            !groupsList.any((g) =>
                (g is Map && g['seller'] is Map
                    ? g['seller']['sellerId']?.toString()
                    : null) ==
                _selectedSellerId)) {
          _selectedSellerId = null;
        }
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Falha ao carregar conferências: $e';
      });
    }
  }

  Future<void> _concluirRevisao(String saleId, {int? divergenceCents}) async {
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

    final action = _selectedActions[saleId] ?? 'RESOLVED_NOTES_ONLY';
    final sellerBlocked = _selectedSellerBlock[saleId] ?? false;

    setState(() => _resolvingSales.add(saleId));

    try {
      await _api.resolveBuyerConfirmationReview(
        saleId,
        resolutionNotes: notes,
        action: action,
        divergenceDeductionCents:
            action == 'DEDUCT_COMMISSION' ? divergenceCents : null,
        sellerBlocked: sellerBlocked,
        sellerBlockedReason: sellerBlocked ? notes : null,
      );
      controller?.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            action == 'DEDUCT_COMMISSION'
                ? 'Revisão concluída! Abatimento de comissão registrado no lote.'
                : 'Revisão concluída com sucesso!',
          ),
          backgroundColor: const Color(0xFF10B981),
        ),
      );
      _carregarConferencias();
    } catch (e) {
      if (!mounted) return;
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

  Future<void> _showUnblockSellerDialog(
      String sellerId, String sellerName) async {
    final reasonController = TextEditingController();
    bool isSubmitting = false;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFFA855F7), width: 1.2),
          ),
          title: Text(
            'Desbloquear $sellerName',
            style: const TextStyle(
                color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Libera novamente o vendedor para realizar vendas após a conferência administrativa. A justificativa fica gravada na auditoria.',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reasonController,
                maxLines: 3,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Justificativa de desbloqueio *',
                  labelStyle: TextStyle(color: Colors.white70),
                  hintText: 'Ex.: Divergência esclarecida com o cliente e lote ajustado...',
                  hintStyle: TextStyle(color: Colors.white30, fontSize: 12),
                  filled: true,
                  fillColor: Color(0xFF0D0714),
                  enabledBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.white24),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Color(0xFFA855F7)),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: isSubmitting ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar',
                  style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFA855F7),
                foregroundColor: Colors.white,
              ),
              onPressed: isSubmitting
                  ? null
                  : () async {
                      final reason = reasonController.text.trim();
                      if (reason.length < 5) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                                'Informe uma justificativa com pelo menos 5 caracteres.'),
                            backgroundColor: Colors.red,
                          ),
                        );
                        return;
                      }
                      setDialogState(() => isSubmitting = true);
                      setState(() => _unblockingSellers.add(sellerId));
                      try {
                        await _api.unblockSeller(sellerId, reason: reason);
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                        }
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                  'Vendedor desbloqueado e trilha auditada!'),
                              backgroundColor: Color(0xFF10B981),
                            ),
                          );
                          await _carregarConferencias();
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Erro ao desbloquear: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                        }
                      } finally {
                        if (mounted) {
                          setState(() => _unblockingSellers.remove(sellerId));
                        }
                      }
                    },
              icon: isSubmitting
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.lock_open_rounded, size: 16),
              label: Text(isSubmitting ? 'Liberando...' : 'Desbloquear'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const bgColor = Color(0xFF0D0714);
    const cardColor = Color(0xFF160D24);
    const accentNeonPurple = Color(0xFFA855F7);

    final selectedGroup = _selectedSellerId == null
        ? null
        : _groups.cast<Map<String, dynamic>?>().firstWhere(
              (g) => g?['seller']?['sellerId']?.toString() == _selectedSellerId,
              orElse: () => null,
            );
    final selectedSellerName =
        selectedGroup?['seller']?['sellerName']?.toString() ?? 'Vendedor';

    return PopScope(
      canPop: selectedGroup == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && selectedGroup != null) {
          setState(() => _selectedSellerId = null);
        }
      },
      child: Scaffold(
        backgroundColor: bgColor,
        appBar: AppBar(
          backgroundColor: cardColor,
          elevation: 0,
          leading: selectedGroup != null
              ? IconButton(
                  icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                  onPressed: () => setState(() => _selectedSellerId = null),
                )
              : null,
          title: Text(
            selectedGroup != null
                ? 'Conferência · $selectedSellerName'
                : 'Conferência e Auditoria (QR)',
            style: const TextStyle(
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
            if (selectedGroup == null && _summary != null && !_isLoading && _errorMessage == null)
              _buildOverallSummaryBanner(_summary!),
            Expanded(
              child: _isLoading
                  ? const Center(
                      child: CircularProgressIndicator(color: accentNeonPurple))
                  : _errorMessage != null
                      ? _buildErrorView()
                      : selectedGroup != null
                          ? _buildSellerDetailView(selectedGroup)
                          : _groups.isEmpty
                              ? _buildEmptyView()
                              : _buildSellerCardsList(),
            ),
          ],
        ),
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
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
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

  Widget _buildOverallSummaryBanner(Map<String, dynamic> summary) {
    final total = (summary['total'] as num?)?.toInt() ?? 0;
    final divergentCount = (summary['divergentCount'] as num?)?.toInt() ?? 0;
    final avgRating = summary['averageRating'];
    final ratedCount = (summary['ratedCount'] as num?)?.toInt() ?? 0;
    final contactAvg = summary['contactAverageRating'];
    final contactRatedCount = (summary['contactRatedCount'] as num?)?.toInt() ?? 0;
    final photogAvg = summary['photographerAverageRating'];
    final photogRatedCount = (summary['photographerRatedCount'] as num?)?.toInt() ?? 0;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      color: const Color(0xFF160D24),
      child: Wrap(
        spacing: 8,
        runSpacing: 6,
        children: [
          _badge('$total conferência(s)', const Color(0xFFA855F7), Icons.qr_code_2_rounded),
          if (divergentCount > 0)
            _badge('$divergentCount divergência(s)', const Color(0xFFEF4444), Icons.warning_rounded),
          _badge(
            avgRating != null ? 'Vendedor $avgRating ($ratedCount)' : 'Vendedor s/ aval.',
            const Color(0xFFFBBF24),
            Icons.star_rounded,
          ),
          if (contactRatedCount > 0 && contactAvg != null)
            _badge(
              'Contato $contactAvg ($contactRatedCount)',
              const Color(0xFF38BDF8),
              Icons.star_rounded,
            ),
          if (photogRatedCount > 0 && photogAvg != null)
            _badge(
              'Fotógrafo $photogAvg ($photogRatedCount)',
              const Color(0xFF10B981),
              Icons.star_rounded,
            ),
        ],
      ),
    );
  }

  Widget _buildSellerCardsList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _groups.length,
      itemBuilder: (context, index) {
        final group = Map<String, dynamic>.from(_groups[index] as Map);
        final seller = Map<String, dynamic>.from(
            (group['seller'] as Map?) ?? <String, dynamic>{});
        final sellerId = seller['sellerId']?.toString() ?? 'SEM_VENDEDOR';
        final sellerName =
            seller['sellerName']?.toString() ?? 'Vendedor não identificado';
        final sellerBlocked = seller['sellerBlocked'] == true;
        final totalCount = (seller['totalCount'] as num?)?.toInt() ??
            ((group['confirmations'] as List?)?.length ?? 0);
        final divergentCount = (seller['divergentCount'] as num?)?.toInt() ?? 0;
        final confirmedCount = (seller['confirmedCount'] as num?)?.toInt() ?? 0;
        final pendingCount = (seller['pendingCount'] as num?)?.toInt() ?? 0;
        final skippedCount = (seller['skippedCount'] as num?)?.toInt() ?? 0;
        final avgRating = seller['averageRating'];
        final ratedCount = (seller['ratedCount'] as num?)?.toInt() ?? 0;

        return InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => setState(() => _selectedSellerId = sellerId),
          child: Container(
            margin: const EdgeInsets.only(bottom: 14),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF160D24),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: divergentCount > 0
                    ? const Color(0xFFEF4444).withOpacity(0.55)
                    : const Color(0xFFA855F7).withOpacity(0.35),
                width: divergentCount > 0 ? 1.4 : 1.0,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 20,
                      backgroundColor: divergentCount > 0
                          ? const Color(0xFFEF4444).withOpacity(0.2)
                          : const Color(0xFFA855F7).withOpacity(0.22),
                      child: Icon(
                        Icons.person_rounded,
                        color: divergentCount > 0
                            ? const Color(0xFFEF4444)
                            : const Color(0xFFA855F7),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            sellerName,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '$totalCount ${totalCount == 1 ? 'venda conferida/emitida' : 'vendas conferidas/emitidas'}',
                            style: const TextStyle(
                                color: Colors.white54, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 9, vertical: 5),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFBBF24).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                            color: const Color(0xFFFBBF24).withOpacity(0.4)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.star_rounded,
                              size: 14, color: Color(0xFFFBBF24)),
                          const SizedBox(width: 4),
                          Text(
                            avgRating != null
                                ? '$avgRating ($ratedCount)'
                                : 'S/ aval.',
                            style: const TextStyle(
                              color: Color(0xFFFBBF24),
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Icon(Icons.chevron_right_rounded,
                        color: Colors.white54),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (divergentCount > 0)
                      _badge(
                        '$divergentCount Divergência(s)',
                        const Color(0xFFEF4444),
                        Icons.warning_rounded,
                      ),
                    if (confirmedCount > 0)
                      _badge(
                        '$confirmedCount Confirmada(s)',
                        const Color(0xFF10B981),
                        Icons.check_circle_rounded,
                      ),
                    if (pendingCount > 0)
                      _badge(
                        '$pendingCount Pendente(s)',
                        const Color(0xFF00E5FF),
                        Icons.hourglass_top,
                      ),
                    if (skippedCount > 0)
                      _badge(
                        '$skippedCount Pulado(s)',
                        const Color(0xFFF59E0B),
                        Icons.skip_next_rounded,
                      ),
                    if (sellerBlocked)
                      _badge(
                        'Bloqueado Preventivamente',
                        const Color(0xFFEF4444),
                        Icons.block,
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSellerDetailView(Map<String, dynamic> group) {
    final seller = Map<String, dynamic>.from(
        (group['seller'] as Map?) ?? <String, dynamic>{});
    final confirmations = (group['confirmations'] as List<dynamic>?) ?? [];
    final sellerId = seller['sellerId']?.toString() ?? '';
    final sellerName = seller['sellerName']?.toString() ?? 'Vendedor';
    final sellerBlocked = seller['sellerBlocked'] == true;
    final avgRating = seller['averageRating'];
    final ratedCount = (seller['ratedCount'] as num?)?.toInt() ?? 0;

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: confirmations.length + 1,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        if (index == 0) {
          return Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF221638),
              borderRadius: BorderRadius.circular(14),
              border:
                  Border.all(color: const Color(0xFFA855F7).withOpacity(0.35)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      sellerName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    _badge(
                      avgRating != null
                          ? 'Média $avgRating ($ratedCount aval.)'
                          : 'Sem avaliações',
                      const Color(0xFFFBBF24),
                      Icons.star_rounded,
                    ),
                    if (sellerBlocked)
                      _badge('Vendedor Bloqueado', const Color(0xFFEF4444),
                          Icons.block),
                  ],
                ),
                if (sellerBlocked && sellerId.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _unblockingSellers.contains(sellerId)
                        ? null
                        : () => _showUnblockSellerDialog(sellerId, sellerName),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFE9D5FF),
                      side: const BorderSide(color: Color(0xFFA855F7)),
                    ),
                    icon: const Icon(Icons.lock_open_rounded, size: 16),
                    label: const Text('Desbloquear Vendedor',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ],
              ],
            ),
          );
        }
        final item =
            Map<String, dynamic>.from(confirmations[index - 1] as Map);
        return _buildConfirmationCard(item);
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
    final responsibleSellerName = (item['sellerName'] ??
            item['sale']?['seller']?['name'] ??
            'Vendedor não identificado')
        .toString();
    final clientDisplayName =
        (item['clientName'] ?? item['sale']?['client']?['name'])?.toString();
    final fichaDisplayCode = (item['fichaCode'] ??
            item['sale']?['fichaNumber'] ??
            item['sale']?['client']?['visibleCode'])
        ?.toString();

    final sellerTotal = seller?['totalBrl'] != null
        ? _currencyFormat.format(seller!['totalBrl'])
        : '---';
    final sellerPaid = seller?['paidBrl'] != null
        ? _currencyFormat.format(seller!['paidBrl'])
        : '---';
    final sellerMethodRaw = seller?['paymentMethod']?.toString();
    final sellerMethod = seller?['paymentMethodLabel']?.toString() ??
        _translateMethodPt(sellerMethodRaw);

    final buyerTotal = buyer?['totalBrl'] != null
        ? _currencyFormat.format(buyer!['totalBrl'])
        : 'Não informado';
    final buyerPaid = buyer?['paidBrl'] != null
        ? _currencyFormat.format(buyer!['paidBrl'])
        : 'Não informado';
    final buyerMethodRaw = buyer?['paymentMethod']?.toString();
    final buyerMethod = buyer?['paymentMethodLabel']?.toString() ??
        _translateMethodPt(buyerMethodRaw);

    final suspectedSelfScan = item['suspectedSelfScan'] == true;
    final selfScanReason = item['selfScanReason']?.toString();
    final serviceRating = (item['serviceRating'] as num?)?.toInt();
    final contactRating = (item['contactRating'] as num?)?.toInt();
    final photographerRating = (item['photographerRating'] as num?)?.toInt();
    final contactName = item['contactName']?.toString();
    final photographerName = item['photographerName']?.toString();
    final opBatch = item['operationalBatch'] as Map<String, dynamic>?;
    final batchName = opBatch?['batchName']?.toString();

    int? calculatedDivergenceCents;
    if (item['differences'] != null &&
        item['differences']['totalDifferenceCents'] != null) {
      calculatedDivergenceCents =
          (item['differences']['totalDifferenceCents'] as num).abs().toInt();
    } else if (seller?['totalBrl'] != null && buyer?['totalBrl'] != null) {
      final diff =
          ((seller!['totalBrl'] as num) - (buyer!['totalBrl'] as num)).abs();
      calculatedDivergenceCents = (diff * 100).round();
    }
    final divergenceBrlFormatted = calculatedDivergenceCents != null
        ? _currencyFormat.format(calculatedDivergenceCents / 100)
        : null;

    final currentAction = _selectedActions[saleId] ?? 'RESOLVED_NOTES_ONLY';
    final currentSellerBlocked = _selectedSellerBlock[saleId] ?? false;

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
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 4,
            children: [
              Text(
                'Venda: ${saleId.length > 8 ? saleId.substring(0, 8).toUpperCase() : saleId}',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  if (serviceRating != null && serviceRating >= 1 && serviceRating <= 5)
                    _badge('Vend: $serviceRating/5', const Color(0xFFFBBF24), Icons.star_rounded),
                  if (contactRating != null && contactRating >= 1 && contactRating <= 5)
                    _badge('Contato: $contactRating/5', const Color(0xFF38BDF8), Icons.star_rounded),
                  if (photographerRating != null && photographerRating >= 1 && photographerRating <= 5)
                    _badge('Foto: $photographerRating/5', const Color(0xFF10B981), Icons.star_rounded),
                  if (suspectedSelfScan)
                    _badge('Auto-scan suspeito', const Color(0xFFF59E0B),
                        Icons.fingerprint),
                  statusBadge,
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: const Color(0xFF160D24),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFA855F7).withOpacity(0.25)),
            ),
            child: Wrap(
              spacing: 12,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.person_rounded,
                        color: Color(0xFFCE93D8), size: 15),
                    const SizedBox(width: 5),
                    Text(
                      'Vendedor: $responsibleSellerName',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                if (clientDisplayName != null && clientDisplayName.isNotEmpty)
                  Text(
                    'Cliente: $clientDisplayName${fichaDisplayCode != null && fichaDisplayCode.isNotEmpty ? ' ($fichaDisplayCode)' : ''}',
                    style: const TextStyle(color: Colors.white70, fontSize: 11),
                  ),
                if (batchName != null && batchName.isNotEmpty)
                  Text(
                    'Lote: $batchName',
                    style: const TextStyle(color: Color(0xFFD8B4FE), fontSize: 11),
                  ),
                if (contactName != null && contactName.isNotEmpty)
                  Text(
                    'Contato: $contactName',
                    style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 11),
                  ),
                if (photographerName != null && photographerName.isNotEmpty)
                  Text(
                    'Fotógrafo: $photographerName',
                    style: const TextStyle(color: Color(0xFF10B981), fontSize: 11),
                  ),
              ],
            ),
          ),
          if (suspectedSelfScan) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withOpacity(0.12),
                borderRadius: BorderRadius.circular(8),
                border:
                    Border.all(color: const Color(0xFFF59E0B).withOpacity(0.5)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.fingerprint,
                      color: Color(0xFFF59E0B), size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'ALERTA: Suspeita de Auto-escaneamento',
                          style: TextStyle(
                            color: Color(0xFFFBBF24),
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          selfScanReason ??
                              'O mesmo dispositivo/IP validou compras de múltiplos clientes deste vendedor ou lote.',
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),

          // Tabela Lado a Lado (Vendedor vs Cliente)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: const BoxDecoration(
              color: Color(0xFF160D24),
              borderRadius: BorderRadius.all(Radius.circular(10)),
            ),
            child: Column(
              children: [
                const Row(
                  children: [
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
                      _translateDivergenceSummaryPt(
                        item['divergenceSummary']?.toString(),
                        item['divergenceReasonLabels'] as List<dynamic>?,
                        reasons,
                      ),
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
                      Expanded(
                        child: Text(
                          'Revisão Concluída por ${resolution['resolvedByName'] ?? 'Admin'}${resolution['resolvedAt'] != null ? ' em ${_dateFormat.format(DateTime.tryParse(resolution['resolvedAt'].toString()) ?? DateTime.now())}' : ''}',
                          style: const TextStyle(
                              color: Color(0xFF10B981),
                              fontSize: 12,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Vendedor responsável: $responsibleSellerName',
                    style: const TextStyle(color: Colors.white70, fontSize: 11),
                  ),
                  const SizedBox(height: 4),
                  if (item['commissionDeductionApplied'] == true) ...[
                    Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEF4444).withOpacity(0.2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.money_off,
                              size: 13, color: Color(0xFFFCA5A5)),
                          const SizedBox(width: 6),
                          Text(
                            'Abatimento no Lote: ${item['commissionDeductedBrl'] != null ? _currencyFormat.format(item['commissionDeductedBrl']) : '---'}',
                            style: const TextStyle(
                                color: Color(0xFFFCA5A5),
                                fontSize: 11,
                                fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    if (item['auditedReferenceBrl'] != null)
                      Text(
                        'Valor de Referência Auditado: ${_currencyFormat.format(item['auditedReferenceBrl'])}',
                        style: const TextStyle(
                            color: Colors.white70, fontSize: 11),
                      ),
                  ] else ...[
                    const Text(
                      'Desfecho: Encerrado apenas com observações',
                      style: TextStyle(color: Colors.white70, fontSize: 11),
                    ),
                  ],
                  if (item['sellerBlockedAtResolution'] == true ||
                      item['sellerBlocked'] == true) ...[
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEF4444).withOpacity(0.25),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            item['sellerBlocked'] == true
                                ? Icons.block
                                : Icons.verified_user_rounded,
                            size: 13,
                            color: item['sellerBlocked'] == true
                                ? const Color(0xFFEF4444)
                                : const Color(0xFF10B981),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            item['sellerBlocked'] == true
                                ? 'Vendedor Bloqueado Preventivamente'
                                : 'Vendedor Desbloqueado após Auditoria',
                            style: TextStyle(
                                color: item['sellerBlocked'] == true
                                    ? const Color(0xFFEF4444)
                                    : const Color(0xFF10B981),
                                fontSize: 10,
                                fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    if (item['sellerBlocked'] == true &&
                        (item['sellerId'] ?? item['sale']?['sellerId']) != null) ...[
                      const SizedBox(height: 6),
                      Builder(
                        builder: (context) {
                          final sellerId = (item['sellerId'] ?? item['sale']?['sellerId']).toString();
                          final sellerName = (item['sellerName'] ?? item['sale']?['seller']?['name'] ?? 'Vendedor').toString();
                          final isUnblocking = _unblockingSellers.contains(sellerId);
                          return Align(
                            alignment: Alignment.centerLeft,
                            child: OutlinedButton.icon(
                              onPressed: isUnblocking
                                  ? null
                                  : () => _showUnblockSellerDialog(sellerId, sellerName),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(0xFFE9D5FF),
                                side: const BorderSide(color: Color(0xFFA855F7)),
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                visualDensity: VisualDensity.compact,
                              ),
                              icon: isUnblocking
                                  ? const SizedBox(
                                      width: 12,
                                      height: 12,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2, color: Color(0xFFA855F7)),
                                    )
                                  : const Icon(Icons.lock_open_rounded,
                                      size: 14, color: Color(0xFFA855F7)),
                              label: Text(
                                isUnblocking ? 'Liberando...' : 'Desbloquear Vendedor',
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ],
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
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Desfecho Operacional da Revisão:',
                  style: TextStyle(
                    color: Color(0xFFA855F7),
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 6),
                InkWell(
                  onTap: () {
                    setState(() {
                      _selectedActions[saleId] = 'RESOLVED_NOTES_ONLY';
                    });
                  },
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: currentAction == 'RESOLVED_NOTES_ONLY'
                          ? const Color(0xFFA855F7).withOpacity(0.18)
                          : const Color(0xFF160D24),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: currentAction == 'RESOLVED_NOTES_ONLY'
                            ? const Color(0xFFA855F7)
                            : Colors.white12,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          currentAction == 'RESOLVED_NOTES_ONLY'
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          color: currentAction == 'RESOLVED_NOTES_ONLY'
                              ? const Color(0xFFA855F7)
                              : Colors.white38,
                          size: 16,
                        ),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            'Encerrar apenas com justificativa (sem abatimento)',
                            style: TextStyle(color: Colors.white, fontSize: 11),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                InkWell(
                  onTap: () {
                    setState(() {
                      _selectedActions[saleId] = 'DEDUCT_COMMISSION';
                    });
                  },
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: currentAction == 'DEDUCT_COMMISSION'
                          ? const Color(0xFFEF4444).withOpacity(0.18)
                          : const Color(0xFF160D24),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: currentAction == 'DEDUCT_COMMISSION'
                            ? const Color(0xFFEF4444)
                            : Colors.white12,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          currentAction == 'DEDUCT_COMMISSION'
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          color: currentAction == 'DEDUCT_COMMISSION'
                              ? const Color(0xFFEF4444)
                              : Colors.white38,
                          size: 16,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            divergenceBrlFormatted != null
                                ? 'Abater divergência de $divergenceBrlFormatted na comissão do lote'
                                : 'Abater divergência na comissão do lote',
                            style: TextStyle(
                              color: currentAction == 'DEDUCT_COMMISSION'
                                  ? const Color(0xFFFCA5A5)
                                  : Colors.white,
                              fontSize: 11,
                              fontWeight: currentAction == 'DEDUCT_COMMISSION'
                                  ? FontWeight.bold
                                  : FontWeight.normal,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                InkWell(
                  onTap: () {
                    setState(() {
                      _selectedSellerBlock[saleId] = !currentSellerBlocked;
                    });
                  },
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: currentSellerBlocked
                          ? const Color(0xFFEF4444).withOpacity(0.12)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: currentSellerBlocked
                            ? const Color(0xFFEF4444).withOpacity(0.5)
                            : Colors.white12,
                      ),
                    ),
                    child: Row(
                      children: [
                        Checkbox(
                          value: currentSellerBlocked,
                          activeColor: const Color(0xFFEF4444),
                          onChanged: (val) {
                            setState(() {
                              _selectedSellerBlock[saleId] = val ?? false;
                            });
                          },
                          materialTapTargetSize:
                              MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                        ),
                        const SizedBox(width: 4),
                        const Expanded(
                          child: Text(
                            'Bloquear vendedor preventivamente para novas vendas/lotes',
                            style: TextStyle(
                              color: Color(0xFFFCA5A5),
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: resolutionCtrl,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  decoration: InputDecoration(
                    hintText:
                        'Justificativa auditada (mínimo 5 caracteres)...',
                    hintStyle:
                        const TextStyle(color: Colors.white38, fontSize: 12),
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
                  onPressed: isResolving
                      ? null
                      : () => _concluirRevisao(
                            saleId,
                            divergenceCents: calculatedDivergenceCents,
                          ),
                  icon: isResolving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.check, size: 16),
                  label: const Text('Concluir Revisão (Admin)',
                      style: TextStyle(
                          fontSize: 12, fontWeight: FontWeight.bold)),
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

  String _translateMethodPt(String? raw) {
    final upper = (raw ?? '').trim().toUpperCase();
    if (upper.isEmpty) return '---';
    const map = {
      'CASH': 'Dinheiro',
      'DINHEIRO': 'Dinheiro',
      'PIX': 'Pix',
      'CREDIT': 'Cartão de Crédito',
      'CREDIT_CARD': 'Cartão de Crédito',
      'DEBIT': 'Cartão de Débito',
      'DEBIT_CARD': 'Cartão de Débito',
      'SPLIT': 'Pagamento Misto',
      'CREDIT_AGREEMENT': 'Crediário',
      'CREDIARIO': 'Crediário',
      'BOLETO': 'Crediário',
    };
    return map[upper] ?? raw!.trim();
  }

  String _translateDivergenceSummaryPt(
    String? rawSummary,
    List<dynamic>? reasonLabels,
    List<dynamic> reasonCodes,
  ) {
    if (rawSummary == null || rawSummary.trim().isEmpty) {
      if (reasonLabels != null && reasonLabels.isNotEmpty) {
        return reasonLabels.map((e) => e.toString()).join(', ');
      }
      return 'Divergência detectada entre os relatos.';
    }
    var translated = rawSummary;
    const replacements = {
      'TOTAL_MISMATCH': 'Divergência no valor total',
      'PAID_MISMATCH': 'Divergência no valor pago no ato',
      'PAYMENT_METHOD_MISMATCH': 'Divergência na forma de pagamento',
      'CREDIT_REMAINING_MISMATCH': 'Divergência no saldo restante do crediário',
      'CREDIT_INSTALLMENTS_COUNT_MISMATCH': 'Divergência na quantidade de parcelas',
      'CREDIT_INSTALLMENT_AMOUNT_MISMATCH': 'Divergência no valor da parcela',
      'SPLIT_TOTAL_MISMATCH': 'Divergência na soma do pagamento misto',
      'CREDIT_AGREEMENT': 'Crediário',
      'CREDIARIO': 'Crediário',
      'CREDIT_CARD': 'Cartão de Crédito',
      'DEBIT_CARD': 'Cartão de Débito',
      'CREDIT': 'Cartão de Crédito',
      'DEBIT': 'Cartão de Débito',
      'CASH': 'Dinheiro',
      'SPLIT': 'Pagamento Misto',
    };
    replacements.forEach((k, v) {
      translated = translated.replaceAll(RegExp('\\b$k\\b'), v);
    });
    return translated;
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

