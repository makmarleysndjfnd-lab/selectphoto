import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';
import 'authenticated_image.dart';

final _adjCurrency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

int computeSaleOriginalCents(Map<String, dynamic> sale) {
  final val = double.tryParse(sale['value']?.toString() ?? '0') ?? 0.0;
  return (val * 100).round().clamp(0, 1 << 30);
}

int computeSaleRefundedCents(Map<String, dynamic> sale) {
  final raw = int.tryParse(sale['refundedAmountCents']?.toString() ?? '0') ?? 0;
  return raw < 0 ? 0 : raw;
}

int computeSaleNetCents(Map<String, dynamic> sale) {
  final saleStatus = (sale['saleStatus'] ?? '').toString().toUpperCase();
  final legacyStatus = (sale['status'] ?? '').toString().toUpperCase();
  if (saleStatus == 'CANCELLED' ||
      legacyStatus == 'CANCELLED' ||
      legacyStatus == 'CANCELED') {
    return 0;
  }
  final orig = computeSaleOriginalCents(sale);
  final ref = computeSaleRefundedCents(sale);
  return (orig - ref).clamp(0, orig);
}

bool isSaleFullyCancelled(Map<String, dynamic> sale) {
  final saleStatus = (sale['saleStatus'] ?? '').toString().toUpperCase();
  final legacyStatus = (sale['status'] ?? '').toString().toUpperCase();
  return saleStatus == 'CANCELLED' ||
      legacyStatus == 'CANCELLED' ||
      legacyStatus == 'CANCELED';
}

bool isSalePartiallyRefunded(Map<String, dynamic> sale) {
  if (isSaleFullyCancelled(sale)) return false;
  final saleStatus = (sale['saleStatus'] ?? '').toString().toUpperCase();
  return saleStatus == 'PARTIALLY_REFUNDED' || computeSaleRefundedCents(sale) > 0;
}

Widget? buildSaleAdjustmentBadge(Map<String, dynamic> sale) {
  if (isSaleFullyCancelled(sale)) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.redAccent.withOpacity(0.18),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.redAccent.withOpacity(0.65)),
      ),
      child: const Text(
        'CANCELADA',
        style: TextStyle(
          color: Colors.redAccent,
          fontSize: 10,
          fontWeight: FontWeight.bold,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
  if (isSalePartiallyRefunded(sale)) {
    final refundedBrl = computeSaleRefundedCents(sale) / 100.0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.amber.withOpacity(0.16),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.amberAccent.withOpacity(0.65)),
      ),
      child: Text(
        'ESTORNO PARCIAL (-${_adjCurrency.format(refundedBrl)})',
        style: const TextStyle(
          color: Colors.amberAccent,
          fontSize: 10,
          fontWeight: FontWeight.bold,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
  return null;
}

Widget buildSaleAdjustmentsHistoryCard(List<dynamic> adjustments) {
  if (adjustments.isEmpty) return const SizedBox.shrink();

  return Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: const Color(0xFF160D24),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xFFA855F7).withOpacity(0.35)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.history_edu_rounded, color: Color(0xFFA855F7), size: 17),
            SizedBox(width: 6),
            Text(
              'HISTÓRICO DE ESTORNOS / CANCELAMENTOS',
              style: TextStyle(
                color: Color(0xFFA855F7),
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.5,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ...adjustments.map((raw) {
          final adj = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
          final isFull = (adj['type'] ?? '').toString() == 'FULL_CANCELLATION';
          final amountCents = int.tryParse(adj['amountCents']?.toString() ?? '0') ?? 0;
          final commDebitCents =
              int.tryParse(adj['commissionDebitCents']?.toString() ?? '0') ?? 0;
          final reason = (adj['reason'] ?? '').toString();
          final author = (adj['createdByName'] ?? 'Admin').toString();
          final receiptUrl = adj['receiptUrl']?.toString();
          String dateStr = '';
          if (adj['createdAt'] != null) {
            final parsed = DateTime.tryParse(adj['createdAt'].toString());
            if (parsed != null) {
              dateStr = DateFormat('dd/MM/yyyy HH:mm')
                  .format(parsed.toUtc().subtract(const Duration(hours: 3)));
            }
          }

          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF0D0714),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: (isFull ? Colors.redAccent : Colors.amberAccent).withOpacity(0.35),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: (isFull ? Colors.redAccent : Colors.amberAccent)
                            .withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        isFull ? 'Cancelamento 100%' : 'Estorno / Desconto Parcial',
                        style: TextStyle(
                          color: isFull ? Colors.redAccent : Colors.amberAccent,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '-${_adjCurrency.format(amountCents / 100.0)}',
                      style: const TextStyle(
                        color: Colors.redAccent,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  reason,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Text(
                  'Por $author${dateStr.isNotEmpty ? ' · $dateStr' : ''}',
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
                if (commDebitCents > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Débito de comissão (Vales): -${_adjCurrency.format(commDebitCents / 100.0)}',
                    style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 11),
                  ),
                ],
                if (receiptUrl != null && receiptUrl.trim().isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: SizedBox(
                      height: 110,
                      width: double.infinity,
                      child: AuthenticatedImage(url: receiptUrl, fit: BoxFit.cover),
                    ),
                  ),
                ],
              ],
            ),
          );
        }),
      ],
    ),
  );
}

