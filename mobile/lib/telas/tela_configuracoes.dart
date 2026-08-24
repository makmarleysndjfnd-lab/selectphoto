import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../provedores/provedor_configuracoes.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_login.dart';
import 'tela_config_impressora.dart';
import 'tela_cadastro_custos.dart';
import 'package:share_plus/share_plus.dart';
import 'package:file_picker/file_picker.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';

class SettingsScreen extends StatefulWidget {
  /// Somente administradores devem receber [canManageRoi] = true.
  /// O padrão é false (fechado) para garantir que vendedores e fotógrafos
  /// não visualizem nem alterem os parâmetros de ROI por engano.
  final bool canManageRoi;

  /// [isFotografo] controla funcionalidades exclusivas do fotógrafo:
  /// impresora bluetooth visível somente para fotógrafos,
  /// download de backup visível somente para não-fotógrafos.
  final bool isFotografo;

  /// [isVendedor] exibe ações operacionais do vendedor (transferência de capas, books e despesas).
  final bool isVendedor;

  const SettingsScreen({
    super.key,
    this.canManageRoi = false,
    this.isFotografo = false,
    this.isVendedor = false,
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
  }

  void _saveRoiSettings(SettingsProvider settings) {
    final double hotel = double.tryParse(_hotelCtrl.text.replaceAll(',', '.')) ?? 70.0;
    final double food = double.tryParse(_foodCtrl.text.replaceAll(',', '.')) ?? 50.0;
    final double fuel = double.tryParse(_fuelCtrl.text.replaceAll(',', '.')) ?? 0.60;
    final double prod = double.tryParse(_prodCtrl.text.replaceAll(',', '.')) ?? 21.0;
    final double ticket = double.tryParse(_ticketCtrl.text.replaceAll(',', '.')) ?? 150.0;
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
      const SnackBar(content: Text('Parâmetros de ROI salvos com sucesso!'), backgroundColor: Colors.green),
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

  void _handleSync(BuildContext context) async {
    final syncService = Provider.of<SyncService>(context, listen: false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Iniciando sincronização...')),
    );
    try {
      await syncService.syncAllPending();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sincronização concluída com sucesso!'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro na sincronização: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _showTransferDialog(BuildContext context, String itemType) async {
    final qtyController = TextEditingController();
    String? selectedRecipient;
    List<dynamic> recipients = [];

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Colors.orangeAccent)),
    );

    try {
      final api = ApiService();
      final users = await api.getCompanyUsers();
      recipients = users;
    } catch (e) {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar usuários: $e')));
      }
      return;
    }

    if (!mounted) return;
    Navigator.pop(context); // fecha loading

