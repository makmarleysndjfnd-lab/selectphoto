import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class VisaoRotasChegada extends StatefulWidget {
  const VisaoRotasChegada({super.key});

  @override
  State<VisaoRotasChegada> createState() => _VisaoRotasChegadaState();
}

class _VisaoRotasChegadaState extends State<VisaoRotasChegada> {
  final ApiService _api = ApiService();
  bool _isLoading = true;

  // Key: batchId (or 'orphan_${client.id}')
  // Value: Map containing batch details and its clients list
  Map<String, Map<String, dynamic>> _dadosPorLote = {};
  List<dynamic> _sellers = [];

  // Track which batches are confirming arrival from gráfica
  final Set<String> _confirmando = {};
  // Track which batches are currently distributing
  final Set<String> _distribuindo = {};

  // Selected client IDs per batch: batchId -> Set<clientId>
  final Map<String, Set<String>> _selectedByBatch = {};

  // Track expanded cards for batches with > 10 fichas
  final Set<String> _expandedBatches = {};

  @override
  void initState() {
    super.initState();
    _loadData();
  }


  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        _api.getAllClients(),
        _api.getCompanyUsers(),
      ]);

      final clients = List<dynamic>.from(results[0]);
      final users = List<dynamic>.from(results[1]);

      final sellers = users.where((u) {
        final role = (u['role'] ?? '').toString().toUpperCase();
        return role == 'SELLER' || role == 'SELLER_MANAGER' || role == 'VENDEDOR';
      }).toList();

      final Map<String, Map<String, dynamic>> agrupado = {};

      for (var rawClient in clients) {
        final c = Map<String, dynamic>.from(rawClient as Map);
        final status = (c['bookStatus'] ?? '').toString();

        // Ignora apenas status de produção pré-campo do fotógrafo. Fichas vendidas são incluídas para constar no histórico do lote.
        if (status == 'CREATED') continue;

        final rawBatchId = c['batchId']?.toString() ?? c['batch']?['id']?.toString();
        final rawBatchName = (c['batch']?['name'] ??
                c['batchName'] ??
                c['eventName'] ??
                c['event'] ??
                'Lote Avulso')
            .toString()
            .trim();

        final groupKey = (rawBatchId != null && rawBatchId.isNotEmpty)
            ? rawBatchId
            : 'orphan_${c['id']}';

        agrupado.putIfAbsent(groupKey, () {
          return {
            'batchId': rawBatchId,
            'batchName': rawBatchName,
            'fullName': rawBatchName,
            'clients': <Map<String, dynamic>>[],
          };
        });

        (agrupado[groupKey]!['clients'] as List<Map<String, dynamic>>).add(c);
      }

      // Exibe apenas lotes que possuem pelo menos 1 ficha ativa em gráfica ou estoque
      agrupado.removeWhere((key, data) {
        final cl = data['clients'] as List<Map<String, dynamic>>;
        final hasActive = cl.any((c) {
          final s = (c['bookStatus'] ?? '').toString();
          return s == 'AWAITING_RELEASE' || s == 'IN_STOCK';
        });
        return !hasActive;
      });

      if (mounted) {
        setState(() {
          _dadosPorLote = agrupado;
          _sellers = sellers;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Erro ao carregar rotas da gráfica: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao carregar dados: $e')),
        );
      }
    }
  }

  // ── CONFIRMAR CHEGADA DA GRÁFICA ──────────────────────────────────────────
  Future<void> _confirmarChegadaGrafica(
    String groupKey,
    String batchName,
    List<Map<String, dynamic>> awaitingClients,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E35),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Confirmar Chegada da Gráfica',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        content: Text(
          'Confirmar que as ${awaitingClients.length} fichas do lote "$batchName" chegaram da gráfica?\n\nElas serão movidas para o ESTOQUE.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF00C853),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: const Icon(Icons.check_circle_outline),
            label: const Text('Confirmar'),
            onPressed: () => Navigator.pop(ctx, true),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => _confirmando.add(groupKey));
    try {
      final clientIds = awaitingClients.map((c) => c['id'].toString()).toList();
      final result = await _api.confirmGrafica(
        clientIds: clientIds,
      );
      final count = result['count'] ?? awaitingClients.length;

      if (mounted) {
        setState(() {
          if (_dadosPorLote.containsKey(groupKey)) {
            final clients = _dadosPorLote[groupKey]!['clients'] as List<Map<String, dynamic>>;
            for (var c in clients) {
              if (clientIds.contains(c['id'].toString())) {
                c['bookStatus'] = 'IN_STOCK';
              }
            }
          }
          _confirmando.remove(groupKey);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF00C853),
            content: Text('✅ $count fichas do lote "$batchName" movidas para o Estoque!'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _confirmando.remove(groupKey));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red,
            content: Text('Erro: $e'),
          ),
        );
      }
    }
  }

  // ── SELEÇÃO POR CIDADE ────────────────────────────────────────────────────
  void _dialogSelecionarPorCidade(
      String groupKey, List<Map<String, dynamic>> inStockClients) {
    final Map<String, List<Map<String, dynamic>>> byCity = {};
    for (var c in inStockClients) {
      final city = (c['city'] ?? 'Sem Cidade').toString().trim();
      byCity.putIfAbsent(city, () => []).add(c);
    }

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E35),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Selecionar Fichas por Cidade',
            style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView(
            shrinkWrap: true,
            children: byCity.entries.map((entry) {
              final city = entry.key;
              final count = entry.value.length;
              final ids = entry.value.map((c) => c['id'].toString()).toSet();
              final currentSelected = _selectedByBatch[groupKey] ?? {};
              final allCitySelected = ids.every((id) => currentSelected.contains(id));

              return ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                leading: Icon(
                  allCitySelected ? Icons.check_box : Icons.check_box_outline_blank,
                  color: const Color(0xFFCE93D8),
                ),
                title: Text(city,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.white10,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text('$count ${count == 1 ? 'ficha' : 'fichas'}',
                      style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 12)),
                ),
                onTap: () {
                  setState(() {
                    _selectedByBatch.putIfAbsent(groupKey, () => {});
                    if (allCitySelected) {
                      _selectedByBatch[groupKey]!.removeAll(ids);
                    } else {
                      _selectedByBatch[groupKey]!.addAll(ids);
                    }
                  });
                  Navigator.pop(ctx);
                },
              );
            }).toList(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Fechar', style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
  }

  // ── SELECIONAR TODAS EM ESTOQUE ──────────────────────────────────────────
  void _toggleSelectAllInStock(
      String groupKey, List<Map<String, dynamic>> inStockClients) {
    setState(() {
      _selectedByBatch.putIfAbsent(groupKey, () => {});
      final current = _selectedByBatch[groupKey]!;
      final inStockIds = inStockClients.map((c) => c['id'].toString()).toSet();
      final allSelected = inStockIds.isNotEmpty && inStockIds.every((id) => current.contains(id));

      if (allSelected) {
        current.removeAll(inStockIds);
      } else {
        current.addAll(inStockIds);
      }
    });
  }

  // ── DISTRIBUIÇÃO PARCIAL / TOTAL ─────────────────────────────────────────
  Future<void> _distribuirSelecionadas(
      String groupKey, List<Map<String, dynamic>> allClients) async {
    final selectedIds = (_selectedByBatch[groupKey] ?? {}).toList();
    if (selectedIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: Colors.orange,
          content: Text('Selecione ao menos uma ficha em estoque para distribuir.'),
        ),
      );
      return;
    }

    String? selectedSellerId;
    String? selectedSellerName;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx2, setModalState) {
            return Container(
              decoration: const BoxDecoration(
                color: Color(0xFF1A1A2E),
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                top: 20,
                bottom: MediaQuery.of(ctx2).viewInsets.bottom + 24,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
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
                  const SizedBox(height: 20),
                  const Text(
                    '📦 Distribuir Fichas Selecionadas',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${selectedIds.length} ${selectedIds.length == 1 ? 'ficha selecionada' : 'fichas selecionadas'} para entrega',
                    style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 14),
                  ),
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.white10,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.white24),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        isExpanded: true,
                        dropdownColor: const Color(0xFF2A2A4A),
                        hint: const Text(
                          'Selecionar Vendedor',
                          style: TextStyle(color: Colors.white54),
                        ),
                        value: selectedSellerId,
                        items: _sellers.map((s) {
                          return DropdownMenuItem<String>(
                            value: s['id'].toString(),
                            child: Text(
                              s['name']?.toString() ?? 'Vendedor',
                              style: const TextStyle(color: Colors.white),
                            ),
                          );
                        }).toList(),
                        onChanged: (val) {
                          setModalState(() {
                            selectedSellerId = val;
                            selectedSellerName = _sellers.firstWhere(
                              (s) => s['id'].toString() == val,
                              orElse: () => {'name': 'Vendedor'},
                            )['name']?.toString();
                          });
                        },
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (selectedSellerId != null)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1B3A2A),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFF00C853).withOpacity(0.4)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.preview, color: Color(0xFF00C853), size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Atribuir ${selectedIds.length} fichas ao vendedor $selectedSellerName. Confirmar?',
                              style: const TextStyle(color: Colors.white70, fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: selectedSellerId != null
                            ? const Color(0xFFCE93D8)
                            : Colors.white24,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                      icon: const Icon(Icons.send),
                      label: Text(
                        selectedSellerId != null
                            ? 'Distribuir ${selectedIds.length} Fichas →'
                            : 'Selecione um Vendedor',
                      ),
                      onPressed: selectedSellerId == null
                          ? null
                          : () async {
                              Navigator.pop(ctx2);
                              await _executarDistribuicao(
                                groupKey,
                                selectedIds,
                                selectedSellerId!,
                                selectedSellerName ?? 'Vendedor',
                              );
                            },
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _executarDistribuicao(
    String groupKey,
    List<String> clientIds,
    String sellerId,
    String sellerName,
  ) async {
    setState(() => _distribuindo.add(groupKey));
    try {
      final res = await _api.batchAssignSeller(clientIds, sellerId);
      final count = (res['count'] != null) ? res['count'] : clientIds.length;

      if (mounted) {
        setState(() {
          _distribuindo.remove(groupKey);
          if (_dadosPorLote.containsKey(groupKey)) {
            final clients = _dadosPorLote[groupKey]!['clients'] as List<Map<String, dynamic>>;
            for (var c in clients) {
              if (clientIds.contains(c['id'].toString())) {
                c['bookStatus'] = 'DISTRIBUTED';
                c['assignedSeller'] = {'id': sellerId, 'name': sellerName};
                c['assignedSellerId'] = sellerId;
              }
            }
          }
          _selectedByBatch[groupKey]?.clear();
        });

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFFCE93D8),
            content: Text(
              '🚀 $count fichas distribuídas para $sellerName com sucesso!',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _distribuindo.remove(groupKey));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red,
            content: Text('Erro ao distribuir: $e'),
          ),
        );
        _loadData();
      }
    }
  }


  // ── BUILD PRINCIPAL ───────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Rotas da Gráfica', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadData,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        color: const Color(0xFFCE93D8),
        backgroundColor: const Color(0xFF1A1A2E),
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
            : _dadosPorLote.isEmpty
                ? ListView(
                    children: const [
                      SizedBox(height: 80),
                      Center(
                        child: Column(
                          children: [
                            Icon(Icons.check_circle_outline,
                                color: Color(0xFF00C853), size: 64),
                            SizedBox(height: 16),
                            Text(
                              'Nenhuma ficha aguardando\na gráfica ou no estoque!',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.white54, fontSize: 16),
                            ),
                          ],
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _dadosPorLote.length,
                    itemBuilder: (context, index) {
                      final groupKey = _dadosPorLote.keys.elementAt(index);
                      final data = _dadosPorLote[groupKey]!;
                      return _buildBatchCard(groupKey, data);
                    },
                  ),
      ),
    );
  }

  // ── CARD ÚNICO POR BATCH ID ───────────────────────────────────────────────
  Widget _buildBatchCard(String groupKey, Map<String, dynamic> data) {
    final batchId = data['batchId'] as String?;
    final batchName = data['batchName'] as String? ?? 'Lote';
    final baseCity = data['baseCity'] as String?;
    final clients = List<Map<String, dynamic>>.from(data['clients'] ?? []);

    final awaiting = clients.where((c) => c['bookStatus'] == 'AWAITING_RELEASE').toList();
    final inStock = clients.where((c) => c['bookStatus'] == 'IN_STOCK' || c['bookStatus'] == 'IN_STOCK_REBOLO').toList();
    final distributed = clients.where((c) => c['bookStatus'] == 'DISTRIBUTED' || c['bookStatus'] == 'DISTRIBUTED_REBOLO').toList();
    final sold = clients.where((c) => c['bookStatus'] == 'SOLD' || c['bookStatus'] == 'REBOLO_SOLD').toList();
    final awaitingReturn = clients.where((c) => c['bookStatus'] == 'AWAITING_RETURN').toList();

    final cities = clients
        .map((c) => (c['city'] ?? 'Sem Cidade').toString().trim())
        .where((s) => s.isNotEmpty)
        .toSet()
        .toList();

    // Ordenar alfabeticamente para exibição consistente
    cities.sort((a, b) => a.compareTo(b));

    final isConfirmando = _confirmando.contains(groupKey);
    final isDistribuindo = _distribuindo.contains(groupKey);

    final selectedIds = _selectedByBatch[groupKey] ?? {};
    final isExpanded = _expandedBatches.contains(groupKey);

    // Limit display to first 10 unless expanded
    final displayedClients = (isExpanded || clients.length <= 10)
        ? clients
        : clients.sublist(0, 10);

    final allInStockSelected = inStock.isNotEmpty &&
        inStock.every((c) => selectedIds.contains(c['id'].toString()));

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.white12,
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── CABEÇALHO DO LOTE (Nome, Total Fichas, Quantidade de Cidades)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: const BoxDecoration(
              color: Color(0xFF1E1040),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(15),
                topRight: Radius.circular(15),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    const Icon(Icons.layers_rounded, color: Color(0xFFCE93D8), size: 24),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            batchName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '$batchName · ${clients.length} ${clients.length == 1 ? 'ficha' : 'fichas'} · ${cities.length} ${cities.length == 1 ? 'cidade' : 'cidades'}',
                            style: const TextStyle(
                              color: Color(0xFF80DEEA),
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                // Resumo de Cidades
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.location_on_outlined, color: Color(0xFFFFB74D), size: 14),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        cities.isEmpty
                            ? 'Sem cidade definida'
                            : (cities.length > 1
                                ? 'Múltiplas cidades (${cities.length}): ${cities.join(', ')}'
                                : cities.first),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFFFB74D),
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // ── RASTREIO VISUAL DAS ETAPAS DO LOTE (fotografo → Gráfica → Estoque → Com vendedor)
          _buildBatchStepper(awaiting, inStock, distributed, sold, clients),

          // ── BADGES DE ESTADO OPERACIONAL DO LOTE (DISTRIBUIÇÃO PARCIAL)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (awaiting.isNotEmpty)
                  _statusBadge(
                    icon: Icons.local_print_shop,
                    label: '${awaiting.length} na Gráfica',
                    color: Colors.orange,
                  ),
                if (inStock.isNotEmpty)
                  _statusBadge(
                    icon: Icons.inventory_2,
                    label: '${inStock.length} em Estoque',
                    color: const Color(0xFF00C853),
                  ),
                if (distributed.isNotEmpty)
                  _statusBadge(
                    icon: Icons.person_pin_circle_outlined,
                    label: '${distributed.length} com Vendedor',
                    color: const Color(0xFFCE93D8),
                  ),
                if (awaitingReturn.isNotEmpty)
                  _statusBadge(
                    icon: Icons.assignment_return_outlined,
                    label: '${awaitingReturn.length} Aguard. Devolução',
                    color: Colors.amber,
                  ),
                if (sold.isNotEmpty)
                  _statusBadge(
                    icon: Icons.verified_outlined,
                    label: '${sold.length} Vendida${sold.length > 1 ? 's' : ''}',
                    color: const Color(0xFF80DEEA),
                  ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          // ── BOTÃO DE CONFIRMAR CHEGADA DA GRÁFICA (SE HOUVER PENDÊNCIAS)
          if (awaiting.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.orange.shade800,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: isConfirmando
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : const Icon(Icons.check_circle_outline),
                label: Text(
                  isConfirmando
                      ? 'Confirmando Chegada...'
                      : '✅ Confirmar Chegada da Gráfica (${awaiting.length} fichas)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                onPressed: isConfirmando
                    ? null
                    : () => _confirmarChegadaGrafica(groupKey, batchName, awaiting),
              ),
            ),

          // ── BARRA DE SELEÇÃO E DISTRIBUIÇÃO (PARA FICHAS EM ESTOQUE)
          if (inStock.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFCE93D8),
                      side: const BorderSide(color: Color(0xFFCE93D8)),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: Icon(
                      allInStockSelected ? Icons.deselect : Icons.select_all,
                      size: 16,
                    ),
                    label: Text(
                      allInStockSelected ? 'Desmarcar todas' : 'Selecionar todas (${inStock.length})',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                    onPressed: () => _toggleSelectAllInStock(groupKey, inStock),
                  ),
                  if (cities.length > 1)
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF80DEEA),
                        side: const BorderSide(color: Color(0xFF80DEEA)),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      icon: const Icon(Icons.location_city, size: 16),
                      label: const Text(
                        'Selecionar por cidade',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                      onPressed: () => _dialogSelecionarPorCidade(groupKey, inStock),
                    ),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: selectedIds.isNotEmpty
                          ? const Color(0xFFCE93D8)
                          : Colors.white24,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: isDistribuindo
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                          )
                        : const Icon(Icons.send, size: 16),
                    label: Text(
                      isDistribuindo
                          ? 'Distribuindo...'
                          : 'Distribuir selecionadas (${selectedIds.length})',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                    onPressed: (selectedIds.isEmpty || isDistribuindo)
                        ? null
                        : () => _distribuirSelecionadas(groupKey, clients),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 8),
          const Divider(color: Colors.white12, height: 1),

          // ── LISTA DE FICHAS NO PRÓPRIO CARD
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                const Icon(Icons.format_list_bulleted, color: Colors.white60, size: 16),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Fichas do Lote (${clients.length})',
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),

          ...displayedClients.map((client) {
            final cId = client['id'].toString();
            final isSelected = selectedIds.contains(cId);
            return _buildFichaRow(groupKey, client, isSelected);
          }),

          // Botão Expansor "Ver todas / Recolher" para lotes com mais de 10 fichas
          if (clients.length > 10)
            InkWell(
              onTap: () {
                setState(() {
                  if (isExpanded) {
                    _expandedBatches.remove(groupKey);
                  } else {
                    _expandedBatches.add(groupKey);
                  }
                });
              },
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.04),
                  borderRadius: const BorderRadius.only(
                    bottomLeft: Radius.circular(15),
                    bottomRight: Radius.circular(15),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                      color: const Color(0xFFCE93D8),
                      size: 20,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      isExpanded
                          ? 'Recolher lista de fichas'
                          : 'Ver todas as fichas (${clients.length} total)',
                      style: const TextStyle(
                        color: Color(0xFFCE93D8),
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ── LINHA INDIVIDUAL DA FICHA ─────────────────────────────────────────────
  Widget _buildFichaRow(
    String groupKey,
    Map<String, dynamic> client,
    bool isSelected,
  ) {
    final status = (client['bookStatus'] ?? '').toString();
    final isInStock = status == 'IN_STOCK';
    final isAwaiting = status == 'AWAITING_RELEASE';

    final visibleCode = client['visibleCode']?.toString();
    final seq = client['sequenceNumber']?.toString();
    final uuid = client['uuid']?.toString();
    final isOffline = client['isOfflinePending'] == true;
    final displayCode = (visibleCode != null && visibleCode.isNotEmpty)
        ? visibleCode
        : ((seq != null && seq.isNotEmpty && seq != 'S/N')
            ? seq
            : (uuid != null && uuid.isNotEmpty
                ? (isOffline
                    ? 'PROV-${uuid.substring(0, uuid.length >= 8 ? 8 : uuid.length).toUpperCase()}'
                    : uuid.substring(0, uuid.length >= 8 ? 8 : uuid.length).toUpperCase())
                : 'S/N'));

    final clientName =
        (client['name'] ?? client['clientName'] ?? 'Cliente').toString();
    final city = (client['city'] ?? 'Sem Cidade').toString().trim();
    final state = client['state']?.toString().trim();
    final locationStr = (state != null && state.isNotEmpty) ? '$city - $state' : city;

    final sellerName = client['assignedSeller']?['name']?.toString() ??
        client['assignedSellerName']?.toString() ??
        'Vendedor';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: isSelected
            ? const Color(0xFFCE93D8).withOpacity(0.08)
            : Colors.transparent,
        border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Caixa de seleção ou ícone indicador
          if (isInStock)
            SizedBox(
              width: 28,
              height: 28,
              child: Checkbox(
                value: isSelected,
                activeColor: const Color(0xFFCE93D8),
                onChanged: (val) {
                  setState(() {
                    _selectedByBatch.putIfAbsent(groupKey, () => {});
                    if (val == true) {
                      _selectedByBatch[groupKey]!.add(client['id'].toString());
                    } else {
                      _selectedByBatch[groupKey]!.remove(client['id'].toString());
                    }
                  });
                },
              ),
            )
          else
            SizedBox(
              width: 28,
              height: 28,
              child: Center(
                child: Icon(
                  isAwaiting ? Icons.local_print_shop_outlined : Icons.check_circle_outline,
                  size: 18,
                  color: isAwaiting ? Colors.orange : const Color(0xFFCE93D8),
                ),
              ),
            ),
          const SizedBox(width: 6),

          // Código da Ficha em fonte monoespaçada
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            decoration: BoxDecoration(
              color: Colors.white10,
              borderRadius: BorderRadius.circular(5),
              border: Border.all(color: Colors.white24),
            ),
            child: Text(
              displayCode,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontWeight: FontWeight.bold,
                fontSize: 11,
                color: Color(0xFF80DEEA),
              ),
            ),
          ),
          const SizedBox(width: 8),

          // Nome do Cliente e Cidade/UF real
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  clientName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    const Icon(
                      Icons.location_on_outlined,
                      size: 11,
                      color: Colors.white60,
                    ),
                    const SizedBox(width: 2),
                    Expanded(
                      child: Text(
                        locationStr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          color: Colors.white60,
                          fontWeight: FontWeight.normal,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),

          // Badge de Estado Atual com largura flexível para evitar overflow em telas estreitas
          Flexible(
            flex: 0,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 130),
              child: _buildItemStatusBadge(status, sellerName),
            ),
          ),
        ],
      ),
    );
  }

  // ── STEPPER VISUAL: Fotógrafo → Gráfica → Estoque → Com vendedor ─────────
  Widget _buildBatchStepper(
    List<Map<String, dynamic>> awaiting,
    List<Map<String, dynamic>> inStock,
    List<Map<String, dynamic>> distributed,
    List<Map<String, dynamic>> sold,
    List<Map<String, dynamic>> allClients,
  ) {
    // Determinação dos estados das etapas baseadas nos dados reais do backend:
    // Etapa 1: Fotógrafo (concluído se o lote existe e saiu da fase inicial de produção do fotógrafo)
    const bool step1Done = true;

    // Etapa 2: Gráfica (concluído se nenhuma ficha aguarda a gráfica e já entraram em estoque/vendedor)
    final bool step2Done = awaiting.isEmpty && (inStock.isNotEmpty || distributed.isNotEmpty || sold.isNotEmpty);
    final bool step2Active = awaiting.isNotEmpty;

    // Etapa 3: Estoque (concluído se todas já saíram do estoque para vendedor/venda; ativo se há fichas em estoque)
    final bool step3Active = inStock.isNotEmpty;
    final bool step3Done = step2Done && inStock.isEmpty && (distributed.isNotEmpty || sold.isNotEmpty);

    // Etapa 4: Com vendedor (ativo se há fichas distribuídas aos vendedores ou vendidas)
    final bool step4Active = distributed.isNotEmpty;
    final bool step4Done = (distributed.isNotEmpty || sold.isNotEmpty) && awaiting.isEmpty && inStock.isEmpty;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: _buildStepNode(
              icon: Icons.camera_alt_outlined,
              label: 'Fotógrafo',
              isCompleted: step1Done,
              isActive: false,
            ),
          ),
          _buildStepConnector(step1Done),
          Expanded(
            flex: 2,
            child: _buildStepNode(
              icon: Icons.local_print_shop_outlined,
              label: 'Gráfica',
              isCompleted: step2Done,
              isActive: step2Active,
            ),
          ),
          _buildStepConnector(step2Done),
          Expanded(
            flex: 2,
            child: _buildStepNode(
              icon: Icons.inventory_2_outlined,
              label: 'Estoque',
              isCompleted: step3Done,
              isActive: step3Active,
            ),
          ),
          _buildStepConnector(step3Done),
          Expanded(
            flex: 2,
            child: _buildStepNode(
              icon: Icons.person_pin_circle_outlined,
              label: 'Vendedor',
              isCompleted: step4Done,
              isActive: step4Active,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepConnector(bool isActive) {
    return Expanded(
      child: Container(
        height: 2,
        margin: const EdgeInsets.symmetric(horizontal: 4),
        color: isActive ? const Color(0xFF00C853) : Colors.white24,
      ),
    );
  }

  Widget _buildStepNode({
    required IconData icon,
    required String label,
    required bool isCompleted,
    required bool isActive,
  }) {
    Color circleColor;
    Color iconColor;
    Color textColor;

    if (isCompleted) {
      circleColor = const Color(0xFF00C853);
      iconColor = Colors.white;
      textColor = const Color(0xFF00C853);
    } else if (isActive) {
      circleColor = const Color(0xFFCE93D8);
      iconColor = Colors.black;
      textColor = const Color(0xFFCE93D8);
    } else {
      circleColor = Colors.white12;
      iconColor = Colors.white38;
      textColor = Colors.white38;
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: circleColor,
            shape: BoxShape.circle,
            boxShadow: isActive
                ? [
                    BoxShadow(
                      color: const Color(0xFFCE93D8).withOpacity(0.4),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    )
                  ]
                : null,
          ),
          child: Icon(
            isCompleted ? Icons.check : icon,
            size: 16,
            color: iconColor,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: textColor,
            fontSize: 10,
            fontWeight: (isActive || isCompleted) ? FontWeight.bold : FontWeight.normal,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }

  Widget _buildItemStatusBadge(String status, String sellerName) {
    if (status == 'AWAITING_RELEASE') {
      return _statusBadge(
        icon: Icons.local_print_shop,
        label: 'Na Gráfica',
        color: Colors.orange,
      );
    } else if (status == 'IN_STOCK' || status == 'IN_STOCK_REBOLO') {
      return _statusBadge(
        icon: Icons.inventory_2,
        label: 'Em Estoque',
        color: const Color(0xFF00C853),
      );
    } else if (status == 'DISTRIBUTED' || status == 'DISTRIBUTED_REBOLO') {
      return _statusBadge(
        icon: Icons.person_pin_circle_outlined,
        label: 'Com vendedor ($sellerName)',
        color: const Color(0xFFCE93D8),
      );
    } else if (status == 'SOLD' || status == 'REBOLO_SOLD') {
      return _statusBadge(
        icon: Icons.verified_outlined,
        label: 'Vendida',
        color: const Color(0xFF80DEEA),
      );
    } else if (status == 'AWAITING_RETURN') {
      return _statusBadge(
        icon: Icons.assignment_return_outlined,
        label: 'Aguard. Devolução',
        color: Colors.amber,
      );
    } else {
      return _statusBadge(
        icon: Icons.info_outline,
        label: status,
        color: Colors.white70,
      );
    }
  }

  Widget _statusBadge({
    required IconData icon,
    required String label,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 11),
          const SizedBox(width: 3),
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