Future<Map<String, dynamic>?> showAdminSaleAdjustmentModal(
  BuildContext context, {
  required Map<String, dynamic> sale,
  Future<void> Function(Map<String, dynamic> result)? onCompleted,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _AdminSaleAdjustmentSheet(
      sale: sale,
      onCompleted: onCompleted,
    ),
  );
}

class _AdminSaleAdjustmentSheet extends StatefulWidget {
  final Map<String, dynamic> sale;
  final Future<void> Function(Map<String, dynamic> result)? onCompleted;

  const _AdminSaleAdjustmentSheet({
    required this.sale,
    this.onCompleted,
  });

  @override
  State<_AdminSaleAdjustmentSheet> createState() =>
      _AdminSaleAdjustmentSheetState();
}

class _AdminSaleAdjustmentSheetState extends State<_AdminSaleAdjustmentSheet> {
  final ApiService _api = ApiService();
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _reasonController = TextEditingController();

  String _type = 'PARTIAL_REFUND_DISCOUNT';
  File? _receiptFile;
  bool _submitting = false;
  String? _errorText;

  late final int _originalCents;
  late final int _alreadyRefundedCents;
  late final int _remainingNetCents;
  late final double _sellerRate;

  @override
  void initState() {
    super.initState();
    _originalCents = computeSaleOriginalCents(widget.sale);
    _alreadyRefundedCents = computeSaleRefundedCents(widget.sale);
    _remainingNetCents = computeSaleNetCents(widget.sale);
    final seller = widget.sale['seller'] is Map
        ? Map<String, dynamic>.from(widget.sale['seller'] as Map)
        : null;
    final usesOwnCar = seller?['usesOwnCar'] == true;
    final appliedPct =
        double.tryParse(widget.sale['appliedCommissionPercent']?.toString() ?? '');
    final agr = widget.sale['creditAgreement'] is Map
        ? Map<String, dynamic>.from(widget.sale['creditAgreement'] as Map)
        : null;
    _sellerRate = (appliedPct != null && appliedPct > 0)
        ? (appliedPct / 100.0)
        : (double.tryParse(agr?['initialCommissionRate']?.toString() ?? '') ??
            (usesOwnCar ? 0.25 : 0.20));
  }

  @override
  void dispose() {
    _amountController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  int get _parsedPartialCents {
    if (_type == 'FULL_CANCELLATION') return _remainingNetCents;
    final cleaned = _amountController.text
        .trim()
        .replaceAll('R\$', '')
        .replaceAll(' ', '')
        .replaceAll(',', '.');
    final parsed = double.tryParse(cleaned);
    if (parsed == null || parsed <= 0) return 0;
    return (parsed * 100).round();
  }

  Future<void> _pickReceipt(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1600,
      );
      if (picked != null && mounted) {
        setState(() {
          _receiptFile = File(picked.path);
          _errorText = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorText = 'Erro ao selecionar imagem: $e');
      }
    }
  }

