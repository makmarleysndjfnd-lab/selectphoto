import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile/servicos/servico_midia.dart';

class FakeImagePicker extends ImagePicker {
  ImageSource? lastSource;
  CameraDevice? lastCameraDevice;
  double? lastMaxWidth;
  double? lastMaxHeight;
  int? lastImageQuality;

  XFile? Function()? onPickImage;

  @override
  Future<XFile?> pickImage({
    required ImageSource source,
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    bool requestFullMetadata = true,
  }) async {
    lastSource = source;
    lastCameraDevice = preferredCameraDevice;
    lastMaxWidth = maxWidth;
    lastMaxHeight = maxHeight;
    lastImageQuality = imageQuality;

    if (onPickImage != null) {
      return onPickImage!();
    }
    return null;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeImagePicker fakePicker;
  late Directory tempDir;

  setUpAll(() {
    tempDir = Directory.systemTemp.createTempSync('servico_midia_all_');
  });

  tearDownAll(() {
    try {
      tempDir.deleteSync(recursive: true);
    } catch (_) {}
  });

  setUp(() {
    fakePicker = FakeImagePicker();
  });

  tearDown(() {
    MediaPickerService.resetInstance();
  });

  group('1. Validação Estrita das Políticas de Mídia (MediaProfile)', () {
    test('Perfil de Usuário: somente câmera frontal, 1280x1280, qualidade 75, sem galeria', () {
      const p = MediaProfile.profilePhoto;
      expect(p.defaultSource, ImageSource.camera);
      expect(p.preferredCamera, CameraDevice.front);
      expect(p.maxWidth, 1280);
      expect(p.maxHeight, 1280);
      expect(p.imageQuality, 75);
      expect(p.allowGallery, isFalse);
    });

    test('Evidência / Comprovante de Venda: somente câmera traseira, 1800x1800, qualidade 70, sem galeria', () {
      const p = MediaProfile.saleEvidence;
      expect(p.defaultSource, ImageSource.camera);
      expect(p.preferredCamera, CameraDevice.rear);
      expect(p.maxWidth, 1800);
      expect(p.maxHeight, 1800);
      expect(p.imageQuality, 70);
      expect(p.allowGallery, isFalse);
    });

    test('Anexos Gerais: câmera ou galeria, 1600x1600, qualidade 75', () {
      const p = MediaProfile.generalAttachment;
      expect(p.defaultSource, ImageSource.camera);
      expect(p.preferredCamera, CameraDevice.rear);
      expect(p.maxWidth, 1600);
      expect(p.maxHeight, 1600);
      expect(p.imageQuality, 75);
      expect(p.allowGallery, isTrue);
    });

    test('MediaPickerResult calcula MB e MIME corretamente', () {
      final file = File('${tempDir.path}/test_calc.png');
      file.writeAsBytesSync(List.filled(1024 * 1024 * 2, 0)); // 2 MB

      final res = MediaPickerResult(
        file: file,
        fileName: 'test_calc.png',
        sizeBytes: 1024 * 1024 * 2,
        mimeType: 'image/png',
      );

      expect(res.sizeMb, 2.0);
      expect(res.fileName, 'test_calc.png');
      expect(res.mimeType, 'image/png');
    });
  });

  group('2. Execução com Injeção de Mock / ImagePicker (runAsync I/O)', () {
    testWidgets('pickProfilePhoto aplica parâmetros de câmera frontal e qualidade 75', (tester) async {
      final testFile = File('${tempDir.path}/profile.jpg');
      testFile.writeAsBytesSync(List.filled(1024 * 50, 1)); // 50 KB

      fakePicker.onPickImage = () => XFile(testFile.path);
      final service = MediaPickerService.testInstance(picker: fakePicker);

      late BuildContext testContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(builder: (ctx) {
              testContext = ctx;
              return const SizedBox();
            }),
          ),
        ),
      );

      MediaPickerResult? result;
      await tester.runAsync(() async {
        result = await service.pickProfilePhoto(testContext);
      });

      expect(result, isNotNull);
      expect(fakePicker.lastSource, ImageSource.camera);
      expect(fakePicker.lastCameraDevice, CameraDevice.front);
      expect(fakePicker.lastMaxWidth, 1280);
      expect(fakePicker.lastMaxHeight, 1280);
      expect(fakePicker.lastImageQuality, 75);
      expect(result!.mimeType, 'image/jpeg');
    });

