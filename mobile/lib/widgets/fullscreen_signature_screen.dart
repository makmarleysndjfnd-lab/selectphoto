import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:signature/signature.dart';

class FullscreenSignatureScreen extends StatefulWidget {
  final String title;
  final String instructions;

  const FullscreenSignatureScreen({
    super.key,
    this.title = 'Assinatura do Cliente',
    this.instructions = 'Peça ao cliente para assinar livremente na área branca abaixo.',
  });

  @override
  State<FullscreenSignatureScreen> createState() =>
      _FullscreenSignatureScreenState();
}

class _FullscreenSignatureScreenState extends State<FullscreenSignatureScreen> {
  final SignatureController _controller = SignatureController(
    penStrokeWidth: 3.5,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );
  bool _isSaving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _confirmSignature() async {
    if (_controller.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Peça ao cliente para assinar antes de salvar.'),
          backgroundColor: Colors.redAccent,
        ),
      );
      return;
    }

    setState(() => _isSaving = true);
    try {
      final Uint8List? bytes = await _controller.toPngBytes();
      if (!mounted) return;
      if (bytes == null || bytes.isEmpty) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Não foi possível capturar a assinatura. Tente novamente.'),
            backgroundColor: Colors.redAccent,
          ),
        );
        return;
      }
      Navigator.of(context).pop(bytes);
    } catch (e) {
      if (mounted) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao salvar assinatura: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B131E),
      appBar: AppBar(
        backgroundColor: const Color(0xFF111C2D),
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          widget.title,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF111C2D),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                      color: const Color(0xFFCE93D8).withOpacity(0.35)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.gesture_rounded,
                        color: Color(0xFFCE93D8), size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        widget.instructions,
                        style:
                            const TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border:
                        Border.all(color: const Color(0xFFCE93D8), width: 2.5),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(13.5),
                    child: LayoutBuilder(
                      builder: (context, constraints) => Signature(
                        controller: _controller,
                        width: constraints.maxWidth,
                        height: constraints.maxHeight,
                        backgroundColor: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _isSaving ? null : () => _controller.clear(),
                      icon: const Icon(Icons.clear_rounded,
                          color: Colors.white70),
                      label: const Text(
                        'Limpar',
                        style: TextStyle(color: Colors.white70),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Colors.white24),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton.icon(
                      onPressed: _isSaving ? null : _confirmSignature,
                      icon: _isSaving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.check_circle_rounded),
                      label: Text(
                        _isSaving ? 'Salvando...' : 'Salvar Assinatura',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF10B981),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
