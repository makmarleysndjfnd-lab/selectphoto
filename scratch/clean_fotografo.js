const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/visao_fechamento_admin.dart', 'utf8');

// First replace the call
content = content.replace(
    /\s*const SizedBox\(height: 20\),\s*_buildFotografoCard\(\),\s*const SizedBox\(height: 20\),\s*_buildCidadesALiberarCard\(\),/m,
    "\n                const SizedBox(height: 20),\n                _buildCidadesALiberarCard(),"
);

// Then replace the methods
const methodRegex = /String\? _selectedPhotographer;[\s\S]*?Widget _buildFotografoCard\(\) \{[\s\S]*?Widget _buildFotografoDetails\(\) \{[\s\S]*?\}\s*\)\s*;\s*\n\s*\}/;

content = content.replace(methodRegex, "");

fs.writeFileSync('mobile/lib/telas/visao_fechamento_admin.dart', content, 'utf8');
console.log("Updated");
