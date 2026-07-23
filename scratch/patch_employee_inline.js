const fs = require('fs');
const path = 'mobile/lib/telas/tela_gerenciamento_funcionarios.dart';

let content = fs.readFileSync(path, 'utf8');

// 1. Add _createTeamInline method inside _EmployeeFormDialogState
const inlineMethod = `  Future<void> _createTeamInline() async {
    final nameCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Nova Equipe', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: nameCtrl,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(labelText: 'Nome da Equipe', labelStyle: TextStyle(color: Colors.white54)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            onPressed: () async {
              if (nameCtrl.text.trim().isEmpty) return;
              try {
                final api = ApiService();
                final newTeam = await api.createTeam({'name': nameCtrl.text.trim(), 'type': 'PRODUCTION'});
                setState(() {
                  widget.teams.add(newTeam);
                  _teamId = newTeam['id'];
                });
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Equipe criada!')));
              } catch (e) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
            child: const Text('Criar e Selecionar', style: TextStyle(color: Colors.black)),
          ),
        ],
      ),
    );
  }

  @override
  void initState() {`;

content = content.replace('  @override\n  void initState() {', inlineMethod);

// 2. Replace the Dropdown with a Row
const oldDropdownRegex = /(if \(_role == 'PHOTOGRAPHER' \|\| _role == 'CONTACT'\)\s*)(DropdownButtonFormField<String>\([\s\S]*?onChanged: \(val\) => setState\(\(\) => _teamId = val\),\s*\),)/;

content = content.replace(oldDropdownRegex, (match, ifStmt, dropdown) => {
    return ifStmt + `Row(
                    children: [
                      Expanded(
                        child: ${dropdown.trim()}
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.add_circle, color: Color(0xFFCE93D8), size: 32),
                        onPressed: _createTeamInline,
                        tooltip: 'Criar Nova Equipe',
                      ),
                    ],
                  ),`;
});

// 3. Remove _TeamsManagementDialog and its related methods from _EmployeeManagementScreenState
// This is best done by string replacement or regex if we are careful.
// Let's remove _showTeamsDialog call from the button.
const oldButton = /Padding\(\s*padding: const EdgeInsets\.only\(right: 16\.0\),\s*child: ElevatedButton\.icon\(\s*onPressed: _showTeamsDialog,\s*icon: const Icon\(Icons\.groups, color: Colors\.white\),\s*label: const Text\('Gerenciar Equipes', style: TextStyle\(color: Colors\.white\)\),\s*style: ElevatedButton\.styleFrom\(\s*backgroundColor: const Color\(0xFF1A1A2E\),\s*side: const BorderSide\(color: Color\(0xFFCE93D8\)\),\s*\),\s*\),\s*\),/;
content = content.replace(oldButton, '');

fs.writeFileSync(path, content, 'utf8');
console.log('patched tela_gerenciamento_funcionarios.dart');
