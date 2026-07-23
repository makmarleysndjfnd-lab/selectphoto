const fs = require('fs');
const path = 'mobile/lib/telas/painel_admin.dart';

let content = fs.readFileSync(path, 'utf8');

const regexMenu = /ListTile\(\s*leading: const Icon\(Icons\.group_work_rounded, color: Color\(0xFFCE93D8\)\),\s*title: const Text\('Equipes', style: TextStyle\(color: Color\(0xFFCE93D8\)\)\),\s*onTap: \(\) => Navigator\.push\(context, MaterialPageRoute\(builder: \(_\) => const TelaGerenciamentoEquipes\(\)\)\),\s*\),\n/;

content = content.replace(regexMenu, '');

const regexImport = /import 'tela_gerenciamento_equipes\.dart';\n/;
content = content.replace(regexImport, '');

fs.writeFileSync(path, content, 'utf8');
console.log('patched painel_admin.dart');
