import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../servicos/servico_api.dart';

/// Widget central para exibição segura de mídias e imagens privadas (comprovantes, fotos, assinaturas).
/// 
/// Características:
/// - Resolve URLs relativas e absolutas através de [ApiService.resolveMediaUrl].
/// - Envia automaticamente cabeçalhos de autenticação (`Authorization: Bearer <token>`).
/// - Em modo release, bloqueia o envio de token para hosts não autorizados fora de [AppConfig.officialHost].
/// - Suporta URLs 'data:image/...;base64,...' diretamente com decodificação em memória.
/// - Trata graciosamente erros 401, 403, 404 ou falhas de conexão exibindo widget de fallback.
class AuthenticatedImage extends StatelessWidget {
  final String? url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;
  final Widget? placeholder;
  final Widget? errorWidget;
  final Map<String, String>? customHeaders;

  const AuthenticatedImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
    this.placeholder,
    this.errorWidget,
    this.customHeaders,
  });

  /// Determina com precisão e segurança se a URL informada tem autorização para receber cabeçalho JWT
  static bool shouldAttachAuth(String url, {bool? isRelease}) {
    if (url.trim().isEmpty) return false;
    final trimmed = url.trim();

    if (trimmed.startsWith('data:')) {
      return false;
    }

    final uri = Uri.tryParse(trimmed);
    if (uri == null || uri.host.isEmpty) return false;

    final releaseMode = isRelease ?? kReleaseMode;

    if (releaseMode) {
      // Em modo release: exige estritamente HTTPS e host oficial exato
      if (uri.scheme.toLowerCase() != 'https') {
        return false;
      }
      final host = uri.host.toLowerCase();
      if (host != AppConfig.authorizedProductionHost) {
        return false;
      }
      return true;
    } else {
      // Em modo debug: permite host oficial ou servidores locais de desenvolvimento
      final host = uri.host.toLowerCase();
      if (host == AppConfig.authorizedProductionHost) {
        return true;
      }
      if (host == 'localhost' ||
          host == '127.0.0.1' ||
          host == '10.0.2.2' ||
          host.startsWith('192.168.') ||
          host.startsWith('10.')) {
        return true;
      }
      return false;
    }
  }

  /// Retorna os headers de autenticação seguros para a URL especificada
  static Map<String, String> getSafeHeadersForUrl(
    String url, {
    Map<String, String>? extraHeaders,
    bool? isRelease,
  }) {
    final headers = <String, String>{};
    if (extraHeaders != null) {
      headers.addAll(extraHeaders);
    }

    final canReceiveAuth = shouldAttachAuth(url, isRelease: isRelease);

    if (canReceiveAuth) {
      final apiAuth = ApiService().currentAuthHeaders;
      headers.addAll(apiAuth);
    } else {
      // Garante que nenhum header Authorization vaze para hosts não autorizados
      headers.removeWhere((key, _) => key.toLowerCase() == 'authorization');
    }

    return headers;
  }

  /// Retorna um ImageProvider autenticado para uso em CircleAvatar, DecorationImage, etc.
  static ImageProvider? provider(
    String? rawUrl, {
    Map<String, String>? customHeaders,
    bool? isRelease,
  }) {
    if (rawUrl == null || rawUrl.trim().isEmpty) return null;
    final trimmed = rawUrl.trim();

    if (trimmed.startsWith('data:image')) {
      try {
        final commaIndex = trimmed.indexOf(',');
        if (commaIndex != -1) {
          final bytes = base64Decode(trimmed.substring(commaIndex + 1));
          return MemoryImage(bytes);
        }
      } catch (e) {
        return null;
      }
    }

    final resolved = ApiService.resolveMediaUrl(trimmed);
    if (resolved.isEmpty) return null;

    final headers = getSafeHeadersForUrl(resolved, extraHeaders: customHeaders, isRelease: isRelease);
    return NetworkImage(resolved, headers: headers.isNotEmpty ? headers : null);
  }

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.trim().isEmpty) {
      return _buildError(context);
    }

    final trimmed = url!.trim();

    // 1. Suporte a Data URL em Base64
    if (trimmed.startsWith('data:image')) {
      try {
        final commaIndex = trimmed.indexOf(',');
        if (commaIndex != -1) {
          final bytes = base64Decode(trimmed.substring(commaIndex + 1));
          Widget imageWidget = Image.memory(
            bytes,
            width: width,
            height: height,
            fit: fit,
            errorBuilder: (_, __, ___) => _buildError(context),
          );
          if (borderRadius != null) {
            imageWidget = ClipRRect(borderRadius: borderRadius!, child: imageWidget);
          }
          return imageWidget;
        }
      } catch (e) {
        return _buildError(context);
      }
    }

    final resolvedUrl = ApiService.resolveMediaUrl(trimmed);
    if (resolvedUrl.isEmpty) {
      return _buildError(context);
    }

    final headers = getSafeHeadersForUrl(resolvedUrl, extraHeaders: customHeaders);

    Widget image = Image.network(
      resolvedUrl,
      headers: headers.isNotEmpty ? headers : null,
      width: width,
      height: height,
      fit: fit,
      loadingBuilder: (context, child, loadingProgress) {
        if (loadingProgress == null) return child;
        return placeholder ??
            SizedBox(
              width: width,
              height: height,
              child: Center(
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  value: loadingProgress.expectedTotalBytes != null
                      ? loadingProgress.cumulativeBytesLoaded / loadingProgress.expectedTotalBytes!
                      : null,
                ),
              ),
            );
      },
      errorBuilder: (context, error, stackTrace) {
        return _buildError(context);
      },
    );

    if (borderRadius != null) {
      image = ClipRRect(borderRadius: borderRadius!, child: image);
    }

    return image;
  }

  Widget _buildError(BuildContext context) {
    if (errorWidget != null) return errorWidget!;
    return Container(
      width: width,
      height: height,
      color: Colors.white10,
      alignment: Alignment.center,
      child: const Icon(Icons.broken_image, color: Colors.white38, size: 24),
    );
  }
}
