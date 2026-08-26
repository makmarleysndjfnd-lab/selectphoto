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
  List<SyncRequest> _pendingRequests = [];
  Timer? _retryTimer;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  late final Future<void> _initialization;
  bool _isOnline = true;
  static const int maxRetries = 5;

  List<SyncRequest> get pendingRequests => _pendingRequests;
  bool get isOnline => _isOnline;

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

  SyncService(this.apiService, {bool? initialOnline}) {
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

  Future<void> addPendingRequest(
      String type, Map<String, dynamic> payload) async {
    await _initialization;
    if (type == 'REGISTER_SALE' && payload['clientId'] != null) {
      _pendingRequests.removeWhere((request) =>
          request.type == 'REGISTER_SALE' &&
          request.payload['clientId']?.toString() ==
              payload['clientId']?.toString());
    }
    final req = SyncRequest(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      type: type,
      payload: payload,
      createdAt: DateTime.now(),
      retryCount: 0,
    );
    _pendingRequests.add(req);
    await _savePendingRequests();

    // Também persiste no SQLite local através do DbHelper
    try {
      await DbHelper.instance.insertSyncTask('/$type', 'POST', payload);
    } catch (_) {}

    if (_isOnline) {
      await syncAllPending();
    } else {
      _scheduleNextRetry();
    }
  }

  Future<void> removePendingRequest(String id) async {
    await _initialization;
    _pendingRequests.removeWhere((e) => e.id == id);
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
            if (pendingReceiptPath != null && pendingReceiptPath.isNotEmpty) {
              await apiService.registerSaleWithReceipt(
                  req.payload, pendingReceiptPath);
            } else {
              throw StateError(
                  'Venda antiga sem comprovante. Exclua este envio e refaça a venda com a foto obrigatória.');
            }
            success = true;
            try {
              await File(pendingReceiptPath).delete();
            } catch (_) {}
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
      } else if (hasErrors) {
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
