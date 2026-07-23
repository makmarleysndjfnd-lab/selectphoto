const fs = require('fs');
const path = 'mobile/lib/telas/tela_gerenciamento_funcionarios.dart';

let content = fs.readFileSync(path, 'utf8');

// Fix 1: Fix the actions in AppBar
content = content.replace(/actions:\s*\[\s*\),\s*\],/, 'actions: [],');

// Fix 2: Move _createTeamInline to _EmployeeFormDialogState
const methodRegex = /  Future<void> _createTeamInline\(\) async \{[\s\S]*?\}\n\n  @override\n  void initState\(\) \{\n    super.initState\(\);\n    _fetchData\(\);\n  \}/;

content = content.replace(methodRegex, `  @override
  void initState() {
    super.initState();
    _fetchData();
  }`);

const targetInjection = /class _EmployeeFormDialogState extends State<_EmployeeFormDialog> \{[\s\S]*?void initState\(\) \{/;

content = content.replace(targetInjection, (match) => {
    return match.replace('  @override\n  void initState() {', `  Future<void> _createTeamInline() async {
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
  void initState() {`);
});

// Also fix painel_admin.dart to ensure there are no leftover imports
const painelPath = 'mobile/lib/telas/painel_admin.dart';
let painelContent = fs.readFileSync(painelPath, 'utf8');
painelContent = painelContent.replace(/import 'tela_gerenciamento_equipes\.dart';\n/, '');
fs.writeFileSync(painelPath, painelContent, 'utf8');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed syntax errors');
