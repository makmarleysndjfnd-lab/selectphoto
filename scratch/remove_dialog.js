const fs = require('fs');
const path = 'mobile/lib/telas/tela_gerenciamento_funcionarios.dart';

let content = fs.readFileSync(path, 'utf8');

const regex = /class _TeamsManagementDialog extends StatefulWidget {[\s\S]*?(?=class _FleetChecklistTab)/;
content = content.replace(regex, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Removed _TeamsManagementDialog from tela_gerenciamento_funcionarios.dart');
