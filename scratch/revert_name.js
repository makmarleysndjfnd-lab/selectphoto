const fs = require('fs');

const replaces = [
    {
        file: 'mobile/android/app/src/main/AndroidManifest.xml',
        searchValue: /android:label="Hiper Photos"/g,
        replaceValue: 'android:label="Lumora System"'
    },
    {
        file: 'mobile/lib/telas/lista_fichas_fotografo.dart',
        searchValue: /HIPER PHOTOS - FICHA UNICA/g,
        replaceValue: 'LUMORA - FICHA UNICA'
    },
    {
        file: 'mobile/lib/telas/painel_fotografo.dart',
        searchValue: /HIPER PHOTOS - FICHA COMPLETA/g,
        replaceValue: 'LUMORA - FICHA COMPLETA'
    },
    {
        file: 'mobile/lib/telas/painel_fotografo.dart',
        searchValue: /HIPER PHOTOS - FECHAMENTO DE LOTE/g,
        replaceValue: 'LUMORA - FECHAMENTO DE LOTE'
    },
    {
        file: 'mobile/lib/telas/painel_admin.dart',
        searchValue: /HIPER PHOTOS - FICHA UNICA/g,
        replaceValue: 'LUMORA - FICHA UNICA'
    },
    {
        file: 'mobile/lib/telas/tela_login.dart',
        searchValue: /'Hiper Photos',/g,
        replaceValue: "'Lumora System',"
    },
    {
        file: 'mobile/lib/telas/tela_config_impressora.dart',
        searchValue: /TESTE DE IMPRESSAO - HIPER PHOTOS/g,
        replaceValue: 'TESTE DE IMPRESSAO - LUMORA'
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
