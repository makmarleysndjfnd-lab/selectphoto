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

  static String? _parseBaseCity(String name) {
    final match = RegExp(r'\(([^)]+)\)$').firstMatch(name.trim());
    if (match != null) {
      final city = match.group(1)?.trim() ?? '';
      final upper = city.toUpperCase();
      // Não deduzir de rótulos genéricos livres como "MUNDO", "GERAL", "TODOS", "PADRÃO"
      if (upper != 'MUNDO' &&
          upper != 'GERAL' &&
          upper != 'TODOS' &&
          upper != 'PADRAO' &&
          upper != 'PADRÃO' &&
          upper != 'SEM CIDADE' &&
          city.isNotEmpty) {
        return city;
      }
    }
    return null;
  }

  static String _cleanBatchName(String name) {
    final match = RegExp(r'\(([^)]+)\)$').firstMatch(name.trim());
    if (match != null) {
      final city = match.group(1)?.trim() ?? '';
      final upper = city.toUpperCase();
      if (upper != 'MUNDO' &&
          upper != 'GERAL' &&
          upper != 'TODOS' &&
          upper != 'PADRAO' &&
          upper != 'PADRÃO') {
        final cleaned = name.replaceFirst(RegExp(r'\s*\([^)]*\)\s*$'), '').trim();
        if (cleaned.isNotEmpty) return cleaned;
      }
    }
    return name.trim();
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

        // Ignora status de produção pré-campo do fotógrafo
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
          final parsedCity = _parseBaseCity(rawBatchName);
          final cleanName = _cleanBatchName(rawBatchName);

          return {
            'batchId': rawBatchId,
            'batchName': cleanName,
            'fullName': rawBatchName,
            'baseCity': parsedCity,
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

  // ── DEFINIR OU ATUALIZAR LOCALIDADE-BASE ──────────────────────────────────
  Future<void> _dialogEditarCidadeBase(String? batchId, String currentBaseCity) async {
    if (batchId == null || batchId.startsWith('orphan_')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Lote avulso não possui identificador estável para fixar base.')),
      );
      return;
    }

    final controller = TextEditingController(text: currentBaseCity);
    final newCity = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E35),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Definir Localidade-Base do Lote',
            style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Fichas de clientes com cidade diferente da localidade-base serão destacadas com o indicador "Fora da Base".',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              autofocus: true,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Cidade Base',
                labelStyle: const TextStyle(color: Color(0xFFCE93D8)),
                hintText: 'Ex: Brasília',
                hintStyle: const TextStyle(color: Colors.white30),
                filled: true,
                fillColor: Colors.white10,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
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
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFCE93D8),
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Salvar'),
          ),
        ],
      ),
    );

    if (newCity != null) {
      try {
        await _api.updateBatchBaseCity(batchId, newCity);
        _loadData();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: const Color(0xFF00C853),
              content: Text(newCity.isEmpty
                  ? 'Localidade-base removida.'
                  : 'Localidade-base definida: $newCity'),
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: Colors.red, content: Text('Erro ao atualizar: $e')),
          );
        }
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
    final inStock = clients.where((c) => c['bookStatus'] == 'IN_STOCK').toList();
    final distributed = clients.where((c) => c['bookStatus'] == 'DISTRIBUTED').toList();

    final cities = clients
        .map((c) => (c['city'] ?? 'Sem Cidade').toString().trim())
        .where((s) => s.isNotEmpty)
        .toSet();

    final hasOutsideFichas = baseCity != null &&
        baseCity.isNotEmpty &&
        clients.any((c) {
          final cCity = (c['city'] ?? '').toString().trim().toLowerCase();
          return cCity.isNotEmpty && cCity != baseCity.toLowerCase();
        });

    final showMultiCityIndicator = cities.length > 1 || hasOutsideFichas;

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
          color: showMultiCityIndicator
              ? const Color(0xFFFF9800).withOpacity(0.4)
              : Colors.white12,
          width: showMultiCityIndicator ? 1.5 : 1,
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
                    // Localidade Base Config
                    InkWell(
                      onTap: () => _dialogEditarCidadeBase(batchId, baseCity ?? ''),
                      borderRadius: BorderRadius.circular(8),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: baseCity != null ? Colors.white12 : Colors.white.withOpacity(0.05),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: baseCity != null ? const Color(0xFF80DEEA) : Colors.white24,
                            width: 0.8,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.location_city_rounded,
                              size: 13,
                              color: baseCity != null ? const Color(0xFF80DEEA) : Colors.white60,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              baseCity ?? '+ Base',
                              style: TextStyle(
                                color: baseCity != null ? const Color(0xFF80DEEA) : Colors.white70,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                // Resumo de Cidades
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.location_on_outlined, color: Color(0xFFFFB74D), size: 13),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        cities.isEmpty ? 'Sem cidade definida' : cities.join(', '),
                        maxLines: 1,
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
                // ⚠️ Indicador: Contém fichas de outras localidades
                if (showMultiCityIndicator)
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE65100).withOpacity(0.2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFF9800), width: 0.9),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.share_location_rounded, color: Color(0xFFFFB74D), size: 15),
                        SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            'Contém fichas de outras localidades',
                            style: TextStyle(
                              color: Color(0xFFFFB74D),
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),

          // ── BADGES DE ESTADO OPERACIONAL DO LOTE
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
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
                    icon: Icons.check_circle_outline,
                    label: '${distributed.length} Distribuídas',
                    color: const Color(0xFFCE93D8),
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
                Text(
                  'Fichas do Lote (${clients.length})',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),

          ...displayedClients.map((client) {
            final cId = client['id'].toString();
            final isSelected = selectedIds.contains(cId);
            return _buildFichaRow(groupKey, client, isSelected, baseCity);
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
    String? baseCity,
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

    final isOutside = baseCity != null &&
        baseCity.isNotEmpty &&
        city.toLowerCase() != baseCity.toLowerCase();

    final sellerName = client['assignedSeller']?['name']?.toString() ??
        client['assignedSellerName']?.toString() ??
        'Vendedor';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
              width: 32,
              height: 32,
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
              width: 32,
              height: 32,
              child: Center(
                child: Icon(
                  isAwaiting ? Icons.local_print_shop_outlined : Icons.check_circle_outline,
                  size: 18,
                  color: isAwaiting ? Colors.orange : const Color(0xFFCE93D8),
                ),
              ),
            ),
          const SizedBox(width: 8),

          // Código da Ficha em fonte monoespaçada
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: Colors.white10,
              borderRadius: BorderRadius.circular(6),
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
          const SizedBox(width: 10),

          // Nome do Cliente e Cidade/UF (Sem quebra letra por letra)
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  clientName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Icon(
                      Icons.location_on_outlined,
                      size: 11,
                      color: isOutside ? const Color(0xFFFFB74D) : Colors.white60,
                    ),
                    const SizedBox(width: 2),
                    Flexible(
                      child: Text(
                        locationStr,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          color: isOutside ? const Color(0xFFFFB74D) : Colors.white60,
                          fontWeight: isOutside ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                    if (isOutside) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFF9800).withOpacity(0.2),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: const Color(0xFFFF9800), width: 0.8),
                        ),
                        child: const Text(
                          'Fora da Base',
                          style: TextStyle(
                            color: Color(0xFFFFB74D),
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),

          // Badge de Estado Atual
          _buildItemStatusBadge(status, sellerName),
        ],
      ),
    );
  }

  Widget _buildItemStatusBadge(String status, String sellerName) {
    if (status == 'AWAITING_RELEASE') {
      return _statusBadge(
        icon: Icons.local_print_shop,
        label: 'Na Gráfica',
        color: Colors.orange,
      );
    } else if (status == 'IN_STOCK') {
      return _statusBadge(
        icon: Icons.inventory_2,
        label: 'Em Estoque',
        color: const Color(0xFF00C853),
      );
    } else if (status == 'DISTRIBUTED') {
      return _statusBadge(
        icon: Icons.person_pin_circle_outlined,
        label: 'Distribuída ($sellerName)',
        color: const Color(0xFFCE93D8),
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 12),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
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
