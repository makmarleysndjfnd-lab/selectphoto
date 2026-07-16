import sys

with open('mobile/lib/telas/painel_admin.dart', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if line.startswith('  void _showNotificacoesDialog() {') and i > 500:
        skip = True
    
    if not skip:
        new_lines.append(line)

    if skip and line.startswith('  }'):
        skip = False

with open('mobile/lib/telas/painel_admin.dart', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
