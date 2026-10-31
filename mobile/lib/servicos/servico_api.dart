import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';

class ApiRequestException implements Exception {
  final String message;
  final bool retryable;

  const ApiRequestException(this.message, {required this.retryable});

  @override
  String toString() => message;
}

class ApiService {
  late Dio _dio;
  String _baseUrl = AppConfig.serverUrl;
  String? _token;
  bool _isIsolatedSession = false;

  static ApiService? _mockInstance;
  @visibleForTesting
  static void setMockInstance(ApiService? mock) {
    _mockInstance = mock;
  }

  // Singleton pattern for easy global access (optional, but good for backward compatibility)
  static final ApiService _instance = ApiService._internal();
  factory ApiService({String? customBaseUrl}) {
    if (_mockInstance != null) return _mockInstance!;
    if (customBaseUrl != null) {
      _instance.updateBaseUrl(customBaseUrl);
    }
    return _instance;
  }

  ApiService._internal() {
    _initDio();
  }

  @visibleForTesting
  ApiService.testInstance() {
    _baseUrl = 'http://localhost:3000/api';
    _initDio();
  }

  Dio get dio => _dio;

  /// Construtor de sessão isolada (utilizado exclusivamente pelo suporte técnico temporário).
  /// Mantém o token efêmero estritamente na memória volátil (RAM), sem gravar em SharedPreferences.
  ApiService.isolated({required String token, String? customBaseUrl}) {
    _token = token;
    _isIsolatedSession = true;
    if (customBaseUrl != null && customBaseUrl.isNotEmpty) {
      _baseUrl = customBaseUrl;
    }
    _initDio();
  }
  String get baseUrl => _baseUrl;

  /// Resolve URL de mídia (comprovantes, fotos de perfil, assinaturas) dinamicamente a partir do servidor configurado
  static String resolveMediaUrl(String? url, {String? customBaseUrl}) {
    if (url == null || url.trim().isEmpty) return '';
    if (url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('data:')) {
      return url;
    }
    String serverBase = customBaseUrl ??
        (_instance._baseUrl.isNotEmpty
            ? _instance._baseUrl
            : AppConfig.serverUrl);
    if (serverBase.endsWith('/api')) {
      serverBase = serverBase.substring(0, serverBase.length - 4);
    }
    if (serverBase.endsWith('/')) {
      serverBase = serverBase.substring(0, serverBase.length - 1);
    }
    final cleanPath = url.startsWith('/') ? url : '/$url';
    return '$serverBase$cleanPath';
  }

  /// Retorna o token atual em memória
  String? get currentToken => _token;

  /// Retorna os headers de autenticação síncronos a partir do token em memória
  Map<String, String> get currentAuthHeaders {
    if (_token != null && _token!.isNotEmpty) {
      return {'Authorization': 'Bearer $_token'};
    }
    return {};
  }

  /// Retorna os cabeçalhos de autenticação para NetworkImage e requisições HTTP seguras
  Future<Map<String, String>> get authHeaders async {
    final token = _token ??
        (await SharedPreferences.getInstance()).getString('jwt_token');
    if (token != null && token.isNotEmpty) {
      return {'Authorization': 'Bearer $token'};
    }
    return {};
  }

