import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';

class ApiService {
  late Dio _dio;
  String _baseUrl = AppConfig.hasServerUrl ? AppConfig.serverUrl : '';
  String? _token;

  // Singleton pattern for easy global access (optional, but good for backward compatibility)
  static final ApiService _instance = ApiService._internal();
  factory ApiService({String? customBaseUrl}) {
    if (customBaseUrl != null) {
      _instance.updateBaseUrl(customBaseUrl);
    }
    return _instance;
  }
  
  ApiService._internal() {
    _initDio();
  }

  Dio get dio => _dio;
  String get baseUrl => _baseUrl;

  /// Resolve URL de mídia (comprovantes, fotos de perfil, assinaturas) dinamicamente a partir do servidor configurado
  static String resolveMediaUrl(String? url) {
    if (url == null || url.trim().isEmpty) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
      return url;
    }
    String serverBase = ApiService().baseUrl;
    if (serverBase.endsWith('/api')) {
      serverBase = serverBase.substring(0, serverBase.length - 4);
    }
    if (serverBase.endsWith('/')) {
      serverBase = serverBase.substring(0, serverBase.length - 1);
    }
    final cleanPath = url.startsWith('/') ? url : '/$url';
    return '$serverBase$cleanPath';
  }

  void _initDio() {
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'User-Agent': 'loca.lt'
      },
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 90),
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Trava estrita: se a baseUrl estiver vazia ou for indefinida, impede a chamada imediatamente
        if (options.baseUrl.trim().isEmpty && options.path.startsWith('http') != true) {
          return handler.reject(
            DioException(
              requestOptions: options,
              error: StateError(
                '🛑 ERRO CRÍTICO: SERVER_URL não foi definida. '
                'Builds debug/staging não possuem fallback para produção. '
                'Forneça --dart-define=SERVER_URL=http://127.0.0.1:3001/api no build.',
              ),
              type: DioExceptionType.cancel,
            ),
          );
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
          // Token expired or invalid: clear local cached token
          _token = null;
          try {
            final prefs = await SharedPreferences.getInstance();
            await prefs.remove('jwt_token');
          } catch (_) {}
        }
        return handler.next(error);
      },
    ));
  }



  void updateBaseUrl(String newUrl) {
    _baseUrl = newUrl;
    _dio.options.baseUrl = newUrl;
  }

  void setToken(String token) {
    _token = token;
  }

  void clearToken() {
    _token = null;
  }

  // Auth endpoints
  String _extractError(DioException e) {
    if (e.response?.data is Map) {
      return (e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro desconhecido na API';
    }
    return e.message ?? 'Erro de conexão';
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
  Future<Map<String, dynamic>> getClientBySequence(String sequenceNumber) async {
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
      await _dio.post('/clients/assign-seller', data: {
        'sequenceNumber': sequenceNumber,
        'sellerId': sellerId
      });
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
  Future<void> requestStockTransfer(String recipientId, String type, int quantity) async {
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
  Future<void> syncClients(List<Map<String, dynamic>> clientsData) async {
    try {
      await _dio.post('/clients/sync', data: {'clients': clientsData});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
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

  // Confirm arrival from gráfica — moves AWAITING_RELEASE → IN_STOCK for a city
  Future<Map<String, dynamic>> confirmGrafica(String city) async {
    try {
      final response = await _dio.put('/clients/confirm-grafica', data: {'city': city});
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Get clients by city and optional bookStatus
  Future<List<dynamic>> getClientsByCity(String city, {String? bookStatus}) async {
    try {
      final Map<String, dynamic> params = {'city': city};
      if (bookStatus != null) params['bookStatus'] = bookStatus;
      final response = await _dio.get('/clients/by-city', queryParameters: params);
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Batch assign a list of client IDs to a seller
  Future<Map<String, dynamic>> batchAssignSeller(List<String> clientIds, String assignedSellerId) async {
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
  Future<String> registerSale(Map<String, dynamic> saleData) async {
    try {
      final response = await _dio.post('/sales', data: saleData);
      return response.data['id'];
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao registrar venda');
    }
  }

  // Sales & Costs (Finance)
  Future<void> editCost(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/finance/costs/$id', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao editar custo');
    }
  }

  Future<void> editSale(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/finance/sales/$id', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao editar venda');
    }
  }

  Future<void> uploadSaleReceipt(String saleId, String filePath) async {
    try {
      final formData = FormData.fromMap({
        'receipt': await MultipartFile.fromFile(filePath),
      });
      await _dio.post('/sales/$saleId/receipt', data: formData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao fazer upload do comprovante');
    }
  }

  // Non-Sales
  Future<void> registerNonSale(Map<String, dynamic> nonSaleData) async {
    try {
      await _dio.post('/sales/non-sale', data: nonSaleData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao registrar não-venda');
    }
  }

  // Appointments
  Future<void> registerAppointment(Map<String, dynamic> appointmentData) async {
    try {
      await _dio.post('/sales/appointments', data: appointmentData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao registrar agendamento');
    }
  }

  // Photos
  Future<void> uploadPhoto(Map<String, dynamic> photoData) async {
    try {
      await _dio.post('/sales/photos', data: photoData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao fazer upload da book');
    }
  }

  // ── Livros e Lotes (Book Batches) ───────────────────────────────────────

  Future<void> createBookBatch(String eventName) async {
    try {
      await _dio.post('/books/close-event', data: {'eventName': eventName});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao fechar lote de evento');
    }
  }

  // Force send a single client to admin (Photographer)
  Future<void> forceSendClient(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-send');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao enviar ficha');
    }
  }

  // Force release a single client to stock (Admin)
  Future<void> forceReleaseClient(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-release');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao liberar ficha');
    }
  }

  // Resgate Admin (Vendedor -> Estoque)
  Future<void> forceReturnToStock(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return-to-stock');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao resgatar ficha');
    }
  }

  // Resgate Vendedor (Vendedor -> AWAITING_RETURN)
  Future<void> forceReturn(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao forçar devolução');
    }
  }

  // Resgate Admin Rebolo (Rebolo -> Estoque Rebolo)
  Future<void> forceReturnReboloStock(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return-rebolo-stock');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao resgatar ficha de rebolo');
    }
  }

  // Resgate Rebolo (Rebolo -> AWAITING_RETURN)
  Future<void> forceReturnRebolo(String clientId) async {
    try {
      await _dio.put('/books/client/$clientId/force-return-rebolo');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao forçar devolução de rebolo');
    }
  }

  Future<void> updateBookBatchStatus(String id, String status) async {
    try {
      await _dio.put('/books/batch/$id', data: {'status': status});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar status do lote');
    }
  }

  Future<Map<String, dynamic>> getCoverStockInfo() async {
    try {
      final response = await _dio.get('/stock/info');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar informacoes de capas');
    }
  }

  Future<void> transferCovers(String sellerId, int quantity) async {
    try {
      await _dio.post('/stock/transfer', data: {'sellerId': sellerId, 'quantity': quantity});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao transferir capas');
    }
  }

  Future<void> addAdminCoverStock(int quantity) async {
    try {
      await _dio.post('/stock/batch', data: {'quantity': quantity});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar estoque geral');
    }
  }

  Future<void> transferBetweenSellers(String recipientId, int quantity) async {
    try {
      await _dio.post('/stock/transfer-between-sellers', data: {'recipientId': recipientId, 'quantity': quantity});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao solicitar transferência');
    }
  }

  Future<void> returnDefectiveCovers(String sellerId, int quantity) async {
    try {
      await _dio.post('/stock/defective', data: {'sellerId': sellerId, 'quantity': quantity});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao devolver capas defeituosas');
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar lotes de books');
    }
  }

  // ── Gestão de Frota (Fleet) ───────────────────────────────────────────

  Future<void> createCar(FormData data) async {
    try {
      await _dio.post('/fleet', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao cadastrar veículo');
    }
  }

  Future<void> updateCar(String id, dynamic data) async {
    try {
      await _dio.put('/fleet/$id', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar veículo');
    }
  }

  Future<void> deleteCar(String id) async {
    try {
      await _dio.delete('/fleet/$id');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao excluir veículo');
    }
  }

  Future<void> submitChecklist(dynamic data) async {
    try {
      await _dio.post('/fleet/checklist', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao enviar checklist');
    }
  }

  // Cache das últimas 4 buscas
  final List<Map<String, dynamic>> _searchCache = [];

  List<Map<String, dynamic>> get cachedSearches => _searchCache;

  // AI Events
  Future<Map<String, dynamic>> searchEvents(String city, {bool forceRefresh = false}) async {
    final lowerCity = city.toLowerCase();

    if (!forceRefresh) {
      final cachedIndex = _searchCache.indexWhere((c) => c['cityQuery'] == lowerCity);
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
      final Map<String, dynamic> responseData = response.data as Map<String, dynamic>;

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
      final errorMsg = (e.response?.data is Map) ? e.response?.data['error'] : null;
      throw Exception(errorMsg ?? 'Erro ao buscar eventos na IA (tempo limite excedido). Tente novamente.');
    }
  }

  Future<Map<String, dynamic>> fetchStateRadar(String state, {bool force = false}) async {
    try {
      final response = await _dio.get(
        '/events/state-radar?state=$state&force=$force',
        options: Options(receiveTimeout: const Duration(seconds: 120)),
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      final errorMsg = (e.response?.data is Map) ? e.response?.data['error'] : null;
      throw Exception(errorMsg ?? 'Erro ao buscar radar por estado. O servidor demorou para responder. Tente novamente.');
    }
  }

  // Roteiro Inteligente — clusters de prospectos dentro de 300km
  Future<Map<String, dynamic>> getSmartRoute() async {
    try {
      final response = await _dio.get('/events/smart-route');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      final errorMsg = (e.response?.data is Map) ? e.response?.data['error'] : null;
      throw Exception(errorMsg ?? 'Erro ao buscar roteiro inteligente.');
    }
  }

  Future<void> saveSellerClosing(Map<String, dynamic> closingData) async {
    try {
      await _dio.post('/closing/daily', data: closingData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao salvar fechamento');
    }
  }

  Future<void> payRepasse(String sellerId, double amount, {double? commissionToLog}) async {
    try {
      await _dio.post('/closing/pay-repasse', data: {
        'sellerId': sellerId,
        'amount': amount,
        'commissionToLog': commissionToLog
      });
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao pagar repasse');
    }
  }

  Future<void> saveProspect(Map<String, dynamic> eventData) async {
    try {
      await _dio.post('/events', data: eventData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao salvar prospect');
    }
  }

  Future<List<dynamic>> getProspects() async {
    try {
      final response = await _dio.get('/events');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar prospects');
    }
  }



  Future<List<dynamic>> getUpcomingEvents() async {
    try {
      final response = await _dio.get('/events/upcoming');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar eventos próximos');
    }
  }

  Future<void> toggleFavorite(String eventId, bool isFavorite) async {
    try {
      await _dio.put('/events/$eventId/favorite', data: {'isFavorite': isFavorite});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao favoritar evento');
    }
  }

  Future<void> transformToProspect(String eventId) async {
    try {
      await _dio.put('/events/$eventId/prospect');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao transformar em prospect');
    }
  }

  Future<void> updateProspect(String eventId, Map<String, dynamic> data) async {
    try {
      await _dio.put('/events/$eventId', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar prospect');
    }
  }

  Future<void> deleteProspect(String eventId) async {
    try {
      await _dio.delete('/events/$eventId');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao excluir prospect');
    }
  }

  Future<void> savePlannedCost(Map<String, dynamic> costData) async {
    try {
      // Re-use costs endpoint but passing status='PLANNED' and eventId
      costData['status'] = 'PLANNED';
      await _dio.post('/costs', data: costData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao salvar custo planejado');
    }
  }

  // ── Finanças e Custos ───────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getFinanceOverview() async {
    try {
      final response = await _dio.get('/finance/overview');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar fluxo de caixa');
    }
  }

  Future<Map<String, dynamic>> getClosingData(String city, {List<String>? sellerIds, String? date}) async {
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar fechamento');
    }
  }

  Future<Map<String, dynamic>> getCustomMetrics({List<String>? sellerIds, String? startDate, String? endDate, String? city}) async {
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar fechamento');
    }
  }

  Future<Map<String, dynamic>> getPhotographerClosing(String photographerId) async {
    try {
      final response = await _dio.get('/closing/photographer/$photographerId');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar fechamento');
    }
  }

  Future<List<dynamic>> getPendingCosts() async {
    try {
      final response = await _dio.get('/finance/pending-costs');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar custos pendentes');
    }
  }

  Future<void> updateCostStatus(String costId, String status) async {
    try {
      await _dio.put('/finance/costs/$costId/status', data: {'status': status});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar status do custo');
    }
  }


  Future<Map<String, dynamic>> getHealthDashboard() async {
    try {
      final response = await _dio.get('/finance/health');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar indicadores de saúde');
    }
  }

  Future<void> submitCost(Map<String, dynamic> costData) async {
    try {
      await _dio.post('/costs', data: costData);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao registrar custo');
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar funcionários');
    }
  }

  Future<void> createUser(FormData data) async {
    try {
      await _dio.post('/users', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao criar funcionário');
    }
  }

  Future<void> updateUser(String id, FormData data) async {
    try {
      await _dio.put('/users/$id', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar funcionário');
    }
  }

  Future<void> deleteUser(String id) async {
    try {
      await _dio.delete('/users/$id');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao excluir funcionário');
    }
  }

  // ── Equipes (Teams) ───────────────────────────────────────────────────────

  Future<List<dynamic>> getTeams() async {
    try {
      final response = await _dio.get('/teams');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar equipes');
    }
  }

  Future<Map<String, dynamic>> createTeam(Map<String, dynamic> data) async {
    try {
      final res = await _dio.post('/teams', data: data);
      return res.data;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao criar equipe');
    }
  }

  Future<void> updateTeam(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/teams/$id', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao atualizar equipe');
    }
  }

  Future<void> deleteTeam(String id) async {
    try {
      await _dio.delete('/teams/$id');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao excluir equipe');
    }
  }

  // ── Frota (Cars) ──────────────────────────────────────────────────────────

  Future<List<dynamic>> getCars() async {
    try {
      final response = await _dio.get('/fleet');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar frota');
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao fazer upload do arquivo');
    }
  }




  // ── Notificações (Notifications) ──────────────────────────────────────────

  Future<List<dynamic>> getNotifications() async {
    try {
      final response = await _dio.get('/notifications');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar notificações');
    }
  }

  Future<void> actionNotification(String id, String actionType, {Map<String, dynamic>? extraData}) async {
    try {
      final data = <String, dynamic>{'actionType': actionType};
      if (extraData != null) {
        data.addAll(extraData);
      }
      await _dio.post('/notifications/$id/action', data: data);
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao processar notificação');
    }
  }

  Future<void> markNotificationRead(String id) async {
    try {
      await _dio.patch('/notifications/$id/read');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao marcar notificação como lida');
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao criar notificação');
    }
  }

  Future<void> releaseCity(String city) async {
    try {
      await _dio.put('/clients/release-city', data: {'city': city});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao liberar lotes da cidade');
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
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao criar solicitação de edição');
    }
  }

  Future<List<dynamic>> getClientsByPhotographer() async {
    try {
      final response = await _dio.get('/clients/photographer');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar fichas');
    }
  }

  Future<List<dynamic>> getClientsBySeller() async {
    try {
      final response = await _dio.get('/clients/seller');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar fichas do vendedor');
    }
  }

  Future<List<dynamic>> getPersonalAppointments(String sellerId) async {
    try {
      final response = await _dio.get('/appointments/seller/$sellerId');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar agendamentos pessoais');
    }
  }

  Future<List<dynamic>> getPendingEditRequests() async {
    try {
      final response = await _dio.get('/edit-requests/pending');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar solicitações');
    }
  }

  Future<void> approveEditRequest(String id) async {
    try {
      await _dio.post('/edit-requests/$id/approve');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao aprovar solicitação');
    }
  }

  Future<void> rejectEditRequest(String id) async {
    try {
      await _dio.post('/edit-requests/$id/reject');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao rejeitar solicitação');
    }
  }

  Future<List<dynamic>> searchBooks(String query) async {
    try {
      final response = await _dio.get('/books/search', queryParameters: {'q': query});
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao buscar livros');
    }
  }

  Future<void> releaseBatchToStock(String id) async {
    try {
      await _dio.put('/books/batch/$id/release');
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao liberar lote para estoque');
    }
  }

  Future<void> receiveReturnedBook(String sequenceNumber) async {
    try {
      await _dio.post('/books/receive-return', data: {'sequenceNumber': sequenceNumber});
    } on DioException catch (e) {
      throw Exception((e.response?.data is Map ? e.response?.data['error'] : null) ?? 'Erro ao receber devolução');
    }
  }
  Future<String> downloadBackup() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('jwt_token');
      
      final res = await _dio.get('/backup/download', options: Options(
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
        throw Exception('CONFLICT: ${(e.response?.data is Map ? e.response?.data['error'] : null)}');
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
  Future<dynamic> getStatsBooks({String? from, String? to, String? city, String? event, String? batchId}) async {
    final queryParams = <String, String>{};
    if (from != null) queryParams['from'] = from;
    if (to != null) queryParams['to'] = to;
    if (city != null) queryParams['city'] = city;
    if (event != null) queryParams['event'] = event;
    if (batchId != null) queryParams['batchId'] = batchId;
    final resp = await _dio.get('/stats/books', queryParameters: queryParams.isEmpty ? null : queryParams);
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

  Future<void> approveEventRoi(String eventId, {required double totalCost, double? expectedRevenue}) async {
    await _dio.patch('/events/$eventId/approve-roi', data: {
      'totalCost': totalCost,
      if (expectedRevenue != null) 'expectedRevenue': expectedRevenue,
    });
  }

  Future<void> batchAssignClients(List<String> clientIds, String sellerId) async {
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
        return role == 'VENDEDOR' || role == 'SELLER' || role == 'ADMIN' || role == 'SUPER_ADMIN';
      }).toList();
    } catch (_) {
      return [];
    }
  }
}
