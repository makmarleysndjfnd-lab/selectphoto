import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class TelaMeusVales extends StatefulWidget {
  const TelaMeusVales({super.key});

  @override
  State<TelaMeusVales> createState() => _TelaMeusValesState();
}

class _TelaMeusValesState extends State<TelaMeusVales> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _data;

  static const Color _bgDark = Color(0xFF0B131E);
  static const Color _cardDark = Color(0xFF111C2D);
  static const Color _cyan = Color(0xFF00E5FF);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final res = await _api.getMyAdvances();
      if (!mounted) return;
      setState(() {
        _data = res;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  String _fmtCents(int cents) {
    return NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$')
        .format(cents / 100.0);
  }

  String _categoryLabel(String category) {
    switch (category.toUpperCase()) {
      case 'CLOSING_SHORTFALL':
        return 'Pendência de Fechamento';
      case 'PERSONAL_ADVANCE':
        return 'Vale Pessoal';
      case 'ROUTE_ADVANCE':
        return 'Adiantamento de Rota / Viagem';
      case 'ADJUSTMENT_DIVERGENCE':
        return 'Divergência / Ajuste';
      case 'TRIP_EVENT_ADVANCE':
        return 'Adiantamento Viagem / Evento';
      case 'ROUTE_EXPENSE':
        return 'Despesa / Custeio em Rota';
      case 'SETTLEMENT':
        return 'Abatimento / Quitação';
      default:
        return category;
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = (_data?['summary'] as Map?) ?? {};
    final companyCfg = (_data?['companyConfig'] as Map?) ?? {};
    final entries = (_data?['entries'] as List?) ?? [];

    final openCents =
        int.tryParse((summary['totalOpenCents'] ?? 0).toString()) ?? 0;
    final debitsCents =
        int.tryParse((summary['totalDebitsCents'] ?? 0).toString()) ?? 0;
    final creditsCents =
        int.tryParse((summary['totalCreditsCents'] ?? 0).toString()) ?? 0;
    final hasAlert = summary['hasAlert'] == true;
    final pixKey = (companyCfg['companyPixKey'] ?? '').toString().trim();
    final pixType = (companyCfg['companyPixKeyType'] ?? '').toString().trim();
    final df = DateFormat('dd/MM/yyyy HH:mm');

    return Scaffold(
      backgroundColor: _bgDark,
      appBar: AppBar(
        backgroundColor: _cardDark,
        title: const Text(
          'Meus Vales / Pendências',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: _cyan),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _cyan),
            onPressed: _load,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: _cyan,
        backgroundColor: _cardDark,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: _cyan))
            : _error != null
                ? ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const Icon(Icons.error_outline,
                          color: Colors.redAccent, size: 46),
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white70),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: _cardDark,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: hasAlert
                                ? const Color(0xFFEF4444)
                                : _cyan.withOpacity(0.5),
                            width: 1.4,
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text(
                                  'SALDO DEVEDOR ATUAL',
                                  style: TextStyle(
                                    color: Color(0xFF4FC3F7),
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.9,
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: _cyan.withOpacity(0.14),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Text(
                                    'Somente Leitura',
                                    style: TextStyle(
                                        color: _cyan,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _fmtCents(openCents),
                              style: TextStyle(
                                color: hasAlert
                                    ? const Color(0xFFEF4444)
                                    : (openCents > 0
                                        ? const Color(0xFFF59E0B)
                                        : const Color(0xFF22C55E)),
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Total de vales: ${_fmtCents(debitsCents)} · Total abatido: ${_fmtCents(creditsCents)}',
                              style: const TextStyle(
                                  color: Colors.white70, fontSize: 12),
                            ),
                            if (pixKey.isNotEmpty) ...[
                              const Divider(color: Colors.white12, height: 22),
                              Row(
                                children: [
                                  const Icon(Icons.pix, color: _cyan, size: 16),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      'Pix da Empresa${pixType.isNotEmpty ? ' ($pixType)' : ''}: $pixKey',
                                      style: const TextStyle(
                                          color: Colors.white, fontSize: 12),
                                    ),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.copy,
                                        color: _cyan, size: 16),
                                    onPressed: () {
                                      Clipboard.setData(
                                          ClipboardData(text: pixKey));
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(
                                        const SnackBar(
                                            content: Text('Pix copiado!')),
                                      );
                                    },
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      const Text(
                        'LINHA DO TEMPO DE LANÇAMENTOS',
                        style: TextStyle(
                          color: Color(0xFF4FC3F7),
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.9,
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (entries.isEmpty)
                        Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: _cardDark,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Text(
                            'Nenhum vale ou pendência registrado para você.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.white54),
                          ),
                        )
                      else
                        ...entries.map((raw) {
                          final e = Map<String, dynamic>.from(raw as Map);
                          final isCredit = e['direction'] == 'CREDIT';
                          final amtCents =
                              int.tryParse((e['amountCents'] ?? 0).toString()) ?? 0;
                          final dt = DateTime.tryParse(
                                  (e['createdAt'] ?? '').toString())
                              ?.toLocal();
                          final notes = (e['notes'] ?? '').toString().trim();
                          final batchName = e['batch']?['name']?.toString();
                          final color = isCredit
                              ? const Color(0xFF22C55E)
                              : const Color(0xFFF59E0B);

                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: _cardDark,
                              borderRadius: BorderRadius.circular(12),
                              border:
                                  Border.all(color: color.withOpacity(0.35)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Icon(
                                      isCredit
                                          ? Icons.arrow_downward_rounded
                                          : Icons.arrow_upward_rounded,
                                      color: color,
                                      size: 18,
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        _categoryLabel(
                                            (e['category'] ?? '').toString()),
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                    Text(
                                      '${isCredit ? '-' : '+'} ${_fmtCents(amtCents)}',
                                      style: TextStyle(
                                        color: color,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  dt != null ? df.format(dt) : '-',
                                  style: const TextStyle(
                                      color: Colors.white54, fontSize: 11),
                                ),
                                if (batchName != null && batchName.isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 2),
                                    child: Text(
                                      'Lote: $batchName',
                                      style: const TextStyle(
                                          color: _cyan, fontSize: 11),
                                    ),
                                  ),
                                if (notes.isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Text(
                                      notes,
                                      style: const TextStyle(
                                          color: Colors.white70, fontSize: 12),
                                    ),
                                  ),
                              ],
                            ),
                          );
                        }),
                    ],
                  ),
      ),
    );
  }
}
