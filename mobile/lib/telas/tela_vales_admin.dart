import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../servicos/servico_api.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/fullscreen_signature_screen.dart';
import '../widgets/admin_ficha_actions.dart';

String formatCentsBRL(int cents) {
  final value = cents / 100.0;
  return NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$').format(value);
}

String advanceCategoryLabel(String category) {
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

class TelaValesAdmin extends StatefulWidget {
  final String profileRole; // 'PHOTOGRAPHER' | 'SELLER'

  const TelaValesAdmin({
    super.key,
    required this.profileRole,
  });

  @override
  State<TelaValesAdmin> createState() => _TelaValesAdminState();
}

class _TelaValesAdminState extends State<TelaValesAdmin> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _professionals = [];
  Map<String, dynamic> _summary = {};
  Map<String, dynamic> _companyConfig = {};

  bool get _isPhotographer => widget.profileRole.toUpperCase() == 'PHOTOGRAPHER';
  String get _title =>
      _isPhotographer ? 'Vales · Fotógrafos' : 'Vales · Vendedores';

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TelaValesAdmin oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.profileRole != widget.profileRole) {
      _loadData();
    }
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final res = await _api.getAdvancesByRole(
        _isPhotographer ? 'PHOTOGRAPHER' : 'SELLER',
      );
      if (!mounted) return;
      setState(() {
        _professionals = (res['professionals'] as List?)
                ?.whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList() ??
            [];
        _summary = res['summary'] is Map
            ? Map<String, dynamic>.from(res['summary'] as Map)
            : {};
        _companyConfig = res['companyConfig'] is Map
            ? Map<String, dynamic>.from(res['companyConfig'] as Map)
            : {};
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

  Future<void> _showConfigDialog() async {
    final curLimitCents =
        int.tryParse((_companyConfig['advanceAlertLimitCents'] ?? 50000).toString()) ?? 50000;
    final curDays =
        int.tryParse((_companyConfig['advanceAlertDays'] ?? 7).toString()) ?? 7;

    final limitCtrl =
        TextEditingController(text: (curLimitCents / 100.0).toStringAsFixed(2));
    final daysCtrl = TextEditingController(text: curDays.toString());
    bool saving = false;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: lumoraSurfaceDark,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: lumoraNeonPurple.withOpacity(0.45)),
          ),
          title: const Text(
            'Alertas de Vales em Aberto',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Defina o teto de saldo aberto (R\$) e o prazo em dias para destacar alertas vermelhos.',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: limitCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Limite máximo (R\$)',
                  labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                  filled: true,
                  fillColor: lumoraBgDark,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: daysCtrl,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Prazo limite (dias em aberto)',
                  labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                  filled: true,
                  fillColor: lumoraBgDark,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: lumoraNeonPurple,
                foregroundColor: Colors.white,
              ),
              onPressed: saving
                  ? null
                  : () async {
                      final parsedLimit = double.tryParse(
                              limitCtrl.text.trim().replaceAll(',', '.')) ??
                          -1;
                      final parsedDays = int.tryParse(daysCtrl.text.trim()) ?? -1;
                      if (parsedLimit < 0 || parsedDays < 1) {
                        ScaffoldMessenger.of(ctx).showSnackBar(
                          const SnackBar(content: Text('Informe valores válidos.')),
                        );
                        return;
                      }
                      setDialogState(() => saving = true);
                      try {
                        await _api.updateAdvanceConfig(
                          advanceAlertLimitCents: (parsedLimit * 100).round(),
                          advanceAlertDays: parsedDays,
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        await _loadData();
                      } catch (e) {
                        setDialogState(() => saving = false);
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
              child: saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final totalOpenCents =
        int.tryParse((_summary['totalOpenCents'] ?? 0).toString()) ?? 0;
    final withBalance =
        int.tryParse((_summary['usersWithBalanceCount'] ?? 0).toString()) ?? 0;
    final overAlert =
        int.tryParse((_summary['usersOverAlertCount'] ?? 0).toString()) ?? 0;
    final limitCents =
        int.tryParse((_companyConfig['advanceAlertLimitCents'] ?? 50000).toString()) ?? 50000;
    final alertDays =
        int.tryParse((_companyConfig['advanceAlertDays'] ?? 7).toString()) ?? 7;

    return Scaffold(
      backgroundColor: lumoraBgDark,
      appBar: AppBar(
        backgroundColor: lumoraSurfaceDark,
        title: Text(
          _title,
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.tune_rounded, color: Color(0xFFD8B4FE)),
            tooltip: 'Configurar Alertas',
            onPressed: _showConfigDialog,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            onPressed: _loadData,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        color: lumoraNeonPurple,
        backgroundColor: lumoraSurfaceDark,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: lumoraNeonPurple))
            : _error != null
                ? ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white70),
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        style: ElevatedButton.styleFrom(backgroundColor: lumoraNeonPurple),
                        child: const Text('Tentar novamente', style: TextStyle(color: Colors.white)),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF281242), lumoraSurfaceDark],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: lumoraNeonPurple.withOpacity(0.5)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'TOTAL EM ABERTO (${_isPhotographer ? 'FOTÓGRAFOS' : 'VENDEDORES'})',
                                  style: const TextStyle(
                                    color: Color(0xFFD8B4FE),
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.8,
                                  ),
                                ),
                                if (overAlert > 0)
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: Colors.redAccent.withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(10),
                                      border: Border.all(color: Colors.redAccent),
                                    ),
                                    child: Text(
                                      '$overAlert em alerta',
                                      style: const TextStyle(
                                        color: Colors.redAccent,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              formatCentsBRL(totalOpenCents),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 26,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '$withBalance profissional(is) com saldo · Alerta acima de ${formatCentsBRL(limitCents)} ou $alertDays dias',
                              style: const TextStyle(color: Colors.white70, fontSize: 11.5),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      if (_professionals.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 48),
                          child: Center(
                            child: Text(
                              'Nenhum profissional encontrado neste perfil.',
                              style: TextStyle(color: Colors.white54),
                            ),
                          ),
                        )
                      else
                        ..._professionals.map((p) {
                          final openCents =
                              int.tryParse((p['totalOpenCents'] ?? 0).toString()) ?? 0;
                          final oldestDays =
                              int.tryParse((p['oldestOpenDays'] ?? 0).toString()) ?? 0;
                          final isOverLimit = p['isOverLimit'] == true;
                          final isOverdue = p['isOverdue'] == true;
                          final hasAlert = p['hasAlert'] == true;
                          final name = (p['name'] ?? 'Profissional').toString();

                          final Color borderColor = hasAlert
                              ? const Color(0xFFEF4444)
                              : (openCents > 0
                                  ? lumoraNeonPurple.withOpacity(0.5)
                                  : Colors.white12);

                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            decoration: BoxDecoration(
                              color: hasAlert
                                  ? const Color(0xFF2B1018)
                                  : lumoraSurfaceDark,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: borderColor,
                                width: hasAlert ? 1.5 : 1,
                              ),
                            ),
                            child: ListTile(
                              onTap: () async {
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => TelaExtratoValeAdmin(
                                      userId: p['userId'].toString(),
                                      profileRole: _isPhotographer ? 'PHOTOGRAPHER' : 'SELLER',
                                    ),
                                  ),
                                );
                                _loadData();
                              },
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 14, vertical: 6),
                              leading: CircleAvatar(
                                backgroundColor: (hasAlert
                                        ? const Color(0xFFEF4444)
                                        : (openCents > 0
                                            ? lumoraNeonPurple
                                            : const Color(0xFF22C55E)))
                                    .withOpacity(0.2),
                                child: Icon(
                                  hasAlert
                                      ? Icons.warning_amber_rounded
                                      : (openCents > 0
                                          ? Icons.account_balance_wallet_rounded
                                          : Icons.check_circle_outline),
                                  color: hasAlert
                                      ? const Color(0xFFEF4444)
                                      : (openCents > 0
                                          ? lumoraNeonPurple
                                          : const Color(0xFF22C55E)),
                                ),
                              ),
                              title: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      name,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14.5,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    formatCentsBRL(openCents),
                                    style: TextStyle(
                                      color: hasAlert
                                          ? const Color(0xFFEF4444)
                                          : (openCents > 0
                                              ? const Color(0xFFF59E0B)
                                              : const Color(0xFF22C55E)),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                              subtitle: Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Wrap(
                                  spacing: 8,
                                  runSpacing: 4,
                                  children: [
                                    if (openCents == 0)
                                      const Text(
                                        'Sem pendências em aberto',
                                        style: TextStyle(
                                            color: Colors.white54, fontSize: 11.5),
                                      )
                                    else
                                      Text(
                                        'Em aberto há $oldestDays dia(s)',
                                        style: TextStyle(
                                          color: isOverdue
                                              ? const Color(0xFFEF4444)
                                              : Colors.white70,
                                          fontSize: 11.5,
                                          fontWeight: isOverdue
                                              ? FontWeight.bold
                                              : FontWeight.normal,
                                        ),
                                      ),
                                    if (isOverLimit)
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 6, vertical: 1),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFEF4444)
                                              .withOpacity(0.22),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Text(
                                          'Acima do Limite',
                                          style: TextStyle(
                                            color: Color(0xFFFCA5A5),
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                    if (isOverdue)
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 6, vertical: 1),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFEF4444)
                                              .withOpacity(0.22),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Text(
                                          'Prazo Vencido',
                                          style: TextStyle(
                                            color: Color(0xFFFCA5A5),
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              trailing: const Icon(
                                Icons.chevron_right_rounded,
                                color: Colors.white54,
                              ),
                            ),
                          );
                        }),
                    ],
                  ),
      ),
    );
  }
}

