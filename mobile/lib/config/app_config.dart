import 'package:flutter/foundation.dart';

class AppConfig {
  /// URL padrão oficial do backend de produção
  static const String officialProductionUrl = 'https://selectphoto-k1ac.onrender.com/api';

  /// Host autorizado para ambiente de produção
  static const String authorizedProductionHost = 'selectphoto-k1ac.onrender.com';

  /// URL do servidor injetada em tempo de compilação via --dart-define=SERVER_URL=...
  static const String _definedServerUrl = String.fromEnvironment('SERVER_URL');

  /// Versão do aplicativo compilada
  static const String appVersion = '1.0.3';
  static const int buildNumber = 3;
  static const String fullVersion = '$appVersion+$buildNumber';

  /// Retorna se a SERVER_URL foi definida em tempo de compilação.
  static bool get hasServerUrl => _definedServerUrl.trim().isNotEmpty;

  /// Validador estrito de URL por ambiente
  static String validateUrl(String rawUrl, {bool isRelease = kReleaseMode}) {
    final url = rawUrl.trim();
    if (url.isEmpty) {
      throw StateError('URL do servidor não pode ser vazia.');
    }

    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      throw StateError('URL do servidor com formato inválido: "$url".');
    }

    if (isRelease) {
      if (uri.scheme != 'https') {
        throw StateError('🛑 SEGURANÇA: Em modo release, apenas conexões HTTPS são autorizadas.');
      }
      if (uri.host != authorizedProductionHost) {
        throw StateError('🛑 SEGURANÇA: Em modo release, apenas o host oficial "$authorizedProductionHost" é autorizado. Recebido: "${uri.host}".');
      }
    }

    return url;
  }

  /// Retorna a SERVER_URL configurada para o aplicativo.
  static String get serverUrl {
    if (kReleaseMode) {
      // Em release, se injetada por --dart-define, valida estritamente; senão, usa a URL oficial de produção
      final target = hasServerUrl ? _definedServerUrl.trim() : officialProductionUrl;
      return validateUrl(target, isRelease: true);
    }

    // Em debug/profile
    if (hasServerUrl) {
      return validateUrl(_definedServerUrl.trim(), isRelease: false);
    }

    // Fallback explícito para debug local
    return 'http://localhost:3000/api';
  }

  /// Retorna a URL segura para inicialização de provedores e serviços.
  static String resolveUrl({String? customUrl}) {
    if (!kReleaseMode && customUrl != null && customUrl.trim().isNotEmpty) {
      return validateUrl(customUrl, isRelease: false);
    }
    return serverUrl;
  }
}
