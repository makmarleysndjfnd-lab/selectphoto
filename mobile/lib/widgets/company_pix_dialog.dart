import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import '../utils/lumora_theme.dart';

const List<Map<String, String>> lumoraPixKeyTypes = [
  {'value': 'EVP', 'label': 'Chave Aleatória (EVP)'},
  {'value': 'CNPJ', 'label': 'CNPJ'},
  {'value': 'CPF', 'label': 'CPF'},
  {'value': 'EMAIL', 'label': 'E-mail'},
  {'value': 'PHONE', 'label': 'Telefone / Celular'},
];

Future<void> showCompanyPixKeyDialog(
  BuildContext context, {
  String? initialKey,
  String? initialType,
  VoidCallback? onSaved,
}) async {
  final keyCtrl = TextEditingController(text: initialKey ?? '');
  String? selectedType = (initialType != null && initialType.trim().isNotEmpty)
      ? initialType.trim().toUpperCase()
      : 'EVP';
  bool loading = initialKey == null;
  bool saving = false;

  await showDialog(
    context: context,
    builder: (ctx) {
      final palette = LumoraTheme.of(ctx, isAdmin: true);
      return StatefulBuilder(
        builder: (ctx, setDialogState) {
          if (loading) {
            ApiService().getCompanyPixKey().then((res) {
              if (ctx.mounted) {
                setDialogState(() {
                  keyCtrl.text = res['companyPixKey']?.toString() ?? '';
                  final t = res['companyPixKeyType']?.toString().toUpperCase();
                  if (t != null && t.isNotEmpty) {
                    selectedType = t;
                  }
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
              side: BorderSide(color: palette.accent.withOpacity(0.45)),
            ),
            title: Row(
              children: [
                Icon(Icons.pix, color: palette.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Chave Pix da Empresa',
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
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
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Chave exibida ao vendedor no fechamento diário apenas quando houver repasse do Vendedor para a Empresa.',
                        style: TextStyle(color: palette.textSecondary, fontSize: 12),
                      ),
                      const SizedBox(height: 14),
                      DropdownButtonFormField<String>(
                        value: selectedType,
                        dropdownColor: palette.surface,
                        style: TextStyle(color: palette.textPrimary, fontSize: 13),
                        decoration: InputDecoration(
                          labelText: 'Tipo da Chave Pix',
                          labelStyle: TextStyle(color: palette.accentText, fontSize: 12),
                          filled: true,
                          fillColor: palette.scaffoldBg,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        items: lumoraPixKeyTypes
                            .map((t) => DropdownMenuItem<String>(
                                  value: t['value'],
                                  child: Text(t['label']!),
                                ))
                            .toList(),
                        onChanged: (val) => setDialogState(() => selectedType = val),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: keyCtrl,
                        maxLength: 140,
                        style: TextStyle(color: palette.textPrimary, fontSize: 14),
                        decoration: InputDecoration(
                          labelText: 'Chave Pix da Empresa',
                          labelStyle: TextStyle(color: palette.accentText, fontSize: 12),
                          hintText: 'Ex.: CNPJ, e-mail financeiro ou chave aleatória',
                          filled: true,
                          fillColor: palette.scaffoldBg,
                          prefixIcon: Icon(Icons.key, color: palette.accent),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                    ],
                  ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(ctx),
                child: Text('Cancelar', style: TextStyle(color: palette.textSecondary)),
              ),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: palette.accent,
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
                label: Text(saving ? 'Salvando...' : 'Salvar Pix'),
                onPressed: saving || loading
                    ? null
                    : () async {
                        setDialogState(() => saving = true);
                        try {
                          await ApiService().saveCompanyPixKey(
                            keyCtrl.text.trim(),
                            pixKeyType: selectedType,
                          );
                          if (ctx.mounted) Navigator.pop(ctx);
                          onSaved?.call();
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Chave Pix da Empresa salva com sucesso.'),
                                backgroundColor: Color(0xFF00C853),
                              ),
                            );
                          }
                        } catch (e) {
                          setDialogState(() => saving = false);
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Erro ao salvar Pix da Empresa: $e'),
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
      );
    },
  );
}
