import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:flutter/foundation.dart';

class ApiService {
  late Dio _dio;
  final String baseUrl = 'https://selectphoto-k1ac.onrender.com/api';

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'User-Agent': 'loca.lt'
      },
      connectTimeout: const Duration(seconds: 40),
      receiveTimeout: const Duration(seconds: 40),
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final prefs = await SharedPreferences.getInstance();
        final token = prefs.getString('jwt_token');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
    ));
  }

  String _extractError(DioException e) {
    if (e.response?.data is Map) {
      return e.response?.data['error'] ?? 'Erro desconhecido na API';
    }
    return e.message ?? 'Erro de conexão';
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    try {
      final response = await _dio.post('/auth/login', data: {
        'email': email,
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

  // Sync Offline Clients
  Future<void> syncClients(List<Map<String, dynamic>> clientsData) async {
    try {
      await _dio.post('/clients/sync', data: {'clients': clientsData});
    } on DioException catch (e) {
      throw Exception(_extractError(e));
    }
  }

  // Sales
  Future<void> registerSale(Map<String, dynamic> saleData) async {
    try {
      await _dio.post('/sales', data: saleData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao registrar venda');
    }
  }

  // Non-Sales
  Future<void> registerNonSale(Map<String, dynamic> nonSaleData) async {
    try {
      await _dio.post('/non-sales', data: nonSaleData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao registrar não-venda');
    }
  }

  // Appointments
  Future<void> registerAppointment(Map<String, dynamic> appointmentData) async {
    try {
      await _dio.post('/sales/appointments', data: appointmentData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao registrar agendamento');
    }
  }

  // Photos
  Future<void> uploadPhoto(Map<String, dynamic> photoData) async {
    try {
      await _dio.post('/sales/photos', data: photoData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao fazer upload da foto');
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
      final response = await _dio.post('/events/search', data: {'city': city});
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
      print(e.response?.data);
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar eventos na IA: ${e.message}');
    }
  }

  Future<Map<String, dynamic>> fetchStateRadar(String state) async {
    try {
      final response = await _dio.get('/events/state-radar?state=$state');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar radar por estado: ${e.message}');
    }
  }

  Future<void> saveProspect(Map<String, dynamic> eventData) async {
    try {
      await _dio.post('/events', data: eventData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao salvar prospect');
    }
  }

  Future<List<dynamic>> getProspects() async {
    try {
      final response = await _dio.get('/events');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar prospects');
    }
  }



  Future<List<dynamic>> getUpcomingEvents() async {
    try {
      final response = await _dio.get('/events/upcoming');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar eventos próximos');
    }
  }

  Future<void> toggleFavorite(String eventId, bool isFavorite) async {
    try {
      await _dio.put('/events/$eventId/favorite', data: {'isFavorite': isFavorite});
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao favoritar evento');
    }
  }

  Future<void> transformToProspect(String eventId) async {
    try {
      await _dio.put('/events/$eventId/prospect');
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao transformar em prospect');
    }
  }

  Future<void> updateProspect(String eventId, Map<String, dynamic> data) async {
    try {
      await _dio.put('/events/$eventId', data: data);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao atualizar prospect');
    }
  }

  Future<void> deleteProspect(String eventId) async {
    try {
      await _dio.delete('/events/$eventId');
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao excluir prospect');
    }
  }

  Future<void> savePlannedCost(Map<String, dynamic> costData) async {
    try {
      // Re-use costs endpoint but passing status='PLANNED' and eventId
      costData['status'] = 'PLANNED';
      await _dio.post('/costs', data: costData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao salvar custo planejado');
    }
  }

  // ── Finanças e Custos ───────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getFinanceOverview() async {
    try {
      final response = await _dio.get('/finance/overview');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar fluxo de caixa');
    }
  }

  Future<List<dynamic>> getPendingCosts() async {
    try {
      final response = await _dio.get('/finance/pending-costs');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar custos pendentes');
    }
  }

  Future<void> updateCostStatus(String costId, String status) async {
    try {
      await _dio.put('/finance/costs/$costId/status', data: {'status': status});
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao atualizar status do custo');
    }
  }

  Future<Map<String, dynamic>> getHealthDashboard() async {
    try {
      final response = await _dio.get('/finance/health');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar indicadores de saúde');
    }
  }

  Future<void> submitCost(Map<String, dynamic> costData) async {
    try {
      await _dio.post('/costs', data: costData);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao registrar custo');
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
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar funcionários');
    }
  }

  Future<void> createUser(FormData data) async {
    try {
      await _dio.post('/users', data: data);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao criar funcionário');
    }
  }

  Future<void> updateUser(String id, FormData data) async {
    try {
      await _dio.put('/users/$id', data: data);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao atualizar funcionário');
    }
  }

  Future<void> deleteUser(String id) async {
    try {
      await _dio.delete('/users/$id');
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao excluir funcionário');
    }
  }

  // ── Equipes (Teams) ───────────────────────────────────────────────────────

  Future<List<dynamic>> getTeams() async {
    try {
      final response = await _dio.get('/teams');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar equipes');
    }
  }

  Future<void> createTeam(Map<String, dynamic> data) async {
    try {
      await _dio.post('/teams', data: data);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao criar equipe');
    }
  }

  Future<void> updateTeam(String id, Map<String, dynamic> data) async {
    try {
      await _dio.put('/teams/$id', data: data);
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao atualizar equipe');
    }
  }

  Future<void> deleteTeam(String id) async {
    try {
      await _dio.delete('/teams/$id');
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao excluir equipe');
    }
  }

  // ── Frota (Cars) ──────────────────────────────────────────────────────────

  Future<List<dynamic>> getCars() async {
    try {
      final response = await _dio.get('/fleet');
      return response.data as List<dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar frota');
    }
  }
}
