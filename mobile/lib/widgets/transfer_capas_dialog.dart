import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import '../utils/lumora_theme.dart';

Future<void> showTransferCapasDialog(
  BuildContext context, {
  VoidCallback? onTransferred,
}) async {
  final qtyController = TextEditingController();
  String? selectedRecipient;
  List<dynamic> recipients = [];
  bool loading = true;
  bool submitting = false;

  await showDialog(
    context: context,
    builder: (ctx) {
      final palette = LumoraTheme.of(ctx);
      return StatefulBuilder(
        builder: (ctx, setDialogState) {
          if (loading) {
            ApiService().getCompanyUsers().then((users) {
              if (ctx.mounted) {
                setDialogState(() {
                  recipients = users.where((u) {
                    final r = (u['role'] ?? '').toString().toUpperCase();
                    final isActive = u['active'] != false;
                    return isActive &&
                        [
                          'SELLER',
                          'SELLER_MANAGER',
                          'VENDEDOR',
                          'ADMIN',
                          'COMPANY_ADMIN',
                          'SUPERVISOR',
                          'SUPER_ADMIN'
                        ].contains(r);
                  }).toList();
                  loading = false;
                });
              }
            }).catchError((_) {
              if (ctx.mounted) setDialogState(() => loading = false);
            });
          }

          return AlertDialog(
            backgroundColor: palette.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
              side: BorderSide(color: palette.accent.withOpacity(0.4)),
            ),
            title: Row(
              children: [
                Icon(Icons.layers_rounded, color: palette.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Transferir Capas',
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ),
              ],
            ),
            content: loading
                ? SizedBox(
                    height: 90,
                    child: Center(
                      child: CircularProgressIndicator(color: palette.accent),
                    ),
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      DropdownButtonFormField<String>(
                        isExpanded: true,
                        dropdownColor: palette.surface,
                        value: selectedRecipient,
                        style: TextStyle(color: palette.textPrimary, fontSize: 13),
                        hint: Text('Selecione o destinatário',
                            style: TextStyle(color: palette.textSecondary)),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: palette.scaffoldBg,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        items: recipients.map((u) {
                          final rawRole = (u['role'] ?? '').toString().toUpperCase();
                          final isAdminRole = [
                            'ADMIN',
                            'COMPANY_ADMIN',
                            'SUPERVISOR',
                            'SUPER_ADMIN'
                          ].contains(rawRole);
                          final roleLabel = isAdminRole ? 'Devolver p/ Admin' : 'Vendedor';
                          return DropdownMenuItem<String>(
                            value: u['id'].toString(),
                            child: Text(
                              '${u['name']} ($roleLabel)',
                              overflow: TextOverflow.ellipsis,
                            ),
                          );
                        }).toList(),
                        onChanged: (val) => setDialogState(() => selectedRecipient = val),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: qtyController,
                        keyboardType: TextInputType.number,
                        style: TextStyle(color: palette.textPrimary, fontSize: 14),
                        decoration: InputDecoration(
                          labelText: 'Quantidade de capas',
                          labelStyle: TextStyle(color: palette.accentText),
                          filled: true,
                          fillColor: palette.scaffoldBg,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                    ],
                  ),
            actions: [
              TextButton(
                onPressed: submitting ? null : () => Navigator.pop(ctx),
                child: Text('Cancelar', style: TextStyle(color: palette.textSecondary)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: palette.accent,
                  foregroundColor: palette.isLight ? Colors.white : Colors.black,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: submitting || loading
                    ? null
                    : () async {
                        final qty = int.tryParse(qtyController.text.trim());
                        if (selectedRecipient == null || qty == null || qty <= 0) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Informe destinatário e quantidade válida.'),
                            ),
                          );
                          return;
                        }
                        setDialogState(() => submitting = true);
                        try {
                          await ApiService().transferBetweenSellers(selectedRecipient!, qty);
                          if (ctx.mounted) Navigator.pop(ctx);
                          onTransferred?.call();
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Transferência de capas realizada com sucesso!'),
                                backgroundColor: Colors.green,
                              ),
                            );
                          }
                        } catch (e) {
                          setDialogState(() => submitting = false);
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Erro ao transferir capas: $e'),
                                backgroundColor: Colors.redAccent,
                              ),
                            );
                          }
                        }
                      },
                child: Text(submitting ? 'Enviando...' : 'Transferir'),
              ),
            ],
          );
        },
      );
    },
  );
}
