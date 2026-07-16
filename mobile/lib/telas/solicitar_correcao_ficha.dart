import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class SolicitarCorrecaoFicha extends StatefulWidget {
  final dynamic ficha;

  const SolicitarCorrecaoFicha({super.key, required this.ficha});

  @override
  State<SolicitarCorrecaoFicha> createState() => _SolicitarCorrecaoFichaState();
}

class _SolicitarCorrecaoFichaState extends State<SolicitarCorrecaoFicha> {
  final _formKey = GlobalKey<FormState>();
  final _nomeController = TextEditingController();
  final _telefoneController = TextEditingController();
  final _motivoController = TextEditingController();
  
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _nomeController.text = widget.ficha['mainContact'] ?? '';
    _telefoneController.text = widget.ficha['phone1'] ?? '';
  }

  @override
  void dispose() {
    _nomeController.dispose();
    _telefoneController.dispose();
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
              _buildTextField('Nome Principal', _nomeController, Icons.person),
              const SizedBox(height: 16),
              _buildTextField('Telefone', _telefoneController, Icons.phone),
              const SizedBox(height: 16),
              _buildTextField(
                'Motivo da Solicitação',
                _motivoController,
                Icons.warning_amber_rounded,
                maxLines: 3,
                validator: (val) => val == null || val.isEmpty ? 'Informe o motivo' : null,
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _isLoading ? null : _enviarSolicitacao,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFCE93D8),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: _isLoading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2))
                    : const Text('Enviar Solicitação', style: TextStyle(color: Colors.black, fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTextField(String label, TextEditingController controller, IconData icon, {int maxLines = 1, String? Function(String?)? validator}) {
    return TextFormField(
      controller: controller,
      style: const TextStyle(color: Colors.white),
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white54),
        prefixIcon: Icon(icon, color: Colors.white54),
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
