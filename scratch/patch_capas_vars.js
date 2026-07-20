const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/visao_estoque_admin.dart', 'utf8');

content = content.replace("info['totalAdminCapas']", "info['totalInAdmin']");
content = content.replace("info['totalSellerCapas']", "info['totalWithSellers']");
content = content.replace("s['name'] ?? 'Sem Nome'", "(s['seller'] != null ? s['seller']['name'] : 'Sem Nome')");
content = content.replace("s['coversInPossession'] ?? 0", "s['balance'] ?? 0");
content = content.replace("s['id']", "s['seller']['id']");
content = content.replace("seller!['id']", "seller!['seller']['id']");
content = content.replace("seller['name']", "seller['seller']['name']");

fs.writeFileSync('mobile/lib/telas/visao_estoque_admin.dart', content, 'utf8');
