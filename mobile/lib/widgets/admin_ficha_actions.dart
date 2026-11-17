import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

const Color lumoraBgDark = Color(0xFF0D0714);
const Color lumoraSurfaceDark = Color(0xFF160D24);
const Color lumoraNeonPurple = Color(0xFFA855F7);

bool isClientEligibleForIncompleteDeletion(Map<String, dynamic> rawClient) {
  return (rawClient['id'] ?? '').toString().trim().isNotEmpty;
}

bool isClientFinalizedForMove(Map<String, dynamic> rawClient) {
  return false;
}

Future<void> showAdminEditFichaDialog(
  BuildContext context,
  Map<String, dynamic> rawClient,
  VoidCallback onSaved,
) async {
  final clientId = (rawClient['id'] ?? '').toString();
  if (clientId.isEmpty) return;

  final nameCtrl =
      TextEditingController(text: (rawClient['name'] ?? rawClient['cliente'] ?? '').toString());
  final seqCtrl =
      TextEditingController(text: (rawClient['sequenceNumber'] ?? rawClient['ficha'] ?? '').toString());
  final phoneCtrl =
      TextEditingController(text: (rawClient['phone1'] ?? '').toString());
  final cityCtrl =
      TextEditingController(text: (rawClient['city'] ?? '').toString());
  final stateCtrl =
      TextEditingController(text: (rawClient['state'] ?? '').toString());
  final streetCtrl =
      TextEditingController(text: (rawClient['street'] ?? '').toString());
  final numberCtrl =
      TextEditingController(text: (rawClient['number'] ?? '').toString());
  final neighborhoodCtrl =
      TextEditingController(text: (rawClient['neighborhood'] ?? '').toString());
  final eventCtrl =
      TextEditingController(text: (rawClient['event'] ?? '').toString());
  final reasonCtrl = TextEditingController();

  bool saving = false;

  await showDialog(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setDialogState) => AlertDialog(
        backgroundColor: lumoraSurfaceDark,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: lumoraNeonPurple.withOpacity(0.45)),
        ),
        title: const Row(
          children: [
            Icon(Icons.edit_note_rounded, color: lumoraNeonPurple),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Editar Dados da Ficha',
                style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: SizedBox(
          width: 440,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _darkField('Nome do Cliente *', nameCtrl),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: _darkField('Nº Ficha / Sequência *', seqCtrl)),
                    const SizedBox(width: 10),
                    Expanded(child: _darkField('Telefone Principal', phoneCtrl)),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(flex: 3, child: _darkField('Cidade', cityCtrl)),
                    const SizedBox(width: 10),
                    Expanded(flex: 1, child: _darkField('UF', stateCtrl)),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(flex: 3, child: _darkField('Rua / Logradouro', streetCtrl)),
                    const SizedBox(width: 10),
                    Expanded(flex: 1, child: _darkField('Nº', numberCtrl)),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: _darkField('Bairro', neighborhoodCtrl)),
                    const SizedBox(width: 10),
                    Expanded(child: _darkField('Evento', eventCtrl)),
                  ],
                ),
                const SizedBox(height: 10),
                _darkField('Motivo da edição (auditoria)', reasonCtrl,
                    hint: 'Ex.: Correção cadastral / telefone atualizado'),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: saving ? null : () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: lumoraNeonPurple,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: saving
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.save_rounded, size: 18),
            label: Text(saving ? 'Salvando...' : 'Salvar Alterações'),
            onPressed: saving
                ? null
                : () async {
                    if (nameCtrl.text.trim().isEmpty || seqCtrl.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Nome e Número da Ficha são obrigatórios.'),
                          backgroundColor: Colors.redAccent,
                        ),
                      );
                      return;
                    }
                    setDialogState(() => saving = true);
                    try {
                      await ApiService().adminEditClient(clientId, {
                        'name': nameCtrl.text.trim(),
                        'sequenceNumber': seqCtrl.text.trim(),
                        'phone1': phoneCtrl.text.trim(),
                        'city': cityCtrl.text.trim(),
                        'state': stateCtrl.text.trim(),
                        'street': streetCtrl.text.trim(),
                        'number': numberCtrl.text.trim(),
                        'neighborhood': neighborhoodCtrl.text.trim(),
                        'event': eventCtrl.text.trim(),
                        if (reasonCtrl.text.trim().isNotEmpty)
                          'reason': reasonCtrl.text.trim(),
                      });
                      if (ctx.mounted) Navigator.pop(ctx);
                      onSaved();
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Ficha atualizada com sucesso.'),
                            backgroundColor: Color(0xFF00C853),
                          ),
                        );
                      }
                    } catch (e) {
                      setDialogState(() => saving = false);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Erro ao editar ficha: $e'),
                            backgroundColor: Colors.redAccent,
                          ),
                        );
                      }
                    }
                  },
          ),
        ],
      ),
    ),
  );
}

