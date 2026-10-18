import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';
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
  final TextEditingController _searchController = TextEditingController();

  final NumberFormat _currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final DateFormat _dateFormat = DateFormat('dd/MM/yyyy HH:mm');

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
      final data = await _api.getSalesHistory();
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

  List<dynamic> get _salesFiltradas {
    if (_filtroTexto.trim().isEmpty) return _sales;
    final query = _filtroTexto.trim().toLowerCase();

    return _sales.where((sale) {
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

  @override
  Widget build(BuildContext context) {
    final filtered = _salesFiltradas;

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
              'Consultas de fichas vendidas e comprovantes',
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
          // Barra de busca
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
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

          // Totalizador de vendas
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFF1A1A2E),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${filtered.length} ${filtered.length == 1 ? 'venda registrada' : 'vendas registradas'}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                ),
                if (filtered.isNotEmpty)
                  Text(
                    'Total: ${_currencyFormat.format(filtered.fold<double>(0.0, (acc, item) => acc + (double.tryParse(item['value']?.toString() ?? '0') ?? 0.0)))}',
                    style: const TextStyle(color: Color(0xFF00C853), fontSize: 12, fontWeight: FontWeight.bold),
                  ),
              ],
            ),
          ),

          // Lista de vendas
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
                : filtered.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.point_of_sale_rounded, color: Colors.white24, size: 56),
                            const SizedBox(height: 12),
                            Text(
                              _filtroTexto.isEmpty
                                  ? 'Nenhuma venda registrada até o momento.'
                                  : 'Nenhuma venda encontrada para "$_filtroTexto".',
                              style: const TextStyle(color: Colors.white54, fontSize: 14),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: filtered.length,
                        itemBuilder: (context, index) {
                          final sale = filtered[index] as Map<String, dynamic>;
                          return _buildSaleCard(sale);
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
                          _infoRow(Icons.person_outline, 'Vendedor Responsável', sellerName),
                          _infoRow(Icons.location_on_outlined, 'Localidade', locationStr),
                          _infoRow(Icons.calendar_today_outlined, 'Data da Confirmação', formattedDate),
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
