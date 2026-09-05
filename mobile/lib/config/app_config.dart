import 'package:flutter/foundation.dart';

class AppConfig {
  /// URL padrão oficial do backend de produção
  static const String officialProductionUrl = 'https://selectphoto-k1ac.onrender.com/api';

  /// Host autorizado para ambiente de produção e download de APK
  static const String authorizedProductionHost = 'selectphoto-k1ac.onrender.com';

  /// URL do servidor injetada em tempo de compilação via --dart-define=SERVER_URL=...
  static const String _definedServerUrl = String.fromEnvironment('SERVER_URL');

  /// Versão do aplicativo compilada
  static const String appVersion = '1.0.8';
  static const int buildNumber = 10;
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
      if (uri.scheme.toLowerCase() != 'https') {
        throw StateError('🛑 SEGURANÇA: Em modo release, apenas conexões HTTPS são autorizadas.');
      }
      if (uri.host.toLowerCase() != authorizedProductionHost) {
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

  /// Validador estrito de segurança da URL de download do APK.
  /// Aceita SOMENTE HTTPS com host exato "selectphoto-k1ac.onrender.com".
  static bool isValidApkDownloadUrl(String? rawUrl) {
    if (rawUrl == null) return false;
    final cleanUrl = rawUrl.trim();
    if (cleanUrl.isEmpty) return false;

    final uri = Uri.tryParse(cleanUrl);
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) return false;

    if (uri.scheme.toLowerCase() != 'https') return false;
    if (uri.host.toLowerCase() != authorizedProductionHost) return false;

    return true;
  }

  /// Valida se uma versão remota é mais recente que a versão instalada e deve disparar diálogo de atualização.
  /// Suporta payload real do backend contendo 'version' (ex: "1.0.4") e 'buildNumber' (ex: 5) separadamente.
  static bool shouldPromptUpdate({
    required String? remoteVersion,
    dynamic remoteBuildNumber,
    required String? downloadUrl,
    String currentVersion = AppConfig.fullVersion,
    dynamic currentBuildNumber,
  }) {
    if (remoteVersion == null || downloadUrl == null) return false;
    if (!isValidApkDownloadUrl(downloadUrl)) return false;

    final current = VersionNumber.tryParse(currentVersion, buildNumber: currentBuildNumber);
    final remote = VersionNumber.tryParse(remoteVersion, buildNumber: remoteBuildNumber);
    if (current == null || remote == null) return false;

    return remote.isGreaterThan(current);
  }
}

/// Comparador semântico de versões e build numbers (ex: "1.0.4+5", "1.0.4", buildNumber: 6)
class VersionNumber implements Comparable<VersionNumber> {
  final int major;
  final int minor;
  final int patch;
  final int build;

  const VersionNumber({
    this.major = 0,
    this.minor = 0,
    this.patch = 0,
    this.build = 0,
  });

  static VersionNumber? tryParse(String? raw, {dynamic buildNumber}) {
    if (raw == null) return null;
    final clean = raw.trim();
    if (clean.isEmpty) return null;

    int build = 0;
    if (buildNumber != null) {
      if (buildNumber is int) {
        build = buildNumber;
      } else if (buildNumber is String) {
        build = int.tryParse(buildNumber.trim()) ?? 0;
      } else if (buildNumber is num) {
        build = buildNumber.toInt();
      }
    }

    String versionPart = clean;
    if (clean.contains('+')) {
      final parts = clean.split('+');
      versionPart = parts[0];
      if (build == 0) {
        build = int.tryParse(parts[1]) ?? 0;
      }
    }

    final segments = versionPart.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final major = segments.isNotEmpty ? segments[0] : 0;
    final minor = segments.length > 1 ? segments[1] : 0;
    final patch = segments.length > 2 ? segments[2] : 0;
    if (segments.length > 3 && build == 0) {
      build = segments[3];
    }

    return VersionNumber(
      major: major,
      minor: minor,
      patch: patch,
      build: build,
    );
  }

  @override
  int compareTo(VersionNumber other) {
    if (major != other.major) return major.compareTo(other.major);
    if (minor != other.minor) return minor.compareTo(other.minor);
    if (patch != other.patch) return patch.compareTo(other.patch);
    return build.compareTo(other.build);
  }

  bool isGreaterThan(VersionNumber other) => compareTo(other) > 0;
  bool isLessThan(VersionNumber other) => compareTo(other) < 0;
  bool isEqualTo(VersionNumber other) => compareTo(other) == 0;
}
