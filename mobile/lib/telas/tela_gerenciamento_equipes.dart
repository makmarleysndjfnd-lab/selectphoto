import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class TelaGerenciamentoEquipes extends StatefulWidget {
  const TelaGerenciamentoEquipes({Key? key}) : super(key: key);

  @override
  State<TelaGerenciamentoEquipes> createState() => _TelaGerenciamentoEquipesState();
}

class _TelaGerenciamentoEquipesState extends State<TelaGerenciamentoEquipes> {
  final ApiService _api = ApiService();
  List<dynamic> _teams = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _loadTeams();
  }

  Future<void> _loadTeams() async {
    setState(() => _isLoading = true);
    try {
      final teams = await _api.getTeams();
      setState(() => _teams = teams);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _showTeamDialog({Map<String, dynamic>? team}) {
    final nameCtrl = TextEditingController(text: team?['name'] ?? '');
    String type = team?['type'] ?? 'PRODUCTION';
    bool isSaving = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setStateDialog) => AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: Text(team == null ? 'Nova Equipe' : 'Editar Equipe', style: const TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (team != null) 
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text('Código: ${team['prefix']}', style: const TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold, fontSize: 16)),
                ),
              TextField(
                controller: nameCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Nome da Equipe', labelStyle: TextStyle(color: Colors.white54)),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: type,
                dropdownColor: const Color(0xFF2A2A3E),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Tipo', labelStyle: TextStyle(color: Colors.white54)),
                items: const [
                  DropdownMenuItem(value: 'PRODUCTION', child: Text('Equipe de Produção (Books/Fotografia)')),
                  DropdownMenuItem(value: 'SALES', child: Text('Equipe de Vendas')),
                ],
                onChanged: (v) => setStateDialog(() => type = v!),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: isSaving ? null : () async {
                if (nameCtrl.text.isEmpty) return;
                setStateDialog(() => isSaving = true);
                try {
                  if (team == null) {
                    await _api.createTeam({
                      'name': nameCtrl.text,
                      'type': type,
                    });
                  } else {
                    await _api.updateTeam(team['id'], {
                      'name': nameCtrl.text,
                      'type': type,
                      'prefix': team['prefix'], // required by PUT
                      'active': team['active'] ?? true,
                    });
                  }
                  if (mounted) {
                    Navigator.pop(ctx);
                    _loadTeams();
                  }
                } catch (e) {
                  ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
                  setStateDialog(() => isSaving = false);
                }
              },
              child: isSaving ? const CircularProgressIndicator() : const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteTeam(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Confirmar exclusão', style: TextStyle(color: Colors.white)),
        content: const Text('Tem certeza que deseja excluir esta equipe? Membros vinculados a ela ficarão sem equipe.', style: TextStyle(color: Colors.white70)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true), 
            child: const Text('Excluir')
          ),
        ],
      ),
    );

    if (confirm == true) {
      setState(() => _isLoading = true);
      try {
        await _api.deleteTeam(id);
        _loadTeams();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
        }
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('Gerenciar Equipes', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF1A1A2E),
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _teams.length,
              itemBuilder: (ctx, i) {
                final t = _teams[i];
                return Card(
                  color: const Color(0xFF1A1A2E),
                  margin: const EdgeInsets.only(bottom: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                    title: Text(t['name'] ?? 'Sem Nome', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                    subtitle: Text('Código: ${t['prefix'] ?? 'N/A'} • Tipo: ${t['type']}', style: const TextStyle(color: Colors.white54)),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.edit, color: Colors.blueAccent),
                          onPressed: () => _showTeamDialog(team: t),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete, color: Colors.redAccent),
                          onPressed: () => _deleteTeam(t['id']),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showTeamDialog(),
        backgroundColor: const Color(0xFFCE93D8),
        icon: const Icon(Icons.add, color: Colors.black),
        label: const Text('Nova Equipe', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
