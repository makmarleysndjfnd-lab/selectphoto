const fs = require('fs');
const path = 'mobile/lib/telas/tela_gerenciamento_funcionarios.dart';

let content = fs.readFileSync(path, 'utf8');

const regexSave = /(final formData = FormData\.fromMap\(\{[\s\S]*?\}\);)/;

const newSave = `String finalSalesType = _salesType;
        String finalTeamId = _teamId ?? '';
        bool finalIsTeamLeader = _isTeamLeader;
        
        if (_role == 'PHOTOGRAPHER' || _role == 'CONTACT') {
          finalSalesType = '';
        } else {
          finalTeamId = '';
          finalIsTeamLeader = false;
        }

        final formData = FormData.fromMap({
          'name': _nameCtrl.text,
          'password': _passwordCtrl.text,
          'role': _role,
          'salesType': finalSalesType,
          'cpf': _cpfCtrl.text,
          'rg': _rgCtrl.text,
          'phone': _phoneCtrl.text,
          'emergencyPhone': _emergencyCtrl.text,
          'address': _addressCtrl.text,
          'teamId': finalTeamId,
          'carId': _carId ?? '',
          'isTeamLeader': finalIsTeamLeader.toString(),
          'usesOwnCar': _usesOwnCar.toString(),
        });`;

content = content.replace(regexSave, newSave);

fs.writeFileSync(path, content, 'utf8');
console.log('patched save logic');
