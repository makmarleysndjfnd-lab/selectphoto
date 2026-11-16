import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import '../telas/tela_login.dart';
import '../utils/lumora_theme.dart';

Future<void> showSecureDeleteAccountDialog(BuildContext context) async {
  final passwordCtrl = TextEditingController();
  final reasonCtrl = TextEditingController();
  bool obscure = true;
  bool submitting = false;

  await showDialog(
    context: context,
    barrierDismissible: false,
    builder: (ctx) {
      final palette = LumoraTheme.of(ctx, isAdmin: true);
      return StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: palette.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: Colors.redAccent.withOpacity(0.55)),
          ),
          title: Row(
            children: [
              const Icon(Icons.delete_forever_rounded, color: Colors.redAccent),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Excluir Minha Conta',
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.redAccent.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.redAccent.withOpacity(0.35)),
                  ),
                  child: Text(
                    'Ao confirmar com sua senha atual, seu acesso será desativado e anonimizado imediatamente em todos os aparelhos. Os registros financeiros e fiscais obrigatórios da empresa permanecem preservados.',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: passwordCtrl,
                  obscureText: obscure,
                  style: TextStyle(color: palette.textPrimary, fontSize: 14),
                  decoration: InputDecoration(
                    labelText: 'Senha atual *',
                    labelStyle: TextStyle(color: palette.accentText, fontSize: 13),
                    filled: true,
                    fillColor: palette.scaffoldBg,
                    suffixIcon: IconButton(
                      icon: Icon(
                        obscure ? Icons.visibility_off : Icons.visibility,
                        color: palette.textSecondary,
                      ),
                      onPressed: () => setDialogState(() => obscure = !obscure),
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: reasonCtrl,
                  maxLines: 2,
                  style: TextStyle(color: palette.textPrimary, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Motivo (opcional)',
                    labelStyle: TextStyle(color: palette.textSecondary, fontSize: 12),
                    filled: true,
                    fillColor: palette.scaffoldBg,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: submitting ? null : () => Navigator.pop(ctx),
              child: Text('Cancelar', style: TextStyle(color: palette.textSecondary)),
            ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.redAccent,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              icon: submitting
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.verified_user_outlined, size: 18),
              label: Text(submitting ? 'Excluindo...' : 'Confirmar Exclusão'),
              onPressed: submitting
                  ? null
                  : () async {
                      final pwd = passwordCtrl.text;
                      if (pwd.trim().isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Informe sua senha atual para confirmar.'),
                            backgroundColor: Colors.redAccent,
                          ),
                        );
                        return;
                      }
                      setDialogState(() => submitting = true);
                      try {
                        await ApiService().deleteMyAccount(
                          pwd,
                          reason: reasonCtrl.text.trim(),
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        if (context.mounted) {
                          Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
                            MaterialPageRoute(builder: (_) => const LoginScreen()),
                            (route) => false,
                          );
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Conta excluída e sessão encerrada com segurança.'),
                              backgroundColor: Colors.green,
                            ),
                          );
                        }
                      } catch (e) {
                        setDialogState(() => submitting = false);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Não foi possível excluir: $e'),
                              backgroundColor: Colors.redAccent,
                            ),
                          );
                        }
                      }
                    },
            ),
          ],
        ),
      );
    },
  );
}
