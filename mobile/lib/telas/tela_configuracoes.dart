import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../provedores/provedor_configuracoes.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_login.dart';
import 'tela_config_impressora.dart';

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
