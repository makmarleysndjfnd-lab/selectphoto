import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';
import '../utils/ui_helpers.dart';
import '../widgets/authenticated_image.dart';

class VisaoHistoricoVendasAdmin extends StatefulWidget {
  const VisaoHistoricoVendasAdmin({super.key});

  @override
  State<VisaoHistoricoVendasAdmin> createState() => _VisaoHistoricoVendasAdminState();
}

class _VisaoHistoricoVendasAdminState extends State<VisaoHistoricoVendasAdmin> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  List<dynamic> _sales = [];
  String _filtroTexto = '';
  DateTime? _startDate;
  DateTime? _endDate;
  final TextEditingController _searchController = TextEditingController();

  final NumberFormat _currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final DateFormat _dateFormat = DateFormat('dd/MM/yyyy HH:mm');
  final DateFormat _dateOnlyFormat = DateFormat('dd/MM/yyyy');

  @override
  void initState() {
    super.initState();
    _carregarHistorico();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _carregarHistorico() async {
    setState(() => _isLoading = true);
    try {
      final data = await _api.getSalesHistory(
        startDate: _startDate,
        endDate: _endDate,
      );
      if (mounted) {
        setState(() {
          _sales = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red.shade800,
            content: Text('Erro ao carregar histórico de vendas: $e'),
          ),
        );
      }
    }
  }

  Future<void> _pickStartDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _startDate ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      locale: const Locale('pt', 'BR'),
    );
    if (picked != null) {
      setState(() => _startDate = picked);
      _carregarHistorico();
    }
  }

  Future<void> _pickEndDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _endDate ?? _startDate ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      locale: const Locale('pt', 'BR'),
    );
    if (picked != null) {
      setState(() => _endDate = picked);
      _carregarHistorico();
    }
  }

  void _limparFiltroDatas() {
    setState(() {
      _startDate = null;
      _endDate = null;
    });
    _carregarHistorico();
  }

  bool _matchesDate(dynamic sale) {
    if (_startDate == null && _endDate == null) return true;
    final rawDate = sale['date'];
    if (rawDate == null) return false;
    final d = DateTime.tryParse(rawDate.toString())?.toLocal();
    if (d == null) return false;

    if (_startDate != null) {
      final start = DateTime(_startDate!.year, _startDate!.month, _startDate!.day, 0, 0, 0, 0);
      if (d.isBefore(start)) return false;
    }
    if (_endDate != null) {
      final end = DateTime(_endDate!.year, _endDate!.month, _endDate!.day, 23, 59, 59, 999);
      if (d.isAfter(end)) return false;
    }
    return true;
  }

  List<dynamic> get _salesFiltradas {
    return _sales.where((sale) {
      if (!_matchesDate(sale)) return false;

      if (_filtroTexto.trim().isEmpty) return true;
      final query = _filtroTexto.trim().toLowerCase();

      final client = sale['client'] as Map<String, dynamic>? ?? {};
      final clientName = (client['name'] ?? client['clientName'] ?? '').toString().toLowerCase();
      final code = (client['visibleCode'] ?? client['sequenceNumber'] ?? sale['fichaNumber'] ?? '').toString().toLowerCase();
      final city = (sale['city'] ?? client['city'] ?? '').toString().toLowerCase();
      final seller = (sale['seller']?['name'] ?? '').toString().toLowerCase();
      final batch = (client['batch']?['name'] ?? client['batchName'] ?? '').toString().toLowerCase();

      return clientName.contains(query) ||
          code.contains(query) ||
          city.contains(query) ||
          seller.contains(query) ||
          batch.contains(query);
    }).toList();
  }

  Map<String, List<Map<String, dynamic>>> get _salesGroupedBySeller {
    final map = <String, List<Map<String, dynamic>>>{};
    for (final item in _salesFiltradas) {
      final sale = item as Map<String, dynamic>;
      final rawSeller = sale['seller']?['name']?.toString().trim();
      final sellerKey = (rawSeller != null && rawSeller.isNotEmpty)
          ? rawSeller
          : 'Vendedor não identificado';
      map.putIfAbsent(sellerKey, () => []).add(sale);
    }
    return map;
  }

  List<String> get _sortedSellers {
    final keys = _salesGroupedBySeller.keys.toList();
    keys.sort((a, b) {
      if (a == 'Vendedor não identificado') return 1;
      if (b == 'Vendedor não identificado') return -1;
      return a.toLowerCase().compareTo(b.toLowerCase());
    });
    return keys;
  }

  void _abrirDetalhesVenda(Map<String, dynamic> sale) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _ModalDetalhesVenda(
        sale: sale,
        currencyFormat: _currencyFormat,
        dateFormat: _dateFormat,
      ),
    );
  }

  Widget _buildSellerGroup(String sellerName, List<Map<String, dynamic>> sales) {
    final subtotal = sales.fold<double>(
      0.0,
      (acc, s) => acc + (double.tryParse(s['value']?.toString() ?? '0') ?? 0.0),
    );
    final isUnidentified = sellerName == 'Vendedor não identificado';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF161628),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isUnidentified ? Colors.orange.withOpacity(0.35) : Colors.white.withOpacity(0.08),
        ),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: true,
          tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          leading: CircleAvatar(
            radius: 18,
            backgroundColor: isUnidentified
                ? Colors.orange.withOpacity(0.2)
                : const Color(0xFFCE93D8).withOpacity(0.2),
            child: Icon(
              isUnidentified ? Icons.help_outline_rounded : Icons.person_rounded,
              color: isUnidentified ? Colors.orange : const Color(0xFFCE93D8),
              size: 20,
            ),
          ),
          title: Text(
            sellerName,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 15,
            ),
          ),
          subtitle: Text(
            '${sales.length} ${sales.length == 1 ? 'venda realizada' : 'vendas realizadas'}',
            style: const TextStyle(color: Colors.white60, fontSize: 11),
          ),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                _currencyFormat.format(subtotal),
                style: const TextStyle(
                  color: Color(0xFF00C853),
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 2),
              const Icon(Icons.expand_more_rounded, color: Colors.white54, size: 18),
            ],
          ),
          children: [
            const Divider(color: Colors.white10, height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              child: Column(
                children: sales.map((sale) => _buildSaleCard(sale)).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _salesFiltradas;
    final sortedSellers = _sortedSellers;
    final grandTotal = filtered.fold<double>(
      0.0,
      (acc, item) => acc + (double.tryParse(item['value']?.toString() ?? '0') ?? 0.0),
    );

    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        iconTheme: const IconThemeData(color: Colors.white),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Histórico de Vendas',
              style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            Text(
              'Consultas organizadas por vendedor e período',
              style: TextStyle(color: Colors.white60, fontSize: 11),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _carregarHistorico,
          ),
        ],
      ),
      body: Column(
        children: [
          // Barra de busca por texto
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            color: const Color(0xFF151528),
            child: TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _filtroTexto = val),
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Buscar por ficha, cliente, lote, cidade ou vendedor...',
                hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
                prefixIcon: const Icon(Icons.search, color: Color(0xFFCE93D8), size: 20),
                suffixIcon: _filtroTexto.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, color: Colors.white54, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _filtroTexto = '');
                        },
                      )
                    : null,
                filled: true,
                fillColor: const Color(0xFF22223A),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),

          // Barra de filtro por período (Data Inicial e Data Final)
          Container(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            color: const Color(0xFF151528),
            child: Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: _pickStartDate,
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF22223A),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: _startDate != null ? const Color(0xFFCE93D8) : Colors.white12,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.calendar_today_rounded,
                              size: 14,
                              color: _startDate != null ? const Color(0xFFCE93D8) : Colors.white54),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _startDate != null ? 'De: ${_dateOnlyFormat.format(_startDate!)}' : 'Data inicial',
                              style: TextStyle(
                                color: _startDate != null ? Colors.white : Colors.white54,
                                fontSize: 11,
                                fontWeight: _startDate != null ? FontWeight.bold : FontWeight.normal,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: InkWell(
                    onTap: _pickEndDate,
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF22223A),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: _endDate != null ? const Color(0xFFCE93D8) : Colors.white12,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.event_available_rounded,
                              size: 14,
                              color: _endDate != null ? const Color(0xFFCE93D8) : Colors.white54),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _endDate != null ? 'Até: ${_dateOnlyFormat.format(_endDate!)}' : 'Data final',
                              style: TextStyle(
                                color: _endDate != null ? Colors.white : Colors.white54,
                                fontSize: 11,
                                fontWeight: _endDate != null ? FontWeight.bold : FontWeight.normal,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                if (_startDate != null || _endDate != null) ...[
                  const SizedBox(width: 6),
                  IconButton(
                    icon: const Icon(Icons.clear_rounded, color: Colors.white70, size: 20),
                    tooltip: 'Limpar período',
                    onPressed: _limparFiltroDatas,
                  ),
                ],
              ],
            ),
          ),

          // Totalizador geral de vendas e contadores
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFF1A1A2E),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${filtered.length} ${filtered.length == 1 ? 'venda' : 'vendas'} · ${sortedSellers.length} ${sortedSellers.length == 1 ? 'vendedor' : 'vendedores'}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                ),
                if (filtered.isNotEmpty)
                  Text(
                    'Total Geral: ${_currencyFormat.format(grandTotal)}',
                    style: const TextStyle(color: Color(0xFF00C853), fontSize: 13, fontWeight: FontWeight.bold),
                  ),
              ],
            ),
          ),

          // Lista de vendas agrupadas por vendedor
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
                : sortedSellers.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.point_of_sale_rounded, color: Colors.white24, size: 56),
                            const SizedBox(height: 12),
                            Text(
                              _filtroTexto.isEmpty && _startDate == null && _endDate == null
                                  ? 'Nenhuma venda registrada até o momento.'
                                  : 'Nenhuma venda encontrada para os filtros selecionados.',
                              style: const TextStyle(color: Colors.white54, fontSize: 14),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: sortedSellers.length,
                        itemBuilder: (context, index) {
                          final sellerKey = sortedSellers[index];
                          final sellerSales = _salesGroupedBySeller[sellerKey]!;
                          return _buildSellerGroup(sellerKey, sellerSales);
                        },
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildSaleCard(Map<String, dynamic> sale) {
    final client = sale['client'] as Map<String, dynamic>? ?? {};
    final visibleCode = client['visibleCode']?.toString();
    final seq = client['sequenceNumber']?.toString();
    final fichaNum = sale['fichaNumber']?.toString();
    final displayCode = (visibleCode != null && visibleCode.isNotEmpty)
        ? visibleCode
        : ((seq != null && seq.isNotEmpty && seq != 'S/N')
            ? seq
            : (fichaNum != null && fichaNum.isNotEmpty ? fichaNum : 'S/N'));

    final clientName = (client['name'] ?? client['clientName'] ?? 'Cliente').toString();
    final batchName = (client['batch']?['name'] ?? client['batchName'] ?? 'Lote Original').toString();
    final city = (sale['city'] ?? client['city'] ?? 'Sem Cidade').toString();
    final state = client['state']?.toString().trim();
    final locationStr = (state != null && state.isNotEmpty) ? '$city - $state' : city;
    final sellerName = (sale['seller']?['name'] ?? 'Vendedor').toString();

    final rawVal = double.tryParse(sale['value']?.toString() ?? '0') ?? 0.0;
    final formattedValue = _currencyFormat.format(rawVal);

    DateTime? saleDate;
    if (sale['date'] != null) {
      saleDate = DateTime.tryParse(sale['date'].toString());
    }
    final formattedDate = saleDate != null ? _dateFormat.format(saleDate.toLocal()) : 'Data não informada';

    final hasReceipt = (sale['receiptUrl'] != null && sale['receiptUrl'].toString().trim().isNotEmpty);
    final hasSheetPhoto = (client['sheetPhotoUrl'] != null && client['sheetPhotoUrl'].toString().trim().isNotEmpty);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.white.withOpacity(0.08)),
      ),
      child: InkWell(
        onTap: () => _abrirDetalhesVenda(sale),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Cabeçalho: Código da Ficha, Lote e Valor
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFCE93D8).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: const Color(0xFFCE93D8).withOpacity(0.4)),
                    ),
                    child: Text(
                      displayCode,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        color: Color(0xFFCE93D8),
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      batchName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  Text(
                    formattedValue,
                    style: const TextStyle(
                      color: Color(0xFF00C853),
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Cliente
              Text(
                clientName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              if (UIHelpers.formatChildren(client['children']).isNotEmpty) ...[
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(Icons.child_care, size: 12, color: Color(0xFFCE93D8)),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        (client['children'] is List && (client['children'] as List).length > 1)
                            ? 'Crianças: ${UIHelpers.formatChildren(client['children'])}'
                            : 'Criança: ${UIHelpers.formatChildren(client['children'])}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 11),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 4),

              // Cidade/UF e Vendedor
              Row(
                children: [
                  const Icon(Icons.location_on_outlined, size: 12, color: Color(0xFFFFB74D)),
                  const SizedBox(width: 3),
                  Expanded(
                    child: Text(
                      locationStr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white70, fontSize: 11),
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.person_outline, size: 12, color: Color(0xFF80DEEA)),
                  const SizedBox(width: 3),
                  Flexible(
                    child: Text(
                      sellerName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Color(0xFF80DEEA), fontSize: 11, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Divider(color: Colors.white10, height: 1),
              const SizedBox(height: 6),

              // Rodapé: Data e Indicadores de anexos
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.access_time_rounded, size: 12, color: Colors.white38),
                      const SizedBox(width: 4),
                      Text(
                        formattedDate,
                        style: const TextStyle(color: Colors.white38, fontSize: 10),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      if (hasReceipt)
                        Container(
                          margin: const EdgeInsets.only(right: 6),
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.green.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.receipt_long_rounded, color: Color(0xFF00C853), size: 11),
                              SizedBox(width: 3),
                              Text('Comprovante', style: TextStyle(color: Color(0xFF00C853), fontSize: 9)),
                            ],
                          ),
                        ),
                      if (hasSheetPhoto)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.purple.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.camera_alt_outlined, color: Color(0xFFCE93D8), size: 11),
                              SizedBox(width: 3),
                              Text('Foto Ficha', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 9)),
                            ],
                          ),
                        ),
                      const SizedBox(width: 4),
                      const Icon(Icons.chevron_right_rounded, color: Colors.white38, size: 16),
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
}

