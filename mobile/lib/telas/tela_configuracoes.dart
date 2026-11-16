import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../provedores/provedor_configuracoes.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_login.dart';
import 'tela_config_impressora.dart';
import 'tela_demonstrativo_empresa_lumora.dart';
import 'tela_suporte_empresa.dart';
import 'tela_integracoes_empresa.dart';
import 'tela_sincronizacao.dart';
import '../utils/lumora_theme.dart';
import '../widgets/account_deletion_dialog.dart';
import '../widgets/company_pix_dialog.dart';
import 'package:share_plus/share_plus.dart';
import 'package:file_picker/file_picker.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';
import 'package:url_launcher/url_launcher.dart';

class SettingsScreen extends StatefulWidget {
  /// Somente administradores devem receber [canManageRoi] = true.
  /// O padrão é false (fechado) para garantir que vendedores e fotógrafos
  /// não visualizem nem alterem os parâmetros de ROI por engano.
  final bool canManageRoi;

  /// [isFotografo] controla funcionalidades exclusivas do fotógrafo:
  /// lista unificada vertical com ações de lote, impressora, sincronização e segurança.
  final bool isFotografo;

  /// [isVendedor] exibe ações operacionais do vendedor (transferência de capas, books e despesas).
  final bool isVendedor;

  /// Ações e dados do lote ativo para fotógrafos
  final VoidCallback? onPrintLote;
  final VoidCallback? onFinalizeLote;
  final String? currentLoteName;
  final int? currentLoteCount;

  const SettingsScreen({
    super.key,
    this.canManageRoi = false,
    this.isFotografo = false,
    this.isVendedor = false,
    this.onPrintLote,
    this.onFinalizeLote,
    this.currentLoteName,
    this.currentLoteCount,
  });

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _urlController = TextEditingController();
  final TextEditingController _hotelCtrl = TextEditingController();
  final TextEditingController _foodCtrl = TextEditingController();
  final TextEditingController _fuelCtrl = TextEditingController();
  final TextEditingController _prodCtrl = TextEditingController();
  final TextEditingController _ticketCtrl = TextEditingController();
  final TextEditingController _fichasCtrl = TextEditingController();
  final TextEditingController _pixCtrl = TextEditingController();
  String _pixKeyType = 'EVP';
  bool _savingPix = false;

  @override
  void initState() {
    super.initState();
    final settings = Provider.of<SettingsProvider>(context, listen: false);
    _urlController.text = settings.serverUrl;
    _hotelCtrl.text = settings.hotelCostPerPersonDay.toStringAsFixed(2);
    _foodCtrl.text = settings.foodCostPerPersonDay.toStringAsFixed(2);
    _fuelCtrl.text = settings.fuelCostPerKm.toStringAsFixed(2);
    _prodCtrl.text = settings.productCost.toStringAsFixed(2);
    _ticketCtrl.text = settings.defaultTicket.toStringAsFixed(2);
    _fichasCtrl.text = settings.defaultFichasPerDay.toString();
    if (widget.canManageRoi) _loadPixKey();
  }

  Future<void> _loadPixKey() async {
    try {
      final res = await ApiService().getCompanyPixKey();
      final key = res['companyPixKey']?.toString() ?? '';
      final type = res['companyPixKeyType']?.toString().toUpperCase();
      if (mounted) {
        setState(() {
          _pixCtrl.text = key;
          if (type != null && type.isNotEmpty) {
            _pixKeyType = type;
          }
        });
      }
    } catch (_) {
      try {
        final fallbackKey = await ApiService().getMyPixKey();
        if (mounted && _pixCtrl.text.isEmpty) {
          setState(() => _pixCtrl.text = fallbackKey);
        }
      } catch (_) {}
    }
  }