  void _initDio() {
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'User-Agent': 'selectphoto-mobile/1.0.3'
      },
      connectTimeout: const Duration(seconds: 25),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 30),
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Trava estrita de segurança: valida se a baseUrl é permitida no ambiente
        if (options.baseUrl.trim().isEmpty &&
            !options.path.startsWith('http')) {
          return handler.reject(
            DioException(
              requestOptions: options,
              error: StateError(
                '🛑 ERRO CRÍTICO: SERVER_URL não configurada.',
              ),
              type: DioExceptionType.cancel,
            ),
          );
        }

        // Em release, assegura que a requisição está direcionada ao host oficial autorizado
        if (kReleaseMode) {
          final targetUrl = options.path.startsWith('http')
              ? options.path
              : '${options.baseUrl}/${options.path}';
          final uri = Uri.tryParse(targetUrl);
          if (uri != null &&
              uri.hasAuthority &&
              uri.host != AppConfig.authorizedProductionHost) {
            return handler.reject(
              DioException(
                requestOptions: options,
                error: StateError(
                    '🛑 SEGURANÇA: Requisição para host não autorizado bloqueada em release.'),
                type: DioExceptionType.cancel,
              ),
            );
          }
        }

        if (_token != null) {
          options.headers['Authorization'] = 'Bearer $_token';
        } else {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('jwt_token');
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
        }
        return handler.next(options);
      },
      onError: (DioException error, handler) async {
        if (error.response?.statusCode == 401) {
          // Token expirado ou inválido: limpa o token em memória e SharedPreferences
          _token = null;
          try {
            final prefs = await SharedPreferences.getInstance();
            if (!_isIsolatedSession) {
              await prefs.remove('jwt_token');
            }
          } catch (_) {}
        }
        return handler.next(error);
      },
    ));
  }

  void updateBaseUrl(String newUrl) {
    final validated = AppConfig.validateUrl(newUrl);
    _baseUrl = validated;
    _dio.options.baseUrl = validated;
  }

  void setToken(String? token) {
    if (token == null || token.trim().isEmpty) {
      _token = null;
    } else {
      _token = token.trim();
    }
  }

  void clearToken() {
    _token = null;
    SharedPreferences.getInstance().then((prefs) {
      prefs.remove('jwt_token');
    }).catchError((_) {});
  }

  /// Revalida a sessão atual com o servidor backend
  Future<bool> revalidateSession() async {
    try {
      final res = await _dio.get('/users/company');
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Auth endpoints
  String _extractError(DioException e) {
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return 'Tempo limite de conexão esgotado. Verifique sua conexão e tente novamente.';
    }

    if (e.type == DioExceptionType.connectionError ||
        e.message?.contains('SocketException') == true ||
        e.message?.contains('Failed host lookup') == true ||
        e.message?.contains('Connection refused') == true) {
      return 'Sem conexão com a internet ou servidor inacessível.';
    }

    if (e.type == DioExceptionType.cancel) {
      if (e.error is StateError) {
        return (e.error as StateError).message;
      }
      return 'Requisição cancelada.';
    }

    final statusCode = e.response?.statusCode;
    final data = e.response?.data;
    String? apiMsg;
    if (data is Map && data['error'] != null) {
      apiMsg = data['error'].toString();
    }

    if (statusCode == 400) {
      return apiMsg ?? 'Dados da requisição inválidos.';
    }
    if (statusCode == 401) {
      if (apiMsg != null) {
        if (apiMsg.contains('Invalid credentials')) {
          return 'CPF ou senha incorretos.';
        }
        if (apiMsg.contains('User is inactive')) {
          return 'Usuário inativo. Entre em contato com a administração.';
        }
        if (apiMsg.contains('Company account is inactive') ||
            apiMsg.contains('Company account is missing')) {
          return 'Conta da empresa inativa. Entre em contato com a administração.';
        }
      }
      return apiMsg ?? 'Sessão expirada. Faça login novamente.';
    }
    if (statusCode == 403) {
      if (apiMsg != null && apiMsg.contains('Company account is inactive')) {
        return 'Conta da empresa inativa. Entre em contato com a administração.';
      }
      return apiMsg ?? 'Acesso não autorizado para esta operação.';
    }
    final supportCode = (data is Map && data['supportCode'] != null)
        ? data['supportCode'].toString()
        : null;

    if (statusCode == 503) {
      if (supportCode != null && supportCode.isNotEmpty) {
        return apiMsg != null
            ? '$apiMsg (Código de suporte: $supportCode)'
            : 'Armazenamento temporariamente indisponível. (Código de suporte: $supportCode)';
      }
      return apiMsg ??
          'Serviço temporariamente indisponível. Tente novamente mais tarde.';
    }
    if (statusCode != null && statusCode >= 500) {
      if (supportCode != null && supportCode.isNotEmpty) {
        return 'Servidor temporariamente indisponível. (Código de suporte: $supportCode)';
      }
      return 'Servidor temporariamente indisponível. Tente novamente mais tarde.';
    }

    if (supportCode != null && supportCode.isNotEmpty && apiMsg != null) {
      return '$apiMsg (Código de suporte: $supportCode)';
    }

    return apiMsg ?? 'Falha na comunicação com o servidor.';
  }

  bool _isRetryable(DioException e) {
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError) {
      return true;
    }
    final statusCode = e.response?.statusCode;
    return statusCode == 408 ||
        statusCode == 429 ||
        (statusCode != null && statusCode >= 500);
  }

  Future<Map<String, dynamic>> login(String cpf, String password) async {
    try {
      final response = await _dio.post('/auth/login', data: {
        'cpf': cpf,
        'password': password,
      });
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Get Client by Ficha (QR Code)
  Future<Map<String, dynamic>> getClientBySequence(
      String sequenceNumber) async {
    try {
      final response = await _dio.get('/clients/ficha/$sequenceNumber');
      return response.data;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Assign seller to a book or rebolo
  Future<void> assignSeller(String sequenceNumber, String sellerId) async {
    try {
      await _dio.post('/clients/assign-seller',
          data: {'sequenceNumber': sequenceNumber, 'sellerId': sellerId});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Get rebolos (clientes com nao-venda e sem venda)
  Future<List<dynamic>> getRebolos() async {
    try {
      final response = await _dio.get('/clients/rebolos');
      return response.data;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Get users from the same company for stock transfer
  Future<List<dynamic>> getCompanyUsers() async {
    try {
      final response = await _dio.get('/users/company');
      return response.data;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Request stock transfer (covers or books)
  Future<void> requestStockTransfer(
      String recipientId, String type, int quantity) async {
    try {
      await _dio.post('/stock/request-transfer', data: {
        'recipientId': recipientId,
        'itemType': type,
        'quantity': quantity
      });
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Sync Offline Clients
  Future<Map<String, dynamic>> syncClients(
      List<Map<String, dynamic>> clientsData) async {
    try {
      final response =
          await _dio.post('/clients/sync', data: {'clients': clientsData});
      if (response.data is Map<String, dynamic>) {
        return response.data as Map<String, dynamic>;
      }
      return {'success': true, 'raw': response.data};
    } on DioException catch (e) {
      throw ApiRequestException(
        _extractError(e),
        retryable: _isRetryable(e),
      );
    }
  }

  // Get All Clients
  Future<List<dynamic>> getAllClients() async {
    try {
      final response = await _dio.get('/clients');
      return response.data;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Confirm arrival from gráfica — moves AWAITING_RELEASE → IN_STOCK
  Future<Map<String, dynamic>> confirmGrafica({
    String? city,
    String? eventName,
    List<String>? clientIds,
  }) async {
    try {
      final Map<String, dynamic> data = {};
      if (city != null) data['city'] = city;
      if (eventName != null) data['eventName'] = eventName;
      if (clientIds != null) data['clientIds'] = clientIds;

      final response = await _dio.put('/clients/confirm-grafica', data: data);
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Get clients by city and optional bookStatus
  Future<List<dynamic>> getClientsByCity(String city,
      {String? bookStatus}) async {
    try {
      final Map<String, dynamic> params = {'city': city};
      if (bookStatus != null) params['bookStatus'] = bookStatus;
      final response =
          await _dio.get('/clients/by-city', queryParameters: params);
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Batch assign a list of client IDs to a seller
  Future<Map<String, dynamic>> batchAssignSeller(
      List<String> clientIds, String assignedSellerId) async {
    try {
      final response = await _dio.patch('/clients/batch-assign', data: {
        'clientIds': clientIds,
        'assignedSellerId': assignedSellerId,
      });
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Sales
  Future<List<dynamic>> getSalesHistory({DateTime? startDate, DateTime? endDate}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (startDate != null) {
        queryParams['startDate'] = startDate.toIso8601String().split('T')[0];
      }
      if (endDate != null) {
        queryParams['endDate'] = endDate.toIso8601String().split('T')[0];
      }
      final response = await _dio.get(
        '/sales/history',
        queryParameters: queryParams.isNotEmpty ? queryParams : null,
      );
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<String> registerSale(Map<String, dynamic> saleData) async {
    try {
      final response = await _dio.post('/sales', data: saleData);
      return response.data['id'];
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao registrar venda');
    }
  }

  Future<String> registerSaleWithReceipt(
      Map<String, dynamic> saleData, String filePath,
      {String? sheetPhotoPath}) async {
    try {
      final fields = <String, dynamic>{};
      for (final entry in saleData.entries) {
        if (entry.key == 'pendingReceiptPath' ||
            entry.key == 'pendingSheetPhotoPath' ||
            entry.value == null) continue;
        if (entry.value is List || entry.value is Map) {
          fields[entry.key] = jsonEncode(entry.value);
        } else {
          fields[entry.key] = entry.value.toString();
        }
      }
      fields['receipt'] = await MultipartFile.fromFile(filePath);
      if (sheetPhotoPath != null && sheetPhotoPath.trim().isNotEmpty) {
        fields['sheetPhoto'] = await MultipartFile.fromFile(sheetPhotoPath);
      }
      final response = await _dio.post('/sales/with-receipt',
          data: FormData.fromMap(fields));
      return response.data['id'].toString();
    } on DioException catch (e) {
      throw ApiRequestException(
        _extractError(e),
        retryable: _isRetryable(e),
      );
    }
  }

  // Sales & Costs (Finance)
  Future<void> editCost(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/finance/costs/$id', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao editar custo');
    }
  }

  Future<void> editSale(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/finance/sales/$id', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao editar venda');
    }
  }

  Future<void> uploadSaleReceipt(String saleId, String filePath) async {
    try {
      final formData = FormData.fromMap({
        'receipt': await MultipartFile.fromFile(filePath),
      });
      await _dio.post('/sales/$saleId/receipt', data: formData);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Non-Sales
  Future<void> registerNonSale(Map<String, dynamic> nonSaleData) async {
    try {
      await _dio.post('/sales/non-sale', data: nonSaleData);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Appointments
  Future<void> registerAppointment(Map<String, dynamic> appointmentData) async {
    try {
      await _dio.post('/sales/appointments', data: appointmentData);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Photos
  Future<void> uploadPhoto(Map<String, dynamic> photoData) async {
    try {
      await _dio.post('/sales/photos', data: photoData);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // ── Livros e Lotes (Book Batches) ───────────────────────────────────────

  Future<Map<String, dynamic>> createBookBatch(
    String eventName, {
    String? city,
    List<String>? clientIds,
    String? batchId,
    String? sessionId,
  }) async {
    try {
      final Map<String, dynamic> data = {'eventName': eventName};
      if (city != null && city.trim().isNotEmpty) {
        data['city'] = city.trim();
      }
      if (clientIds != null && clientIds.isNotEmpty) {
        data['clientIds'] = clientIds;
      }
      if (batchId != null && batchId.trim().isNotEmpty) {
        data['batchId'] = batchId.trim();
      }
      if (sessionId != null && sessionId.trim().isNotEmpty) {
        data['sessionId'] = sessionId.trim();
      }
      final res = await _dio.post('/books/close-event', data: data);
      return res.data is Map ? Map<String, dynamic>.from(res.data) : {};
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao fechar lote de evento');
    }
  }

  // Force send a single client to admin (Photographer)
  Future<void> forceSendClient(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-send');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao enviar ficha');
    }
  }

  // Force release a single client to stock (Admin)
  Future<void> forceReleaseClient(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-release');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao liberar ficha');
    }
  }

  // Resgate Admin (Vendedor -> Estoque)
  Future<void> forceReturnToStock(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return-to-stock');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao resgatar ficha');
    }
  }

  // Resgate Vendedor (Vendedor -> AWAITING_RETURN)
  Future<void> forceReturn(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao forçar devolução');
    }
  }

  // Resgate Admin Rebolo (Rebolo -> Estoque Rebolo)
  Future<void> forceReturnReboloStock(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return-rebolo-stock');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao resgatar ficha de rebolo');
    }
  }

  // Resgate Rebolo (Rebolo -> AWAITING_RETURN)
  Future<void> forceReturnRebolo(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return-rebolo');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao forçar devolução de rebolo');
    }
  }

  Future<void> releaseBatchToStock(String batchId) async {
    try {
      await _dio.put('/books/batch/$batchId/release');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao liberar lote para o estoque');
    }
  }

  Future<void> updateBookBatchStatus(String id, String status) async {
    try {
      await _dio.put('/books/batch/$id', data: {'status': status});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar status do lote');
    }
  }

  Future<Map<String, dynamic>> getCoverStockInfo() async {
    try {
      final response = await _dio.get('/stock/info');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar informacoes de capas');
    }
  }

  Future<void> transferCovers(
    String sellerId,
    int quantity, {
    String operation = 'SEND',
    String? idempotencyKey,
  }) async {
    try {
      final Map<String, dynamic> data = {
        'sellerId': sellerId,
        'quantity': quantity.abs(),
        'operation': operation,
        'type': operation
      };
      if (idempotencyKey != null && idempotencyKey.trim().isNotEmpty) {
        data['idempotencyKey'] = idempotencyKey.trim();
      }
      await _dio.post('/stock/transfer', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao transferir capas');
    }
  }

  Future<void> addAdminCoverStock(int quantity) async {
    try {
      await _dio.post('/stock/batch', data: {'quantity': quantity});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar estoque geral');
    }
  }

  Future<void> transferBetweenSellers(String recipientId, int quantity) async {
    try {
      await _dio.post('/stock/transfer-between-sellers',
          data: {'recipientId': recipientId, 'quantity': quantity});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao solicitar transferência');
    }
  }

  Future<void> returnDefectiveCovers(
    String sellerId,
    int quantity, {
    String origin = 'SELLER',
    String? idempotencyKey,
  }) async {
    try {
      final Map<String, dynamic> data = {
        'sellerId': sellerId,
        'quantity': quantity.abs(),
        'origin': origin,
      };
      if (idempotencyKey != null && idempotencyKey.trim().isNotEmpty) {
        data['idempotencyKey'] = idempotencyKey.trim();
      }
      await _dio.post('/stock/defective', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao devolver capas defeituosas');
    }
  }

  Future<List<dynamic>> getPendingBookBatches() async {
    final all = await getBookBatches();
    return all.where((b) => b['status'] == 'AWAITING_RELEASE').toList();
  }

  Future<List<dynamic>> getBookBatches() async {
    try {
      final response = await _dio.get('/books/batch');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar lotes de books');
    }
  }

  Future<Map<String, dynamic>> updateBatchBaseCity(String batchId, String baseCity) async {
    try {
      final response = await _dio.patch('/books/batch/$batchId/base-city', data: {
        'baseCity': baseCity,
      });
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar localidade-base do lote');
    }
  }

  // ── Gestão de Frota (Fleet) ───────────────────────────────────────────

  Future<void> createCar(FormData data) async {
    try {
      await _dio.post('/fleet', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao cadastrar veículo');
    }
  }

  Future<void> updateCar(String id, dynamic data) async {
    try {
      await _dio.put('/fleet/$id', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar veículo');
    }
  }

  Future<void> deleteCar(String id) async {
    try {
      await _dio.delete('/fleet/$id');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao excluir veículo');
    }
  }

  Future<void> submitChecklist(dynamic data) async {
    try {
      await _dio.post('/fleet/checklist', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao enviar checklist');
    }
  }

  // Cache das últimas 4 buscas
  final List<Map<String, dynamic>> _searchCache = [];

  List<Map<String, dynamic>> get cachedSearches => _searchCache;

  // AI Events
  Future<Map<String, dynamic>> searchEvents(String city,
      {bool forceRefresh = false}) async {
    final lowerCity = city.toLowerCase();

    if (!forceRefresh) {
      final cachedIndex =
          _searchCache.indexWhere((c) => c['cityQuery'] == lowerCity);
      if (cachedIndex != -1) {
        final cached = _searchCache[cachedIndex];
        final DateTime savedAt = DateTime.parse(cached['savedAt']);
        if (DateTime.now().difference(savedAt).inDays < 10) {
          _searchCache.removeAt(cachedIndex);
          _searchCache.insert(0, cached);
          return cached['data'];
        }
      }
    }

    try {
      final response = await _dio.post(
        '/events/search',
        data: {'city': city},
        options: Options(receiveTimeout: const Duration(seconds: 120)),
      );
      final Map<String, dynamic> responseData =
          response.data as Map<String, dynamic>;

      _searchCache.removeWhere((c) => c['cityQuery'] == lowerCity);
      _searchCache.insert(0, {
        'cityQuery': lowerCity,
        'originalCity': city,
        'savedAt': DateTime.now().toIso8601String(),
        'data': responseData,
      });

      if (_searchCache.length > 4) {
        _searchCache.removeLast();
      }

      return responseData;
    } on DioException catch (e) {
      print('=== DIO ERROR IN SEARCH ===');
      print(e.message);
      final errorMsg =
          (e.response?.data is Map) ? e.response?.data['error'] : null;
      throw Exception(errorMsg ??
          'Erro ao buscar eventos na IA (tempo limite excedido). Tente novamente.');
    }
  }

  Future<Map<String, dynamic>> fetchStateRadar(String state,
      {bool force = false}) async {
    try {
      final response = await _dio.get(
        '/events/state-radar?state=$state&force=$force',
        options: Options(receiveTimeout: const Duration(seconds: 120)),
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      final errorMsg =
          (e.response?.data is Map) ? e.response?.data['error'] : null;
      throw Exception(errorMsg ??
          'Erro ao buscar radar por estado. O servidor demorou para responder. Tente novamente.');
    }
  }

  // Roteiro Inteligente — clusters de prospectos dentro de 300km
  Future<Map<String, dynamic>> getSmartRoute() async {
    try {
      final response = await _dio.get('/events/smart-route');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      final errorMsg =
          (e.response?.data is Map) ? e.response?.data['error'] : null;
      throw Exception(errorMsg ?? 'Erro ao buscar roteiro inteligente.');
    }
  }

  Future<void> saveSellerClosing(Map<String, dynamic> closingData) async {
    try {
      await _dio.post('/closing/daily', data: closingData);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao salvar fechamento');
    }
  }

  Future<void> payRepasse(String sellerId, double amount,
      {required String direction}) async {
    try {
      await _dio.post('/closing/pay-repasse', data: {
        'sellerId': sellerId,
        'amount': amount,
        'direction': direction,
      });
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao pagar repasse');
    }
  }

  Future<String> getMyPixKey() async {
    try {
      final response = await _dio.get('/users/me/pix-key');
      return response.data['pixKey']?.toString() ?? '';
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<String> saveMyPixKey(String pixKey) async {
    try {
      final response =
          await _dio.put('/users/me/pix-key', data: {'pixKey': pixKey.trim()});
      return response.data['pixKey']?.toString() ?? '';
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<void> saveProspect(Map<String, dynamic> eventData) async {
    try {
      await _dio.post('/events', data: eventData);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao salvar prospect');
    }
  }

  Future<List<dynamic>> getProspects() async {
    try {
      final response = await _dio.get('/events');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar prospects');
    }
  }

  Future<List<dynamic>> getUpcomingEvents() async {
    try {
      final response = await _dio.get('/events/upcoming');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar eventos próximos');
    }
  }

  Future<void> toggleFavorite(String eventId, bool isFavorite) async {
    try {
      await _dio
          .put('/events/$eventId/favorite', data: {'isFavorite': isFavorite});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao favoritar evento');
    }
  }

  Future<void> transformToProspect(String eventId) async {
    try {
      await _dio.put('/events/$eventId/prospect');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao transformar em prospect');
    }
  }

  Future<void> updateProspect(String eventId, Map<String, dynamic> data) async {
    try {
      await _dio.put('/events/$eventId', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar prospect');
    }
  }

  Future<void> deleteProspect(String eventId) async {
    try {
      await _dio.delete('/events/$eventId');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao excluir prospect');
    }
  }

  Future<void> savePlannedCost(Map<String, dynamic> costData) async {
    try {
      // Re-use costs endpoint but passing status='PLANNED' and eventId
      costData['status'] = 'PLANNED';
      await _dio.post('/costs', data: costData);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao salvar custo planejado');
    }
  }

  // ── Finanças e Custos ───────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getFinanceOverview() async {
    try {
      final response = await _dio.get('/finance/overview');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar fluxo de caixa');
    }
  }

  Future<Map<String, dynamic>> getClosingData(String city,
      {List<String>? sellerIds, String? date}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (sellerIds != null && sellerIds.isNotEmpty) {
        queryParams['sellerIds'] = sellerIds.join(',');
      }
      if (date != null && date.isNotEmpty) {
        queryParams['date'] = date;
      }

      final response = await _dio.get(
        '/closing/city/$city',
        queryParameters: queryParams.isNotEmpty ? queryParams : null,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar fechamento');
    }
  }

  Future<Map<String, dynamic>> getCustomMetrics(
      {List<String>? sellerIds,
      String? startDate,
      String? endDate,
      String? city}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (sellerIds != null && sellerIds.isNotEmpty) {
        queryParams['sellerIds'] = sellerIds.join(',');
      }
      if (startDate != null && startDate.isNotEmpty) {
        queryParams['startDate'] = startDate;
      }
      if (endDate != null && endDate.isNotEmpty) {
        queryParams['endDate'] = endDate;
      }
      if (city != null && city.isNotEmpty) {
        queryParams['city'] = city;
      }

      final response = await _dio.get(
        '/closing/custom',
        queryParameters: queryParams.isNotEmpty ? queryParams : null,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      final data = e.response?.data;
      final errorMsg = (data is Map) ? data['error'] : data?.toString();
      throw Exception(errorMsg ?? 'Erro ao buscar métricas customizadas');
    }
  }

  Future<Map<String, dynamic>> getSellerClosing(String sellerId) async {
    try {
      final response = await _dio.get('/closing/daily/$sellerId');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar fechamento');
    }
  }

  Future<Map<String, dynamic>> getPhotographerClosing(
      String photographerId) async {
    try {
      final response = await _dio.get('/closing/photographer/$photographerId');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar fechamento');
    }
  }

  Future<List<dynamic>> getPendingCosts() async {
    try {
      final response = await _dio.get('/finance/pending-costs');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar custos pendentes');
    }
  }

  Future<void> updateCostStatus(String costId, String status) async {
    try {
      await _dio.put('/finance/costs/$costId/status', data: {'status': status});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar status do custo');
    }
  }

  Future<Map<String, dynamic>> getHealthDashboard() async {
    try {
      final response = await _dio.get('/finance/health');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar indicadores de saúde');
    }
  }

  Future<void> submitCost(Map<String, dynamic> costData) async {
    try {
      await _dio.post('/costs', data: costData);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao registrar custo');
    }
  }

  Future<Map<String, dynamic>> getAppVersion() async {
    try {
      final response = await _dio.get('/app/version');
      return response.data as Map<String, dynamic>;
    } on DioException {
      return {'version': '1.0.0', 'mandatory': false, 'downloadUrl': ''};
    } catch (_) {
      return {'version': '1.0.0', 'mandatory': false, 'downloadUrl': ''};
    }
  }

  // ── Funcionários (Users) ──────────────────────────────────────────────────

  Future<List<dynamic>> getUsers() async {
    try {
      final response = await _dio.get('/users');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar funcionários');
    }
  }

  Future<void> createUser(FormData data) async {
    try {
      await _dio.post('/users', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao criar funcionário');
    }
  }

  Future<void> updateUser(String id, FormData data) async {
    try {
      await _dio.put('/users/$id', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar funcionário');
    }
  }

  Future<void> deleteUser(String id) async {
    try {
      await _dio.delete('/users/$id');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao excluir funcionário');
    }
  }

  // ── Equipes (Teams) ───────────────────────────────────────────────────────

  Future<List<dynamic>> getTeams() async {
    try {
      final response = await _dio.get('/teams');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar equipes');
    }
  }

  Future<Map<String, dynamic>> createTeam(Map<String, dynamic> data) async {
    try {
      final res = await _dio.post('/teams', data: data);
      return res.data;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao criar equipe');
    }
  }

  Future<void> updateTeam(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/teams/$id', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao atualizar equipe');
    }
  }

  Future<void> deleteTeam(String id) async {
    try {
      await _dio.delete('/teams/$id');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao excluir equipe');
    }
  }

  // ── Frota (Cars) ──────────────────────────────────────────────────────────

  Future<List<dynamic>> getCars() async {
    try {
      final response = await _dio.get('/fleet');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar frota');
    }
  }

  Future<String> uploadFile(String filePath) async {
    try {
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath),
      });
      final response = await _dio.post('/upload', data: formData);
      return response.data['url'];
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // ── Notificações (Notifications) ──────────────────────────────────────────

  Future<List<dynamic>> getNotifications() async {
    try {
      final response = await _dio.get('/notifications');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar notificações');
    }
  }

  Future<void> actionNotification(String id, String actionType,
      {Map<String, dynamic>? extraData}) async {
    try {
      final data = <String, dynamic>{'actionType': actionType};
      if (extraData != null) {
        data.addAll(extraData);
      }
      await _dio.post('/notifications/$id/action', data: data);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao processar notificação');
    }
  }

  Future<void> markNotificationRead(String id) async {
    try {
      await _dio.patch('/notifications/$id/read');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao marcar notificação como lida');
    }
  }

  Future<void> updateFcmToken(String token) async {
    try {
      await _dio.put('/users/me/fcm-token', data: {'token': token});
    } catch (e) {
      print("Failed to sync FCM token: $e");
    }
  }

  Future<void> createNotification({
    required String title,
    required String message,
    required String type,
    String? priority,
    String? targetRole,
    String? targetUserId,
  }) async {
    try {
      await _dio.post('/notifications', data: {
        'title': title,
        'message': message,
        'type': type,
        'priority': priority ?? 'NORMAL',
        'targetRole': targetRole,
        'targetUserId': targetUserId,
      });
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao criar notificação');
    }
  }

  Future<void> releaseCity(String city) async {
    try {
      await _dio.put('/clients/release-city', data: {'city': city});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao liberar lotes da cidade');
    }
  }

  Future<void> createEditRequest({
    required String clientId,
    required Map<String, dynamic> proposedData,
    String? reason,
  }) async {
    try {
      final userResponse = await _dio.get('/users/me');
      final photographerId = userResponse.data['id'];

      await _dio.post('/edit-requests', data: {
        'clientId': clientId,
        'photographerId': photographerId,
        'proposedData': proposedData,
        'reason': reason,
      });
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao criar solicitação de edição');
    }
  }

  Future<List<dynamic>> getProductionSummary() async {
    try {
      final response = await _dio.get('/clients/production-summary');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar resumo de produção');
    }
  }

  Future<List<dynamic>> getClientsByPhotographer() async {
    try {
      final response = await _dio.get('/clients/photographer');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar fichas');
    }
  }

  Future<List<dynamic>> getClientsBySeller() async {
    try {
      final response = await _dio.get('/clients/seller');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar fichas do vendedor');
    }
  }

  Future<List<dynamic>> getPersonalAppointments(String sellerId,
      {DateTime? from}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (from != null) {
        queryParams['from'] = from.toUtc().toIso8601String();
      }
      final response = await _dio.get(
        '/appointments/seller/$sellerId',
        queryParameters: queryParams.isEmpty ? null : queryParams,
      );
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<List<dynamic>> getUnifiedAppointments(String sellerId,
      {DateTime? from}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (from != null) {
        queryParams['from'] = from.toUtc().toIso8601String();
      }
      final response = await _dio.get(
        '/appointments/unified/$sellerId',
        queryParameters: queryParams.isEmpty ? null : queryParams,
      );
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> createPersonalAppointment({
    required String sellerId,
    required String title,
    String? description,
    required DateTime dateTime,
  }) async {
    try {
      final response = await _dio.post('/appointments', data: {
        'sellerId': sellerId,
        'title': title,
        'description': description,
        'dateTime': dateTime.toUtc().toIso8601String(),
      });
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> getCityClosingPreview(String city) async {
    try {
      final response = await _dio.get(
        '/closing/city/preview',
        queryParameters: {'city': city},
      );
      return Map<String, dynamic>.from(response.data as Map);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar prévia de fechamento');
    }
  }

  Future<Map<String, dynamic>> closeCity(String city, {String? event}) async {
    try {
      final response = await _dio.post('/closing/city', data: {
        'city': city,
        if (event != null && event.trim().isNotEmpty) 'event': event.trim(),
      });
      return Map<String, dynamic>.from(response.data as Map);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao realizar fechamento de cidade');
    }
  }

  Future<List<Map<String, dynamic>>> getCitiesClosingPreview() async {
    try {
      final response = await _dio.get('/closing/cities/preview');
      final list = response.data as List<dynamic>;
      return list.map((item) => Map<String, dynamic>.from(item as Map)).toList();
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar prévia de fechamento de cidades');
    }
  }

  Future<Map<String, dynamic>> closeMultipleCities(List<String> cities, {String? event}) async {
    try {
      final response = await _dio.post('/closing/cities', data: {
        'cities': cities,
        if (event != null && event.trim().isNotEmpty) 'event': event.trim(),
      });
      return Map<String, dynamic>.from(response.data as Map);
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao realizar fechamento de cidades');
    }
  }

  Future<List<dynamic>> getPendingEditRequests() async {
    try {
      final response = await _dio.get('/edit-requests/pending');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar solicitações');
    }
  }

  Future<void> approveEditRequest(String id) async {
    try {
      await _dio.post('/edit-requests/$id/approve');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao aprovar solicitação');
    }
  }

  Future<void> rejectEditRequest(String id) async {
    try {
      await _dio.post('/edit-requests/$id/reject');
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao rejeitar solicitação');
    }
  }

  Future<List<dynamic>> searchBooks(String query) async {
    try {
      final response =
          await _dio.get('/books/search', queryParameters: {'q': query});
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao buscar livros');
    }
  }

  Future<void> receiveReturnedBook(String sequenceNumber) async {
    try {
      await _dio.post('/books/receive-return',
          data: {'sequenceNumber': sequenceNumber});
    } on DioException catch (e) {
      throw Exception(
          (e.response?.data is Map ? e.response?.data['error'] : null) ??
              'Erro ao receber devolução');
    }
  }

  Future<String> downloadBackup() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('jwt_token');

      final res = await _dio.get('/backup/download',
          options: Options(
            headers: {'Authorization': 'Bearer $token'},
            responseType: ResponseType.plain, // To get the raw JSON string
          ));

      if (res.statusCode == 200) {
        return res.data.toString();
      } else {
        throw Exception('Failed to download backup');
      }
    } catch (e) {
      print('Error downloading backup: $e');
      throw Exception('Network error');
    }
  }

  Future<void> restoreBackup(String filePath, {bool force = false}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('jwt_token');

      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: 'backup.json'),
      });

      final res = await _dio.post(
        '/backup/restore',
        queryParameters: {'force': force},
        data: formData,
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );

      if (res.statusCode != 200) {
        throw Exception('Failed to restore backup');
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 409) {
        // Specifically throw to handle conflict
        throw Exception(
            'CONFLICT: ${(e.response?.data is Map ? e.response?.data['error'] : null)}');
      }
      throw Exception('Network error');
    } catch (e) {
      print('Error restoring backup: $e');
      throw Exception('Error restoring backup');
    }
  }

  Future<String> getDailyQuote() async {
    try {
      final res = await _dio.get('/quotes/random');
      if (res.statusCode == 200 && res.data != null) {
        final quoteData = res.data;
        if (quoteData['texto'] != null && quoteData['autor'] != null) {
          return '"${quoteData['texto']}" - ${quoteData['autor']}';
        }
      }
      return '';
    } catch (e) {
      print('Error fetching daily quote: $e');
      return '';
    }
  }

  // ── Estatísticas / BI ──────────────────────────────────────
  Future<dynamic> getStatsBooks(
      {String? from,
      String? to,
      String? city,
      String? event,
      String? batchId}) async {
    final queryParams = <String, String>{};
    if (from != null) queryParams['from'] = from;
    if (to != null) queryParams['to'] = to;
    if (city != null) queryParams['city'] = city;
    if (event != null) queryParams['event'] = event;
    if (batchId != null) queryParams['batchId'] = batchId;
    final resp = await _dio.get('/stats/books',
        queryParameters: queryParams.isEmpty ? null : queryParams);
    return resp.data;
  }

  Future<dynamic> getStatsAiInsights(Map<String, dynamic> statsData) async {
    final resp = await _dio.post(
      '/stats/books/ai-insights',
      data: statsData,
      options: Options(receiveTimeout: const Duration(seconds: 120)),
    );
    return resp.data;
  }

  Future<dynamic> getStatsRebolos() async {
    final resp = await _dio.get('/stats/rebolos');
    return resp.data;
  }

  Future<void> updateProfileName(String newName) async {
    await _dio.put('/users/profile', data: {'name': newName});
  }

  Future<void> approveEventRoi(String eventId,
      {required double totalCost, double? expectedRevenue}) async {
    await _dio.patch('/events/$eventId/approve-roi', data: {
      'totalCost': totalCost,
      if (expectedRevenue != null) 'expectedRevenue': expectedRevenue,
    });
  }

  Future<void> batchAssignClients(
      List<String> clientIds, String sellerId) async {
    await _dio.patch('/clients/batch-assign', data: {
      'clientIds': clientIds,
      'assignedSellerId': sellerId,
    });
  }

  Future<List<dynamic>> getSellers() async {
    try {
      final resp = await _dio.get('/users');
      final List<dynamic> users = resp.data;
      return users.where((u) {
        final role = (u['role'] ?? '').toString().toUpperCase();
        return role == 'VENDEDOR' ||
            role == 'SELLER' ||
            role == 'ADMIN' ||
            role == 'SUPER_ADMIN';
      }).toList();
    } catch (_) {
      return [];
    }
  }

  // ================= Crediário Interno / Parcelado =================
  Future<Map<String, dynamic>> getCreditOverview({
    String? sellerId,
    String? startDate,
    String? endDate,
  }) async {
    try {
      final params = <String, dynamic>{
        if (sellerId != null && sellerId.isNotEmpty) 'sellerId': sellerId,
        if (startDate != null && startDate.isNotEmpty) 'startDate': startDate,
        if (endDate != null && endDate.isNotEmpty) 'endDate': endDate,
      };
      final resp = await _dio.get('/credit/overview', queryParameters: params);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<List<dynamic>> getCreditAgreements({
    String? search,
    String? status,
    String? sellerId,
  }) async {
    try {
      final params = <String, dynamic>{
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (status != null && status.isNotEmpty) 'status': status,
        if (sellerId != null && sellerId.isNotEmpty) 'sellerId': sellerId,
      };
      final resp = await _dio.get('/credit/agreements', queryParameters: params);
      return List<dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> getCreditAgreementDetails(String id) async {
    try {
      final resp = await _dio.get('/credit/agreements/$id');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> registerCreditPayment(
      String agreementId, Map<String, dynamic> data) async {
    try {
      final resp =
          await _dio.post('/credit/agreements/$agreementId/payments', data: data);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> reverseCreditPayment(String paymentId,
      {required String reason}) async {
    try {
      final resp = await _dio
          .post('/credit/payments/$paymentId/reverse', data: {'reason': reason});
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> renegotiateCreditAgreement(
      String agreementId, Map<String, dynamic> data) async {
    try {
      final resp = await _dio
          .post('/credit/agreements/$agreementId/renegotiate', data: data);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> payCreditCommission(String commissionId) async {
    try {
      final resp = await _dio.post('/credit/commissions/$commissionId/pay');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> payCreditCommissionsBatch({
    required String sellerId,
    required List<String> commissionIds,
    String paymentMethod = 'PIX',
    String? notes,
    String? receiptUrl,
    String? idempotencyKey,
  }) async {
    try {
      final resp = await _dio.post('/credit/commissions/pay', data: {
        'sellerId': sellerId,
        'commissionIds': commissionIds,
        'paymentMethod': paymentMethod,
        'notes': notes,
        'receiptUrl': receiptUrl,
        'idempotencyKey': idempotencyKey,
      });
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<List<dynamic>> getSellersCreditSummary() async {
    try {
      final resp = await _dio.get('/credit/sellers-summary');
      return List<dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> getSellerCreditPortfolio({String? sellerId, String? competence}) async {
    try {
      final params = <String>[];
      if (sellerId != null && sellerId.isNotEmpty) params.add('sellerId=$sellerId');
      if (competence != null && competence.isNotEmpty) params.add('competence=$competence');
      final query = params.isNotEmpty ? '?${params.join('&')}' : '';
      final resp = await _dio.get('/credit/seller/portfolio$query');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }


  Future<Map<String, dynamic>> getAsaasConfig() async {
    try {
      final resp = await _dio.get('/credit/asaas/config');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> updateAsaasConfig(Map<String, dynamic> data) async {
    try {
      final resp = await _dio.post('/credit/asaas/config', data: data);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> emitAsaasCharges(String agreementId) async {
    try {
      final resp = await _dio.post('/credit/agreements/$agreementId/emit-asaas');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<List<dynamic>> getAsaasDuplicateAlerts({String? status}) async {
    try {
      final query = status != null ? {'status': status} : null;
      final resp = await _dio.get('/credit/asaas/duplicate-alerts', queryParameters: query);
      return List<dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> resolveAsaasDuplicateAlert(
      String id, String action, {String? notes}) async {
    try {
      final resp = await _dio
          .post('/credit/asaas/duplicate-alerts/$id/resolve', data: {
        'action': action,
        'notes': notes,
      });
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // ================= Fechamento Mensal do Crediário (Etapa 2) =================

  /// Retorna os 4 estados visíveis de comissão para a carteira do vendedor
  Future<Map<String, dynamic>> getSellerFourStates({String? sellerId}) async {
    try {
      final query = sellerId != null ? {'sellerId': sellerId} : null;
      final resp = await _dio.get('/credit/seller/four-states', queryParameters: query);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Lista fechamentos mensais de crediário
  Future<List<dynamic>> getMonthlyCreditClosings({
    String? competence,
    String? sellerId,
    String? status,
  }) async {
    try {
      final params = <String, dynamic>{
        if (competence != null) 'competence': competence,
        if (sellerId != null) 'sellerId': sellerId,
        if (status != null) 'status': status,
      };
      final resp = await _dio.get('/credit/monthly-closings', queryParameters: params);
      return List<dynamic>.from(resp.data['closings'] ?? []);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Detalhes de um fechamento mensal
  Future<Map<String, dynamic>> getMonthlyCreditClosingDetail(String id) async {
    try {
      final resp = await _dio.get('/credit/monthly-closings/$id');
      return Map<String, dynamic>.from(resp.data['closing'] ?? resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Processa fechamento formal de uma competência encerrada para um vendedor
  Future<Map<String, dynamic>> processMonthlyCreditClosing({
    required String sellerId,
    required String competence,
    String? notes,
  }) async {
    try {
      final resp = await _dio.post('/credit/monthly-closings/process', data: {
        'sellerId': sellerId,
        'competence': competence,
        if (notes != null) 'notes': notes,
      });
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Registra acerto (parcial ou integral) do fechamento mensal
  Future<Map<String, dynamic>> recordMonthlyCreditPayout({
    required String closingId,
    required int amountCents,
    String paymentMethod = 'PIX',
    String? receiptUrl,
    String? notes,
    String? idempotencyKey,
  }) async {
    try {
      final resp = await _dio.post('/credit/monthly-closings/$closingId/payout', data: {
        'amountCents': amountCents,
        'paymentMethod': paymentMethod,
        if (receiptUrl != null) 'receiptUrl': receiptUrl,
        if (notes != null) 'notes': notes,
        if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
      });
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // ── Central do Proprietário (Bloco 1) ──────────────────────────────────────

  /// Reautenticação reforçada (Step-Up Auth) com senha
  Future<Map<String, dynamic>> ownerStepUpAuth(String password, {String? reason}) async {
    try {
      final resp = await _dio.post('/owner/auth/step-up', data: {
        'password': password,
        if (reason != null) 'reason': reason,
      });
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Revoga a sessão de step-up auth atual
  Future<void> ownerRevokeStepUp({String? stepUpToken}) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) {
        headers['X-Step-Up-Token'] = stepUpToken;
      }
      await _dio.post('/owner/auth/step-up/revoke', options: Options(headers: headers));
    } catch (_) {}
  }

  /// Perfil e capacidades do proprietário
  Future<Map<String, dynamic>> getOwnerProfile() async {
    try {
      final resp = await _dio.get('/owner/profile');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Listar empresas na Central do Proprietário
  Future<List<Map<String, dynamic>>> getOwnerCompanies({String? status, String? search}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (status != null && status != 'ALL') queryParams['status'] = status;
      if (search != null && search.trim().isNotEmpty) queryParams['search'] = search.trim();

      final resp = await _dio.get('/owner/companies', queryParameters: queryParams);
      return (resp.data as List).map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Detalhes completos da empresa (com histórico de taxas e auditoria)
  Future<Map<String, dynamic>> getOwnerCompanyDetails(String companyId) async {
    try {
      final resp = await _dio.get('/owner/companies/$companyId');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Cadastrar nova empresa
  Future<Map<String, dynamic>> createOwnerCompany(
    Map<String, dynamic> data, {
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = Map<String, dynamic>.from(data);
      if (passwordConfirmation != null) body['passwordConfirmation'] = passwordConfirmation;

      final resp = await _dio.post(
        '/owner/companies',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Atualizar dados contratuais da empresa
  Future<Map<String, dynamic>> updateOwnerCompany(
    String companyId,
    Map<String, dynamic> data, {
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = Map<String, dynamic>.from(data);
      if (passwordConfirmation != null) body['passwordConfirmation'] = passwordConfirmation;

      final resp = await _dio.put(
        '/owner/companies/$companyId',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Configurar nova taxa de remuneração do Lumora com vigência
  Future<Map<String, dynamic>> setOwnerCompanyRate(
    String companyId, {
    required double ratePercentage,
    required DateTime effectiveFrom,
    required String reason,
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = <String, dynamic>{
        'ratePercentage': ratePercentage,
        'effectiveFrom': effectiveFrom.toIso8601String(),
        'reason': reason,
        if (passwordConfirmation != null) 'passwordConfirmation': passwordConfirmation,
      };

      final resp = await _dio.post(
        '/owner/companies/$companyId/rates',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Suspender ou Reativar Empresa
  Future<Map<String, dynamic>> setOwnerCompanyStatus(
    String companyId, {
    required String status,
    required String reason,
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = <String, dynamic>{
        'status': status,
        'reason': reason,
        if (passwordConfirmation != null) 'passwordConfirmation': passwordConfirmation,
      };

      final resp = await _dio.post(
        '/owner/companies/$companyId/status',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Trilha de auditoria contratual
  Future<List<Map<String, dynamic>>> getOwnerAuditLogs({String? companyId, int limit = 50}) async {
    try {
      final queryParams = <String, dynamic>{'limit': limit};
      if (companyId != null) queryParams['companyId'] = companyId;

      final resp = await _dio.get('/owner/audit-logs', queryParameters: queryParams);
      return (resp.data as List).map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Consulta de contrato próprio da empresa (COMPANY_ADMIN)
  Future<Map<String, dynamic>> getMyCompanyContract() async {
    try {
      final resp = await _dio.get('/owner/my-company-contract');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // ── ETAPA 2: CENTRAL DE INTEGRAÇÕES E APIS ───────────────────────────────────

  /// Catálogo de integrações suportadas
  Future<List<Map<String, dynamic>>> getIntegrationCatalogs() async {
    try {
      final resp = await _dio.get('/owner/integrations/catalogs');
      final list = resp.data['catalogs'] as List? ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Lista integrações configuradas por empresa
  Future<List<Map<String, dynamic>>> getCompanyIntegrations(String companyId) async {
    try {
      final resp = await _dio.get('/owner/integrations/companies/$companyId');
      final list = resp.data['integrations'] as List? ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Detalhes de uma integração com auditoria recente
  Future<Map<String, dynamic>> getIntegrationDetails(String id) async {
    try {
      final resp = await _dio.get('/owner/integrations/$id');
      return Map<String, dynamic>.from(resp.data['integration'] ?? {});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Cadastrar nova integração para empresa (requer Step-Up Auth)
  Future<Map<String, dynamic>> createCompanyIntegration(
    Map<String, dynamic> data, {
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = Map<String, dynamic>.from(data);
      if (passwordConfirmation != null) body['passwordConfirmation'] = passwordConfirmation;

      final resp = await _dio.post(
        '/owner/integrations',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Rotacionar ou atualizar credencial criptografada no Vault (requer Step-Up Auth)
  Future<Map<String, dynamic>> rotateIntegrationCredentials(
    String id,
    String plainSecret, {
    String? reason,
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = <String, dynamic>{
        'plainSecret': plainSecret,
        if (reason != null) 'reason': reason,
        if (passwordConfirmation != null) 'passwordConfirmation': passwordConfirmation,
      };

      final resp = await _dio.post(
        '/owner/integrations/$id/credentials',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Atualizar status da integração (ACTIVE, DISABLED, TESTING, REVOKED) (requer Step-Up Auth)
  Future<Map<String, dynamic>> updateIntegrationStatus(
    String id,
    String status, {
    String? reason,
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final body = <String, dynamic>{
        'status': status,
        if (reason != null) 'reason': reason,
        if (passwordConfirmation != null) 'passwordConfirmation': passwordConfirmation,
      };

      final resp = await _dio.post(
        '/owner/integrations/$id/status',
        data: body,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Testar conexão não destrutiva com o provedor
  Future<Map<String, dynamic>> testIntegrationConnection(String id) async {
    try {
      final resp = await _dio.post('/owner/integrations/$id/test');
      return Map<String, dynamic>.from(resp.data['testResult'] ?? {});
    } on DioException catch (e) {
      if (e.response?.statusCode == 422 &&
          e.response?.data is Map &&
          e.response?.data['testResult'] != null) {
        return Map<String, dynamic>.from(e.response!.data['testResult']);
      }
      throw Exception(_extractError(e));
    }
  }

  /// Histórico de consumo e métricas
  Future<List<Map<String, dynamic>>> getIntegrationUsage(String id) async {
    try {
      final resp = await _dio.get('/owner/integrations/$id/usage');
      final list = resp.data['usage'] as List? ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Executar homologação oficial no Asaas Sandbox (exige Step-Up Auth)
  Future<Map<String, dynamic>> runAsaasSandboxHomologation({
    required String companyId,
    String? sandboxApiKey,
    String? webhookToken,
    bool? forceSimulation,
    String? stepUpToken,
  }) async {
    try {
      final resp = await _dio.post(
        '/owner/integrations/sandbox/run-homologation',
        data: {
          'companyId': companyId,
          if (sandboxApiKey != null) 'sandboxApiKey': sandboxApiKey,
          if (webhookToken != null) 'webhookToken': webhookToken,
          if (forceSimulation != null) 'forceSimulation': forceSimulation,
        },
        options: stepUpToken != null
            ? Options(headers: {'x-step-up-token': stepUpToken})
            : null,
      );
      return Map<String, dynamic>.from(resp.data['report'] ?? {});
    } on DioException catch (e) {
      if (e.response?.statusCode == 422 &&
          e.response?.data is Map &&
          e.response?.data['report'] != null) {
        return Map<String, dynamic>.from(e.response!.data['report']);
      }
      throw Exception(_extractError(e));
    }
  }

  /// Atualizar parâmetros não-secretos e metadados de configuração (requer Step-Up Auth)
  Future<Map<String, dynamic>> updateIntegrationMetadata(
    String id,
    Map<String, dynamic> data, {
    String? stepUpToken,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;

      final resp = await _dio.put(
        '/owner/integrations/$id',
        data: data,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Obter relatório de prontidão para entrada futura em modo LIVE
  // ── ETAPA 3: FATURAMENTO VARIÁVEL LUMORA, AUDITORIA OPERACIONAL E CUSTOS ─────

  /// Consulta somente-leitura do demonstrativo da própria empresa (sem PII, sem links de checkout)
  Future<Map<String, dynamic>> getMyCompanyStatements({String? competence}) async {
    try {
      final resp = await _dio.get(
        '/owner/my-company-statements',
        queryParameters: competence != null && competence.isNotEmpty
            ? {'competence': competence}
            : null,
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Detalhe por competência do demonstrativo da própria empresa
  Future<Map<String, dynamic>> getMyCompanyStatementDetail(String competence) async {
    try {
      final resp = await _dio.get('/owner/my-company-statements/$competence');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Lista geral de demonstrativos e prévias na Central do Proprietário
  Future<Map<String, dynamic>> getOwnerBillingStatements({
    String? competence,
    String? companyId,
    String? status,
  }) async {
    try {
      final query = <String, dynamic>{};
      if (competence != null && competence.isNotEmpty) query['competence'] = competence;
      if (companyId != null && companyId.isNotEmpty) query['companyId'] = companyId;
      if (status != null && status.isNotEmpty && status != 'ALL') query['status'] = status;
      final resp = await _dio.get('/owner/billing/statements', queryParameters: query);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Prévia detalhada ou demonstrativo fechado de uma empresa e competência
  Future<Map<String, dynamic>> getOwnerStatementPreview({
    required String companyId,
    required String competence,
  }) async {
    try {
      final resp = await _dio.get(
        '/owner/billing/statements/preview',
        queryParameters: {'companyId': companyId, 'competence': competence},
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Fechamento único e idempotente do demonstrativo mensal (requer Step-Up Auth)
  Future<Map<String, dynamic>> closeOwnerMonthlyStatement({
    required String companyId,
    required String competence,
    String? notes,
    String? stepUpToken,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;
      final resp = await _dio.post(
        '/owner/billing/statements/close',
        data: {
          'companyId': companyId,
          'competence': competence,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
        },
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Registrar crédito proporcional de devolução/cancelamento ou ajuste manual (requer Step-Up Auth)
  Future<Map<String, dynamic>> recordOwnerStatementAdjustment({
    required Map<String, dynamic> payload,
    String? stepUpToken,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;
      final resp = await _dio.post(
        '/owner/billing/statements/adjustments',
        data: payload,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Registrar conciliação manual externa B2B de demonstrativo (sem checkout in-app; requer Step-Up Auth)
  Future<Map<String, dynamic>> recordOwnerStatementPayment({
    required String statementId,
    required Map<String, dynamic> payload,
    String? stepUpToken,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;
      final resp = await _dio.post(
        '/owner/billing/statements/$statementId/payments',
        data: payload,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Trilha de auditoria operacional geral (7 domínios, PII mascarada por padrão)
  Future<Map<String, dynamic>> getOwnerOperationalAudit({
    String? companyId,
    String? category,
    String? entityReference,
    bool includeSimulation = false,
    int limit = 100,
  }) async {
    try {
      final query = <String, dynamic>{
        'limit': limit,
        'includeSimulation': includeSimulation.toString(),
      };
      if (companyId != null && companyId.isNotEmpty) query['companyId'] = companyId;
      if (category != null && category.isNotEmpty && category != 'ALL') query['category'] = category;
      if (entityReference != null && entityReference.isNotEmpty) {
        query['entityReference'] = entityReference;
      }
      final resp = await _dio.get('/owner/billing/operational-audit', queryParameters: query);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Fila de revisão administrativa de inconsistências (não-acusatória)
  Future<Map<String, dynamic>> getOwnerReviewAlerts({
    String? companyId,
    String? status,
    bool includeSimulation = false,
    int limit = 100,
  }) async {
    try {
      final query = <String, dynamic>{
        'limit': limit,
        'includeSimulation': includeSimulation.toString(),
      };
      if (companyId != null && companyId.isNotEmpty) query['companyId'] = companyId;
      if (status != null && status.isNotEmpty && status != 'ALL') query['status'] = status;
      final resp = await _dio.get('/owner/billing/review-alerts', queryParameters: query);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Resolver alerta de revisão administrativa (requer Step-Up Auth)
  Future<Map<String, dynamic>> resolveOwnerReviewAlert({
    required String alertId,
    required String status,
    required String reviewNotes,
    String? stepUpToken,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;
      final resp = await _dio.post(
        '/owner/billing/review-alerts/$alertId/resolve',
        data: {
          'status': status,
          'reviewNotes': reviewNotes,
        },
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Painel consolidado de custos verificados da plataforma, rateio e margem real/estimada
  Future<Map<String, dynamic>> getOwnerCostsAndMargin({
    required String competence,
    bool includeSimulation = false,
  }) async {
    try {
      final resp = await _dio.get(
        '/owner/billing/costs-and-margin',
        queryParameters: {
          'competence': competence,
          'includeSimulation': includeSimulation.toString(),
        },
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Lançar custo da plataforma com origem verificável (requer Step-Up Auth)
  Future<Map<String, dynamic>> recordOwnerPlatformCost({
    required Map<String, dynamic> payload,
    String? stepUpToken,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (stepUpToken != null) headers['X-Step-Up-Token'] = stepUpToken;
      final resp = await _dio.post(
        '/owner/billing/costs',
        data: payload,
        options: Options(headers: headers),
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Status das travas de políticas das lojas (Google Play & Apple App Store)
  Future<Map<String, dynamic>> getOwnerStorePoliciesStatus() async {
    try {
      final resp = await _dio.get('/owner/billing/store-policies-status');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  Future<Map<String, dynamic>> getAsaasLiveReadinessReport({String? companyId}) async {
    try {
      final resp = await _dio.get(
        '/owner/integrations/sandbox/readiness-report',
        queryParameters: companyId != null ? {'companyId': companyId} : null,
      );
      return Map<String, dynamic>.from(resp.data['readinessReport'] ?? {});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // =========================================================================
  // ETAPA 4: CENTRAL DE SUPORTE, INDICADORES E CONTINUIDADE (EMPRESA & PROPRIETÁRIO)
  // =========================================================================

  /// Listar chamados da empresa
  Future<List<Map<String, dynamic>>> getSupportTickets({
    String? status,
    String? priority,
    String? category,
    String? search,
  }) async {
    try {
      final q = <String, dynamic>{};
      if (status != null && status != 'ALL') q['status'] = status;
      if (priority != null && priority != 'ALL') q['priority'] = priority;
      if (category != null && category != 'ALL') q['category'] = category;
      if (search != null && search.trim().isNotEmpty) q['search'] = search.trim();
      final resp = await _dio.get('/support/tickets', queryParameters: q);
      final list = (resp.data['tickets'] as List?) ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Obter detalhes do chamado da empresa
  Future<Map<String, dynamic>> getSupportTicketDetails(String ticketId) async {
    try {
      final resp = await _dio.get('/support/tickets/' + ticketId);
      return Map<String, dynamic>.from(resp.data['ticket'] ?? {});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Criar chamado de suporte pela empresa/operador
  Future<Map<String, dynamic>> createSupportTicket(Map<String, dynamic> data) async {
    try {
      final resp = await _dio.post('/support/tickets', data: data);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Adicionar mensagem ao chamado pela empresa
  Future<Map<String, dynamic>> addSupportTicketMessage(
    String ticketId,
    String message,
  ) async {
    try {
      final resp = await _dio.post(
        '/support/tickets/' + ticketId + '/messages',
        data: {'message': message},
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Listar solicitações de suporte pendentes de autorização da empresa
  Future<List<Map<String, dynamic>>> getPendingSupportGrants() async {
    try {
      final resp = await _dio.get('/support/grants/pending');
      final list = (resp.data['grants'] as List?) ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Empresa autoriza formalmente acesso de suporte técnico
  Future<Map<String, dynamic>> approveSupportGrant(String grantId) async {
    try {
      final resp = await _dio.post('/support/grants/' + grantId + '/approve');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Empresa revoga imediatamente acesso de suporte técnico
  Future<Map<String, dynamic>> revokeSupportGrant(
    String grantId, {
    String? reason,
  }) async {
    try {
      final resp = await _dio.post(
        '/support/grants/' + grantId + '/revoke',
        data: {'reason': reason ?? 'Revogado pelo usuário'},
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // ── Proprietário / Técnico Lumora ─────────────────────────────────────────

  /// Proprietário lista chamados de todas as empresas
  Future<List<Map<String, dynamic>>> getOwnerSupportTickets({
    String? companyId,
    String? status,
    String? priority,
    String? search,
  }) async {
    try {
      final q = <String, dynamic>{};
      if (companyId != null && companyId != 'ALL') q['companyId'] = companyId;
      if (status != null && status != 'ALL') q['status'] = status;
      if (priority != null && priority != 'ALL') q['priority'] = priority;
      if (search != null && search.trim().isNotEmpty) q['search'] = search.trim();
      final resp = await _dio.get('/owner/support/tickets', queryParameters: q);
      final list = (resp.data['tickets'] as List?) ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Detalhes do chamado para a equipe do proprietário (com notas internas)
  Future<Map<String, dynamic>> getOwnerSupportTicketDetails(String ticketId) async {
    try {
      final resp = await _dio.get('/owner/support/tickets/' + ticketId);
      return Map<String, dynamic>.from(resp.data['ticket'] ?? {});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Adicionar mensagem ou nota técnica interna ao chamado
  Future<Map<String, dynamic>> addOwnerSupportTicketMessage(
    String ticketId,
    String message, {
    bool isInternalNote = false,
  }) async {
    try {
      final resp = await _dio.post(
        '/owner/support/tickets/' + ticketId + '/messages',
        data: {
          'message': message,
          'isInternalNote': isInternalNote,
        },
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Atualizar status do chamado e atribuir técnico responsável
  Future<Map<String, dynamic>> updateOwnerSupportTicketStatus(
    String ticketId, {
    required String status,
    String? assignedToUserId,
    String? assignedToName,
  }) async {
    try {
      final resp = await _dio.post(
        '/owner/support/tickets/' + ticketId + '/status',
        data: {
          'status': status,
          'assignedToUserId': assignedToUserId,
          'assignedToName': assignedToName,
        },
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Técnico solicita concessão de acesso de suporte a uma empresa
  Future<Map<String, dynamic>> requestOwnerSupportGrant({
    required String companyId,
    String? ticketId,
    required String scope,
    required String reason,
    int durationMinutes = 60,
  }) async {
    try {
      final resp = await _dio.post(
        '/owner/support/grants/request',
        data: {
          'companyId': companyId,
          'ticketId': ticketId,
          'scope': scope,
          'reason': reason,
          'durationMinutes': durationMinutes,
        },
      );
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Listar concessões de acesso de suporte
  Future<List<Map<String, dynamic>>> getOwnerSupportGrants({
    String? companyId,
    String? status,
  }) async {
    try {
      final q = <String, dynamic>{};
      if (companyId != null && companyId != 'ALL') q['companyId'] = companyId;
      if (status != null && status != 'ALL') q['status'] = status;
      final resp = await _dio.get('/owner/support/grants', queryParameters: q);
      final list = (resp.data['grants'] as List?) ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Técnico reivindica token de sessão de suporte autorizada pela empresa
  Future<Map<String, dynamic>> claimOwnerSupportSessionToken(String grantId) async {
    try {
      final resp = await _dio.post('/owner/support/grants/' + grantId + '/claim-session');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Métricas operacionais agregadas (fichas, vendas, contratos, falhas Asaas)
  Future<Map<String, dynamic>> getOwnerOperationalMetrics({String? companyId}) async {
    try {
      final q = <String, dynamic>{};
      if (companyId != null && companyId != 'ALL') q['companyId'] = companyId;
      final resp = await _dio.get('/owner/support/operational-metrics', queryParameters: q);
      return Map<String, dynamic>.from(resp.data['metrics'] ?? {});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Status de continuidade de negócio e recuperação de desastres (DR)
  Future<Map<String, dynamic>> getOwnerContinuityStatus() async {
    try {
      final resp = await _dio.get('/owner/support/continuity/status');
      return Map<String, dynamic>.from(resp.data['continuity'] ?? {});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Listar alertas internos operacionais
  Future<List<Map<String, dynamic>>> getOwnerInternalAlerts({
    String? companyId,
    bool acknowledged = false,
  }) async {
    try {
      final q = <String, dynamic>{
        'acknowledged': acknowledged.toString(),
      };
      if (companyId != null && companyId != 'ALL') q['companyId'] = companyId;
      final resp = await _dio.get('/owner/support/internal-alerts', queryParameters: q);
      final list = (resp.data['alerts'] as List?) ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Reconhecer alerta interno operacional
  Future<Map<String, dynamic>> acknowledgeOwnerInternalAlert(String alertId) async {
    try {
      final resp = await _dio.post('/owner/support/internal-alerts/' + alertId + '/ack');
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  /// Enviar telemetria operacional mínima do aparelho para o servidor
  Future<Map<String, dynamic>> reportDeviceTelemetry(Map<String, dynamic> payload) async {
    try {
      final resp = await _dio.post('/app/telemetry', data: payload);
      return Map<String, dynamic>.from(resp.data);
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }
}
