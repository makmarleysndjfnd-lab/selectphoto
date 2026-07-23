const fs = require('fs');
const path = 'mobile/lib/telas/tela_gerenciamento_funcionarios.dart';

let content = fs.readFileSync(path, 'utf8');

// remove _showTeamsDialog method
const regexMethod = /\s*void _showTeamsDialog\(\) \{[\s\S]*?\}\s*(?=@override)/;
content = content.replace(regexMethod, '\n\n  ');

// remove the ElevatedButton inside Padding
const regexButton = /\s*Padding\(\s*padding: const EdgeInsets\.only\(right: 16\.0\),\s*child: ElevatedButton\.icon\([\s\S]*?onPressed: _showTeamsDialog,[\s\S]*?\),\s*\),\s*\),/;
content = content.replace(regexButton, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Cleaned up _showTeamsDialog');
