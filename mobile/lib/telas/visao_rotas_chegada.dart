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

  // "eventName|city" -> { 'eventName': String, 'city': String, 'awaiting': [...], 'inStock': [...] }
  Map<String, Map<String, dynamic>> _dadosPorEvento = {};
  List<dynamic> _sellers = [];

  // Track which cities are being confirmed (loading spinner per city)
  final Set<String> _confirmando = {};
  // Track cities already confirmed (now in_stock) to show distribute button
  final Set<String> _confirmadas = {};

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

      final clients = results[0] as List<dynamic>;
      final users = results[1] as List<dynamic>;

      final sellers = users.where((u) {
        final role = (u['role'] ?? '').toString().toUpperCase();
        // Backend usa 'VENDEDOR' (PT) e também 'SELLER' / 'SELLER_MANAGER' (EN)
        return role == 'SELLER' || role == 'SELLER_MANAGER' || role == 'VENDEDOR';
      }).toList();

      // Key: "eventName|city" -> { 'eventName': String, 'city': String, 'awaiting': [...], 'inStock': [...] }
      final Map<String, Map<String, dynamic>> agrupado = {};

      for (var c in clients) {
        final status = (c['bookStatus'] ?? '').toString();
        if (status != 'AWAITING_RELEASE' && status != 'IN_STOCK') continue;

        final city = (c['city'] ?? 'Sem Cidade').toString().trim().toUpperCase();
        final eventName = (c['eventName'] ?? c['event'] ?? c['notes'] ?? 'Produção de Fichas').toString().trim();
        final groupKey = '$eventName|$city';

        agrupado.putIfAbsent(groupKey, () => {
          'eventName': eventName,
          'city': city,
          'awaiting': <dynamic>[],
          'inStock': <dynamic>[],
        });

        if (status == 'AWAITING_RELEASE') {
          (agrupado[groupKey]!['awaiting'] as List).add(c);
        } else {
          (agrupado[groupKey]!['inStock'] as List).add(c);
        }
      }

      agrupado.removeWhere((key, data) =>
          (data['awaiting'] as List).isEmpty && (data['inStock'] as List).isEmpty);

      for (final key in agrupado.keys) {
        if ((agrupado[key]!['awaiting'] as List).isEmpty &&
            (agrupado[key]!['inStock'] as List).isNotEmpty) {
          _confirmadas.add(key);
        }
      }

      if (mounted) {
        setState(() {
          _dadosPorEvento = agrupado;
          _sellers = sellers;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Erro ao carregar rotas de chegada: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao carregar dados: $e')),
        );
      }
    }
  }

  Future<void> _confirmarChegadaGrafica(String city) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E35),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Confirmar Chegada', style: TextStyle(color: Colors.white)),
        content: Text(
          'Confirmar que as fichas de $city chegaram da gráfica?\n\nElas serão movidas para o ESTOQUE.',
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

    setState(() => _confirmando.add(city));
    try {
      final result = await _api.confirmGrafica(city);
      final count = result['count'] ?? 0;

      if (mounted) {
        final awaiting = List<dynamic>.from(_dadosPorEvento[city]?['awaiting'] ?? []);
        setState(() {
          _dadosPorEvento[city]!['inStock']!.addAll(awaiting);
          _dadosPorEvento[city]!['awaiting']!.clear();
          _confirmadas.add(city);
          _confirmando.remove(city);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF00C853),
            content: Text('✅ $count fichas de $city movidas para o Estoque!'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _confirmando.remove(city));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red,
            content: Text('Erro: $e'),
          ),
        );
      }
    }
  }

  Future<void> _distribuirParaVendedor(String city) async {
    final inStockClients = List<dynamic>.from(_dadosPorEvento[city]?['inStock'] ?? []);
    if (inStockClients.isEmpty) return;

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
                  Text(
                    '📦 Distribuir Fichas — $city',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${inStockClients.length} fichas disponíveis no estoque',
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
                              'Atribuir ${inStockClients.length} fichas de $city ao vendedor $selectedSellerName. Confirmar?',
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
                            ? 'Distribuir ${inStockClients.length} Fichas →'
                            : 'Selecione um Vendedor',
                      ),
                      onPressed: selectedSellerId == null
                          ? null
                          : () async {
                              Navigator.pop(ctx2);
                              await _executarDistribuicao(
                                city,
                                inStockClients,
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
    String city,
    List<dynamic> clients,
    String sellerId,
    String sellerName,
  ) async {
    try {
      final ids = clients.map((c) => c['id'].toString()).toList();
      await _api.batchAssignSeller(ids, sellerId);
      if (mounted) {
        setState(() {
          _dadosPorEvento.remove(city);
          _confirmadas.remove(city);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFFCE93D8),
            content: Text(
              '🚀 ${clients.length} fichas de $city distribuídas para $sellerName!',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red,
            content: Text('Erro ao distribuir: $e'),
          ),
        );
      }
    }
  }

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
            : _dadosPorEvento.isEmpty
                ? ListView(
                    children: [
                      const SizedBox(height: 80),
                      Center(
                        child: Column(
                          children: [
                            const Icon(Icons.check_circle_outline,
                                color: Color(0xFF00C853), size: 64),
                            const SizedBox(height: 16),
                            const Text(
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
                    itemCount: _dadosPorEvento.length,
                    itemBuilder: (context, index) {
                      final groupKey = _dadosPorEvento.keys.elementAt(index);
                      final data = _dadosPorEvento[groupKey]!;
                      return _buildEventCard(
                        groupKey,
                        data['eventName'] ?? 'Evento Comercial',
                        data['city'] ?? 'Sem Cidade',
                        (data['awaiting'] as List).cast<dynamic>(),
                        (data['inStock'] as List).cast<dynamic>(),
                      );
                    },
                  ),
      ),
    );
  }

  Widget _buildEventCard(
    String groupKey,
    String eventName,
    String city,
    List<dynamic> awaiting,
    List<dynamic> inStock,
  ) {
    final isConfirmando = _confirmando.contains(groupKey);
    final isConfirmada = _confirmadas.contains(groupKey);
    final totalFichas = awaiting.length + inStock.length;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Header (Nome do Evento em Destaque, Cidade abaixo)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: Color(0xFF1E1040),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
              ),
            ),
            child: Row(
              children: [
                const Icon(Icons.event, color: Color(0xFFCE93D8), size: 24),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        eventName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined, color: Color(0xFFFFB74D), size: 13),
                          const SizedBox(width: 2),
                          Text(
                            city,
                            style: const TextStyle(color: Color(0xFFFFB74D), fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white10,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '$totalFichas fichas',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),

          // ── Status badges
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Row(
              children: [
                if (awaiting.isNotEmpty) ...[
                  _statusBadge(
                    icon: Icons.local_print_shop,
                    label: '${awaiting.length} na Gráfica',
                    color: Colors.orange,
                  ),
                  const SizedBox(width: 8),
                ],
                if (inStock.isNotEmpty)
                  _statusBadge(
                    icon: Icons.inventory_2,
                    label: '${inStock.length} em Estoque',
                    color: const Color(0xFF00C853),
                  ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ── Pipeline visual
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _flowStep(
                  icon: Icons.camera_alt,
                  label: 'Fotógrafo',
                  done: true,
                  color: const Color(0xFF00C853),
                ),
                _flowArrow(),
                _flowStep(
                  icon: Icons.local_print_shop,
                  label: 'Gráfica',
                  done: isConfirmada || awaiting.isEmpty,
                  color: Colors.orange,
                ),
                _flowArrow(),
                _flowStep(
                  icon: Icons.inventory_2,
                  label: 'Estoque',
                  done: inStock.isNotEmpty,
                  color: const Color(0xFF00C853),
                ),
                _flowArrow(),
                _flowStep(
                  icon: Icons.person,
                  label: 'Vendedor',
                  done: false,
                  color: const Color(0xFFCE93D8),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),
          const Divider(color: Colors.white12, height: 1),
          const SizedBox(height: 12),

          // ── Action buttons
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (awaiting.isNotEmpty)
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.orange.shade700,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: isConfirmando
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(Icons.check_circle_outline),
                    label: Text(
                      isConfirmando
                          ? 'Confirmando...'
                          : '✅ Confirmar Chegada da Gráfica (${awaiting.length} fichas)',
                    ),
                    onPressed:
                        isConfirmando ? null : () => _confirmarChegadaGrafica(city),
                  ),
                if (awaiting.isNotEmpty && inStock.isNotEmpty)
                  const SizedBox(height: 8),
                if (inStock.isNotEmpty)
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFCE93D8),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: const Icon(Icons.send),
                    label: Text(
                      '🚀 Distribuir ${inStock.length} Fichas para Vendedor',
                    ),
                    onPressed: () => _distribuirParaVendedor(city),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBadge({
    required IconData icon,
    required String label,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 14),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
                color: color, fontSize: 12, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  Widget _flowStep({
    required IconData icon,
    required String label,
    required bool done,
    required Color color,
  }) {
    return Expanded(
      child: Column(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: done ? color.withOpacity(0.2) : Colors.white10,
              border:
                  Border.all(color: done ? color : Colors.white24, width: 1.5),
            ),
            child: Icon(icon, size: 18, color: done ? color : Colors.white38),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 10,
              color: done ? color : Colors.white38,
              fontWeight: done ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ],
      ),
    );
  }

  Widget _flowArrow() {
    return const Padding(
      padding: EdgeInsets.only(bottom: 18),
      child: Icon(Icons.arrow_forward_ios, size: 12, color: Colors.white24),
    );
  }
}
