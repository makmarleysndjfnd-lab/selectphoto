const fs = require('fs');

const path = 'mobile/lib/telas/painel_admin.dart';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split(/\r?\n/);

const newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('  void _showNotificacoesDialog() {') && i > 500) {
        skip = true;
    }
    
    if (!skip) {
        newLines.push(lines[i]);
    }

    if (skip && lines[i].startsWith('  }')) {
        skip = false;
    }
}

fs.writeFileSync(path, newLines.join('\n'));
console.log('Fixed');
