import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'servico_api.dart';
import 'ajudante_bd.dart';

class SyncRequest {
  final String id;
  final String
      type; // 'SYNC_CLIENTS', 'REGISTER_SALE', 'REGISTER_NONSALE', 'REGISTER_APPOINTMENT', 'SUBMIT_COST', etc
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  int retryCount;
  String? lastError;
  bool isSyncing = false;

  SyncRequest({
    required this.id,
    required this.type,
    required this.payload,
    required this.createdAt,
    this.retryCount = 0,
    this.lastError,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'payload': payload,
        'createdAt': createdAt.toIso8601String(),
        'retryCount': retryCount,
        'lastError': lastError,
      };

  factory SyncRequest.fromJson(Map<String, dynamic> json) => SyncRequest(
        id: json['id']?.toString() ??
            DateTime.now().millisecondsSinceEpoch.toString(),
        type: json['type'] ?? '',
        payload: json['payload'] is Map<String, dynamic> ? json['payload'] : {},
        createdAt: json['createdAt'] != null
            ? DateTime.tryParse(json['createdAt']) ?? DateTime.now()
            : DateTime.now(),
        retryCount: json['retryCount'] is int ? json['retryCount'] : 0,
        lastError: json['lastError'],
      );
}

class SyncService extends ChangeNotifier {
  final ApiService apiService;
  final bool Function(String path)? fileExistsChecker;
  List<SyncRequest> _pendingRequests = [];
  Timer? _retryTimer;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  late final Future<void> _initialization;
  bool _isOnline = true;
  static const int maxRetries = 5;

  List<SyncRequest> get pendingRequests => _pendingRequests;
  bool get isOnline => _isOnline;

  bool _checkFileExists(String path) {
    if (fileExistsChecker != null) {
      return fileExistsChecker!(path);
    }
    try {
      return File(path).existsSync();
    } catch (_) {
      return false;
    }
  }

  /// Remove com segurança apenas arquivos da pasta controlada 'pending_receipts'
  Future<void> _safeDeleteControlledReceipt(String? path) async {
    if (path == null || path.trim().isEmpty) return;
    try {
      final normalized = path.replaceAll('\\', '/');
      if (!normalized.contains('/pending_receipts/') &&
          !normalized.contains('pending_receipts')) {
        if (kDebugMode) {
          print(
              '[SyncService] Segurança: exclusão fora da pasta pending_receipts bloqueada: $path');
        }
        return;
      }
      final file = File(path);
      if (await file.exists()) {
        await file.delete();
        if (kDebugMode) {
          print(
              '[SyncService] Comprovante local da pasta controlada excluído: $path');
        }
      }
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao excluir comprovante controlado: $e');
      }
    }
  }

  bool isLegacyRequest(SyncRequest req) {
    if (req.type == 'REGISTER_SALE') {
      final path = req.payload['pendingReceiptPath'] as String?;
      if (path == null || path.trim().isEmpty) return true;
      return !_checkFileExists(path);
    }
    return false;
  }

  List<SyncRequest> get syncableRequests =>
      _pendingRequests.where((req) => !isLegacyRequest(req)).toList();

  List<SyncRequest> get legacyRequests =>
      _pendingRequests.where((req) => isLegacyRequest(req)).toList();

  bool _isDisposed = false;

  @visibleForTesting
  Timer? get retryTimer => _retryTimer;

  @visibleForTesting
  bool get isSyncing => _isSyncing;

  @visibleForTesting
  Future<void> setOnlineForTesting(bool online) async {
    await _initialization;
    final wasOffline = !_isOnline;
    _isOnline = online;
    _safeNotifyListeners();

    if (wasOffline && _isOnline && _pendingRequests.isNotEmpty) {
      await syncAllPending();
    }
  }

  void _safeNotifyListeners() {
    if (!_isDisposed) {
      notifyListeners();
    }
  }

  @visibleForTesting
  static int calculateBackoff(int retryLevel) {
    return (15 * (1 << (retryLevel > 3 ? 3 : retryLevel))).clamp(15, 120);
  }

  SyncService(this.apiService, {bool? initialOnline, this.fileExistsChecker}) {
    if (initialOnline != null) _isOnline = initialOnline;
    _initialization = _loadPendingRequests();
    _initConnectivityListener();
    _initialization.then((_) {
      if (_pendingRequests.isNotEmpty && _isOnline && !_isDisposed) {
        syncAllPending();
      }
    });
  }

