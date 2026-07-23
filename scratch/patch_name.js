const fs = require('fs');

const replaces = [
    {
        file: 'mobile/android/app/src/main/AndroidManifest.xml',
        searchValue: /android:label="Lumora"/g,
        replaceValue: 'android:label="Hiper Photos"'
    },
    {
        file: 'mobile/lib/telas/lista_fichas_fotografo.dart',
        searchValue: /LUMORA - FICHA UNICA/g,
        replaceValue: 'HIPER PHOTOS - FICHA UNICA'
    },
    {
        file: 'mobile/lib/telas/painel_fotografo.dart',
        searchValue: /LUMORA - FICHA COMPLETA/g,
        replaceValue: 'HIPER PHOTOS - FICHA COMPLETA'
    },
    {
        file: 'mobile/lib/telas/painel_fotografo.dart',
        searchValue: /LUMORA - FECHAMENTO DE LOTE/g,
        replaceValue: 'HIPER PHOTOS - FECHAMENTO DE LOTE'
    },
    {
        file: 'mobile/lib/telas/painel_admin.dart',
        searchValue: /LUMORA - FICHA UNICA/g,
        replaceValue: 'HIPER PHOTOS - FICHA UNICA'
    },
    {
        file: 'mobile/lib/telas/tela_login.dart',
        searchValue: /'Lumora',/g,
        replaceValue: "'Hiper Photos',"
    },
    {
        file: 'mobile/lib/telas/tela_login.dart',
        searchValue: /'assets\/images\/logo.png'/g,
        replaceValue: "'assets/images/logo_hiper.png'"
    },
    {
        file: 'mobile/lib/telas/tela_config_impressora.dart',
        searchValue: /TESTE DE IMPRESSAO - LUMORA/g,
        replaceValue: 'TESTE DE IMPRESSAO - HIPER PHOTOS'
    }
];

replaces.forEach(r => {
    if (fs.existsSync(r.file)) {
        let content = fs.readFileSync(r.file, 'utf8');
        content = content.replace(r.searchValue, r.replaceValue);
        fs.writeFileSync(r.file, content, 'utf8');
        console.log(`Updated ${r.file}`);
    }
});