Future<void> showAdminMoveFichaDialog(
  BuildContext context,
  Map<String, dynamic> rawClient,
  VoidCallback onMoved,
) async {
  final clientId = (rawClient['id'] ?? '').toString();
  if (clientId.isEmpty) return;

  if (isClientFinalizedForMove(rawClient)) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Fichas vendidas ou descartadas não podem ser movimentadas.'),
        backgroundColor: Colors.orangeAccent,
      ),
    );
    return;
  }

  final api = ApiService();
  String? selectedBatchId = rawClient['batchId']?.toString() ?? rawClient['batch']?['id']?.toString();
  String? selectedSellerId =
      rawClient['assignedSellerId']?.toString() ?? rawClient['assignedSeller']?['id']?.toString();
  final String? initialBatchId = selectedBatchId;
  final String? initialSellerId = selectedSellerId;

  List<Map<String, dynamic>> batches = [];
  List<Map<String, dynamic>> sellers = [];
  bool loading = true;
  bool saving = false;
  final reasonCtrl = TextEditingController();

  await showDialog(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setDialogState) {
        if (loading) {
          Future.wait([
            api.getBookBatches(includeConcluded: false),
            api.getCompanyUsers(),
          ]).then((res) {
            final rawBatches = List<dynamic>.from(res[0]);
            final rawUsers = List<dynamic>.from(res[1]);
            if (ctx.mounted) {
              setDialogState(() {
                batches = rawBatches.map((e) => Map<String, dynamic>.from(e as Map)).toList();
                sellers = rawUsers
                    .where((u) =>
                        u is Map &&
                        u['active'] == true &&
                        ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'].contains(u['role']))
                    .map((u) => Map<String, dynamic>.from(u as Map))
                    .toList();
                loading = false;
              });
            }
          }).catchError((_) {
            if (ctx.mounted) setDialogState(() => loading = false);
          });
        }

        final batchIdsSet = batches.map((b) => b['id'].toString()).toSet();
        final validBatchDropdownValue =
            (selectedBatchId != null && batchIdsSet.contains(selectedBatchId))
                ? selectedBatchId
                : null;
        final sellerIdsSet = sellers.map((s) => s['id'].toString()).toSet();
        final validSellerDropdownValue =
            (selectedSellerId != null && sellerIdsSet.contains(selectedSellerId))
                ? selectedSellerId
                : '';

        return AlertDialog(
          backgroundColor: lumoraSurfaceDark,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: lumoraNeonPurple.withOpacity(0.45)),
          ),
          title: const Row(
            children: [
              Icon(Icons.swap_horiz_rounded, color: lumoraNeonPurple),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Mover Ficha (Lote / Vendedor)',
                  style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          content: loading
              ? const SizedBox(
                  height: 110,
                  child: Center(child: CircularProgressIndicator(color: lumoraNeonPurple)),
                )
              : SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Cliente: ${(rawClient['name'] ?? rawClient['cliente'] ?? 'Cliente')}',
                        style: const TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                      const SizedBox(height: 14),
                      const Text('Lote (BookBatch) da empresa:',
                          style: TextStyle(color: lumoraNeonPurple, fontSize: 12, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      DropdownButtonFormField<String?>(
                        value: validBatchDropdownValue,
                        dropdownColor: lumoraBgDark,
                        style: const TextStyle(color: Colors.white, fontSize: 13),
                        decoration: _dropdownDecoration(),
                        hint: const Text('Manter / Sem alteração',
                            style: TextStyle(color: Colors.white54, fontSize: 13)),
                        items: [
                          ...batches.map((b) => DropdownMenuItem<String?>(
                                value: b['id'].toString(),
                                child: Text(
                                  '${b['name'] ?? 'Lote'} (${b['status'] ?? ''})',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              )),
                        ],
                        onChanged: (val) => setDialogState(() => selectedBatchId = val),
                      ),
                      const SizedBox(height: 14),
                      const Text('Vendedor ativo da empresa:',
                          style: TextStyle(color: lumoraNeonPurple, fontSize: 12, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      DropdownButtonFormField<String>(
                        value: validSellerDropdownValue,
                        dropdownColor: lumoraBgDark,
                        style: const TextStyle(color: Colors.white, fontSize: 13),
                        decoration: _dropdownDecoration(),
                        items: [
                          const DropdownMenuItem<String>(
                            value: '',
                            child: Text('Sem vendedor (Em Estoque Central)',
                                style: TextStyle(color: Colors.white70)),
                          ),
                          ...sellers.map((s) => DropdownMenuItem<String>(
                                value: s['id'].toString(),
                                child: Text(
                                  s['name']?.toString() ?? 'Vendedor',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              )),
                        ],
                        onChanged: (val) =>
                            setDialogState(() => selectedSellerId = (val == null || val.isEmpty) ? null : val),
                      ),
                      const SizedBox(height: 12),
                      _darkField('Motivo da movimentação (auditoria)', reasonCtrl,
                          hint: 'Ex.: Redistribuição de rota ou ajuste de lote'),
                    ],
                  ),
                ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
            ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: lumoraNeonPurple,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              icon: saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.check_rounded, size: 18),
              label: Text(saving ? 'Movendo...' : 'Confirmar Movimentação'),
              onPressed: saving || loading
                  ? null
                  : () async {
                      final batchChanged = selectedBatchId != initialBatchId && selectedBatchId != null;
                      final sellerChanged = selectedSellerId != initialSellerId;
                      if (!batchChanged && !sellerChanged) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Altere o lote ou o vendedor de destino antes de confirmar.'),
                            backgroundColor: Colors.orangeAccent,
                          ),
                        );
                        return;
                      }
                      setDialogState(() => saving = true);
                      try {
                        await api.moveClient(
                          clientId,
                          targetBatchId: selectedBatchId,
                          includeBatchTarget: batchChanged,
                          targetSellerId: selectedSellerId ?? '',
                          includeSellerTarget: sellerChanged,
                          reason: reasonCtrl.text.trim(),
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        onMoved();
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Ficha movimentada com sucesso.'),
                              backgroundColor: Color(0xFF00C853),
                            ),
                          );
                        }
                      } catch (e) {
                        setDialogState(() => saving = false);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Erro ao mover ficha: $e'),
                              backgroundColor: Colors.redAccent,
                            ),
                          );
                        }
                      }
                    },
            ),
          ],
        );
      },
    ),
  );
}

