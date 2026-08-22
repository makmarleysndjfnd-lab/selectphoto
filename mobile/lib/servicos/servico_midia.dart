import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

enum MediaPickerSource {
  camera,
  gallery,
}

class MediaProfile {
  final ImageSource defaultSource;
  final CameraDevice preferredCamera;
  final double maxWidth;
  final double maxHeight;
  final int imageQuality;
  final bool allowGallery;
  final String label;

  const MediaProfile({
    required this.defaultSource,
    required this.preferredCamera,
    required this.maxWidth,
    required this.maxHeight,
    required this.imageQuality,
    required this.allowGallery,
    required this.label,
  });

  /// Foto de Perfil: CÂMERA OBRIGATÓRIA (frontal), sem opção de galeria.
  static const profilePhoto = MediaProfile(
    defaultSource: ImageSource.camera,
    preferredCamera: CameraDevice.front,
    maxWidth: 1280,
    maxHeight: 1280,
    imageQuality: 75,
    allowGallery: false,
    label: 'Foto de Perfil',
  );

  /// Evidências e Comprovantes de Venda: CÂMERA OBRIGATÓRIA (traseira), sem galeria.
  static const saleEvidence = MediaProfile(
    defaultSource: ImageSource.camera,
    preferredCamera: CameraDevice.rear,
    maxWidth: 1800,
    maxHeight: 1800,
    imageQuality: 70,
    allowGallery: false,
    label: 'Evidência de Venda',
  );

  /// Anexos Gerais (Frota, Checklist, Despesas): Modal inferior com Câmera ou Galeria.
  static const generalAttachment = MediaProfile(
    defaultSource: ImageSource.camera,
    preferredCamera: CameraDevice.rear,
    maxWidth: 1600,
    maxHeight: 1600,
    imageQuality: 75,
    allowGallery: true,
    label: 'Anexo Geral',
  );
}

class MediaPickerResult {
  final File file;
  final String fileName;
  final int sizeBytes;
  final String mimeType;

  MediaPickerResult({
    required this.file,
    required this.fileName,
    required this.sizeBytes,
    required this.mimeType,
  });

  double get sizeMb => sizeBytes / (1024 * 1024);
}

class MediaPickerService {
  static MediaPickerService _instance = MediaPickerService._internal();
  factory MediaPickerService() => _instance;
  MediaPickerService._internal({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  @visibleForTesting
  factory MediaPickerService.testInstance({ImagePicker? picker}) =>
      MediaPickerService._internal(picker: picker);

  @visibleForTesting
  static void setMockInstance(MediaPickerService mock) {
    _instance = mock;
  }

  @visibleForTesting
  static void resetInstance() {
    _instance = MediaPickerService._internal();
  }

  static const int maxFileSizeBytes = 15 * 1024 * 1024; // 15 MB
  final ImagePicker _picker;

  /// Foto de Perfil: CÂMERA OBRIGATÓRIA (preferência frontal), sem opção de galeria.
  Future<MediaPickerResult?> pickProfilePhoto(BuildContext context) async {
    return pickWithProfile(context, MediaProfile.profilePhoto);
  }

  /// Evidências e Comprovantes de Venda: CÂMERA OBRIGATÓRIA (traseira), sem galeria.
  Future<MediaPickerResult?> pickSaleEvidencePhoto(BuildContext context) async {
    return pickWithProfile(context, MediaProfile.saleEvidence);
  }

  /// Anexos Gerais (Frota, Checklist, Despesas): Modal inferior com Câmera ou Galeria.
  Future<MediaPickerResult?> pickGeneralAttachment(
    BuildContext context, {
    String title = 'Selecionar Imagem',
  }) async {
    final chosenSource = await _showSourceModal(
      context: context,
      title: title,
    );

    if (chosenSource == null) return null;

    final imageSource = chosenSource == MediaPickerSource.camera
        ? ImageSource.camera
        : ImageSource.gallery;

    final profile = MediaProfile(
      defaultSource: imageSource,
      preferredCamera: CameraDevice.rear,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 75,
      allowGallery: true,
      label: title,
    );

    return pickWithProfile(context, profile, overrideSource: imageSource);
  }

  /// Documentos Administrativos / Antecedentes: Modal com Câmera ou Galeria.
  Future<MediaPickerResult?> pickDocumentOrImage(
    BuildContext context, {
    String title = 'Selecionar Documento ou Foto',
  }) async {
    return pickGeneralAttachment(context, title: title);
  }

  Future<MediaPickerResult?> pickWithProfile(
    BuildContext context,
    MediaProfile profile, {
    ImageSource? overrideSource,
  }) async {
    try {
      final startTime = DateTime.now();
      final source = overrideSource ?? profile.defaultSource;
      final pickedFile = await _picker.pickImage(
        source: source,
        preferredCameraDevice: profile.preferredCamera,
        maxWidth: profile.maxWidth,
        maxHeight: profile.maxHeight,
        imageQuality: profile.imageQuality,
      );

      if (pickedFile == null) return null;

      final file = File(pickedFile.path);
      if (!await file.exists()) {
        throw Exception('Arquivo temporário de imagem não encontrado no dispositivo.');
      }

      final sizeBytes = await file.length();
      if (sizeBytes > maxFileSizeBytes) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: Colors.red,
              content: Text('A imagem excede o tamanho máximo permitido de 15 MB.'),
            ),
          );
        }
        return null;
      }

      final ext = pickedFile.path.split('.').last.toLowerCase();
      String mimeType = 'image/jpeg';
      if (ext == 'png') mimeType = 'image/png';
      else if (ext == 'webp') mimeType = 'image/webp';

      final durationMs = DateTime.now().difference(startTime).inMilliseconds;
      if (kDebugMode) {
        print('📸 [${profile.label}] Mídia processada: ${(sizeBytes / 1024).toStringAsFixed(1)} KB em ${durationMs}ms');
      }

      return MediaPickerResult(
        file: file,
        fileName: pickedFile.name,
        sizeBytes: sizeBytes,
        mimeType: mimeType,
      );
    } catch (e) {
      debugPrint('Erro ao capturar imagem: $e');
      if (context.mounted) {
        final errorMsg = _formatPermissionOrPickerError(e);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.red,
            content: Text(errorMsg),
          ),
        );
      }
      return null;
    }
  }

  Future<MediaPickerSource?> _showSourceModal({
    required BuildContext context,
    required String title,
  }) async {
    if (!context.mounted) return null;

    return showModalBottomSheet<MediaPickerSource>(
      context: context,
      backgroundColor: const Color(0xFF1E1E2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFF2A2A40),
                    child: Icon(Icons.camera_alt, color: Color(0xFFCE93D8)),
                  ),
                  title: const Text('Tirar foto', style: TextStyle(color: Colors.white)),
                  onTap: () => Navigator.pop(ctx, MediaPickerSource.camera),
                ),
                ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFF2A2A40),
                    child: Icon(Icons.photo_library, color: Color(0xFF90CAF9)),
                  ),
                  title: const Text('Escolher da galeria', style: TextStyle(color: Colors.white)),
                  onTap: () => Navigator.pop(ctx, MediaPickerSource.gallery),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => Navigator.pop(ctx, null),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  String _formatPermissionOrPickerError(dynamic error) {
    final str = error.toString().toLowerCase();
    if (str.contains('permission') || str.contains('denied')) {
      return 'Permissão de câmera ou armazenamento negada. Habilite nas configurações do aparelho.';
    }
    if (str.contains('camera') && str.contains('not available')) {
      return 'Câmera não disponível neste dispositivo.';
    }
    return 'Não foi possível acessar a mídia: $error';
  }
}
