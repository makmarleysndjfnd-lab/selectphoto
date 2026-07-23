const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/visao_fechamento_admin.dart', 'utf8');

// 1. Remove _buildFotografoCard() from the column
content = content.replace(
    "_buildFotografoCard(),\n                const SizedBox(height: 20),\n                _buildCidadesALiberarCard(),",
    "_buildCidadesALiberarCard(),"
);

// 2. Remove the variables and methods up to _buildCidadesALiberarCard
content = content.replace(
    /String\? _selectedPhotographer;[\s\S]*?Widget _buildCidadesALiberarCard\(\) \{/m,
    "Widget _buildCidadesALiberarCard() {"
);

fs.writeFileSync('mobile/lib/telas/visao_fechamento_admin.dart', content, 'utf8');
console.log("visao_fechamento_admin.dart updated.");
