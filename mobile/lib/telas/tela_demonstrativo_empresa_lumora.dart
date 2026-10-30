import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class TelaDemonstrativoEmpresaLumora extends StatefulWidget {
  final Future<Map<String, dynamic>> Function(String competence)? loadOverride;
  final String? initialCompetence;

  const TelaDemonstrativoEmpresaLumora({
    super.key,
    this.loadOverride,
    this.initialCompetence,
  });

  @override
  State<TelaDemonstrativoEmpresaLumora> createState() =>
      _TelaDemonstrativoEmpresaLumoraState();
}

class _TelaDemonstrativoEmpresaLumoraState
    extends State<TelaDemonstrativoEmpresaLumora> {
  final ApiService _api = ApiService();
  final NumberFormat _brl =
      NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  late String _competence;
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _payload;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _competence = widget.initialCompetence ??
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}';
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = widget.loadOverride != null
          ? await widget.loadOverride!(_competence)
          : await _api.getMyCompanyStatements(competence: _competence);
      if (mounted) {
        setState(() {
          _payload = res;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceAll('Exception: ', '');
        });
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  void _alterarMes(int deltaMeses) {
    final parts = _competence.split('-');
    if (parts.length != 2) return;
    final y = int.tryParse(parts[0]) ?? DateTime.now().year;
    final m = int.tryParse(parts[1]) ?? DateTime.now().month;
    final dt = DateTime(y, m + deltaMeses, 1);
    setState(() {
      _competence =
          '${dt.year.toString().padLeft(4, '0')}-${dt.month.toString().padLeft(2, '0')}';
    });
    _carregar();
  }

  String _formatCents(dynamic cents) {
    final c = (cents is num) ? cents.toDouble() : 0.0;
    return _brl.format(c / 100.0);
  }

  @override
  Widget build(BuildContext context) {
    final detailWrapper =
        _payload?['selectedCompetenceDetail'] as Map<String, dynamic>?;
    final isClosed = detailWrapper?['isClosed'] == true;
    final String docKey = isClosed ? 'statement' : 'preview';
    final Object? rawDoc = detailWrapper?[docKey];
    final Map<String, dynamic> doc =
        rawDoc is Map<String, dynamic> ? rawDoc : <String, dynamic>{};
    final contractStatus = doc['contractStatus']?.toString() ?? 'NOT_CONFIGURED';
    final status = doc['status']?.toString() ?? 'OPEN_PREVIEW';
    final vigencias = (doc['vigenciaBreakdown'] as List?) ?? [];
    final items = (doc['items'] as List?) ?? [];
    final sep =
        (doc['financialSeparation'] as Map<String, dynamic>?) ?? {};
    final closedHistory = (_payload?['closedHistory'] as List?) ?? [];

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        foregroundColor: Colors.white,
        title: const Text(
          'Demonstrativo Lumora (Empresa)',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _carregar,
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF38BDF8)),
            )
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.redAccent),
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    // Seletor de Competência
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.chevron_left_rounded,
                                color: Colors.white70),
                            onPressed: () => _alterarMes(-1),
                          ),
                          Column(
                            children: [
                              const Text(
                                'COMPETÊNCIA',
                                style: TextStyle(
                                  color: Color(0xFF94A3B8),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                _competence,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          IconButton(
                            icon: const Icon(Icons.chevron_right_rounded,
                                color: Colors.white70),
                            onPressed: () => _alterarMes(1),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Aviso informativo B2B (sem checkout / sem links externos)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0C4A6E).withOpacity(0.35),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: const Color(0xFF38BDF8).withOpacity(0.35)),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.shield_outlined,
                              color: Color(0xFF38BDF8), size: 20),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Consulta B2B somente-leitura: contém apenas referências de fichas, datas e valores comerciais, sem CPF, fotos ou dados de crianças. A liquidação contratual ocorre exclusivamente fora do aplicativo.',
                              style: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Card Principal de Situação e Saldo
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _buildBadge(
                                isClosed
                                    ? 'FECHADO ($status)'
                                    : (contractStatus == 'NOT_CONFIGURED' ||
                                            contractStatus ==
                                                'NOT_EFFECTIVE_IN_PERIOD'
                                        ? 'TAXA NÃO CONFIGURADA'
                                        : 'PRÉVIA EM ABERTO'),
                                isClosed
                                    ? const Color(0xFF10B981)
                                    : (contractStatus == 'NOT_CONFIGURED'
                                        ? Colors.orangeAccent
                                        : const Color(0xFF38BDF8)),
                              ),
                              if (doc['isGratuitousZero'] == true)
                                _buildBadge(
                                    'GRATUIDADE CONTRATADA (0%)', Colors.tealAccent),
                            ],
                          ),
                          const SizedBox(height: 14),
                          _buildRowValor('Vendas Confirmadas Elegíveis',
                              '${doc['eligibleSalesCount'] ?? 0} venda(s) • ${_formatCents(doc['eligibleSalesBaseCents'])}'),
                          _buildRowValor('Taxa Contratual Bruta',
                              _formatCents(doc['grossPlatformFeeCents'])),
                          _buildRowValor('Ajustes / Devoluções Proporcionais',
                              _formatCents(doc['adjustmentsCents'])),
                          const Divider(color: Colors.white12),
                          _buildRowValor(
                            'Valor Líquido Devido ao Lumora',
                            _formatCents(doc['netDueCents']),
                            destaque: true,
                          ),
                          _buildRowValor('Conciliado / Pago (Fora do App)',
                              _formatCents(doc['paidAmountCents'])),
                          _buildRowValor(
                            'Saldo Remanescente',
                            _formatCents(doc['remainingBalanceCents']),
                            destaque: true,
                            corValor: (doc['remainingBalanceCents'] ?? 0) > 0
                                ? Colors.amberAccent
                                : Colors.greenAccent,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Discriminação por Vigência Contratual no Mês
                    if (vigencias.isNotEmpty) ...[
                      const Text(
                        'Bases por Vigência Contratual no Mês',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14),
                      ),
                      const SizedBox(height: 8),
                      ...vigencias.map((v) {
                        final vm = Map<String, dynamic>.from(v as Map);
                        return Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  'Versão v${vm['version']} • ${vm['ratePercentage']}% (${vm['salesCount']} venda(s))',
                                  style: const TextStyle(
                                      color: Colors.white, fontSize: 13),
                                ),
                              ),
                              Text(
                                '${_formatCents(vm['baseCents'])} → ${_formatCents(vm['feeCents'])}',
                                style: const TextStyle(
                                  color: Color(0xFF38BDF8),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        );
                      }),
                      const SizedBox(height: 12),
                    ],

                    // Separação Financeira Estrita (4 Livros)
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Separação de Naturezas Financeiras',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 8),
                          _buildRowValor('Vendas Confirmadas da Empresa',
                              _formatCents(sep['companyConfirmedSalesCents'])),
                          _buildRowValor(
                              'Parcelas de Crediário Recebidas no Mês',
                              _formatCents(
                                  sep['companyCreditReceivedPrincipalCents'])),
                          _buildRowValor(
                              'Incidência Lumora sobre Parcelas Recebidas',
                              _formatCents(
                                  sep['lumoraFeeOnCreditInstallmentsCents'] ??
                                      0)),
                          _buildRowValor(
                              'Comissões Vendedores (20%/25% Entrada/À Vista)',
                              _formatCents(
                                  sep['sellerInitialCommissions20Or25Cents'])),
                          _buildRowValor(
                              'Comissões Vendedores (10% Principal Parcelas)',
                              _formatCents(
                                  sep['sellerInstallmentCommissions10Cents'])),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Itens Sanitizados da Competência
                    Text(
                      'Referências de Vendas da Competência (${items.length})',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 14),
                    ),
                    const SizedBox(height: 8),
                    if (items.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          'Nenhuma venda elegível apurada nesta competência.',
                          style: TextStyle(color: Colors.white54, fontSize: 13),
                        ),
                      )
                    else
                      ...items.map((raw) {
                        final it = Map<String, dynamic>.from(raw as Map);
                        return Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Ficha/Ref: ${it['saleReference']} • ${it['city']}',
                                      style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.w600,
                                          fontSize: 13),
                                    ),
                                    Text(
                                      '${it['paymentModality']} • Taxa v${it['rateVersion']} (${it['ratePercentageFormatted']})',
                                      style: const TextStyle(
                                          color: Colors.white54, fontSize: 11),
                                    ),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    _formatCents(it['saleBaseCents']),
                                    style: const TextStyle(
                                        color: Colors.white70, fontSize: 12),
                                  ),
                                  Text(
                                    'Taxa: ${_formatCents(it['calculatedFeeCents'])}',
                                    style: const TextStyle(
                                      color: Color(0xFF38BDF8),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        );
                      }),

                    if (closedHistory.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      const Text(
                        'Histórico de Competências Fechadas',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14),
                      ),
                      const SizedBox(height: 8),
                      ...closedHistory.map((h) {
                        final hm = Map<String, dynamic>.from(h as Map);
                        return ListTile(
                          tileColor: const Color(0xFF1E293B),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                          title: Text(
                            'Competência ${hm['competence']} • ${hm['status']}',
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 13),
                          ),
                          subtitle: Text(
                            'Devido: ${_formatCents(hm['netDueCents'])} | Pago: ${_formatCents(hm['paidAmountCents'])} | Saldo: ${_formatCents(hm['remainingBalanceCents'])}',
                            style: const TextStyle(
                                color: Colors.white70, fontSize: 12),
                          ),
                          onTap: () {
                            setState(() {
                              _competence = hm['competence'].toString();
                            });
                            _carregar();
                          },
                        );
                      }),
                    ],
                  ],
                ),
    );
  }

  Widget _buildBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.6)),
      ),
      child: Text(
        label,
        style:
            TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold),
      ),
    );
  }

  Widget _buildRowValor(
    String rotulo,
    String valor, {
    bool destaque = false,
    Color? corValor,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              rotulo,
              style: TextStyle(
                color: destaque ? Colors.white : Colors.white70,
                fontSize: destaque ? 13 : 12,
                fontWeight: destaque ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          Text(
            valor,
            style: TextStyle(
              color: corValor ??
                  (destaque ? const Color(0xFF38BDF8) : Colors.white),
              fontSize: destaque ? 14 : 12,
              fontWeight: destaque ? FontWeight.bold : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