  Future<void> _savePixKey() async {
    if (_savingPix) return;
    setState(() => _savingPix = true);
    try {
      final res = await ApiService().saveCompanyPixKey(
        _pixCtrl.text,
        pixKeyType: _pixKeyType,
      );
      final saved = res['companyPixKey']?.toString() ?? _pixCtrl.text.trim();
      if (!mounted) return;
      setState(() => _pixCtrl.text = saved);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Chave PIX da Empresa salva com sucesso.'),
          backgroundColor: Colors.green));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Erro ao salvar PIX da Empresa: $e'),
            backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _savingPix = false);
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _hotelCtrl.dispose();
    _foodCtrl.dispose();
    _fuelCtrl.dispose();
    _prodCtrl.dispose();
    _ticketCtrl.dispose();
    _fichasCtrl.dispose();
    _pixCtrl.dispose();
    super.dispose();
  }

  void _saveRoiSettings(SettingsProvider settings) {
    final double hotel =
        double.tryParse(_hotelCtrl.text.replaceAll(',', '.')) ?? 70.0;
    final double food =
        double.tryParse(_foodCtrl.text.replaceAll(',', '.')) ?? 50.0;
    final double fuel =
        double.tryParse(_fuelCtrl.text.replaceAll(',', '.')) ?? 0.60;
    final double prod =
        double.tryParse(_prodCtrl.text.replaceAll(',', '.')) ?? 21.0;
    final double ticket =
        double.tryParse(_ticketCtrl.text.replaceAll(',', '.')) ?? 150.0;
    final int fichas = int.tryParse(_fichasCtrl.text) ?? 30;

    settings.updateRoiSettings(
      hotelCost: hotel,
      foodCost: food,
      fuelKmCost: fuel,
      prodCost: prod,
      ticket: ticket,
      fichasPerDay: fichas,
    );

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
          content: Text('Parâmetros de ROI salvos com sucesso!'),
          backgroundColor: Colors.green),
    );
  }

  void _handleLogout(BuildContext context) async {
    // Clear API token
    Provider.of<ApiService>(context, listen: false).clearToken();

    // Clear token from SharedPreferences
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('jwt_token');
    await prefs.remove('user_role');

    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  void _openLegalUrl(String path) async {
    final uri = Uri.parse('https://selectphoto-k1ac.onrender.com/legal/$path');
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não foi possível abrir o link: $e')),
        );
      }
    }
  }

  Future<void> _showMyContractDialog(BuildContext context) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator(color: Color(0xFF4FC3F7))),
    );

    Map<String, dynamic>? data;
    String? errorMsg;
    try {
      data = await ApiService().getMyCompanyContract();
    } catch (e) {
      errorMsg = e.toString().replaceAll('Exception: ', '');
    }

    if (!mounted) return;
    Navigator.pop(context);

    if (errorMsg != null || data == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao consultar contrato: $errorMsg'), backgroundColor: Colors.redAccent),
      );
      return;
    }

    final company = data['company'] as Map<String, dynamic>? ?? {};
    final currentRate = data['currentRate'] as Map<String, dynamic>?;
    final rateHistory = (data['rateHistory'] as List<dynamic>?) ?? [];
    final note = data['note']?.toString() ?? '';

    if (!context.mounted) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF141E2E),
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.75,
          minChildSize: 0.4,
          maxChildSize: 0.95,
          expand: false,
          builder: (_, scrollCtrl) {
            return SingleChildScrollView(
              controller: scrollCtrl,
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFF4FC3F7).withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(Icons.description_rounded, color: Color(0xFF4FC3F7), size: 24),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              company['name']?.toString() ?? 'Empresa',
                              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            Text(
                              company['cnpj'] != null && company['cnpj'].toString().isNotEmpty
                                  ? 'CNPJ: ${company['cnpj']}'
                                  : 'Contrato Lumora',
                              style: const TextStyle(color: Colors.white54, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: company['status'] == 'ACTIVE' ? Colors.green.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: company['status'] == 'ACTIVE' ? Colors.green : Colors.orange),
                        ),
                        child: Text(
                          company['status'] == 'ACTIVE' ? 'ATIVO' : (company['status']?.toString() ?? 'INATIVO'),
                          style: TextStyle(
                            color: company['status'] == 'ACTIVE' ? Colors.greenAccent : Colors.orangeAccent,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [const Color(0xFF0D3B6E).withOpacity(0.4), const Color(0xFF1B2A4A)],
                      ),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFF4FC3F7).withOpacity(0.3)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Taxa Lumora Vigente',
                          style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Text(
                              currentRate != null ? '${currentRate['ratePercentage'] ?? currentRate['percentage']}%' : 'Não configurada',
                              style: TextStyle(
                                color: currentRate != null ? const Color(0xFF4FC3F7) : Colors.orangeAccent,
                                fontSize: 26,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(width: 8),
                            if (currentRate != null)
                              Text(
                                '(versão ${currentRate['version'] ?? currentRate['contractVersion']})',
                                style: const TextStyle(color: Colors.white54, fontSize: 13),
                              ),
                          ],
                        ),
                        if (currentRate != null && currentRate['effectiveFrom'] != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Vigência desde: ${currentRate['effectiveFrom'].toString().split('T')[0]}',
                            style: const TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                        ],
                        if (currentRate?['changeReason'] != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Justificativa: ${currentRate!['changeReason']}',
                            style: const TextStyle(color: Colors.white54, fontSize: 11, fontStyle: FontStyle.italic),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.04),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, color: Color(0xFF90CAF9), size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            note.isNotEmpty
                                ? note
                                : 'A remuneração do Lumora é configurada exclusivamente pelo proprietário da plataforma. Esta consulta é apenas informativa.',
                            style: const TextStyle(color: Colors.white70, fontSize: 11, height: 1.4),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Histórico Contratual da Remuneração',
                    style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 10),
                  if (rateHistory.isEmpty)
                    const Text('Nenhum histórico registrado até o momento.', style: TextStyle(color: Colors.white54, fontSize: 12))
                  else
                    ...rateHistory.map((r) {
                      final p = r['percentage']?.toString() ?? '-';
                      final v = r['contractVersion']?.toString() ?? '-';
                      final from = r['effectiveFrom']?.toString().split('T')[0] ?? '-';
                      final to = r['effectiveTo'] != null ? r['effectiveTo'].toString().split('T')[0] : 'Vigente';
                      final reason = r['changeReason']?.toString() ?? '';
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Text('v$v', style: const TextStyle(color: Color(0xFF4FC3F7), fontWeight: FontWeight.bold)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('$p% ($from \u2192 $to)', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                                  if (reason.isNotEmpty)
                                    Text(reason, style: const TextStyle(color: Colors.white54, fontSize: 11)),
                                ],
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: LedButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Fechar'),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _handleSync(BuildContext context) async {
    final syncService = Provider.of<SyncService>(context, listen: false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Iniciando sincronização...')),
    );
    try {
      await syncService.syncAllPending();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Sincronização concluída com sucesso!'),
              backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro na sincronização: $e'),
              backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = Provider.of<SettingsProvider>(context);
    final palette = LumoraTheme.of(context, isAdmin: widget.canManageRoi);

    // ── VISÃO UNIFICADA DO FOTÓGRAFO ──────────────────────────────────────────
    if (widget.isFotografo) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Configurações do Fotógrafo',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: palette.headerStart,
          iconTheme: const IconThemeData(color: Colors.white),
        ),
        backgroundColor: palette.scaffoldBg,
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // 1. Imprimir Lote Atual
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: const Icon(Icons.print_rounded, color: Color(0xFFFFB74D)),
                ),
                title: Text('Imprimir Lote Atual',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  widget.currentLoteName != null && widget.currentLoteName!.isNotEmpty
                      ? 'Lote em uso: ${widget.currentLoteName} (${widget.currentLoteCount ?? 0} ficha(s))'
                      : 'Imprime o relatório de fechamento do lote em uso',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                trailing: Icon(Icons.arrow_forward_ios_rounded, color: palette.textSecondary, size: 16),
                onTap: () {
                  if (widget.onPrintLote != null) {
                    widget.onPrintLote!();
                  } else {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Nenhum lote ativo configurado para impressão.'),
                      backgroundColor: Colors.orange,
                    ));
                  }
                },
              ),
            ),
            const SizedBox(height: 12),

            // 2. Finalizar Produção do Lote
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: const Icon(Icons.done_all_rounded, color: Color(0xFFCE93D8)),
                ),
                title: Text('Finalizar Produção do Lote',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  'Notifica o admin e encerra a produção deste lote para envio à gráfica',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                trailing: Icon(Icons.arrow_forward_ios_rounded, color: palette.textSecondary, size: 16),
                onTap: () {
                  if (widget.onFinalizeLote != null) {
                    widget.onFinalizeLote!();
                  } else {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Nenhum lote ativo para finalizar.'),
                      backgroundColor: Colors.orange,
                    ));
                  }
                },
              ),
            ),
            const SizedBox(height: 12),

            // 3. Sincronização / Pendências Offline
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: const Icon(Icons.sync_rounded, color: Color(0xFF4FC3F7)),
                ),
                title: Text('Sincronização & Pendências Offline',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  'Sincroniza fichas e fotos locais com o servidor',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                trailing: Icon(Icons.arrow_forward_ios_rounded, color: palette.textSecondary, size: 16),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const SyncScreen()),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),

            // 4. Modo Escuro / Modo Claro
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: Icon(
                    settings.isDarkMode ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                    color: palette.accent,
                  ),
                ),
                title: Text(settings.isDarkMode ? 'Modo Escuro' : 'Modo Claro',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  settings.isDarkMode ? 'Tema escuro ativado' : 'Tema claro ativado',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                trailing: Switch(
                  value: settings.isDarkMode,
                  onChanged: (val) => settings.setDarkMode(val),
                  activeColor: palette.accent,
                ),
              ),
            ),
            const SizedBox(height: 12),

            // 5. Configurar Impressora Bluetooth
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: const Icon(Icons.bluetooth_connected_rounded, color: Color(0xFF81C784)),
                ),
                title: Text('Configurar Impressora Bluetooth',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  'Conectar impressora térmica portátil para comprovantes',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                trailing: Icon(Icons.arrow_forward_ios_rounded, color: palette.textSecondary, size: 16),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const PrinterConfigScreen()),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),

            // 6. Notificações Disponíveis
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: const Icon(Icons.notifications_active_outlined, color: Colors.amberAccent),
                ),
                title: Text('Notificações Disponíveis',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  'Scout Automático de Eventos (Push IA) na sua região',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.amber.withOpacity(0.14),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.amberAccent.withOpacity(0.5)),
                  ),
                  child: const Text('Ativo',
                      style: TextStyle(color: Colors.amber, fontSize: 10, fontWeight: FontWeight.bold)),
                ),
              ),
            ),
            const SizedBox(height: 12),

            // 7. Política de Privacidade
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: palette.surfaceAlt,
                  child: const Icon(Icons.privacy_tip_outlined, color: Color(0xFF4FC3F7)),
                ),
                title: Text('Política de Privacidade',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text('Minuta técnica e proteção de dados',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                trailing: Icon(Icons.open_in_new_rounded, color: palette.textSecondary, size: 18),
                onTap: () => _openLegalUrl('privacy.html'),
              ),
            ),
            const SizedBox(height: 12),

            // 8. Exclusão Segura de Conta
            LedCard(
              color: Colors.redAccent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: Colors.redAccent.withOpacity(0.14),
                  child: const Icon(Icons.person_remove_outlined, color: Colors.redAccent),
                ),
                title: const Text('Excluir Conta',
                    style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                subtitle: Text('Confirme sua senha atual para encerrar e anonimizar o acesso',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                trailing: const Icon(Icons.chevron_right_rounded, color: Colors.redAccent),
                onTap: () => showSecureDeleteAccountDialog(context),
              ),
            ),
            const SizedBox(height: 16),

            // 9. Sair da Conta (preserva rascunhos e fichas locais)
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: Colors.redAccent.withOpacity(0.12),
                  child: const Icon(Icons.logout_rounded, color: Colors.redAccent),
                ),
                title: const Text('Sair da Conta',
                    style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                subtitle: Text('Preserva rascunhos e fichas pendentes no dispositivo',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                onTap: () => _handleLogout(context),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      );
    }

    // ── VISÃO GERAL (ADMIN / SUPER_ADMIN / VENDEDOR) ──────────────────────────

    return Scaffold(
      appBar: AppBar(
        title:
            const Text('Configurações', style: TextStyle(color: Colors.white)),
        backgroundColor: palette.headerStart,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      backgroundColor: palette.scaffoldBg,
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Theme Settings
          LedCard(
            color: palette.accent,
            child: ListTile(
              leading: Icon(
                settings.isDarkMode ? Icons.dark_mode : Icons.light_mode,
                color: palette.accent,
              ),
              title: Text(
                settings.isDarkMode ? 'Modo Escuro' : 'Modo Claro',
                style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold),
              ),
              subtitle: Text(
                settings.isDarkMode
                    ? 'Alternar para tema claro de alta legibilidade'
                    : 'Tema claro ativado (toque para voltar ao escuro)',
                style: TextStyle(color: palette.textSecondary, fontSize: 12),
              ),
              trailing: Switch(
                value: settings.isDarkMode,
                onChanged: (val) => settings.setDarkMode(val),
                activeColor: palette.accent,
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Server URL Settings (Apenas em ambiente de desenvolvimento / debug)
          if (!kReleaseMode) ...[
            LedCard(
              color: const Color(0xFF1A1A2E),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('IP / URL do Servidor (Debug)',
                        style: TextStyle(color: Colors.white70, fontSize: 14)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _urlController,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        filled: true,
                        fillColor: Color(0xFF161625),
                        border: OutlineInputBorder(),
                        hintText: 'https://seuservidor.com/api',
                        hintStyle: TextStyle(color: Colors.white30),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: LedButton(
                        style: LedButton.styleFrom(
                            backgroundColor: const Color(0xFF0288D1)),
                        onPressed: () {
                          settings.setServerUrl(_urlController.text.trim());
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('URL salva com sucesso!'),
                                backgroundColor: Colors.green),
                          );
                        },
                        child: const Text('Salvar Servidor',
                            style: TextStyle(color: Colors.white)),
                      ),
                    )
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          if (widget.canManageRoi) ...[
            LedCard(
              color: palette.accent,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.pix, color: Colors.greenAccent),
                      const SizedBox(width: 8),
                      Expanded(
                          child: Text('PIX da Empresa para recebimento de repasses',
                              style: TextStyle(
                                  color: palette.textPrimary,
                                  fontWeight: FontWeight.bold))),
                    ]),
                    const SizedBox(height: 8),
                    Text(
                        'Chave cadastrada da empresa exibida apenas quando o vendedor precisar repassar valores à empresa.',
                        style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: _pixKeyType,
                      dropdownColor: palette.surface,
                      style: TextStyle(color: palette.textPrimary, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Tipo da Chave PIX',
                      ),
                      items: lumoraPixKeyTypes
                          .map((t) => DropdownMenuItem<String>(
                                value: t['value'],
                                child: Text(t['label']!),
                              ))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) setState(() => _pixKeyType = val);
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _pixCtrl,
                      style: TextStyle(color: palette.textPrimary),
                      maxLength: 140,
                      decoration: const InputDecoration(
                          labelText: 'Chave PIX da Empresa',
                          prefixIcon: Icon(Icons.key)),
                    ),
                    SizedBox(
                      width: double.infinity,
                      child: LedButton(
                        onPressed: _savingPix ? null : _savePixKey,
                        child: Text(
                            _savingPix ? 'Salvando...' : 'Salvar chave PIX da Empresa'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            LedCard(
              color: const Color(0xFF1A1A2E),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.calculate,
                            color: palette.accent, size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Parâmetros Base da Calculadora de ROI',
                            style: TextStyle(
                                color: palette.textPrimary,
                                fontWeight: FontWeight.bold,
                                fontSize: 15),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Valores padrão usados para estimar o lucro líquido das viagens.',
                      style: TextStyle(color: palette.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _hotelCtrl,
                            keyboardType: TextInputType.number,
                            style: TextStyle(color: palette.textPrimary),
                            decoration: InputDecoration(
                              labelText: 'Hospedagem (R\$/p/dia)',
                              labelStyle: TextStyle(
                                  color: palette.textSecondary, fontSize: 12),
                              filled: true,
                              fillColor: palette.scaffoldBg,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _foodCtrl,
                            keyboardType: TextInputType.number,
                            style: TextStyle(color: palette.textPrimary),
                            decoration: InputDecoration(
                              labelText: 'Alimentação (R\$/p/dia)',
                              labelStyle: TextStyle(
                                  color: palette.textSecondary, fontSize: 12),
                              filled: true,
                              fillColor: palette.scaffoldBg,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _fuelCtrl,
                            keyboardType: TextInputType.number,
                            style: TextStyle(color: palette.textPrimary),
                            decoration: InputDecoration(
                              labelText: 'Combustível (R\$/km)',
                              labelStyle: TextStyle(
                                  color: palette.textSecondary, fontSize: 12),
                              filled: true,
                              fillColor: palette.scaffoldBg,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _prodCtrl,
                            keyboardType: TextInputType.number,
                            style: TextStyle(color: palette.textPrimary),
                            decoration: InputDecoration(
                              labelText: 'Custo Produto (R\$)',
                              labelStyle: TextStyle(
                                  color: palette.textSecondary, fontSize: 12),
                              filled: true,
                              fillColor: palette.scaffoldBg,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _ticketCtrl,
                            keyboardType: TextInputType.number,
                            style: TextStyle(color: palette.textPrimary),
                            decoration: InputDecoration(
                              labelText: 'Ticket Médio (R\$)',
                              labelStyle: TextStyle(
                                  color: palette.textSecondary, fontSize: 12),
                              filled: true,
                              fillColor: palette.scaffoldBg,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _fichasCtrl,
                            keyboardType: TextInputType.number,
                            style: TextStyle(color: palette.textPrimary),
                            decoration: InputDecoration(
                              labelText: 'Fichas/Dia Padrão',
                              labelStyle: TextStyle(
                                  color: palette.textSecondary, fontSize: 12),
                              filled: true,
                              fillColor: palette.scaffoldBg,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: LedButton(
                        style: LedButton.styleFrom(
                            backgroundColor: const Color(0xFFCE93D8)),
                        onPressed: () => _saveRoiSettings(settings),
                        child: const Text('Salvar Parâmetros de ROI',
                            style: TextStyle(
                                color: Colors.black,
                                fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: const Icon(Icons.description_rounded, color: Color(0xFF4FC3F7)),
                title: Text('Contrato Lumora (Consulta)',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text('Consulte os dados da sua empresa, taxa e vigência atual',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                trailing: Icon(Icons.arrow_forward_ios_rounded, color: palette.textSecondary, size: 16),
                onTap: () => _showMyContractDialog(context),
              ),
            ),
            const SizedBox(height: 16),
          ],

          if (widget.canManageRoi) ...[
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: const Icon(Icons.receipt_long_rounded,
                    color: Colors.amberAccent),
                title: Text('Demonstrativo Mensal Lumora (Consulta)',
                    style: TextStyle(
                        color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                    'Competências, vigências, itens e saldo B2B sem dados pessoais',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                trailing: Icon(Icons.arrow_forward_ios_rounded,
                    color: palette.textSecondary, size: 16),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const TelaDemonstrativoEmpresaLumora(),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: const Icon(Icons.support_agent_rounded,
                    color: Color(0xFF38BDF8)),
                title: Text('Suporte Técnico Lumora',
                    style: TextStyle(
                        color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                    'Abertura de chamados, mensagens e autorização de acesso técnico',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                trailing: Icon(Icons.arrow_forward_ios_rounded,
                    color: palette.textSecondary, size: 16),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const TelaSuporteEmpresa(),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            LedCard(
              color: palette.accent,
              child: ListTile(
                leading: const Icon(Icons.api_rounded, color: Color(0xFF10B981)),
                title: Text('Integrações da minha empresa',
                    style: TextStyle(color: palette.textPrimary, fontWeight: FontWeight.bold)),
                subtitle: Text(
                    'Cadastre e teste suas credenciais de IA (Gemini), Asaas e WhatsApp',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                trailing: Icon(Icons.arrow_forward_ios_rounded,
                    color: palette.textSecondary, size: 16),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const TelaIntegracoesEmpresa(),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Operações do vendedor ficam na aba Operações (painel principal),
          // mantendo Configurações enxuta para ajustes de conta e sistema.
          // Actions
          LedCard(
            color: palette.accent,
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.sync, color: Colors.greenAccent),
                  title: Text('Sincronizar Manualmente',
                      style: TextStyle(color: palette.textPrimary)),
                  subtitle: Text('Envia dados offline pendentes',
                      style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  onTap: () => _handleSync(context),
                ),
                if (widget.isFotografo) ...[
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading:
                        const Icon(Icons.print, color: Colors.orangeAccent),
                    title: const Text('Configurar Impressora',
                        style: TextStyle(color: Colors.white)),
                    subtitle: const Text('Conectar via Bluetooth',
                        style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const PrinterConfigScreen()));
                    },
                  ),
                ],
                if (!widget.isFotografo) ...[
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading: const Icon(Icons.cloud_download_rounded,
                        color: Colors.blueAccent),
                    title: const Text('Baixar Backup (JSON)',
                        style: TextStyle(color: Colors.blueAccent)),
                    onTap: () async {
                      try {
                        if (mounted)
                          ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content:
                                      Text('Baixando backup, aguarde...')));
                        final jsonString = await ApiService().downloadBackup();
                        final dateStr =
                            DateTime.now().toIso8601String().split('T')[0];

                        await Share.share(jsonString,
                            subject: 'backup_selectphoto_$dateStr.json');
                      } catch (e) {
                        if (mounted)
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                              content: Text('Erro ao baixar: $e'),
                              backgroundColor: Colors.red));
                      }
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.restore_page_rounded,
                        color: Colors.orangeAccent),
                    title: const Text('Restaurar Backup',
                        style: TextStyle(color: Colors.orangeAccent)),
                    onTap: () async {
                      // 1. Alert about data loss
                      final bool? confirmed = await showDialog<bool>(
                        context: context,
                        builder: (context) {
                          return AlertDialog(
                            backgroundColor: const Color(0xFF1A2535),
                            title: const Text('Atenção: Ação Irreversível!',
                                style: TextStyle(
                                    color: Colors.redAccent,
                                    fontWeight: FontWeight.bold)),
                            content: const Text(
                                'Restaurar um backup irá APAGAR TODOS os dados atuais e substituí-los pelo conteúdo do arquivo.\n\nTem certeza que deseja continuar?',
                                style: TextStyle(color: Colors.white)),
                            actions: [
                              TextButton(
                                  onPressed: () =>
                                      Navigator.pop(context, false),
                                  child: const Text('Cancelar',
                                      style: TextStyle(color: Colors.white54))),
                              LedButton(
                                style: LedButton.styleFrom(
                                    backgroundColor: Colors.redAccent),
                                onPressed: () => Navigator.pop(context, true),
                                child: const Text('CONFIRMO',
                                    style: TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold)),
                              ),
                            ],
                          );
                        },
                      );

                      if (confirmed != true) return;

                      // 2. Pick JSON File
                      FilePickerResult? result = await FilePicker.pickFiles(
                        type: FileType.custom,
                        allowedExtensions: ['json'],
                      );

                      if (result != null && result.files.single.path != null) {
                        final filePath = result.files.single.path!;

                        try {
                          if (mounted)
                            ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text(
                                        'Restaurando backup, isso pode demorar...')));
                          await ApiService().restoreBackup(filePath);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content:
                                        Text('Backup Restaurado com Sucesso!'),
                                    backgroundColor: Colors.green));
                          }
                        } catch (e) {
                          if (e.toString().contains('CONFLICT')) {
                            // Tratar conflito de data
                            if (!mounted) return;
                            final bool? force = await showDialog<bool>(
                              context: context,
                              builder: (context) {
                                return AlertDialog(
                                  backgroundColor: const Color(0xFF1A2535),
                                  title: const Text('Backup Antigo Detectado',
                                      style: TextStyle(
                                          color: Colors.orangeAccent,
                                          fontWeight: FontWeight.bold)),
                                  content: const Text(
                                      'O backup online atual é mais RECENTE do que este arquivo que você está tentando restaurar.\n\nDeseja forçar a restauração mesmo assim?',
                                      style: TextStyle(color: Colors.white)),
                                  actions: [
                                    TextButton(
                                        onPressed: () =>
                                            Navigator.pop(context, false),
                                        child: const Text('Cancelar',
                                            style: TextStyle(
                                                color: Colors.white54))),
                                    LedButton(
                                      style: LedButton.styleFrom(
                                          backgroundColor: Colors.redAccent),
                                      onPressed: () =>
                                          Navigator.pop(context, true),
                                      child: const Text('FORÇAR RESTAURAÇÃO',
                                          style: TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.bold)),
                                    ),
                                  ],
                                );
                              },
                            );

                            if (force == true) {
                              try {
                                if (mounted)
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content:
                                              Text('Forçando restauração...')));
                                await ApiService()
                                    .restoreBackup(filePath, force: true);
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content: Text(
                                              'Backup Restaurado (Forçado)!'),
                                          backgroundColor: Colors.green));
                                }
                              } catch (e2) {
                                if (mounted)
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                          content: Text('Erro: $e2'),
                                          backgroundColor: Colors.red));
                              }
                            }
                          } else {
                            if (mounted)
                              ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                      content: Text('Erro: $e'),
                                      backgroundColor: Colors.red));
                          }
                        }
                      }
                    },
                  ),
                ],
                const Divider(color: Colors.white12, height: 1),
                const SizedBox(height: 12),
                // Recursos em Breve (Bloqueados)
                Opacity(
                  opacity: 0.55,
                  child: ListTile(
                    leading: const Icon(Icons.notifications_active_outlined,
                        color: Colors.amberAccent),
                    title: const Text('Scout Automático de Eventos (Push IA)',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold)),
                    subtitle: const Text(
                        'Notificações automáticas quando novos circos ou eventos longos forem detectados na sua região.',
                        style: TextStyle(color: Colors.white54, fontSize: 11)),
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                          color: Colors.white10,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white24)),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.lock_outline,
                              color: Colors.amberAccent, size: 13),
                          SizedBox(width: 4),
                          Text('Em Breve',
                              style: TextStyle(
                                  color: Colors.amberAccent,
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.privacy_tip_outlined, color: Colors.blueAccent),
                  title: Text('Política de Privacidade (Minuta)',
                      style: TextStyle(color: palette.textPrimary)),
                  subtitle: Text('Minuta técnica em validação jurídica',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  trailing: Icon(Icons.open_in_new, color: palette.textSecondary, size: 18),
                  onTap: () => _openLegalUrl('privacy.html'),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.person_remove_outlined, color: Colors.redAccent),
                  title: const Text('Excluir Conta',
                      style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                  subtitle: Text('Desativa e anonimiza seu acesso após confirmar a senha atual',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  trailing: const Icon(Icons.chevron_right_rounded, color: Colors.redAccent),
                  onTap: () => showSecureDeleteAccountDialog(context),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.logout, color: Colors.redAccent),
                  title: const Text('Sair da Conta',
                      style: TextStyle(color: Colors.redAccent)),
                  onTap: () => _handleLogout(context),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