    if (!context.mounted) return;

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: Row(
                children: [
                  Icon(itemType == 'COVER' ? Icons.layers_rounded : Icons.menu_book_rounded, color: const Color(0xFF4FC3F7)),
                  const SizedBox(width: 8),
                  Text('Transferir ${itemType == 'COVER' ? 'Capas' : 'Books'}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      dropdownColor: const Color(0xFF1A2535),
                      value: selectedRecipient,
                      hint: const Text('Selecione o destinatário', style: TextStyle(color: Colors.white54)),
                      items: recipients.map((u) {
                        return DropdownMenuItem<String>(
                          value: u['id'].toString(),
                          child: Text('${u['name']} (${u['role']})', style: const TextStyle(color: Colors.white), overflow: TextOverflow.ellipsis),
                        );
                      }).toList(),
                      onChanged: (val) => setDialogState(() => selectedRecipient = val),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: qtyController,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Quantidade',
                        labelStyle: TextStyle(color: Colors.white54),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
                LedButton(
                  onPressed: () async {
                    final qty = int.tryParse(qtyController.text);
                    if (selectedRecipient == null || qty == null || qty <= 0) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha os campos corretamente.')));
                      return;
                    }
                    try {
                      if (itemType == 'COVER') {
                        await ApiService().transferBetweenSellers(selectedRecipient!, qty);
                      } else {
                        await ApiService().requestStockTransfer(selectedRecipient!, itemType, qty);
                      }
                      if (context.mounted) {
                        Navigator.pop(context);
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Transferência solicitada/realizada com sucesso!'), backgroundColor: Colors.green));
                      }
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
                      }
                    }
                  },
                  child: const Text('Confirmar'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final settings = Provider.of<SettingsProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurações', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1A1A2E),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      backgroundColor: const Color(0xFF161625),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Theme Settings
          LedCard(
            color: const Color(0xFF1A1A2E),
            child: ListTile(
              leading: Icon(
                settings.isDarkMode ? Icons.dark_mode : Icons.light_mode,
                color: Colors.blueAccent,
              ),
              title: const Text('Modo Escuro', style: TextStyle(color: Colors.white)),
              trailing: Switch(
                value: settings.isDarkMode,
                onChanged: (val) => settings.setDarkMode(val),
                activeColor: Colors.blueAccent,
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
                    const Text('IP / URL do Servidor (Debug)', style: TextStyle(color: Colors.white70, fontSize: 14)),
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
                        style: LedButton.styleFrom(backgroundColor: const Color(0xFF0288D1)),
                        onPressed: () {
                          settings.setServerUrl(_urlController.text.trim());
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('URL salva com sucesso!'), backgroundColor: Colors.green),
                          );
                        },
                        child: const Text('Salvar Servidor', style: TextStyle(color: Colors.white)),
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
              color: const Color(0xFF1A1A2E),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.calculate, color: Color(0xFFCE93D8), size: 20),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Parâmetros Base da Calculadora de ROI',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Valores padrão usados para estimar o lucro líquido das viagens.',
                      style: TextStyle(color: Colors.white54, fontSize: 12),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _hotelCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Hospedagem (R\$/p/dia)',
                              labelStyle: TextStyle(color: Colors.white54, fontSize: 12),
                              filled: true,
                              fillColor: Color(0xFF161625),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _foodCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Alimentação (R\$/p/dia)',
                              labelStyle: TextStyle(color: Colors.white54, fontSize: 12),
                              filled: true,
                              fillColor: Color(0xFF161625),
                              border: OutlineInputBorder(),
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
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Combustível (R\$/km)',
                              labelStyle: TextStyle(color: Colors.white54, fontSize: 12),
                              filled: true,
                              fillColor: Color(0xFF161625),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _prodCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Custo Produto (R\$)',
                              labelStyle: TextStyle(color: Colors.white54, fontSize: 12),
                              filled: true,
                              fillColor: Color(0xFF161625),
                              border: OutlineInputBorder(),
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
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Ticket Médio (R\$)',
                              labelStyle: TextStyle(color: Colors.white54, fontSize: 12),
                              filled: true,
                              fillColor: Color(0xFF161625),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _fichasCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Fichas/Dia Padrão',
                              labelStyle: TextStyle(color: Colors.white54, fontSize: 12),
                              filled: true,
                              fillColor: Color(0xFF161625),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: LedButton(
                        style: LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                        onPressed: () => _saveRoiSettings(settings),
                        child: const Text('Salvar Parâmetros de ROI', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          
          if (widget.isVendedor) ...[
            LedCard(
              color: const Color(0xFF1A1A2E),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: Row(
                      children: [
                        Icon(Icons.handyman_rounded, color: Color(0xFF4FC3F7), size: 18),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Operações do Vendedor',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading: const Icon(Icons.assignment_return_rounded, color: Colors.orangeAccent),
                    title: const Text('Transferir / Dividir Capas', style: TextStyle(color: Colors.white)),
                    subtitle: const Text('Repassar saldo de capas para outro vendedor', style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () => _showTransferDialog(context, 'COVER'),
                  ),
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading: const Icon(Icons.menu_book_rounded, color: Colors.lightGreenAccent),
                    title: const Text('Transferir / Dividir Books', style: TextStyle(color: Colors.white)),
                    subtitle: const Text('Repassar books físicos entre a equipe', style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () => _showTransferDialog(context, 'BOOK'),
                  ),
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading: const Icon(Icons.receipt_long_rounded, color: Color(0xFFCE93D8)),
                    title: const Text('Lançar Despesas / Custos', style: TextStyle(color: Colors.white)),
                    subtitle: const Text('Cadastrar alimentação, combustível, hotel ou outros', style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.push(context, MaterialPageRoute(
                        builder: (_) => const CostEntryScreen(),
                      ));
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Actions
          LedCard(
            color: const Color(0xFF1A1A2E),
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.sync, color: Colors.greenAccent),
                  title: const Text('Sincronizar Manualmente', style: TextStyle(color: Colors.white)),
                  subtitle: const Text('Envia dados offline pendentes', style: TextStyle(color: Colors.white54, fontSize: 12)),
                  onTap: () => _handleSync(context),
                ),
                if (widget.isFotografo) ...[
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading: const Icon(Icons.print, color: Colors.orangeAccent),
                    title: const Text('Configurar Impressora', style: TextStyle(color: Colors.white)),
                    subtitle: const Text('Conectar via Bluetooth', style: TextStyle(color: Colors.white54, fontSize: 12)),
                    onTap: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const PrinterConfigScreen()));
                    },
                  ),
                ],
                if (!widget.isFotografo) ...[
                  const Divider(color: Colors.white12, height: 1),
                  ListTile(
                    leading: const Icon(Icons.cloud_download_rounded, color: Colors.blueAccent),
                    title: const Text('Baixar Backup (JSON)', style: TextStyle(color: Colors.blueAccent)),
                    onTap: () async {
                      try {
                        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Baixando backup, aguarde...')));
                        final jsonString = await ApiService().downloadBackup();
                        final dateStr = DateTime.now().toIso8601String().split('T')[0];
                        
                        await Share.share(jsonString, subject: 'backup_selectphoto_$dateStr.json');
                      } catch (e) {
                        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao baixar: $e'), backgroundColor: Colors.red));
                      }
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.restore_page_rounded, color: Colors.orangeAccent),
                    title: const Text('Restaurar Backup', style: TextStyle(color: Colors.orangeAccent)),
                    onTap: () async {
                      // 1. Alert about data loss
                      final bool? confirmed = await showDialog<bool>(
                        context: context,
                        builder: (context) {
                          return AlertDialog(
                            backgroundColor: const Color(0xFF1A2535),
                            title: const Text('Atenção: Ação Irreversível!', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                            content: const Text('Restaurar um backup irá APAGAR TODOS os dados atuais e substituí-los pelo conteúdo do arquivo.\n\nTem certeza que deseja continuar?', style: TextStyle(color: Colors.white)),
                            actions: [
                              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
                              LedButton(
                                style: LedButton.styleFrom(backgroundColor: Colors.redAccent),
                                onPressed: () => Navigator.pop(context, true),
                                child: const Text('CONFIRMO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Restaurando backup, isso pode demorar...')));
                          await ApiService().restoreBackup(filePath);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Backup Restaurado com Sucesso!'), backgroundColor: Colors.green));
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
                                  title: const Text('Backup Antigo Detectado', style: TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold)),
                                  content: const Text('O backup online atual é mais RECENTE do que este arquivo que você está tentando restaurar.\n\nDeseja forçar a restauração mesmo assim?', style: TextStyle(color: Colors.white)),
                                  actions: [
                                    TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
                                    LedButton(
                                      style: LedButton.styleFrom(backgroundColor: Colors.redAccent),
                                      onPressed: () => Navigator.pop(context, true),
                                      child: const Text('FORÇAR RESTAURAÇÃO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                                    ),
                                  ],
                                );
                              },
                            );
                            
                            if (force == true) {
                              try {
                                if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Forçando restauração...')));
                                await ApiService().restoreBackup(filePath, force: true);
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Backup Restaurado (Forçado)!'), backgroundColor: Colors.green));
                                }
                              } catch (e2) {
                                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e2'), backgroundColor: Colors.red));
                              }
                            }
                          } else {
                            if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
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
                    leading: const Icon(Icons.notifications_active_outlined, color: Colors.amberAccent),
                    title: const Text('Scout Automático de Eventos (Push IA)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    subtitle: const Text('Notificações automáticas quando novos circos ou eventos longos forem detectados na sua região.', style: TextStyle(color: Colors.white54, fontSize: 11)),
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white24)),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.lock_outline, color: Colors.amberAccent, size: 13),
                          SizedBox(width: 4),
                          Text('Em Breve', style: TextStyle(color: Colors.amberAccent, fontSize: 10, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ),
                const Divider(color: Colors.white12, height: 1),
                ListTile(
                  leading: const Icon(Icons.logout, color: Colors.redAccent),
                  title: const Text('Sair da Conta', style: TextStyle(color: Colors.redAccent)),
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