class TelaExtratoValeAdmin extends StatefulWidget {
  final String userId;
  final String profileRole;

  const TelaExtratoValeAdmin({
    super.key,
    required this.userId,
    required this.profileRole,
  });

  @override
  State<TelaExtratoValeAdmin> createState() => _TelaExtratoValeAdminState();
}

class _TelaExtratoValeAdminState extends State<TelaExtratoValeAdmin> {
  final ApiService _api = ApiService();
  final ImagePicker _picker = ImagePicker();
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _statement;

  @override
  void initState() {
    super.initState();
    _loadStatement();
  }

  Future<void> _loadStatement() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final res = await _api.getUserAdvanceStatement(widget.userId);
      if (!mounted) return;
      setState(() {
        _statement = res;
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

  Future<void> _openNewDebitDialog() async {
    final isPhotographer = widget.profileRole == 'PHOTOGRAPHER';
    final categories = isPhotographer
        ? const [
            {'id': 'TRIP_EVENT_ADVANCE', 'label': 'Adiantamento Viagem / Evento'},
            {'id': 'PERSONAL_ADVANCE', 'label': 'Vale Pessoal'},
            {'id': 'ROUTE_EXPENSE', 'label': 'Despesa / Custeio em Rota'},
            {'id': 'ADJUSTMENT_DIVERGENCE', 'label': 'Divergência / Ajuste'},
          ]
        : const [
            {'id': 'PERSONAL_ADVANCE', 'label': 'Vale Pessoal'},
            {'id': 'ROUTE_ADVANCE', 'label': 'Adiantamento de Rota / Viagem'},
            {'id': 'CLOSING_SHORTFALL', 'label': 'Pendência de Fechamento'},
            {'id': 'ADJUSTMENT_DIVERGENCE', 'label': 'Divergência / Ajuste'},
          ];

    String selectedCategory = categories.first['id']!;
    String? selectedBatchId;
    DateTime? selectedDueDate;
    String? receiptPath;
    Uint8List? signatureBytes;
    bool saving = false;

    final valueCtrl = TextEditingController();
    final notesCtrl = TextEditingController();

    List<dynamic> batches = [];
    try {
      batches = await _api.getBookBatches();
    } catch (_) {}

    if (!mounted) return;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: lumoraSurfaceDark,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: lumoraNeonPurple.withOpacity(0.5)),
          ),
          title: const Row(
            children: [
              Icon(Icons.add_card_rounded, color: lumoraNeonPurple),
              SizedBox(width: 8),
              Text('Lançar Novo Vale',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          content: SizedBox(
            width: 400,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    value: selectedCategory,
                    isExpanded: true,
                    dropdownColor: lumoraSurfaceDark,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: 'Categoria',
                      labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                      filled: true,
                      fillColor: lumoraBgDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: categories
                        .map((c) => DropdownMenuItem<String>(
                              value: c['id'],
                              child: Text(c['label']!),
                            ))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setDialogState(() => selectedCategory = v);
                    },
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: valueCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Valor (R\$)',
                      hintText: 'Ex: 150,00',
                      hintStyle: const TextStyle(color: Colors.white30),
                      labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                      filled: true,
                      fillColor: lumoraBgDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (batches.isNotEmpty) ...[
                    DropdownButtonFormField<String?>(
                      value: selectedBatchId,
                      isExpanded: true,
                      dropdownColor: lumoraSurfaceDark,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: InputDecoration(
                        labelText: 'Lote Associado (Opcional)',
                        labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                        filled: true,
                        fillColor: lumoraBgDark,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Nenhum lote específico'),
                        ),
                        ...batches.map((b) => DropdownMenuItem<String?>(
                              value: b['id']?.toString(),
                              child: Text((b['name'] ?? 'Lote').toString()),
                            )),
                      ],
                      onChanged: (v) => setDialogState(() => selectedBatchId = v),
                    ),
                    const SizedBox(height: 12),
                  ],
                  OutlinedButton.icon(
                    onPressed: () async {
                      final picked = await showDatePicker(
                        context: ctx,
                        initialDate: selectedDueDate ?? DateTime.now().add(const Duration(days: 7)),
                        firstDate: DateTime.now().subtract(const Duration(days: 30)),
                        lastDate: DateTime.now().add(const Duration(days: 365)),
                      );
                      if (picked != null) {
                        setDialogState(() => selectedDueDate = picked);
                      }
                    },
                    icon: const Icon(Icons.event_rounded, color: Color(0xFFD8B4FE), size: 18),
                    label: Text(
                      selectedDueDate == null
                          ? 'Definir Vencimento (Opcional)'
                          : 'Vencimento: ${DateFormat('dd/MM/yyyy').format(selectedDueDate!)}',
                      style: const TextStyle(color: Color(0xFFD8B4FE), fontSize: 12.5),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: notesCtrl,
                    maxLines: 2,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: 'Observação / Motivo',
                      labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                      filled: true,
                      fillColor: lumoraBgDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final xFile = await _picker.pickImage(
                              source: ImageSource.gallery,
                              imageQuality: 75,
                            );
                            if (xFile != null) {
                              setDialogState(() => receiptPath = xFile.path);
                            }
                          },
                          icon: Icon(
                            receiptPath != null ? Icons.check_circle : Icons.attach_file_rounded,
                            color: receiptPath != null ? const Color(0xFF22C55E) : Colors.white70,
                            size: 18,
                          ),
                          label: Text(
                            receiptPath != null ? 'Comprovante OK' : 'Comprovante',
                            style: const TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final bytes = await Navigator.push<Uint8List?>(
                              ctx,
                              MaterialPageRoute(
                                builder: (_) => const FullscreenSignatureScreen(
                                  title: 'Assinatura do Profissional',
                                  instructions:
                                      'Peça ao profissional para assinar abaixo confirmando o vale.',
                                ),
                              ),
                            );
                            if (bytes != null && bytes.isNotEmpty) {
                              setDialogState(() => signatureBytes = bytes);
                            }
                          },
                          icon: Icon(
                            signatureBytes != null ? Icons.check_circle : Icons.gesture_rounded,
                            color: signatureBytes != null ? const Color(0xFF22C55E) : lumoraNeonPurple,
                            size: 18,
                          ),
                          label: Text(
                            signatureBytes != null ? 'Assinado' : 'Assinatura',
                            style: TextStyle(
                              color: signatureBytes != null
                                  ? const Color(0xFF22C55E)
                                  : const Color(0xFFD8B4FE),
                              fontSize: 12,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: lumoraNeonPurple,
                foregroundColor: Colors.white,
              ),
              onPressed: saving
                  ? null
                  : () async {
                      final parsed = double.tryParse(
                              valueCtrl.text.trim().replaceAll(',', '.')) ??
                          0;
                      final cents = (parsed * 100).round();
                      if (cents <= 0) {
                        ScaffoldMessenger.of(ctx).showSnackBar(
                          const SnackBar(content: Text('Informe um valor maior que zero.')),
                        );
                        return;
                      }
                      setDialogState(() => saving = true);
                      try {
                        String? uploadedReceiptUrl;
                        if (receiptPath != null) {
                          uploadedReceiptUrl = await _api.uploadFile(receiptPath!);
                        }
                        await _api.createAdvance(
                          userId: widget.userId,
                          profileRole: widget.profileRole,
                          category: selectedCategory,
                          amountCents: cents,
                          dueDate: selectedDueDate?.toIso8601String(),
                          notes: notesCtrl.text.trim(),
                          receiptUrl: uploadedReceiptUrl,
                          signatureBase64: signatureBytes != null
                              ? base64Encode(signatureBytes!)
                              : null,
                          batchId: selectedBatchId,
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        await _loadStatement();
                      } catch (e) {
                        setDialogState(() => saving = false);
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
              child: saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Confirmar Vale'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openSettleDialog(int openCents) async {
    if (openCents <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não há saldo de vale em aberto para abater.')),
      );
      return;
    }

    final valueCtrl = TextEditingController(
      text: (openCents / 100.0).toStringAsFixed(2),
    );
    final notesCtrl = TextEditingController();
    String? receiptPath;
    bool saving = false;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: lumoraSurfaceDark,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: Color(0xFF22C55E), width: 1.2),
          ),
          title: const Row(
            children: [
              Icon(Icons.check_circle_outline_rounded, color: Color(0xFF22C55E)),
              SizedBox(width: 8),
              Text('Abater / Quitar Vale',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Saldo em aberto atual: ${formatCentsBRL(openCents)}',
                style: const TextStyle(color: Color(0xFFD8B4FE), fontSize: 13),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: valueCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Valor a Abater (R\$)',
                  labelStyle: const TextStyle(color: Color(0xFF86EFAC)),
                  filled: true,
                  fillColor: lumoraBgDark,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () {
                    valueCtrl.text = (openCents / 100.0).toStringAsFixed(2);
                  },
                  child: const Text('Quitar Tudo (100%)',
                      style: TextStyle(color: Color(0xFF22C55E), fontWeight: FontWeight.bold)),
                ),
              ),
              TextField(
                controller: notesCtrl,
                maxLines: 2,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Observação do abatimento',
                  labelStyle: const TextStyle(color: Colors.white70),
                  filled: true,
                  fillColor: lumoraBgDark,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () async {
                  final xFile = await _picker.pickImage(
                    source: ImageSource.gallery,
                    imageQuality: 75,
                  );
                  if (xFile != null) {
                    setDialogState(() => receiptPath = xFile.path);
                  }
                },
                icon: Icon(
                  receiptPath != null ? Icons.check_circle : Icons.attach_file_rounded,
                  color: receiptPath != null ? const Color(0xFF22C55E) : Colors.white70,
                  size: 18,
                ),
                label: Text(
                  receiptPath != null ? 'Comprovante anexado' : 'Anexar comprovante (Opcional)',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF16A34A),
                foregroundColor: Colors.white,
              ),
              onPressed: saving
                  ? null
                  : () async {
                      final parsed = double.tryParse(
                              valueCtrl.text.trim().replaceAll(',', '.')) ??
                          0;
                      final cents = (parsed * 100).round();
                      if (cents <= 0 || cents > openCents) {
                        ScaffoldMessenger.of(ctx).showSnackBar(
                          SnackBar(
                            content: Text(
                              'Valor inválido. Informe entre R\$ 0,01 e ${formatCentsBRL(openCents)}.',
                            ),
                            backgroundColor: Colors.red,
                          ),
                        );
                        return;
                      }
                      setDialogState(() => saving = true);
                      try {
                        String? uploadedReceiptUrl;
                        if (receiptPath != null) {
                          uploadedReceiptUrl = await _api.uploadFile(receiptPath!);
                        }
                        await _api.settleAdvance(
                          userId: widget.userId,
                          amountCents: cents,
                          notes: notesCtrl.text.trim(),
                          receiptUrl: uploadedReceiptUrl,
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        await _loadStatement();
                      } catch (e) {
                        setDialogState(() => saving = false);
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
              child: saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Confirmar Abatimento'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _sendStatementToWhatsApp() async {
    final s = _statement;
    if (s == null) return;
    final user = s['user'] as Map? ?? {};
    final cfg = s['companyConfig'] as Map? ?? {};
    final summary = s['summary'] as Map? ?? {};
    final entries = (s['entries'] as List?) ?? [];

    final companyName = (cfg['companyDisplayName'] ?? 'Lumora').toString();
    final pixKey = (cfg['companyPixKey'] ?? '').toString().trim();
    final pixType = (cfg['companyPixKeyType'] ?? '').toString().trim();
    final userName = (user['name'] ?? 'Profissional').toString();
    final rawPhone = (user['phone'] ?? '').toString().replaceAll(RegExp(r'\D'), '');
    final openCents = int.tryParse((summary['totalOpenCents'] ?? 0).toString()) ?? 0;

    final df = DateFormat('dd/MM/yyyy HH:mm');
    final buf = StringBuffer();
    buf.writeln('*$companyName — Extrato de Vales e Pendências*');
    buf.writeln('Profissional: *$userName*');
    buf.writeln('Saldo atual em aberto: *${formatCentsBRL(openCents)}*');
    buf.writeln('');

    if (entries.isEmpty) {
      buf.writeln('Sem movimentações registradas.');
    } else {
      buf.writeln('*Histórico de Lançamentos:*');
      for (final raw in entries.take(15)) {
        final e = Map<String, dynamic>.from(raw as Map);
        final dt = DateTime.tryParse((e['createdAt'] ?? '').toString())?.toLocal();
        final dateStr = dt != null ? df.format(dt) : '-';
        final dir = e['direction'] == 'CREDIT' ? '(-) ABATIMENTO' : '(+) VALE';
        final amt = int.tryParse((e['amountCents'] ?? 0).toString()) ?? 0;
        final cat = advanceCategoryLabel((e['category'] ?? '').toString());
        final notes = (e['notes'] ?? '').toString().trim();
        buf.writeln('• $dateStr | $dir ${formatCentsBRL(amt)} — $cat${notes.isNotEmpty ? " ($notes)" : ""}');
      }
    }

    if (pixKey.isNotEmpty) {
      buf.writeln('');
      buf.writeln(
          'Chave Pix da Empresa${pixType.isNotEmpty ? ' ($pixType)' : ''}: *$pixKey*');
    }

    final encoded = Uri.encodeComponent(buf.toString());
    final String phonePrefix = rawPhone.length >= 10
        ? (rawPhone.startsWith('55') ? rawPhone : '55$rawPhone')
        : '';
    final uri = Uri.parse(
      phonePrefix.isNotEmpty
          ? 'https://wa.me/$phonePrefix?text=$encoded'
          : 'https://wa.me/?text=$encoded',
    );
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final user = (_statement?['user'] as Map?) ?? {};
    final summary = (_statement?['summary'] as Map?) ?? {};
    final entries = (_statement?['entries'] as List?) ?? [];
    final openCents =
        int.tryParse((summary['totalOpenCents'] ?? 0).toString()) ?? 0;
    final totalDebitsCents =
        int.tryParse((summary['totalDebitsCents'] ?? 0).toString()) ?? 0;
    final totalCreditsCents =
        int.tryParse((summary['totalCreditsCents'] ?? 0).toString()) ?? 0;
    final hasAlert = summary['hasAlert'] == true;
    final df = DateFormat('dd/MM/yyyy HH:mm');

    return Scaffold(
      backgroundColor: lumoraBgDark,
      appBar: AppBar(
        backgroundColor: lumoraSurfaceDark,
        title: Text(
          (user['name'] ?? 'Extrato de Vales').toString(),
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          if (_statement != null)
            IconButton(
              icon: const Icon(Icons.chat_rounded, color: Color(0xFF22C55E)),
              tooltip: 'Enviar Extrato no WhatsApp',
              onPressed: _sendStatementToWhatsApp,
            ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            onPressed: _loadStatement,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: lumoraNeonPurple))
          : _error != null
              ? Center(
                  child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: hasAlert ? const Color(0xFF2B1018) : lumoraSurfaceDark,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: hasAlert ? const Color(0xFFEF4444) : lumoraNeonPurple,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'SALDO DEVEDOR EM ABERTO',
                            style: TextStyle(
                              color: Color(0xFFD8B4FE),
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            formatCentsBRL(openCents),
                            style: TextStyle(
                              color: hasAlert
                                  ? const Color(0xFFEF4444)
                                  : Colors.white,
                              fontSize: 28,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Débitos: ${formatCentsBRL(totalDebitsCents)} · Abatimentos: ${formatCentsBRL(totalCreditsCents)}',
                            style: const TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: _openNewDebitDialog,
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: const Text('+ Novo Vale',
                                style: TextStyle(fontWeight: FontWeight.bold)),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: lumoraNeonPurple,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: openCents > 0
                                ? () => _openSettleDialog(openCents)
                                : null,
                            icon: const Icon(Icons.remove_circle_outline, size: 18),
                            label: const Text('- Abater / Quitar',
                                style: TextStyle(fontWeight: FontWeight.bold)),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF16A34A),
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: _sendStatementToWhatsApp,
                      icon: const Icon(Icons.share_rounded, color: Color(0xFF22C55E), size: 18),
                      label: const Text('Enviar Extrato no WhatsApp (com Pix da Empresa)',
                          style: TextStyle(color: Color(0xFF86EFAC), fontSize: 12.5)),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFF22C55E)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'EXTRATO IMUTÁVEL DE MOVIMENTAÇÕES',
                      style: TextStyle(
                        color: Color(0xFFD8B4FE),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.9,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (entries.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 32),
                        child: Center(
                          child: Text(
                            'Nenhum lançamento registrado para este profissional.',
                            style: TextStyle(color: Colors.white54),
                          ),
                        ),
                      )
                    else
                      ...entries.map((raw) {
                        final e = Map<String, dynamic>.from(raw as Map);
                        final isCredit = e['direction'] == 'CREDIT';
                        final amtCents =
                            int.tryParse((e['amountCents'] ?? 0).toString()) ?? 0;
                        final dt = DateTime.tryParse((e['createdAt'] ?? '').toString())
                            ?.toLocal();
                        final notes = (e['notes'] ?? '').toString().trim();
                        final receiptUrl = (e['receiptUrl'] ?? '').toString().trim();
                        final hasSig =
                            (e['signatureBase64'] ?? '').toString().trim().isNotEmpty;
                        final batchName = e['batch']?['name']?.toString();
                        final authorName = e['createdBy']?['name']?.toString();
                        final color = isCredit
                            ? const Color(0xFF22C55E)
                            : const Color(0xFFEF4444);

                        return Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: lumoraSurfaceDark,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: color.withOpacity(0.35)),
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
                                      advanceCategoryLabel((e['category'] ?? '').toString()),
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    '${isCredit ? '-' : '+'} ${formatCentsBRL(amtCents)}',
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
                                '${dt != null ? df.format(dt) : '-'}${authorName != null ? ' · Por: $authorName' : ''}',
                                style: const TextStyle(color: Colors.white54, fontSize: 11),
                              ),
                              if (batchName != null && batchName.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 2),
                                  child: Text(
                                    'Lote: $batchName',
                                    style: const TextStyle(
                                        color: Color(0xFFD8B4FE), fontSize: 11),
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
                              if (receiptUrl.isNotEmpty || hasSig)
                                Padding(
                                  padding: const EdgeInsets.only(top: 8),
                                  child: Wrap(
                                    spacing: 8,
                                    children: [
                                      if (receiptUrl.isNotEmpty)
                                        ActionChip(
                                          avatar: const Icon(Icons.receipt_long,
                                              size: 14, color: Colors.white),
                                          label: const Text('Ver Comprovante',
                                              style: TextStyle(
                                                  color: Colors.white, fontSize: 11)),
                                          backgroundColor: lumoraBgDark,
                                          onPressed: () => showDialog(
                                            context: context,
                                            builder: (_) => Dialog(
                                              backgroundColor: Colors.black,
                                              child: AuthenticatedImage(
                                                url: receiptUrl,
                                                fit: BoxFit.contain,
                                              ),
                                            ),
                                          ),
                                        ),
                                      if (hasSig)
                                        ActionChip(
                                          avatar: const Icon(Icons.gesture_rounded,
                                              size: 14, color: Color(0xFFD8B4FE)),
                                          label: const Text('Ver Assinatura',
                                              style: TextStyle(
                                                  color: Color(0xFFD8B4FE), fontSize: 11)),
                                          backgroundColor: lumoraBgDark,
                                          onPressed: () {
                                            final bytes = base64Decode(
                                                e['signatureBase64'].toString());
                                            showDialog(
                                              context: context,
                                              builder: (_) => Dialog(
                                                backgroundColor: Colors.white,
                                                child: Padding(
                                                  padding: const EdgeInsets.all(12),
                                                  child: Image.memory(bytes),
                                                ),
                                              ),
                                            );
                                          },
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
    );
  }
}
