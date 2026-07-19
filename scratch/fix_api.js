const fs = require('fs');

let content = fs.readFileSync('mobile/lib/servicos/servico_api.dart', 'utf8');

if (!content.includes('getPendingBookBatches')) {
    content = content.replace(
        "Future<List<dynamic>> getBookBatches() async {",
        "Future<List<dynamic>> getPendingBookBatches() async {\n    final all = await getBookBatches();\n    return all.where((b) => b['status'] == 'AWAITING_RELEASE').toList();\n  }\n\n  Future<List<dynamic>> getBookBatches() async {"
    );
    fs.writeFileSync('mobile/lib/servicos/servico_api.dart', content, 'utf8');
}