  void _initConnectivityListener() {
    _connectivitySubscription = Connectivity()
        .onConnectivityChanged
        .listen((List<ConnectivityResult> results) {
      final hasConnection = results.any((r) => r != ConnectivityResult.none);
      final wasOffline = !_isOnline;
      _isOnline = hasConnection;
      _safeNotifyListeners();

      // Dispara sincronização imediatamente ao recuperar conectividade caso haja pendências
      if (wasOffline && _isOnline && _pendingRequests.isNotEmpty) {
        if (kDebugMode) {
          print(
              '[SyncService] Conexão restabelecida com ${_pendingRequests.length} pendências! Iniciando sincronização.');
        }
        syncAllPending();
      }
    });
  }

  @override
  void dispose() {
    _isDisposed = true;
    _cancelRetryTimer();
    _connectivitySubscription?.cancel();
    super.dispose();
  }

  void _cancelRetryTimer() {
    _retryTimer?.cancel();
    _retryTimer = null;
  }

  void _scheduleNextRetry() {
    _cancelRetryTimer();
    if (_pendingRequests.isEmpty || !_isOnline) return;

    // Calcula backoff baseado no maior número de retentativas dos itens pendentes
    int maxRetryLevel = 0;
    for (var req in _pendingRequests) {
      if (req.retryCount > maxRetryLevel) maxRetryLevel = req.retryCount;
    }

    // Intervalo progressivo: 15s, 30s, 60s, até 120s no máximo
    final delaySeconds =
        (15 * (1 << (maxRetryLevel > 3 ? 3 : maxRetryLevel))).clamp(15, 120);

    if (kDebugMode) {
      print(
          '[SyncService] Agendando próxima tentativa de sync para daqui a ${delaySeconds}s');
    }

    _retryTimer = Timer(Duration(seconds: delaySeconds), () {
      _retryTimer = null;
      if (_isOnline && _pendingRequests.isNotEmpty) {
        syncAllPending();
      }
    });
  }

