const fs = require('fs');
const path = 'mobile/lib/telas/tela_gerenciamento_funcionarios.dart';

let content = fs.readFileSync(path, 'utf8');

// 1. Hide Tipo de Venda based on role
const regexRow = /(<String>\(\s*value: _role,[\s\S]*?onChanged: \(v\) => setState\(\(\) => _role = v!\),\s*\),\s*\),\s*const SizedBox\(width: 16\),)(\s*Expanded\([\s\S]*?value: _salesType,[\s\S]*?onChanged: \(v\) => setState\(\(\) => _salesType = v!\),\s*\),\s*\),)/m;

content = content.replace(regexRow, (match, part1, part2) => {
    return part1 + `\n                    if (_role != 'PHOTOGRAPHER' && _role != 'CONTACT')` + part2 + `\n                    if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT')\n                      const Expanded(child: SizedBox()),`;
});

// 2. Hide Equipe based on role
const regexEquipe = /(DropdownButtonFormField<String>\(\s*value: _teamId,[\s\S]*?labelText: 'Equipe \(Opcional\)',[\s\S]*?onChanged: \(v\) => setState\(\(\) => _teamId = v\),\s*\),)/m;

content = content.replace(regexEquipe, (match, part1) => {
    return `if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT')\n                  ${part1}`;
});

// 3. Hide Chefe de Equipe based on role
const regexChefe = /(CheckboxListTile\(\s*title: const Text\('Chefe de Equipe\?',[\s\S]*?controlAffinity: ListTileControlAffinity\.leading,\s*\),)/m;

content = content.replace(regexChefe, (match, part1) => {
    return `if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT')\n                  ${part1}`;
});

// 4. Change Usa carro próprio to Radio and Veículo dropdown logic
const regexCarroDropdown = /(DropdownButtonFormField<String>\(\s*value: _carId,[\s\S]*?labelText: 'Veículo Vinculado \(Opcional\)',[\s\S]*?onChanged: \(v\) => setState\(\(\) => _carId = v\),\s*\),)/m;

content = content.replace(regexCarroDropdown, (match, part1) => {
    return `if (!_usesOwnCar)\n                  ${part1}`;
});

const regexCarroProprio = /CheckboxListTile\(\s*title: const Text\('Usa carro próprio\?', style: TextStyle\(color: Colors\.white\)\),\s*value: _usesOwnCar,\s*activeColor: const Color\(0xFFCE93D8\),\s*checkColor: Colors\.black,\s*contentPadding: EdgeInsets\.zero,\s*controlAffinity: ListTileControlAffinity\.leading,\s*onChanged: \(v\) => setState\(\(\) => _usesOwnCar = v!\),\s*\),/;

const newCarroProprio = `
                const Text('Usa carro próprio?', style: TextStyle(color: Colors.white)),
                Row(
                  children: [
                    Expanded(
                      child: RadioListTile<bool>(
                        title: const Text('Sim', style: TextStyle(color: Colors.white)),
                        value: true,
                        groupValue: _usesOwnCar,
                        activeColor: const Color(0xFFCE93D8),
                        onChanged: (v) {
                          setState(() {
                            _usesOwnCar = v!;
                            _carId = null; // reset if they use own car
                          });
                        },
                      ),
                    ),
                    Expanded(
                      child: RadioListTile<bool>(
                        title: const Text('Não', style: TextStyle(color: Colors.white)),
                        value: false,
                        groupValue: _usesOwnCar,
                        activeColor: const Color(0xFFCE93D8),
                        onChanged: (v) => setState(() => _usesOwnCar = v!),
                      ),
                    ),
                  ],
                ),`;

content = content.replace(regexCarroProprio, newCarroProprio);

fs.writeFileSync(path, content, 'utf8');
console.log('patched tela_gerenciamento_funcionarios.dart');
