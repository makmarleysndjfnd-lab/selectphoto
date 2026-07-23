const fs = require('fs');
const path = 'mobile/lib/telas/painel_admin.dart';

let content = fs.readFileSync(path, 'utf8');

const regexRH = /(title: const Text\('RH E LOGÍSTICA',[\s\S]*?children: \[)([\s\S]*?)(\],)/;

content = content.replace(regexRH, (match, part1, part2, part3) => {
    return part1 + part2 + `                        ListTile(
                          leading: const Icon(Icons.group_work_rounded, color: Color(0xFFCE93D8)),
                          title: const Text('Equipes', style: TextStyle(color: Color(0xFFCE93D8))),
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TelaGerenciamentoEquipes())),
                        ),\n` + part3;
});

// Also add import for TelaGerenciamentoEquipes at the top
if (!content.includes('tela_gerenciamento_equipes.dart')) {
    content = content.replace(/(import 'tela_gerenciamento_funcionarios\.dart';)/, "$1\nimport 'tela_gerenciamento_equipes.dart';");
}

fs.writeFileSync(path, content, 'utf8');
console.log('patched painel_admin.dart');