  Future<void> _submit() async {
    final amountCents = _parsedPartialCents;
    final reason = _reasonController.text.trim();

    if (amountCents <= 0) {
      setState(() => _errorText = 'Informe um valor de devolução/estorno maior que zero.');
      return;
    }
    if (amountCents > _remainingNetCents) {
      setState(() => _errorText =
          'Valor excede o saldo líquido restante (${_adjCurrency.format(_remainingNetCents / 100.0)}).');
      return;
    }
    if (reason.length < 3) {
      setState(() => _errorText = 'Informe o motivo/justificativa (mínimo 3 caracteres).');
      return;
    }

    setState(() {
      _submitting = true;
      _errorText = null;
    });

    try {
      String? uploadedUrl;
      if (_receiptFile != null) {
        uploadedUrl = await _api.uploadFile(_receiptFile!.path);
      }

      final result = await _api.refundOrCancelSale(
        saleId: widget.sale['id'].toString(),
        type: _type,
        amountCents: amountCents,
        reason: reason,
        receiptUrl: uploadedUrl,
      );

      if (widget.onCompleted != null) {
        await widget.onCompleted!(result);
      }

      if (mounted) {
        Navigator.of(context).pop(result);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _errorText = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final selectedCents = _parsedPartialCents;
    final projectedNetCents = (_remainingNetCents - selectedCents).clamp(0, _remainingNetCents);
    final estCommDebitCents =
        widget.sale['creditAgreement'] != null
            ? null
            : (selectedCents * _sellerRate).round();

    return Container(
      margin: EdgeInsets.only(top: 40, bottom: bottomInset),
      decoration: const BoxDecoration(
        color: Color(0xFF0D0714),
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        border: Border(
          top: BorderSide(color: Color(0xFFA855F7), width: 1.5),
        ),
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFA855F7).withOpacity(0.5),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFA855F7).withOpacity(0.18),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.assignment_return_rounded,
                      color: Color(0xFFA855F7), size: 22),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Cancelar / Estornar / Desconto',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        'Ação exclusiva da Administração',
                        style: TextStyle(color: Color(0xFFCE93D8), fontSize: 11),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _submitting ? null : () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: Colors.white54),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Resumo da Venda
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF160D24),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFA855F7).withOpacity(0.28)),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Valor Original:',
                          style: TextStyle(color: Colors.white60, fontSize: 12)),
                      Text(_adjCurrency.format(_originalCents / 100.0),
                          style: const TextStyle(
                              color: Colors.white, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  if (_alreadyRefundedCents > 0) ...[
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Já Estornado:',
                            style: TextStyle(color: Colors.amberAccent, fontSize: 12)),
                        Text('-${_adjCurrency.format(_alreadyRefundedCents / 100.0)}',
                            style: const TextStyle(
                                color: Colors.amberAccent,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ],
                  const Divider(color: Colors.white12, height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Saldo Líquido Atual:',
                          style: TextStyle(
                              color: Color(0xFFCE93D8),
                              fontSize: 13,
                              fontWeight: FontWeight.w600)),
                      Text(_adjCurrency.format(_remainingNetCents / 100.0),
                          style: const TextStyle(
                              color: Color(0xFF00E676),
                              fontSize: 14,
                              fontWeight: FontWeight.bold)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // Tipo de operação
            const Text(
              'TIPO DE OPERAÇÃO',
              style: TextStyle(
                color: Color(0xFFA855F7),
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.6,
              ),
            ),
            const SizedBox(height: 8),
            _buildTypeOption(
              value: 'PARTIAL_REFUND_DISCOUNT',
              title: 'Desconto / Estorno Parcial com Devolução ao Cliente',
              subtitle: 'Deduz parte do valor pago ou das parcelas mantendo a venda líquida ativa',
              color: Colors.amberAccent,
            ),
            const SizedBox(height: 8),
            _buildTypeOption(
              value: 'FULL_CANCELLATION',
              title: 'Cancelamento Total (Estorno 100%)',
              subtitle: 'Cancela integralmente a venda, crediário aberto e restaura capa',
              color: Colors.redAccent,
            ),
            const SizedBox(height: 14),

            if (_type == 'PARTIAL_REFUND_DISCOUNT') ...[
              TextField(
                controller: _amountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(
                    color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                onChanged: (_) => setState(() => _errorText = null),
                decoration: InputDecoration(
                  labelText: 'Valor a Devolver / Descontar (R\$)',
                  hintText: 'Ex: 150,00',
                  labelStyle: const TextStyle(color: Color(0xFFCE93D8)),
                  hintStyle: const TextStyle(color: Colors.white30),
                  prefixIcon: const Icon(Icons.currency_exchange_rounded,
                      color: Color(0xFFA855F7)),
                  filled: true,
                  fillColor: const Color(0xFF160D24),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                        color: const Color(0xFFA855F7).withOpacity(0.35)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Color(0xFFA855F7), width: 1.5),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            TextField(
              controller: _reasonController,
              maxLines: 3,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              onChanged: (_) => setState(() => _errorText = null),
              decoration: InputDecoration(
                labelText: 'Justificativa / Motivo Obrigatório',
                hintText: 'Descreva o acordo com o cliente ou motivo do estorno...',
                labelStyle: const TextStyle(color: Color(0xFFCE93D8)),
                hintStyle: const TextStyle(color: Colors.white30),
                alignLabelWithHint: true,
                filled: true,
                fillColor: const Color(0xFF160D24),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide:
                      BorderSide(color: const Color(0xFFA855F7).withOpacity(0.35)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: Color(0xFFA855F7), width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Comprovante de devolução opcional
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF160D24),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.receipt_long_rounded,
                          color: Color(0xFFCE93D8), size: 17),
                      const SizedBox(width: 6),
                      const Expanded(
                        child: Text(
                          'Comprovante de Devolução / Pix (Opcional)',
                          style: TextStyle(
                              color: Colors.white70,
                              fontSize: 12,
                              fontWeight: FontWeight.w600),
                        ),
                      ),
                      if (_receiptFile != null)
                        IconButton(
                          tooltip: 'Remover foto',
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(Icons.delete_outline,
                              color: Colors.redAccent, size: 18),
                          onPressed: _submitting
                              ? null
                              : () => setState(() => _receiptFile = null),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_receiptFile != null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.file(
                        _receiptFile!,
                        height: 120,
                        width: double.infinity,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _submitting
                              ? null
                              : () => _pickReceipt(ImageSource.gallery),
                          icon: const Icon(Icons.photo_library_outlined,
                              size: 16, color: Color(0xFFCE93D8)),
                          label: const Text('Galeria',
                              style: TextStyle(color: Color(0xFFCE93D8), fontSize: 12)),
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(
                                color: const Color(0xFFA855F7).withOpacity(0.4)),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _submitting
                              ? null
                              : () => _pickReceipt(ImageSource.camera),
                          icon: const Icon(Icons.camera_alt_outlined,
                              size: 16, color: Color(0xFFCE93D8)),
                          label: const Text('Câmera',
                              style: TextStyle(color: Color(0xFFCE93D8), fontSize: 12)),
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(
                                color: const Color(0xFFA855F7).withOpacity(0.4)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Prévia de Impacto
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFA855F7).withOpacity(0.10),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFA855F7).withOpacity(0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'IMPACTO ESTIMADO',
                    style: TextStyle(
                      color: Color(0xFFA855F7),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Novo Saldo Líquido da Venda:',
                          style: TextStyle(color: Colors.white70, fontSize: 12)),
                      Text(
                        _adjCurrency.format(projectedNetCents / 100.0),
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 13),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Débito Comissão Vendedor:',
                          style: TextStyle(color: Colors.white70, fontSize: 12)),
                      Text(
                        estCommDebitCents != null
                            ? '-${_adjCurrency.format(estCommDebitCents / 100.0)}'
                            : 'Calculado no servidor',
                        style: const TextStyle(
                            color: Color(0xFFCE93D8),
                            fontWeight: FontWeight.bold,
                            fontSize: 12),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            if (_errorText != null) ...[
              const SizedBox(height: 10),
              Text(
                _errorText!,
                style: const TextStyle(color: Colors.redAccent, fontSize: 12),
              ),
            ],
            const SizedBox(height: 16),

            ElevatedButton.icon(
              onPressed: _submitting ? null : _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: _type == 'FULL_CANCELLATION'
                    ? Colors.redAccent
                    : const Color(0xFFA855F7),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          color: Colors.white, strokeWidth: 2),
                    )
                  : Icon(_type == 'FULL_CANCELLATION'
                      ? Icons.cancel_outlined
                      : Icons.check_circle_outline_rounded),
              label: Text(
                _submitting
                    ? 'Processando...'
                    : (_type == 'FULL_CANCELLATION'
                        ? 'Confirmar Cancelamento Total (100%)'
                        : 'Confirmar Estorno / Desconto'),
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypeOption({
    required String value,
    required String title,
    required String subtitle,
    required Color color,
  }) {
    final selected = _type == value;
    return InkWell(
      onTap: _submitting
          ? null
          : () => setState(() {
                _type = value;
                _errorText = null;
              }),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.12) : const Color(0xFF160D24),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? color : Colors.white12,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_unchecked_rounded,
              color: selected ? color : Colors.white38,
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: selected ? Colors.white : Colors.white70,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