class _ModalDetalhesVenda extends StatelessWidget {
  final Map<String, dynamic> sale;
  final NumberFormat currencyFormat;
  final DateFormat dateFormat;

  const _ModalDetalhesVenda({
    required this.sale,
    required this.currencyFormat,
    required this.dateFormat,
  });

  void _abrirImagemEmZoom(BuildContext context, String url, String titulo) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(8),
        child: Stack(
          alignment: Alignment.center,
          children: [
            InteractiveViewer(
              panEnabled: true,
              minScale: 0.5,
              maxScale: 4.0,
              child: AuthenticatedImage(
                url: url,
                fit: BoxFit.contain,
              ),
            ),
            Positioned(
              top: 10,
              right: 10,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white, size: 28),
                onPressed: () => Navigator.pop(ctx),
              ),
            ),
            Positioned(
              bottom: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.black87,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  titulo,
                  style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final client = sale['client'] as Map<String, dynamic>? ?? {};
    final visibleCode = client['visibleCode']?.toString();
    final seq = client['sequenceNumber']?.toString();
    final fichaNum = sale['fichaNumber']?.toString();
    final displayCode = (visibleCode != null && visibleCode.isNotEmpty)
        ? visibleCode
        : ((seq != null && seq.isNotEmpty && seq != 'S/N')
            ? seq
            : (fichaNum != null && fichaNum.isNotEmpty ? fichaNum : 'S/N'));

    final clientName = (client['name'] ?? client['clientName'] ?? 'Cliente').toString();
    final batchName = (client['batch']?['name'] ?? client['batchName'] ?? 'Lote Original').toString();
    final city = (sale['city'] ?? client['city'] ?? 'Sem Cidade').toString();
    final state = client['state']?.toString().trim();
    final locationStr = (state != null && state.isNotEmpty) ? '$city - $state' : city;
    final sellerName = (sale['seller']?['name'] ?? 'Vendedor').toString();
    final paymentMethod = (sale['paymentMethod'] ?? 'Não informado').toString();

    final rawVal = double.tryParse(sale['value']?.toString() ?? '0') ?? 0.0;
    final formattedValue = currencyFormat.format(rawVal);

    DateTime? saleDate;
    if (sale['date'] != null) {
      saleDate = DateTime.tryParse(sale['date'].toString());
    }
    final formattedDate = saleDate != null ? dateFormat.format(saleDate.toLocal()) : 'Não informada';

    final reportNotes = (sale['reportNotes'] ?? client['notes'] ?? '').toString().trim();
    final receiptUrl = sale['receiptUrl']?.toString().trim();
    final sheetPhotoUrl = client['sheetPhotoUrl']?.toString().trim();
    final timeline = List<Map<String, dynamic>>.from(client['timeline'] ?? []);

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (_, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Color(0xFF161628),
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              // Alça de arraste
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10, bottom: 8),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Cabeçalho do modal
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFCE93D8).withOpacity(0.2),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: const Color(0xFFCE93D8)),
                      ),
                      child: Text(
                        displayCode,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          color: Color(0xFFCE93D8),
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
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
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            'Lote: $batchName',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white60, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white54),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              const Divider(color: Colors.white12, height: 1),

              // Conteúdo rolável
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.all(16),
                  children: [
                    // Dados comerciais
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1F1F35),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.white10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'DADOS DA VENDA',
                            style: TextStyle(
                              color: Color(0xFF80DEEA),
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.5,
                            ),
                          ),
                          const SizedBox(height: 10),
                          _infoRow(Icons.monetization_on_outlined, 'Valor Total', formattedValue, valueColor: const Color(0xFF00C853)),
                          _infoRow(Icons.payment_outlined, 'Forma de Pagamento', paymentMethod),
                          if (sale['payments'] != null && (sale['payments'] as List).isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Padding(
                              padding: const EdgeInsets.only(left: 28, bottom: 6),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: (sale['payments'] as List).map<Widget>((p) {
                                  final m = (p['method'] ?? '').toString();
                                  String label = m;
                                  if (m == 'CASH') label = 'Dinheiro';
                                  else if (m == 'PIX') label = 'Pix';
                                  else if (m == 'CREDIT') label = 'Cartão de Crédito';
                                  else if (m == 'DEBIT') label = 'Cartão de Débito';
                                  final amt = double.tryParse(p['amount']?.toString() ?? '0') ?? 0.0;
                                  return Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 2),
                                    child: Text(
                                      '• $label: ${currencyFormat.format(amt)}',
                                      style: const TextStyle(color: Color(0xFF80DEEA), fontSize: 12),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ),
                          ],
                          _infoRow(Icons.person_outline, 'Vendedor Responsável', sellerName),
                          _infoRow(Icons.location_on_outlined, 'Localidade', locationStr),
                          _infoRow(Icons.calendar_today_outlined, 'Data da Confirmação', formattedDate),
                          if (client['children'] != null && (client['children'] as List).isNotEmpty)
                            _infoRow(
                              Icons.child_care,
                              (client['children'] as List).length == 1 ? 'Criança' : 'Crianças',
                              UIHelpers.formatChildren(client['children']),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Relatório e notas
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1F1F35),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.white10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.notes_rounded, color: Color(0xFFFFB74D), size: 16),
                              SizedBox(width: 6),
                              Text(
                                'RELATÓRIO / OBSERVAÇÕES',
                                style: TextStyle(
                                  color: Color(0xFFFFB74D),
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            reportNotes.isNotEmpty ? reportNotes : 'Nenhuma observação ou relatório registrado.',
                            style: TextStyle(
                              color: reportNotes.isNotEmpty ? Colors.white : Colors.white38,
                              fontSize: 13,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Anexos: Comprovante e Foto da Ficha
                    const Text(
                      'DOCUMENTOS E ANEXOS',
                      style: TextStyle(
                        color: Color(0xFFCE93D8),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 10),

                    Row(
                      children: [
                        // Comprovante
                        Expanded(
                          child: _buildAttachmentCard(
                            context: context,
                            title: 'Comprovante',
                            url: receiptUrl,
                            icon: Icons.receipt_long_rounded,
                            emptyMessage: 'Sem comprovante anexado',
                          ),
                        ),
                        const SizedBox(width: 12),
                        // Foto da Ficha
                        Expanded(
                          child: _buildAttachmentCard(
                            context: context,
                            title: 'Foto da Ficha',
                            url: sheetPhotoUrl,
                            icon: Icons.camera_alt_outlined,
                            emptyMessage: 'Sem foto da ficha',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Histórico / Linha do Tempo
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1F1F35),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.white10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.history_rounded, color: Color(0xFFCE93D8), size: 16),
                              SizedBox(width: 6),
                              Text(
                                'HISTÓRICO DE EVENTOS (TIMELINE)',
                                style: TextStyle(
                                  color: Color(0xFFCE93D8),
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          if (timeline.isEmpty)
                            const Text(
                              'Nenhum evento registrado na linha do tempo.',
                              style: TextStyle(color: Colors.white38, fontSize: 12),
                            )
                          else
                            ...timeline.map((evt) {
                              final action = evt['action']?.toString() ?? 'Ação';
                              final desc = evt['description']?.toString() ?? '';
                              DateTime? evtDate;
                              if (evt['timestamp'] != null) {
                                evtDate = DateTime.tryParse(evt['timestamp'].toString());
                              }
                              final dateStr = evtDate != null ? dateFormat.format(evtDate.toLocal()) : '';

                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Padding(
                                      padding: EdgeInsets.only(top: 3),
                                      child: Icon(Icons.circle, size: 8, color: Color(0xFFCE93D8)),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            action,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                          if (desc.isNotEmpty)
                                            Text(
                                              desc,
                                              style: const TextStyle(color: Colors.white70, fontSize: 11),
                                            ),
                                          if (dateStr.isNotEmpty)
                                            Text(
                                              dateStr,
                                              style: const TextStyle(color: Colors.white38, fontSize: 10),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _infoRow(IconData icon, String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 14, color: Colors.white54),
          const SizedBox(width: 6),
          Text('$label: ', style: const TextStyle(color: Colors.white60, fontSize: 12)),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: valueColor ?? Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAttachmentCard({
    required BuildContext context,
    required String title,
    required String? url,
    required IconData icon,
    required String emptyMessage,
  }) {
    final hasImage = url != null && url.isNotEmpty;

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1F1F35),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
            child: Row(
              children: [
                Icon(icon, size: 14, color: Colors.white70),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
          if (hasImage)
            ClipRRect(
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(11)),
              child: InkWell(
                onTap: () => _abrirImagemEmZoom(context, url, title),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      height: 130,
                      width: double.infinity,
                      child: AuthenticatedImage(
                        url: url,
                        fit: BoxFit.cover,
                      ),
                    ),
                    Container(
                      height: 130,
                      color: Colors.black26,
                      child: const Center(
                        child: Icon(Icons.zoom_in_rounded, color: Colors.white70, size: 28),
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            Container(
              height: 100,
              padding: const EdgeInsets.all(8),
              alignment: Alignment.center,
              child: Text(
                emptyMessage,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white30, fontSize: 11),
              ),
            ),
        ],
      ),
    );
  }
}