  Future<void> _loadPendingRequests() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String? data = prefs.getString('offline_backups');
      if (data != null) {
        final List<dynamic> decoded = json.decode(data);
        _pendingRequests = decoded.map((e) => SyncRequest.fromJson(e)).toList();
        _safeNotifyListeners();
      }
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao carregar fila de sync: $e');
      }
    }
  }

  Future<void> _savePendingRequests() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String encoded =
          json.encode(_pendingRequests.map((e) => e.toJson()).toList());
      await prefs.setString('offline_backups', encoded);
      _safeNotifyListeners();
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao salvar fila de sync: $e');
      }
    }
  }

  /// Adiciona uma nova requisição na fila offline.
  /// Retorna true se a requisição foi validada e persistida com sucesso na fila;
  /// retorna false caso contrário.
  Future<bool> addPendingRequest(
      String type, Map<String, dynamic> payload) async {
    await _initialization;
    // Venda sem arquivo de comprovante local nunca deve entrar na fila offline
    if (type == 'REGISTER_SALE') {
      final pendingReceiptPath = payload['pendingReceiptPath'] as String?;
      if (pendingReceiptPath == null ||
          pendingReceiptPath.trim().isEmpty ||
          !_checkFileExists(pendingReceiptPath)) {
        if (kDebugMode) {
          print(
              '[SyncService] Venda sem arquivo de comprovante local não pode ser enfileirada offline.');
        }
        return false;
      }

      // Substituição segura: se já existia pendência deste cliente, apaga a cópia antiga controlada
      if (payload['clientId'] != null) {
        final existingSales = _pendingRequests
            .where((request) =>
                request.type == 'REGISTER_SALE' &&
                request.payload['clientId']?.toString() ==
                    payload['clientId']?.toString())
            .toList();

        for (final oldSale in existingSales) {
          final oldPath = oldSale.payload['pendingReceiptPath'] as String?;
          if (oldPath != null && oldPath != pendingReceiptPath) {
            await _safeDeleteControlledReceipt(oldPath);
          }
        }

        _pendingRequests.removeWhere((request) =>
            request.type == 'REGISTER_SALE' &&
            request.payload['clientId']?.toString() ==
                payload['clientId']?.toString());
      }
    }

    final req = SyncRequest(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      type: type,
      payload: payload,
      createdAt: DateTime.now(),
      retryCount: 0,
    );
    _pendingRequests.add(req);

    try {
      await _savePendingRequests();
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Falha ao persistir requisição pendente: $e');
      }
      return false;
    }

    // Também persiste no SQLite local através do DbHelper
    try {
      await DbHelper.instance.insertSyncTask('/$type', 'POST', payload);
    } catch (_) {}

    if (_isOnline) {
      await syncAllPending();
    } else {
      _scheduleNextRetry();
    }

    return true;
  }

  /// Remove manualmente um envio pendente.
  /// Se houver comprovante local na pasta controlada, apaga o arquivo físico com segurança.
  Future<void> removePendingRequest(String id) async {
    await _initialization;
    final toRemove = _pendingRequests.where((e) => e.id == id).toList();
    for (final req in toRemove) {
      if (req.type == 'REGISTER_SALE') {
        final path = req.payload['pendingReceiptPath'] as String?;
        await _safeDeleteControlledReceipt(path);
      }
    }
    _pendingRequests.removeWhere((e) => e.id == id);
    await _savePendingRequests();
    if (_pendingRequests.isEmpty) {
      _cancelRetryTimer();
    }
  }

  Future<void> removeLegacyRequests() async {
    await _initialization;
    _pendingRequests.removeWhere((e) => isLegacyRequest(e));
    await _savePendingRequests();
    if (_pendingRequests.isEmpty) {
      _cancelRetryTimer();
    }
  }

  bool _isSyncing = false;

  Future<void> syncAllPending() async {
    await _initialization;
    if (_isSyncing || _pendingRequests.isEmpty || !_isOnline) return;
    _isSyncing = true;

    try {
      final requestsToSync = List<SyncRequest>.from(_pendingRequests);
      bool hasChanges = false;
      bool hasErrors = false;

      for (var req in requestsToSync) {
        // Se for registro legado sem comprovante local, não tenta enviar automaticamente em loop
        if (isLegacyRequest(req)) {
          req.lastError =
              'Registro antigo sem a fotografia do comprovante. Não pode ser enviado automaticamente.';
          hasChanges = true;
          continue;
        }

        // Se excedeu o número máximo de tentativas, ignora
        if (req.retryCount >= maxRetries) continue;
        if (req.isSyncing) continue;

        req.isSyncing = true;
        bool success = false;
        String? failureError;

        try {
          if (req.type == 'SYNC_CLIENTS') {
            await apiService.syncClients([req.payload]);
            success = true;
          } else if (req.type == 'REGISTER_SALE') {
            final pendingReceiptPath =
                req.payload['pendingReceiptPath'] as String?;
            if (pendingReceiptPath != null &&
                pendingReceiptPath.isNotEmpty &&
                _checkFileExists(pendingReceiptPath)) {
              await apiService.registerSaleWithReceipt(
                  req.payload, pendingReceiptPath);
              success = true;
              await _safeDeleteControlledReceipt(pendingReceiptPath);
            } else {
              throw StateError('Comprovante local ausente ou inacessível.');
            }
          } else if (req.type == 'UPLOAD_RECEIPT') {
            final saleId = req.payload['saleId']?.toString();
            final filePath = req.payload['filePath']?.toString();
            if (saleId != null &&
                filePath != null &&
                !saleId.startsWith('offline_')) {
              await apiService.uploadSaleReceipt(saleId, filePath);
              success = true;
            } else {
              success = true; // ID inválido, descarta
            }
          } else if (req.type == 'REGISTER_NONSALE') {
            await apiService.registerNonSale(req.payload);
            success = true;
          } else if (req.type == 'REGISTER_APPOINTMENT') {
            await apiService.registerAppointment(req.payload);
            success = true;
          } else if (req.type == 'SUBMIT_COST') {
            await apiService.submitCost(req.payload);
            success = true;
          }
        } catch (e) {
          hasErrors = true;
          failureError = e.toString();
          // Erros não retentáveis (400, 401, 403, 404, 409) encerram tentativas automáticas
          if (e is ApiRequestException && !e.retryable) {
            req.retryCount = maxRetries;
          }
          if (kDebugMode) {
            print(
                '[SyncService] Falha ao sincronizar requisição ${req.id} (Tentativa ${req.retryCount + 1}): $e');
          }
        } finally {
          req.isSyncing = false;
        }

        if (success) {
          _pendingRequests.removeWhere((e) => e.id == req.id);
          hasChanges = true;
        } else {
          req.retryCount += 1;
          req.lastError = failureError;
          hasChanges = true;
        }
      }

      if (_pendingRequests.isEmpty) {
        _cancelRetryTimer();
      } else if (hasErrors && syncableRequests.isNotEmpty) {
        _scheduleNextRetry();
      }

      if (hasChanges) {
        await _savePendingRequests();
      }
    } finally {
      _isSyncing = false;
    }
  }
}
