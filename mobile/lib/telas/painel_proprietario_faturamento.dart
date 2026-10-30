import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class _DialogControllerDisposer extends StatefulWidget {
  final List<TextEditingController> controllers;
  final Widget child;

  const _DialogControllerDisposer({
    required this.controllers,
    required this.child,
  });

  @override
  State<_DialogControllerDisposer> createState() =>
      _DialogControllerDisposerState();
}

class _DialogControllerDisposerState extends State<_DialogControllerDisposer> {
  @override
  void dispose() {
    for (final c in widget.controllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class PainelProprietarioFaturamentoAuditoriaCustos extends StatefulWidget {
  final Future<Map<String, dynamic>> Function(String competence)?
      loadStatementsOverride;
  final Future<Map<String, dynamic>> Function(String competence)?
      loadCostsOverride;
  final Future<Map<String, dynamic>> Function(String? category)?
      loadAuditOverride;
  final Future<Map<String, dynamic>> Function()? loadAlertsOverride;
  final String? initialCompetence;

  const PainelProprietarioFaturamentoAuditoriaCustos({
    super.key,
    this.loadStatementsOverride,
    this.loadCostsOverride,
    this.loadAuditOverride,
    this.loadAlertsOverride,
    this.initialCompetence,
  });

  @override
  State<PainelProprietarioFaturamentoAuditoriaCustos> createState() =>
      _PainelProprietarioFaturamentoAuditoriaCustosState();
}

class _PainelProprietarioFaturamentoAuditoriaCustosState
    extends State<PainelProprietarioFaturamentoAuditoriaCustos>
    with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  final NumberFormat _brl =
      NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  late TabController _tabController;
  late String _competence;

  bool _loading = false;
  String? _error;

  String? _stepUpToken;
  DateTime? _stepUpExpiresAt;

  Map<String, dynamic>? _statementsOverview;
  Map<String, dynamic>? _costsPanel;
  Map<String, dynamic>? _auditPayload;
  Map<String, dynamic>? _alertsPayload;

  String _selectedAuditCategory = 'ALL';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    final now = DateTime.now();
    _competence = widget.initialCompetence ??
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}';
    _carregarTudo();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  bool get _hasValidStepUp =>
      _stepUpToken != null &&
      _stepUpExpiresAt != null &&
      _stepUpExpiresAt!.isAfter(DateTime.now());

  String _formatCents(dynamic cents) {
    final val = (cents is num) ? cents.toDouble() : 0.0;
    return _brl.format(val / 100.0);
  }

  void _mudarCompetencia(int deltaMeses) {
    final parts = _competence.split('-');
    if (parts.length != 2) return;
    final y = int.tryParse(parts[0]) ?? DateTime.now().year;
    final m = int.tryParse(parts[1]) ?? DateTime.now().month;
    final next = DateTime(y, m + deltaMeses, 1);
    setState(() {
      _competence =
          '${next.year.toString().padLeft(4, '0')}-${next.month.toString().padLeft(2, '0')}';
    });
    _carregarTudo();
  }

  Future<void> _carregarTudo() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.loadStatementsOverride != null
            ? widget.loadStatementsOverride!(_competence)
            : _api.getOwnerBillingStatements(competence: _competence),
        widget.loadCostsOverride != null
            ? widget.loadCostsOverride!(_competence)
            : _api.getOwnerCostsAndMargin(competence: _competence),
        widget.loadAuditOverride != null
            ? widget.loadAuditOverride!(_selectedAuditCategory)
            : _api.getOwnerOperationalAudit(category: _selectedAuditCategory),
        widget.loadAlertsOverride != null
            ? widget.loadAlertsOverride!()
            : _api.getOwnerReviewAlerts(),
      ]);

      if (mounted) {
        setState(() {
          _statementsOverview = results[0];
          _costsPanel = results[1];
          _auditPayload = results[2];
          _alertsPayload = results[3];
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

  Future<bool> _ensureStepUp(String actionLabel) async {
    if (_hasValidStepUp) return true;

    final passCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _DialogControllerDisposer(
        controllers: [passCtrl],
        child: AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          title: const Text(
            'Confirmação Reforçada (Step-Up)',
            style: TextStyle(color: Colors.white, fontSize: 16),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Confirme sua senha de proprietário para autorizar: $actionLabel',
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: passCtrl,
                  obscureText: true,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Senha atual',
                    labelStyle: TextStyle(color: Colors.white54),
                    filled: true,
                    fillColor: Color(0xFF0F172A),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF38BDF8),
                foregroundColor: const Color(0xFF0F172A),
              ),
              onPressed: () async {
                if (passCtrl.text.trim().isEmpty) return;
                try {
                  final res = await _api.ownerStepUpAuth(passCtrl.text.trim());
                  _stepUpToken = res['stepUpToken']?.toString();
                  final exp = res['expiresAt']?.toString();
                  _stepUpExpiresAt = exp != null
                      ? DateTime.tryParse(exp)
                      : DateTime.now().add(const Duration(minutes: 10));
                  if (ctx.mounted) Navigator.pop(ctx, true);
                } catch (e) {
                  if (ctx.mounted) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      SnackBar(
                        content: Text('Senha recusada: $e'),
                        backgroundColor: Colors.redAccent,
                      ),
                    );
                  }
                }
              },
              child: const Text('Confirmar'),
            ),
          ],
        ),
      ),
    );
    return ok == true;
  }

  Future<void> _fecharDemonstrativo(String companyId, String companyName) async {
    final authed = await _ensureStepUp(
        'Fechar demonstrativo $_competence de $companyName');
    if (!authed) return;

    try {
      await _api.closeOwnerMonthlyStatement(
        companyId: companyId,
        competence: _competence,
        stepUpToken: _stepUpToken,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                'Demonstrativo $_competence de $companyName fechado com snapshot imutável.'),
            backgroundColor: Colors.green,
          ),
        );
      }
      await _carregarTudo();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Falha ao fechar demonstrativo: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  Future<void> _abrirModalConciliacaoExterna(Map<String, dynamic> st) async {
    final remainingCents = (st['remainingBalanceCents'] as num?)?.toInt() ?? 0;
    if (remainingCents <= 0) return;

    final authed = await _ensureStepUp(
        'Registrar conciliação externa B2B (${st['competence']})');
    if (!authed || !mounted) return;

    final valorCtrl = TextEditingController(
      text: (remainingCents / 100.0).toStringAsFixed(2),
    );
    final refCtrl = TextEditingController();
    final obsCtrl = TextEditingController();
    String metodo = 'PIX_OUTSIDE_APP';

    await showDialog<void>(
      context: context,
      builder: (ctx) => _DialogControllerDisposer(
        controllers: [valorCtrl, refCtrl, obsCtrl],
        child: StatefulBuilder(
          builder: (ctx, setModalState) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: const Text(
              'Conciliação Externa B2B (Fora do App)',
              style: TextStyle(color: Colors.white, fontSize: 15),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Registra liquidação recebida por contrato externo (sem emissão bancária nem checkout no app).',
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: metodo,
                    dropdownColor: const Color(0xFF0F172A),
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: const InputDecoration(
                      labelText: 'Meio externo conciliado',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                    items: const [
                      DropdownMenuItem(
                          value: 'PIX_OUTSIDE_APP',
                          child: Text('PIX Corporativo Externo')),
                      DropdownMenuItem(
                          value: 'TED_OUTSIDE_APP',
                          child: Text('TED / Transferência Externa')),
                      DropdownMenuItem(
                          value: 'BOLETO_OUTSIDE_APP',
                          child: Text('Boleto Externo Liquidado')),
                      DropdownMenuItem(
                          value: 'MANUAL_RECONCILIATION',
                          child: Text('Conciliação Contábil Manual')),
                    ],
                    onChanged: (v) {
                      if (v != null) setModalState(() => metodo = v);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: valorCtrl,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Valor recebido (R\$)',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: refCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Comprovante / Referência Externa',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: obsCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Observações',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF10B981),
                  foregroundColor: Colors.white,
                ),
                onPressed: () async {
                  final parsed = double.tryParse(
                          valorCtrl.text.trim().replaceAll(',', '.')) ??
                      0;
                  final cents = (parsed * 100).round();
                  if (cents <= 0) return;
                  try {
                    await _api.recordOwnerStatementPayment(
                      statementId: st['id'].toString(),
                      stepUpToken: _stepUpToken,
                      payload: {
                        'idempotencyKey':
                            'pay-${st['id']}-${DateTime.now().millisecondsSinceEpoch}',
                        'amountCents': cents,
                        'paymentMethod': metodo,
                        'externalReference': refCtrl.text.trim(),
                        'notes': obsCtrl.text.trim(),
                      },
                    );
                    if (ctx.mounted) Navigator.pop(ctx);
                    await _carregarTudo();
                  } catch (e) {
                    if (ctx.mounted) {
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        SnackBar(
                          content: Text('Erro: $e'),
                          backgroundColor: Colors.redAccent,
                        ),
                      );
                    }
                  }
                },
                child: const Text('Registrar Conciliação'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _abrirModalNovoCusto() async {
    final authed = await _ensureStepUp('Lançar custo verificado da plataforma');
    if (!authed || !mounted) return;

    final provCtrl = TextEditingController(text: 'RENDER');
    final valorCtrl = TextEditingController();
    final cambioCtrl = TextEditingController(text: '5.750');
    final docCtrl = TextEditingController();
    final obsCtrl = TextEditingController();

    String categoria = 'INFRASTRUCTURE';
    String apuracao = 'MANUAL';
    String moeda = 'BRL';
    String pagador = 'PLATFORM';
    String rateio = 'UNALLOCATED_PLATFORM_OVERHEAD';
    bool substituiTelemetria = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) => _DialogControllerDisposer(
        controllers: [provCtrl, valorCtrl, cambioCtrl, docCtrl, obsCtrl],
        child: StatefulBuilder(
          builder: (ctx, setModalState) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: const Text(
              'Lançar Custo Verificado da Plataforma',
              style: TextStyle(color: Colors.white, fontSize: 15),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    value: categoria,
                    dropdownColor: const Color(0xFF0F172A),
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: const InputDecoration(
                      labelText: 'Categoria',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                    items: const [
                      DropdownMenuItem(
                          value: 'INFRASTRUCTURE',
                          child: Text('Infraestrutura (Servidor/Banco/Storage)')),
                      DropdownMenuItem(
                          value: 'APIS', child: Text('APIs (Gemini / Grok)')),
                      DropdownMenuItem(
                          value: 'MESSAGING', child: Text('Mensageria')),
                      DropdownMenuItem(
                          value: 'TOOLS',
                          child: Text('Ferramentas / Contas de Loja')),
                    ],
                    onChanged: (v) {
                      if (v != null) setModalState(() => categoria = v);
                    },
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: provCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Provedor (ex.: RENDER, BACKBLAZE_B2, GEMINI)',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: apuracao,
                    dropdownColor: const Color(0xFF0F172A),
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: const InputDecoration(
                      labelText: 'Classificação de Origem',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                    items: const [
                      DropdownMenuItem(
                          value: 'MANUAL',
                          child: Text('MANUAL (Fatura/Recibo Lançado)')),
                      DropdownMenuItem(
                          value: 'MEASURED',
                          child: Text('MEASURED (Medido Verificado)')),
                      DropdownMenuItem(
                          value: 'ESTIMATED',
                          child: Text('ESTIMATED (Estimativa Operacional)')),
                    ],
                    onChanged: (v) {
                      if (v != null) setModalState(() => apuracao = v);
                    },
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: moeda,
                          dropdownColor: const Color(0xFF0F172A),
                          style:
                              const TextStyle(color: Colors.white, fontSize: 13),
                          decoration: const InputDecoration(
                            labelText: 'Moeda',
                            labelStyle: TextStyle(color: Colors.white54),
                          ),
                          items: const [
                            DropdownMenuItem(value: 'BRL', child: Text('BRL')),
                            DropdownMenuItem(value: 'USD', child: Text('USD')),
                          ],
                          onChanged: (v) {
                            if (v != null) setModalState(() => moeda = v);
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: valorCtrl,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          style: const TextStyle(color: Colors.white),
                          decoration: InputDecoration(
                            labelText: 'Valor ($moeda)',
                            labelStyle: const TextStyle(color: Colors.white54),
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (moeda == 'USD') ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: cambioCtrl,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Câmbio BRL/USD (ex.: 5.750)',
                        labelStyle: TextStyle(color: Colors.white54),
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: pagador,
                    dropdownColor: const Color(0xFF0F172A),
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                    decoration: const InputDecoration(
                      labelText: 'Pagador do Custo',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                    items: const [
                      DropdownMenuItem(
                          value: 'PLATFORM',
                          child: Text('PLATFORM (Custo próprio do Lumora)')),
                      DropdownMenuItem(
                          value: 'COMPANY',
                          child: Text('COMPANY (Pago direto pela empresa)')),
                    ],
                    onChanged: (v) {
                      if (v != null) setModalState(() => pagador = v);
                    },
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: rateio,
                    dropdownColor: const Color(0xFF0F172A),
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                    decoration: const InputDecoration(
                      labelText: 'Regra de Rateio',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                    items: const [
                      DropdownMenuItem(
                          value: 'UNALLOCATED_PLATFORM_OVERHEAD',
                          child: Text('Custo Geral Plataforma (Sem Rateio)')),
                      DropdownMenuItem(
                          value: 'PROPORTIONAL_ELIGIBLE_SALES',
                          child: Text('Proporcional às Vendas Elegíveis')),
                      DropdownMenuItem(
                          value: 'EQUAL_ACTIVE_COMPANIES',
                          child: Text('Igualitário entre Empresas Ativas')),
                      DropdownMenuItem(
                          value: 'USAGE_UNITS',
                          child: Text('Proporcional a Unidades de Uso')),
                    ],
                    onChanged: (v) {
                      if (v != null) setModalState(() => rateio = v);
                    },
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: docCtrl,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Documento / Fatura de Origem (Obrigatório)',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: substituiTelemetria,
                    onChanged: (v) =>
                        setModalState(() => substituiTelemetria = v ?? false),
                    title: const Text(
                      'Substitui telemetria interna do provedor na competência (evita dupla contagem)',
                      style: TextStyle(color: Colors.white70, fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF38BDF8),
                  foregroundColor: const Color(0xFF0F172A),
                ),
                onPressed: () async {
                  final val = double.tryParse(
                          valorCtrl.text.trim().replaceAll(',', '.')) ??
                      0;
                  final cents = (val * 100).round();
                  final fx = double.tryParse(
                          cambioCtrl.text.trim().replaceAll(',', '.')) ??
                      0;
                  final fxMilli = (fx * 1000).round();
                  if (cents <= 0 || docCtrl.text.trim().length < 4) return;

                  try {
                    await _api.recordOwnerPlatformCost(
                      stepUpToken: _stepUpToken,
                      payload: {
                        'idempotencyKey':
                            'cost-$_competence-${provCtrl.text.trim()}-${DateTime.now().millisecondsSinceEpoch}',
                        'competence': _competence,
                        'category': categoria,
                        'provider': provCtrl.text.trim(),
                        'measurementType': apuracao,
                        'currency': moeda,
                        'originalAmountCents': cents,
                        if (moeda == 'USD') 'exchangeRateMilli': fxMilli,
                        'costPayer': pagador,
                        'allocationRule': rateio,
                        'replacesTelemetryUsage': substituiTelemetria,
                        'sourceDocument': docCtrl.text.trim(),
                        'notes': obsCtrl.text.trim(),
                      },
                    );
                    if (ctx.mounted) Navigator.pop(ctx);
                    await _carregarTudo();
                  } catch (e) {
                    if (ctx.mounted) {
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        SnackBar(
                          content: Text('Erro: $e'),
                          backgroundColor: Colors.redAccent,
                        ),
                      );
                    }
                  }
                },
                child: const Text('Salvar Custo'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _abrirModalRevisaoAlerta(Map<String, dynamic> alert) async {
    final authed =
        await _ensureStepUp('Registrar conferência administrativa de alerta');
    if (!authed || !mounted) return;

    final notasCtrl = TextEditingController();
    String status = 'REVIEWED_OK';

    await showDialog<void>(
      context: context,
      builder: (ctx) => _DialogControllerDisposer(
        controllers: [notasCtrl],
        child: StatefulBuilder(
          builder: (ctx, setModalState) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: const Text(
              'Conferência Administrativa',
              style: TextStyle(color: Colors.white, fontSize: 15),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    value: status,
                    dropdownColor: const Color(0xFF0F172A),
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: const InputDecoration(
                      labelText: 'Parecer da Conferência',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                    items: const [
                      DropdownMenuItem(
                          value: 'REVIEWED_OK',
                          child: Text('Conferido e Regular (REVIEWED_OK)')),
                      DropdownMenuItem(
                          value: 'ADJUSTMENT_OPENED',
                          child: Text(
                              'Encaminhado para Ajuste (ADJUSTMENT_OPENED)')),
                    ],
                    onChanged: (v) {
                      if (v != null) setModalState(() => status = v);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: notasCtrl,
                    maxLines: 3,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Observação administrativa (mín. 5 caracteres)',
                      labelStyle: TextStyle(color: Colors.white54),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar'),
              ),
              ElevatedButton(
                onPressed: () async {
                  if (notasCtrl.text.trim().length < 5) return;
                  try {
                    await _api.resolveOwnerReviewAlert(
                      alertId: alert['id'].toString(),
                      status: status,
                      reviewNotes: notasCtrl.text.trim(),
                      stepUpToken: _stepUpToken,
                    );
                    if (ctx.mounted) Navigator.pop(ctx);
                    await _carregarTudo();
                  } catch (e) {
                    if (ctx.mounted) {
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        SnackBar(
                          content: Text('Erro: $e'),
                          backgroundColor: Colors.redAccent,
                        ),
                      );
                    }
                  }
                },
                child: const Text('Concluir Conferência'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Faturamento, Custos e Auditoria',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
            ),
            Text(
              'Competência $_competence • Liquidação B2B Externa',
              style: const TextStyle(fontSize: 11, color: Color(0xFF38BDF8)),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Mês anterior',
            icon: const Icon(Icons.chevron_left_rounded),
            onPressed: () => _mudarCompetencia(-1),
          ),
          IconButton(
            tooltip: 'Próximo mês',
            icon: const Icon(Icons.chevron_right_rounded),
            onPressed: () => _mudarCompetencia(1),
          ),
          IconButton(
            tooltip: 'Atualizar',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _carregarTudo,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          indicatorColor: const Color(0xFF38BDF8),
          labelColor: const Color(0xFF38BDF8),
          unselectedLabelColor: const Color(0xFF94A3B8),
          tabs: const [
            Tab(icon: Icon(Icons.receipt_long_rounded, size: 18), text: 'Demonstrativos'),
            Tab(icon: Icon(Icons.analytics_rounded, size: 18), text: 'Custos & Margem'),
            Tab(icon: Icon(Icons.policy_rounded, size: 18), text: 'Auditoria'),
            Tab(icon: Icon(Icons.fact_check_rounded, size: 18), text: 'Revisões'),
          ],
        ),
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
                      style: const TextStyle(color: Colors.redAccent),
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildTabDemonstrativos(),
                    _buildTabCustosMargem(),
                    _buildTabAuditoria(),
                    _buildTabRevisoes(),
                  ],
                ),
    );
  }

  Widget _buildTabDemonstrativos() {
    final totals =
        (_statementsOverview?['totals'] as Map<String, dynamic>?) ?? {};
    final closed = (_statementsOverview?['statements'] as List?) ?? [];
    final openPreviews =
        (_statementsOverview?['unclosedCompaniesPreview'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Consolidado Fechado ($_competence)',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14),
              ),
              const SizedBox(height: 8),
              _row('Base Confirmada Elegível',
                  _formatCents(totals['eligibleSalesBaseCents'])),
              _row('Taxa Contratada Bruta',
                  _formatCents(totals['grossPlatformFeeCents'])),
              _row('Ajustes / Devoluções',
                  _formatCents(totals['adjustmentsCents'])),
              _row('Líquido Devido', _formatCents(totals['netDueCents']),
                  bold: true),
              _row('Recebido (Conciliação Externa)',
                  _formatCents(totals['paidAmountCents'])),
              _row('Saldo em Aberto',
                  _formatCents(totals['remainingBalanceCents']),
                  bold: true),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'Demonstrativos Fechados (${closed.length})',
          style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
        ),
        const SizedBox(height: 8),
        if (closed.isEmpty)
          const Text(
            'Nenhum demonstrativo fechado nesta competência.',
            style: TextStyle(color: Colors.white54, fontSize: 12),
          ),
        ...closed.map((raw) {
          final st = Map<String, dynamic>.from(raw as Map);
          final comp = (st['company'] as Map<String, dynamic>?) ?? {};
          final rem = (st['remainingBalanceCents'] as num?)?.toInt() ?? 0;
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        comp['name']?.toString() ?? 'Empresa',
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14),
                      ),
                    ),
                    Text(
                      st['status']?.toString() ?? 'CLOSED',
                      style: TextStyle(
                        color: st['status'] == 'PAID'
                            ? Colors.greenAccent
                            : Colors.amberAccent,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                _row('Base Elegível (${st['eligibleSalesCount']} vendas)',
                    _formatCents(st['eligibleSalesBaseCents'])),
                _row('Taxa Bruta / Ajustes',
                    '${_formatCents(st['grossPlatformFeeCents'])} / ${_formatCents(st['adjustmentsCents'])}'),
                _row('Devido / Pago / Saldo',
                    '${_formatCents(st['netDueCents'])} / ${_formatCents(st['paidAmountCents'])} / ${_formatCents(rem)}',
                    bold: true),
                if (rem > 0) ...[
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.check_circle_outline, size: 16),
                      label: const Text('Conciliar Pagamento Externo'),
                      onPressed: () => _abrirModalConciliacaoExterna(st),
                    ),
                  ),
                ],
              ],
            ),
          );
        }),
        const SizedBox(height: 16),
        Text(
          'Empresas em Aberto na Competência (${openPreviews.length})',
          style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
        ),
        const SizedBox(height: 8),
        ...openPreviews.map((raw) {
          final pv = Map<String, dynamic>.from(raw as Map);
          final comp = (pv['company'] as Map<String, dynamic>?) ?? {};
          final canClose = pv['canClose'] == true;
          final contractStatus = pv['contractStatus']?.toString() ?? '';
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  comp['name']?.toString() ?? 'Empresa',
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14),
                ),
                const SizedBox(height: 4),
                Text(
                  !canClose
                      ? 'Não configurado ($contractStatus) — sem cobrança automática'
                      : 'Prévia elegível: ${pv['eligibleSalesCount']} venda(s) • Taxa prevista: ${_formatCents(pv['netDueCents'])}',
                  style: TextStyle(
                    color: !canClose ? Colors.orangeAccent : Colors.white70,
                    fontSize: 12,
                  ),
                ),
                if (canClose) ...[
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF38BDF8),
                        foregroundColor: const Color(0xFF0F172A),
                      ),
                      icon: const Icon(Icons.lock_clock_rounded, size: 16),
                      label: const Text('Fechar Competência'),
                      onPressed: () => _fecharDemonstrativo(
                        pv['companyId'].toString(),
                        comp['name']?.toString() ?? 'Empresa',
                      ),
                    ),
                  ),
                ],
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildTabCustosMargem() {
    final rev = (_costsPanel?['revenues'] as Map<String, dynamic>?) ?? {};
    final costs =
        (_costsPanel?['platformCosts'] as Map<String, dynamic>?) ?? {};
    final margins = (_costsPanel?['margins'] as Map<String, dynamic>?) ?? {};
    final sep =
        (_costsPanel?['separationGuarantee'] as Map<String, dynamic>?) ?? {};
    final entries = (_costsPanel?['entries'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Receita Contratada vs Recebida & Margem Lumora',
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14),
              ),
              const SizedBox(height: 8),
              _row('Receita Contratada (Fechada + Prévia)',
                  _formatCents(rev['totalContractedRevenueCents'])),
              _row('Receita Efetivamente Recebida',
                  _formatCents(rev['statementReceivedRevenueCents'])),
              const Divider(color: Colors.white12),
              _row('Custos Plataforma Medidos (MEASURED)',
                  _formatCents(costs['measuredBrlCents'])),
              _row('Custos Plataforma Faturas Manuais (MANUAL)',
                  _formatCents(costs['manualVerifiedBrlCents'])),
              _row('Custos Plataforma Estimados (ESTIMATED)',
                  _formatCents(costs['estimatedBrlCents'])),
              const Divider(color: Colors.white12),
              _row('Margem Real (Recebida − Verificados)',
                  _formatCents(margins['realMarginCents']),
                  bold: true),
              _row('Margem Estimada (Contratada − Total c/ Est.)',
                  _formatCents(margins['estimatedMarginCents']),
                  bold: true),
              const SizedBox(height: 8),
              Text(
                'Anti-dupla-contagem ativa: ${sep['supersededTelemetryRecordsCount'] ?? 0} telemetria(s) substituída(s) por fatura consolidada. Despesas internas das empresas clientes permanecem isoladas.',
                style: const TextStyle(color: Colors.white54, fontSize: 11),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF38BDF8),
              foregroundColor: const Color(0xFF0F172A),
            ),
            icon: const Icon(Icons.add_chart_rounded, size: 18),
            label: const Text('Lançar Custo da Plataforma'),
            onPressed: _abrirModalNovoCusto,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Livro de Custos Verificados (${entries.length})',
          style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
        ),
        const SizedBox(height: 8),
        ...entries.map((raw) {
          final e = Map<String, dynamic>.from(raw as Map);
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${e['provider']} • ${e['category']} (${e['measurementType']})',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 13),
                    ),
                    Text(
                      _formatCents(e['amountBrlCents']),
                      style: const TextStyle(
                          color: Color(0xFF38BDF8),
                          fontWeight: FontWeight.bold,
                          fontSize: 13),
                    ),
                  ],
                ),
                Text(
                  'Origem: ${e['sourceDocument']} • Pagador: ${e['costPayer']} • Rateio: ${e['allocationRule']}',
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildTabAuditoria() {
    final events = (_auditPayload?['events'] as List?) ?? [];
    const cats = [
      'ALL',
      'PRICE',
      'DISCOUNT',
      'CONDITIONS',
      'BUYER_PHONE',
      'PAYMENT',
      'REVERSAL',
      'CONTRACT',
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'PII mascarada por padrão (sem fotos, sem dados de crianças, sem CPF/telefone completo).',
          style: TextStyle(color: Color(0xFF38BDF8), fontSize: 12),
        ),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: cats.map((c) {
              final selected = _selectedAuditCategory == c;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(c, style: const TextStyle(fontSize: 11)),
                  selected: selected,
                  selectedColor: const Color(0xFF38BDF8),
                  onSelected: (_) {
                    setState(() => _selectedAuditCategory = c);
                    _carregarTudo();
                  },
                ),
              );
            }).toList(),
          ),
        ),
        const SizedBox(height: 12),
        if (events.isEmpty)
          const Text(
            'Nenhum evento de auditoria encontrado para o filtro.',
            style: TextStyle(color: Colors.white54, fontSize: 13),
          ),
        ...events.map((raw) {
          final ev = Map<String, dynamic>.from(raw as Map);
          final comp = (ev['company'] as Map<String, dynamic>?) ?? {};
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '[${ev['category']}] ${ev['action']} • Ref: ${ev['entityReference']}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 13),
                ),
                Text(
                  'Empresa: ${comp['name'] ?? 'Plataforma'} • Autor: ${ev['authorName']}',
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
                if (ev['reason'] != null)
                  Text(
                    'Justificativa: ${ev['reason']}',
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                  ),
                if (ev['previousValues'] != null || ev['newValues'] != null)
                  Text(
                    'Antes: ${ev['previousValues'] ?? '-'} | Depois: ${ev['newValues'] ?? '-'}',
                    style: const TextStyle(color: Colors.white38, fontSize: 11),
                  ),
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildTabRevisoes() {
    final alerts = (_alertsPayload?['alerts'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Text(
            'Fila de conferência administrativa: alertas sinalizam eventos para verificação humana, sem acusação automática de fraude e sem bloquear vendas.',
            style: TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ),
        const SizedBox(height: 12),
        if (alerts.isEmpty)
          const Text(
            'Nenhuma pendência de conferência registrada.',
            style: TextStyle(color: Colors.white54, fontSize: 13),
          ),
        ...alerts.map((raw) {
          final al = Map<String, dynamic>.from(raw as Map);
          final comp = (al['company'] as Map<String, dynamic>?) ?? {};
          final isPending = al['status'] == 'PENDING_REVIEW';
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${al['alertType']} • ${al['status']}',
                  style: TextStyle(
                    color:
                        isPending ? Colors.amberAccent : Colors.greenAccent,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  al['summary']?.toString() ?? '',
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
                Text(
                  'Empresa: ${comp['name'] ?? '-'} • Ref: ${al['entityReference']}',
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
                if (al['reviewNotes'] != null)
                  Text(
                    'Parecer: ${al['reviewNotes']} (${al['reviewedByName'] ?? ''})',
                    style: const TextStyle(
                        color: Colors.lightGreenAccent, fontSize: 11),
                  ),
                if (isPending) ...[
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton(
                      onPressed: () => _abrirModalRevisaoAlerta(al),
                      child: const Text('Registrar Conferência'),
                    ),
                  ),
                ],
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _row(String k, String v, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              k,
              style: TextStyle(
                color: bold ? Colors.white : Colors.white70,
                fontWeight: bold ? FontWeight.bold : FontWeight.normal,
                fontSize: 12,
              ),
            ),
          ),
          Text(
            v,
            style: TextStyle(
              color: bold ? const Color(0xFF38BDF8) : Colors.white,
              fontWeight: bold ? FontWeight.bold : FontWeight.w500,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
