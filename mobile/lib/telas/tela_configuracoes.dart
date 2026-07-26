import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../provedores/provedor_configuracoes.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_login.dart';
import 'tela_config_impressora.dart';
import 'package:share_plus/share_plus.dart';
import 'package:file_picker/file_picker.dart';

class SettingsScreen extends StatefulWidget {
  final bool isFotografo;
  const SettingsScreen({super.key, this.isFotografo = false});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _urlController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final settings = Provider.of<SettingsProvider>(context, listen: false);
    _urlController.text = settings.serverUrl;
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
          Card(
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
          
          // Server URL Settings
          Card(
            color: const Color(0xFF1A1A2E),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('IP / URL do Servidor', style: TextStyle(color: Colors.white70, fontSize: 14)),
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
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0288D1)),
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
          
          // Actions
          Card(
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
                              ElevatedButton(
                                style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
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
                                    ElevatedButton(
                                      style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
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