    testWidgets('pickSaleEvidencePhoto aplica parâmetros de câmera traseira e qualidade 70', (tester) async {
      final testFile = File('${tempDir.path}/recibo.jpg');
      testFile.writeAsBytesSync(List.filled(1024 * 100, 2)); // 100 KB

      fakePicker.onPickImage = () => XFile(testFile.path);
      final service = MediaPickerService.testInstance(picker: fakePicker);

      late BuildContext testContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(builder: (ctx) {
              testContext = ctx;
              return const SizedBox();
            }),
          ),
        ),
      );

      MediaPickerResult? result;
      await tester.runAsync(() async {
        result = await service.pickSaleEvidencePhoto(testContext);
      });

      expect(result, isNotNull);
      expect(fakePicker.lastSource, ImageSource.camera);
      expect(fakePicker.lastCameraDevice, CameraDevice.rear);
      expect(fakePicker.lastMaxWidth, 1800);
      expect(fakePicker.lastMaxHeight, 1800);
      expect(fakePicker.lastImageQuality, 70);
    });

    testWidgets('Cancelamento pelo usuário retorna null sem erro', (tester) async {
      fakePicker.onPickImage = () => null;
      final service = MediaPickerService.testInstance(picker: fakePicker);

      late BuildContext testContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(builder: (ctx) {
              testContext = ctx;
              return const SizedBox();
            }),
          ),
        ),
      );

      MediaPickerResult? result;
      await tester.runAsync(() async {
        result = await service.pickProfilePhoto(testContext);
      });
      expect(result, isNull);
    });

    testWidgets('Arquivo > 15MB é rejeitado retornando null e exibindo SnackBar', (tester) async {
      final largeFile = File('${tempDir.path}/huge.jpg');
      largeFile.writeAsBytesSync(List.filled(16 * 1024 * 1024, 0)); // 16 MB

      fakePicker.onPickImage = () => XFile(largeFile.path);
      final service = MediaPickerService.testInstance(picker: fakePicker);

      late BuildContext testContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(builder: (ctx) {
              testContext = ctx;
              return const SizedBox();
            }),
          ),
        ),
      );

      MediaPickerResult? result;
      await tester.runAsync(() async {
        result = await service.pickSaleEvidencePhoto(testContext);
      });
      await tester.pump();

      expect(result, isNull);
      expect(find.text('A imagem excede o tamanho máximo permitido de 15 MB.'), findsOneWidget);

      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('Permissão negada é tratada graciosamente retornando null', (tester) async {
      fakePicker.onPickImage = () => throw PlatformException(
            code: 'camera_access_denied',
            message: 'O aplicativo não tem permissão para acessar a câmera.',
          );
      final service = MediaPickerService.testInstance(picker: fakePicker);

      late BuildContext testContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(builder: (ctx) {
              testContext = ctx;
              return const SizedBox();
            }),
          ),
        ),
      );

      MediaPickerResult? result;
      await tester.runAsync(() async {
        result = await service.pickProfilePhoto(testContext);
      });
      await tester.pump();

      expect(result, isNull);
      expect(find.text('Permissão de câmera ou armazenamento negada. Habilite nas configurações do aparelho.'), findsOneWidget);

      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('Arquivo inexistente no caminho retornado trata erro graciosamente', (tester) async {
      fakePicker.onPickImage = () => XFile('${tempDir.path}/arquivo_fantasma.jpg');
      final service = MediaPickerService.testInstance(picker: fakePicker);

      late BuildContext testContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(builder: (ctx) {
              testContext = ctx;
              return const SizedBox();
            }),
          ),
        ),
      );

      MediaPickerResult? result;
      await tester.runAsync(() async {
        result = await service.pickProfilePhoto(testContext);
      });
      await tester.pump();

      expect(result, isNull);
      await tester.pump(const Duration(seconds: 5));
    });
  });
}