Future<void> confirmAdminDeleteIncompleteFicha(
  BuildContext context,
  Map<String, dynamic> rawClient,
  VoidCallback onDeleted,
) async {
  final clientId = (rawClient['id'] ?? '').toString();
  if (clientId.isEmpty) return;

  final clientName = (rawClient['name'] ?? rawClient['cliente'] ?? 'Ficha').toString();
  final status = (rawClient['bookStatus'] ?? '').toString();
  final reasonCtrl = TextEditingController();
  bool deleting = false;

  await showDialog(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setDialogState) => AlertDialog(
        backgroundColor: lumoraSurfaceDark,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: Colors.redAccent.withOpacity(0.55)),
        ),
        title: const Row(
          children: [
            Icon(Icons.delete_forever_rounded, color: Colors.redAccent),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Excluir Ficha Definitivamente',
                style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Confirma a exclusão definitiva da ficha de "$clientName" (status: $status)?',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
            ),
            const SizedBox(height: 8),
            const Text(
              'Atenção: esta ação administrativa remove a ficha e eventuais vínculos (vendas, crediário, não-vendas e histórico), mantendo o registro completo na trilha de auditoria.',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const SizedBox(height: 12),
            _darkField('Motivo da exclusão (auditoria)', reasonCtrl,
                hint: 'Ex.: Correção administrativa / ficha duplicada'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: deleting ? null : () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: deleting
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.delete_outline_rounded, size: 18),
            label: Text(deleting ? 'Excluindo...' : 'Confirmar Exclusão'),
            onPressed: deleting
                ? null
                : () async {
                    setDialogState(() => deleting = true);
                    try {
                      await ApiService().deleteIncompleteClient(
                        clientId,
                        reason: reasonCtrl.text.trim(),
                      );
                      if (ctx.mounted) Navigator.pop(ctx);
                      onDeleted();
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Ficha excluída e registrada na trilha de auditoria.'),
                            backgroundColor: Color(0xFF00C853),
                          ),
                        );
                      }
                    } catch (e) {
                      setDialogState(() => deleting = false);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Bloqueado / Erro ao excluir: $e'),
                            backgroundColor: Colors.redAccent,
                          ),
                        );
                      }
                    }
                  },
          ),
        ],
      ),
    ),
  );
}

Widget _darkField(String label, TextEditingController controller, {String? hint}) {
  return TextField(
    controller: controller,
    style: const TextStyle(color: Colors.white, fontSize: 13),
    decoration: InputDecoration(
      labelText: label,
      hintText: hint,
      hintStyle: const TextStyle(color: Colors.white30, fontSize: 12),
      labelStyle: const TextStyle(color: Color(0xFFD8B4FE), fontSize: 12),
      filled: true,
      fillColor: lumoraBgDark,
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: lumoraNeonPurple.withOpacity(0.28)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: lumoraNeonPurple, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    ),
  );
}

InputDecoration _dropdownDecoration() {
  return InputDecoration(
    filled: true,
    fillColor: lumoraBgDark,
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: lumoraNeonPurple.withOpacity(0.28)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: const BorderSide(color: lumoraNeonPurple, width: 1.5),
    ),
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
  );
}
