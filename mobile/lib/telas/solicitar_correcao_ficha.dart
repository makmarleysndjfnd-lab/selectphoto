import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_button.dart';


class SolicitarCorrecaoFicha extends StatefulWidget {
  final dynamic ficha;

  const SolicitarCorrecaoFicha({super.key, required this.ficha});

  @override
  State<SolicitarCorrecaoFicha> createState() => _SolicitarCorrecaoFichaState();
}

class _SolicitarCorrecaoFichaState extends State<SolicitarCorrecaoFicha> {
  final _formKey = GlobalKey<FormState>();
  
  // Controllers
  final _nomeController = TextEditingController();
  final _telefoneController = TextEditingController();
  final _telefone2Controller = TextEditingController();
  final _cepController = TextEditingController();
  final _ruaController = TextEditingController();
  final _numController = TextEditingController();
  final _bairroController = TextEditingController();
  final _cidadeController = TextEditingController();
  final _condoController = TextEditingController();
  final _blocoController = TextEditingController();
  final _aptoController = TextEditingController();
  final _refController = TextEditingController();
  final _gateController = TextEditingController();
  final _childNameController = TextEditingController();
  final _childAgeController = TextEditingController();
  final _clothesColorController = TextEditingController();
  final _professionController = TextEditingController();
  
  final _motivoController = TextEditingController();
  
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _nomeController.text = widget.ficha['mainContact'] ?? '';
    _telefoneController.text = widget.ficha['phone1'] ?? '';
    _telefone2Controller.text = widget.ficha['phone2'] ?? '';
    _cepController.text = widget.ficha['cep'] ?? '';
    _ruaController.text = widget.ficha['address'] ?? '';
    _numController.text = widget.ficha['number'] ?? '';
    _bairroController.text = widget.ficha['neighborhood'] ?? '';
    _cidadeController.text = widget.ficha['city'] ?? '';
    _condoController.text = widget.ficha['condo'] ?? '';
    _blocoController.text = widget.ficha['block'] ?? '';
    _aptoController.text = widget.ficha['apt'] ?? '';
    _refController.text = widget.ficha['reference'] ?? '';
    _gateController.text = widget.ficha['gateObservation'] ?? '';
    _childNameController.text = widget.ficha['childName'] ?? '';
    _childAgeController.text = widget.ficha['childAge']?.toString() ?? '';
    _clothesColorController.text = widget.ficha['clothesColor'] ?? '';
    _professionController.text = widget.ficha['profession'] ?? '';
  }

  @override
  void dispose() {
    _nomeController.dispose();
    _telefoneController.dispose();
    _telefone2Controller.dispose();
    _cepController.dispose();
    _ruaController.dispose();
    _numController.dispose();
    _bairroController.dispose();
    _cidadeController.dispose();
    _condoController.dispose();
    _blocoController.dispose();
    _aptoController.dispose();
    _refController.dispose();
    _gateController.dispose();
    _childNameController.dispose();
    _childAgeController.dispose();
    _clothesColorController.dispose();
    _professionController.dispose();
    _motivoController.dispose();
    super.dispose();
  }

  Future<void> _enviarSolicitacao() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      final proposedData = {
        'mainContact': _nomeController.text,
        'phone1': _telefoneController.text,
        'phone2': _telefone2Controller.text,
        'cep': _cepController.text,
        'address': _ruaController.text,
        'number': _numController.text,
        'neighborhood': _bairroController.text,
        'city': _cidadeController.text,
        'condo': _condoController.text,
        'block': _blocoController.text,
        'apt': _aptoController.text,
        'reference': _refController.text,
        'gateObservation': _gateController.text,
        'childName': _childNameController.text,
        'childAge': _childAgeController.text,
        'clothesColor': _clothesColorController.text,
        'profession': _professionController.text,
      };

      await ApiService().createEditRequest(
        clientId: widget.ficha['id'],
        proposedData: proposedData,
        reason: _motivoController.text,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Solicitação enviada com sucesso!'), backgroundColor: Colors.green),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao enviar solicitação: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2A0D2E),
        title: const Text('Solicitar Correção', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Edite os campos que deseja corrigir e informe o motivo da correção.',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 24),
              
              const Text('Dados do Cliente', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              _buildTextField('Nome Principal', _nomeController, Icons.person),
              const SizedBox(height: 12),
              _buildTextField('WhatsApp', _telefoneController, FontAwesomeIcons.whatsapp, keyboardType: TextInputType.phone),
              const SizedBox(height: 12),
              _buildTextField('Telefone 2 (Opcional)', _telefone2Controller, Icons.phone, keyboardType: TextInputType.phone),
              const SizedBox(height: 12),
              _buildTextField('Profissão', _professionController, Icons.work),
              const SizedBox(height: 24),

              const Text('Endereço', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              _buildTextField('CEP', _cepController, Icons.map, keyboardType: TextInputType.number),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(flex: 3, child: _buildTextField('Rua/Av', _ruaController, Icons.location_on)),
                  const SizedBox(width: 8),
                  Expanded(flex: 1, child: _buildTextField('Num', _numController, Icons.numbers)),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildTextField('Bairro', _bairroController, Icons.holiday_village)),
                  const SizedBox(width: 8),
                  Expanded(child: _buildTextField('Cidade', _cidadeController, Icons.location_city)),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildTextField('Condomínio (Opcional)', _condoController, Icons.apartment)),
                  const SizedBox(width: 8),
                  Expanded(child: _buildTextField('Bloco', _blocoController, null)),
                  const SizedBox(width: 8),
                  Expanded(child: _buildTextField('Apto', _aptoController, null)),
                ],
              ),
              const SizedBox(height: 12),
              _buildTextField('Ponto de Referência', _refController, Icons.place),
              const SizedBox(height: 12),
              _buildTextField('Observação Portão (Opcional)', _gateController, Icons.edit_note),
              const SizedBox(height: 24),

              const Text('Dados das Crianças', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              _buildTextField('Nome da(s) criança(s)', _childNameController, Icons.child_care),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildTextField('Idades', _childAgeController, Icons.cake)),
                  const SizedBox(width: 8),
                  Expanded(child: _buildTextField('Cores de Roupa', _clothesColorController, Icons.checkroom)),
                ],
              ),
              const SizedBox(height: 24),

              const Text('Motivo', style: TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              _buildTextField(
                'Motivo da Solicitação',
                _motivoController,
                Icons.warning_amber_rounded,
                maxLines: 3,
                validator: (val) => val == null || val.isEmpty ? 'Informe o motivo' : null,
              ),
              const SizedBox(height: 32),
              LedButton(
                onPressed: _isLoading ? null : _enviarSolicitacao,
                style: LedButton.styleFrom(
                  backgroundColor: const Color(0xFFCE93D8),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: _isLoading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('Enviar Solicitação', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTextField(String label, TextEditingController controller, IconData? icon, {int maxLines = 1, TextInputType? keyboardType, String? Function(String?)? validator}) {
    return TextFormField(
      controller: controller,
      style: const TextStyle(color: Colors.white),
      maxLines: maxLines,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white54),
        prefixIcon: icon != null ? Icon(icon, color: Colors.white54) : null,
        filled: true,
        fillColor: Colors.black26,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Colors.white24),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Colors.white24),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Color(0xFFCE93D8)),
        ),
      ),
      validator: validator,
    );
  }
}
