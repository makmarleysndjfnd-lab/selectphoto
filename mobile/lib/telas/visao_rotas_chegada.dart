import 'dart:async';
import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_card.dart';

class VisaoRotasChegada extends StatefulWidget {
  const VisaoRotasChegada({super.key});

  @override
  State<VisaoRotasChegada> createState() => _VisaoRotasChegadaState();
}

class _VisaoRotasChegadaState extends State<VisaoRotasChegada>
    with WidgetsBindingObserver {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  Timer? _pollTimer;
  bool _isScreenVisible = true;

  // Key: batchId
  // Value: Map containing batch details, counts, cities, and its active clients list
  Map<String, Map<String, dynamic>> _dadosPorLote = {};
  List<dynamic> _sellers = [];

  // Track which batches are confirming arrival from gráfica
  final Set<String> _confirmando = {};
  // Track which batches are currently distributing
  final Set<String> _distribuindo = {};

  // Selected client IDs per batch: batchId -> Set<clientId>
  final Map<String, Set<String>> _selectedByBatch = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadData();
    _startPolling();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _isScreenVisible = true;
      _loadData(silent: true);
    } else {
      _isScreenVisible = false;
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_isScreenVisible && mounted) {
        _loadData(silent: true);
      }
    });
  }

  Future<void> _loadData({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        _api.getBookBatches(),
        _api.getCompanyUsers(),
      ]);

      final rawBatches = List<dynamic>.from(results[0]);
      final users = List<dynamic>.from(results[1]);

      final sellers = users.where((u) {
        final role = (u['role'] ?? '').toString().toUpperCase();
        return role == 'SELLER' || role == 'SELLER_MANAGER' || role == 'VENDEDOR';
      }).toList();

      final Map<String, Map<String, dynamic>> agrupado = {};

      for (var rawBatch in rawBatches) {
        final b = Map<String, dynamic>.from(rawBatch as Map);
        final batchId = (b['id'] ?? '').toString();
        if (batchId.isEmpty) continue;

        final batchName = (b['name'] ?? 'Lote').toString().trim();
        final photographer = b['photographer'] as Map<String, dynamic>?;
        final photographerName = photographer?['name']?.toString() ?? 'Fotógrafo';
        final status = (b['status'] ?? 'CREATED').toString().toUpperCase();

        final rawClients = List<dynamic>.from(b['clients'] ?? []);
        // Exclui SOLD e REBOLO_SOLD das fichas operacionais
        final activeClients = rawClients
            .map((c) => Map<String, dynamic>.from(c as Map))
            .where((c) {
              final s = (c['bookStatus'] ?? '').toString();
              return s != 'SOLD' && s != 'REBOLO_SOLD';
            })
            .toList();

        final counts = Map<String, dynamic>.from(b['counts'] ?? {});
        final int produced = counts['produced'] ?? b['totalProduced'] ?? activeClients.length;
        final int inStock = counts['inStock'] ??
            activeClients.where((c) => c['bookStatus'] == 'IN_STOCK' || c['bookStatus'] == 'IN_STOCK_REBOLO').length;
        final int awaitingRelease = counts['awaitingRelease'] ??
            activeClients.where((c) => c['bookStatus'] == 'AWAITING_RELEASE').length;
        final int inProduction = counts['inProduction'] ??
            activeClients.where((c) => c['bookStatus'] == 'CREATED').length;
        final int distributed = counts['distributed'] ??
            activeClients.where((c) => c['bookStatus'] == 'DISTRIBUTED' || c['bookStatus'] == 'DISTRIBUTED_REBOLO' || c['bookStatus'] == 'AWAITING_RETURN').length;

        // Cidades
        final rawCities = List<dynamic>.from(b['cities'] ?? []);
        final List<String> cities = rawCities.map((c) => c.toString().trim()).where((c) => c.isNotEmpty).toSet().toList();
        if (cities.isEmpty) {
          for (var c in activeClients) {
            final city = (c['city'] ?? '').toString().trim();
            if (city.isNotEmpty && !cities.contains(city)) cities.add(city);
          }
        }
        if (cities.isEmpty && b['city'] != null && b['city'].toString().trim().isNotEmpty) {
          cities.add(b['city'].toString().trim());
        }

        agrupado[batchId] = {
          'batchId': batchId,
          'batchName': batchName,
          'photographerName': photographerName,
          'status': status,
          'totalProduced': produced,
          'inProduction': inProduction,
          'awaitingRelease': awaitingRelease,
          'inStock': inStock,
          'distributed': distributed,
          'cities': cities,
          'clients': activeClients,
        };
      }

      if (mounted) {
        setState(() {
          _dadosPorLote = agrupado;
          _sellers = sellers;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Erro ao carregar rotas da gráfica: $e');
      if (mounted && !silent) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao carregar dados: $e')),
        );
      }
    }
  }

  // ── CONFIRMAR CHEGADA DA GRÁFICA ──────────────────────────────────────────
  Future<void> _confirmarChegadaGrafica(
    String batchId,
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

    setState(() => _confirmando.add(batchId));
    try {
      final clientIds = awaitingClients.map((c) => c['id'].toString()).toList();
      final result = await _api.confirmGrafica(
        clientIds: clientIds,
      );
      final count = result['count'] ?? awaitingClients.length;

      if (mounted) {
        setState(() {
          _confirmando.remove(batchId);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF00C853),
            content: Text('✅ $count fichas do lote "$batchName" movidas para o Estoque!'),
          ),
        );
        _loadData(silent: true);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _confirmando.remove(batchId));
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
      String batchId, List<Map<String, dynamic>> inStockClients, StateSetter setModalState) {
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
              final currentSelected = _selectedByBatch[batchId] ?? {};
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
                    _selectedByBatch.putIfAbsent(batchId, () => {});
                    if (allCitySelected) {
                      _selectedByBatch[batchId]!.removeAll(ids);
                    } else {
                      _selectedByBatch[batchId]!.addAll(ids);
                    }
                  });
                  setModalState(() {});
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
      String batchId, List<Map<String, dynamic>> inStockClients, StateSetter setModalState) {
    setState(() {
      _selectedByBatch.putIfAbsent(batchId, () => {});
      final current = _selectedByBatch[batchId]!;
      final inStockIds = inStockClients.map((c) => c['id'].toString()).toSet();
      final allSelected = inStockIds.isNotEmpty && inStockIds.every((id) => current.contains(id));

      if (allSelected) {
        current.removeAll(inStockIds);
      } else {
        current.addAll(inStockIds);
      }
    });
    setModalState(() {});
  }

  // ── DISTRIBUIÇÃO PARCIAL / TOTAL ─────────────────────────────────────────
  Future<void> _distribuirSelecionadas(
      String batchId, List<Map<String, dynamic>> allClients) async {
    final selectedIds = (_selectedByBatch[batchId] ?? {}).toList();
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
      builder: (ctx2) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              padding: const EdgeInsets.all(24),
              decoration: const BoxDecoration(
                color: Color(0xFF1E1E35),
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.people_alt, color: Color(0xFFCE93D8), size: 28),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Distribuir Fichas aos Vendedores',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Text(
                              '${selectedIds.length} fichas selecionadas para entrega',
                              style: const TextStyle(color: Colors.white54, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      color: const Color(0xFF2A2A4A),
                      borderRadius: BorderRadius.circular(12),
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
                                batchId,
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
    String batchId,
    List<String> clientIds,
    String sellerId,
    String sellerName,
  ) async {
    setState(() => _distribuindo.add(batchId));
    try {
      final res = await _api.batchAssignSeller(clientIds, sellerId);
      final count = (res['count'] != null) ? res['count'] : clientIds.length;

      if (mounted) {
        setState(() {
          _distribuindo.remove(batchId);
          _selectedByBatch[batchId]?.clear();
        });

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFFCE93D8),
            content: Text(
              '🚀 $count fichas distribuídas para $sellerName com sucesso!',
            ),
          ),
        );
        _loadData(silent: true);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _distribuindo.remove(batchId));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red,
            content: Text('Erro ao distribuir: $e'),
          ),
        );
        _loadData(silent: true);
      }
    }
  }

  // ── DETALHES DO LOTE (ABERTO AO CLICAR NO CARD) ───────────────────────────
  void _abrirDetalhesLote(String batchId, Map<String, dynamic> data) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final batchName = data['batchName']?.toString() ?? 'Lote';
            final photographerName = data['photographerName']?.toString() ?? 'Fotógrafo';
            final status = data['status']?.toString() ?? 'CREATED';
            final totalProduced = data['totalProduced'] ?? 0;
            final inStock = data['inStock'] ?? 0;
            final awaitingRelease = data['awaitingRelease'] ?? 0;
            final inProduction = data['inProduction'] ?? 0;
            final distributed = data['distributed'] ?? 0;
            final List<String> cities = List<String>.from(data['cities'] ?? []);
            final List<Map<String, dynamic>> clients =
                List<Map<String, dynamic>>.from(data['clients'] ?? []);

            final awaitingClients = clients
                .where((c) => c['bookStatus'] == 'AWAITING_RELEASE')
                .toList();
            final inStockClients = clients
                .where((c) => c['bookStatus'] == 'IN_STOCK' || c['bookStatus'] == 'IN_STOCK_REBOLO')
                .toList();

            final selectedIds = _selectedByBatch[batchId] ?? {};
            final allInStockSelected = inStockClients.isNotEmpty &&
                inStockClients.every((c) => selectedIds.contains(c['id'].toString()));

            final isConfirmando = _confirmando.contains(batchId);
            final isDistribuindo = _distribuindo.contains(batchId);

            return DraggableScrollableSheet(
              initialChildSize: 0.85,
              minChildSize: 0.5,
              maxChildSize: 0.95,
              builder: (_, scrollCtrl) {
                return Container(
                  decoration: const BoxDecoration(
                    color: Color(0xFF161625),
                    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                  ),
                  child: Column(
                    children: [
                      // Handle
                      const SizedBox(height: 12),
                      Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Cabeçalho dos detalhes
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: const Color(0xFFCE93D8).withOpacity(0.15),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Icon(Icons.layers_rounded,
                                  color: Color(0xFFCE93D8), size: 26),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    batchName,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    'Fotógrafo: $photographerName · $totalProduced ficha(s) produzidas',
                                    style: const TextStyle(
                                        color: Colors.white70, fontSize: 13),
                                  ),
                                  if (cities.isNotEmpty) ...[
                                    const SizedBox(height: 2),
                                    Text(
                                      'Cidades: ${cities.join(', ')}',
                                      style: const TextStyle(
                                          color: Color(0xFFFFB74D), fontSize: 12),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.close, color: Colors.white54),
                              onPressed: () => Navigator.pop(ctx),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      const Divider(color: Colors.white12, height: 1),

                      // Conteúdo rolável
                      Expanded(
                        child: ListView(
                          controller: scrollCtrl,
                          padding: const EdgeInsets.all(20),
                          children: [
                            // Resumo de estágios
                            Row(
                              children: [
                                _buildMetricPill('Em Produção', inProduction, Colors.amberAccent),
                                const SizedBox(width: 8),
                                _buildMetricPill('Na Gráfica', awaitingRelease, const Color(0xFF4FC3F7)),
                                const SizedBox(width: 8),
                                _buildMetricPill('Em Estoque', inStock, const Color(0xFF00C853)),
                                const SizedBox(width: 8),
                                _buildMetricPill('Distribuído', distributed, const Color(0xFFCE93D8)),
                              ],
                            ),
                            const SizedBox(height: 20),

                            // Ações conforme estágio
                            if (status == 'CREATED') ...[
                              Container(
                                padding: const EdgeInsets.all(16),
                                decoration: BoxDecoration(
                                  color: Colors.amber.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: Colors.amber.withOpacity(0.4)),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(Icons.camera_alt_outlined, color: Colors.amberAccent, size: 24),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Text(
                                        'Lote em produção em campo pelo fotógrafo ($inProduction ficha(s)). As fichas ficarão disponíveis para envio à gráfica e distribuição assim que o lote for finalizado.',
                                        style: const TextStyle(color: Colors.white70, fontSize: 13),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],

                            if (awaitingClients.isNotEmpty) ...[
                              Container(
                                padding: const EdgeInsets.all(16),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF4FC3F7).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: const Color(0xFF4FC3F7).withOpacity(0.3)),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${awaitingClients.length} ficha(s) aguardando chegada da gráfica',
                                      style: const TextStyle(
                                          color: Color(0xFF4FC3F7),
                                          fontWeight: FontWeight.bold,
                                          fontSize: 14),
                                    ),
                                    const SizedBox(height: 10),
                                    SizedBox(
                                      width: double.infinity,
                                      child: ElevatedButton.icon(
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: const Color(0xFF00C853),
                                          foregroundColor: Colors.white,
                                          padding: const EdgeInsets.symmetric(vertical: 12),
                                          shape: RoundedRectangleBorder(
                                              borderRadius: BorderRadius.circular(10)),
                                        ),
                                        icon: isConfirmando
                                            ? const SizedBox(
                                                width: 16,
                                                height: 16,
                                                child: CircularProgressIndicator(
                                                    strokeWidth: 2, color: Colors.white))
                                            : const Icon(Icons.check_circle_outline),
                                        label: Text(isConfirmando
                                            ? 'Confirmando...'
                                            : 'Confirmar Chegada da Gráfica (${awaitingClients.length})'),
                                        onPressed: isConfirmando
                                            ? null
                                            : () async {
                                                await _confirmarChegadaGrafica(
                                                    batchId, batchName, awaitingClients);
                                                setModalState(() {});
                                              },
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],

                            if (inStockClients.isNotEmpty) ...[
                              Row(
                                children: [
                                  const Icon(Icons.inventory_2_rounded,
                                      color: Color(0xFF00C853), size: 18),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Estoque Disponível (${inStockClients.length})',
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15),
                                  ),
                                  const Spacer(),
                                  TextButton(
                                    onPressed: () => _toggleSelectAllInStock(
                                        batchId, inStockClients, setModalState),
                                    child: Text(
                                      allInStockSelected
                                          ? 'Desmarcar Todas'
                                          : 'Selecionar Todas',
                                      style: const TextStyle(
                                          color: Color(0xFFCE93D8), fontSize: 12),
                                    ),
                                  ),
                                  if (cities.length > 1) ...[
                                    const SizedBox(width: 4),
                                    TextButton(
                                      onPressed: () => _dialogSelecionarPorCidade(
                                          batchId, inStockClients, setModalState),
                                      child: const Text('Por Cidade',
                                          style: TextStyle(
                                              color: Color(0xFFFFB74D), fontSize: 12)),
                                    ),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 8),
                              // Lista de fichas em estoque com checkboxes
                              ...inStockClients.map((client) {
                                final id = client['id'].toString();
                                final isSelected = selectedIds.contains(id);
                                final code = client['visibleCode'] ??
                                    client['sequenceNumber'] ??
                                    'S/N';
                                final name = client['name'] ?? 'Cliente';
                                final city = client['city'] ?? 'Sem Cidade';

                                return Container(
                                  margin: const EdgeInsets.only(bottom: 6),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? const Color(0xFFCE93D8).withOpacity(0.12)
                                        : Colors.white.withOpacity(0.04),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: isSelected
                                          ? const Color(0xFFCE93D8).withOpacity(0.6)
                                          : Colors.white12,
                                    ),
                                  ),
                                  child: ListTile(
                                    dense: true,
                                    contentPadding:
                                        const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
                                    leading: Checkbox(
                                      value: isSelected,
                                      activeColor: const Color(0xFFCE93D8),
                                      onChanged: (val) {
                                        setState(() {
                                          _selectedByBatch.putIfAbsent(batchId, () => {});
                                          if (val == true) {
                                            _selectedByBatch[batchId]!.add(id);
                                          } else {
                                            _selectedByBatch[batchId]!.remove(id);
                                          }
                                        });
                                        setModalState(() {});
                                      },
                                    ),
                                    title: Text(
                                      '$code · $name',
                                      style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.w600,
                                          fontSize: 13),
                                    ),
                                    subtitle: Text(
                                      city,
                                      style: const TextStyle(
                                          color: Colors.white54, fontSize: 11),
                                    ),
                                  ),
                                );
                              }),

                              const SizedBox(height: 16),
                              SizedBox(
                                width: double.infinity,
                                child: ElevatedButton.icon(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: selectedIds.isNotEmpty
                                        ? const Color(0xFFCE93D8)
                                        : Colors.white24,
                                    foregroundColor: Colors.white,
                                    padding: const EdgeInsets.symmetric(vertical: 14),
                                    shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(12)),
                                  ),
                                  icon: isDistribuindo
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                              strokeWidth: 2, color: Colors.white))
                                      : const Icon(Icons.send_rounded),
                                  label: Text(
                                    selectedIds.isNotEmpty
                                        ? 'Distribuir ${selectedIds.length} Fichas Selecionadas →'
                                        : 'Selecione Fichas para Distribuir',
                                    style: const TextStyle(fontWeight: FontWeight.bold),
                                  ),
                                  onPressed: selectedIds.isEmpty || isDistribuindo
                                      ? null
                                      : () async {
                                          Navigator.pop(ctx);
                                          await _distribuirSelecionadas(batchId, clients);
                                        },
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  Widget _buildMetricPill(String label, int value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withOpacity(0.3)),
        ),
        child: Column(
          children: [
            Text(
              '$value',
              style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white54, fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }

  // ── STEPPER DE 4 ETAPAS COM BOLINHAS ──────────────────────────────────────
  Widget _buildStepper(String status, int producedCount, int inStockCount, int distributedCount) {
    // 4 etapas: 1. Fotógrafo, 2. Gráfica, 3. Estoque, 4. Vendedor
    final bool step1Active = status == 'CREATED';
    final bool step1Done = status != 'CREATED';

    final bool step2Active = status == 'AWAITING_RELEASE';
    final bool step2Done = status == 'IN_STOCK' || status == 'DISTRIBUTED' || inStockCount > 0 || distributedCount > 0;

    // Se há fichas no estoque central, a etapa Estoque está ativa; se todas já foram para vendedores, está concluída
    final bool step3Active = inStockCount > 0 || (status == 'IN_STOCK' && distributedCount == 0);
    final bool step3Done = (status == 'DISTRIBUTED' || distributedCount > 0) && inStockCount == 0;

    // Se há fichas com vendedores, a etapa Vendedor está ativa
    final bool step4Active = distributedCount > 0 || status == 'DISTRIBUTED';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            _buildStepDot(1, 'Fotógrafo', step1Active, step1Done),
            _buildStepLine(step1Done),
            _buildStepDot(2, 'Gráfica', step2Active, step2Done),
            _buildStepLine(step2Done),
            _buildStepDot(3, 'Estoque', step3Active, step3Done),
            _buildStepLine(step3Done || (step2Done && inStockCount == 0 && distributedCount > 0)),
            _buildStepDot(4, 'Vendedor', step4Active, false),
          ],
        ),
        const SizedBox(height: 4),
        // Contador de fichas abaixo da etapa Fotógrafo
        Row(
          children: [
            SizedBox(
              width: 64,
              child: Text(
                '$producedCount ${producedCount == 1 ? 'ficha' : 'fichas'}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFFFFB74D),
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const Spacer(),
          ],
        ),
      ],
    );
  }

  Widget _buildStepDot(int step, String label, bool isActive, bool isDone) {
    Color dotColor = Colors.white24;
    Color textColor = Colors.white38;

    if (isDone) {
      dotColor = const Color(0xFF00C853);
      textColor = Colors.white70;
    } else if (isActive) {
      dotColor = step == 1
          ? Colors.amberAccent
          : (step == 2 ? const Color(0xFF4FC3F7) : (step == 3 ? const Color(0xFF00C853) : const Color(0xFFCE93D8)));
      textColor = Colors.white;
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            color: dotColor.withOpacity(isActive || isDone ? 0.25 : 0.1),
            shape: BoxShape.circle,
            border: Border.all(color: dotColor, width: 2),
          ),
          child: Center(
            child: isDone
                ? const Icon(Icons.check, size: 12, color: Color(0xFF00C853))
                : Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                  ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: textColor,
            fontSize: 10,
            fontWeight: isActive || isDone ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }

  Widget _buildStepLine(bool isDone) {
    return Expanded(
      child: Container(
        height: 2,
        margin: const EdgeInsets.only(bottom: 16),
        color: isDone ? const Color(0xFF00C853) : Colors.white12,
      ),
    );
  }

  // ── CARD COMPACTO POR LOTE ────────────────────────────────────────────────
  Widget _buildCompactBatchCard(String batchId, Map<String, dynamic> data) {
    final batchName = data['batchName']?.toString() ?? 'Lote';
    final photographerName = data['photographerName']?.toString() ?? 'Fotógrafo';
    final status = data['status']?.toString() ?? 'CREATED';
    final totalProduced = data['totalProduced'] ?? 0;
    final inStock = data['inStock'] ?? 0;
    final distributed = data['distributed'] ?? 0;
    final List<String> cities = List<String>.from(data['cities'] ?? []);

    // Formatar cidades
    String cityIndicator;
    if (cities.isEmpty) {
      cityIndicator = 'Sem cidade';
    } else if (cities.length == 1) {
      cityIndicator = cities.first;
    } else {
      cityIndicator = '${cities.first} + ${cities.length - 1} cidades';
    }

    // Badge de status
    String statusLabel = 'Em produção';
    Color statusColor = Colors.amberAccent;
    if (status == 'AWAITING_RELEASE') {
      statusLabel = 'Na gráfica';
      statusColor = const Color(0xFF4FC3F7);
    } else if (status == 'IN_STOCK') {
      statusLabel = 'Em estoque';
      statusColor = const Color(0xFF00C853);
    } else if (status == 'DISTRIBUTED') {
      statusLabel = 'Distribuído';
      statusColor = const Color(0xFFCE93D8);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _abrirDetalhesLote(batchId, data),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top: Nome do Lote + Badge de Status
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            batchName,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              const Icon(Icons.person_outline, color: Colors.white54, size: 14),
                              const SizedBox(width: 4),
                              Text(
                                photographerName,
                                style: const TextStyle(color: Colors.white70, fontSize: 12),
                              ),
                              const SizedBox(width: 12),
                              const Icon(Icons.location_on_outlined,
                                  color: Color(0xFFFFB74D), size: 14),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  cityIndicator,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: Color(0xFFFFB74D), fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: statusColor.withOpacity(0.5)),
                      ),
                      child: Text(
                        statusLabel,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Stepper de 4 etapas
                _buildStepper(status, totalProduced, inStock, distributed),

                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: const [
                    Text(
                      'Toque para abrir detalhes e ações',
                      style: TextStyle(color: Colors.white38, fontSize: 11),
                    ),
                    SizedBox(width: 4),
                    Icon(Icons.arrow_forward_ios_rounded, color: Colors.white38, size: 12),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── BUILD PRINCIPAL ───────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Rotas da Gráfica',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            onPressed: () => _loadData(),
            tooltip: 'Atualizar',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _loadData(),
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
                              'Nenhum lote ativo em produção,\ngráfica ou estoque no momento.',
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
                      final batchId = _dadosPorLote.keys.elementAt(index);
                      final data = _dadosPorLote[batchId]!;
                      return _buildCompactBatchCard(batchId, data);
                    },
                  ),
      ),
    );
  }
}
