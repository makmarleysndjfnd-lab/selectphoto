import 'package:flutter/material.dart';
import 'tela_login.dart';
import 'painel_admin.dart';
import 'painel_vendedor.dart';
import 'painel_fotografo.dart';

class HomeScreen extends StatefulWidget {
  final String role;
  const HomeScreen({super.key, required this.role});

  @override
  // ignore: library_private_types_in_public_api
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _fadeAnim;
  int _selectedIndex = 0;

  bool get isSeller => widget.role == 'SELLER';

  @override
  void initState() {
    super.initState();
    // Redirect ADMIN and SELLER to their dedicated screens
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.role == 'ADMIN') {
        Navigator.of(context).pushReplacement(
          PageRouteBuilder(
            pageBuilder: (_, __, ___) => const AdminDashboard(),
            transitionsBuilder: (_, anim, __, child) =>
                FadeTransition(opacity: anim, child: child),
            transitionDuration: const Duration(milliseconds: 400),
          ),
        );
      } else if (widget.role == 'SELLER') {
        Navigator.of(context).pushReplacement(
          PageRouteBuilder(
            pageBuilder: (_, __, ___) => const SellerDashboard(),
            transitionsBuilder: (_, anim, __, child) =>
                FadeTransition(opacity: anim, child: child),
            transitionDuration: const Duration(milliseconds: 400),
          ),
        );
      } else if (widget.role == 'PHOTOGRAPHER') {
        Navigator.of(context).pushReplacement(
          PageRouteBuilder(
            pageBuilder: (_, __, ___) => const PhotographerDashboard(),
            transitionsBuilder: (_, anim, __, child) =>
                FadeTransition(opacity: anim, child: child),
            transitionDuration: const Duration(milliseconds: 400),
          ),
        );
      }
    });
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 700));
    _fadeAnim =
        CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  void _logout() {
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        pageBuilder: (_, __, ___) => const LoginScreen(),
        transitionsBuilder: (_, anim, __, child) =>
            FadeTransition(opacity: anim, child: child),
        transitionDuration: const Duration(milliseconds: 400),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      body: FadeTransition(
        opacity: _fadeAnim,
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: _selectedIndex == 0 ? _buildDashboard() : _buildProfile(),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  // ── Header ────────────────────────────────────────────────────────────────
  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0D1B2A), Color(0xFF0D3B6E)],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                      colors: [Color(0xFF4FC3F7), Color(0xFF0288D1)]),
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: [
                    BoxShadow(
                        color: const Color(0xFF0288D1).withOpacity(0.4),
                        blurRadius: 12,
                        offset: const Offset(0, 4)),
                  ],
                ),
                child: const Icon(Icons.camera_alt_rounded,
                    color: Colors.white, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Central Fotográfica',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.bold)),
                    Text(
                      isSeller ? 'Vendedor' : 'Fotógrafo',
                      style: const TextStyle(
                          color: Color(0xFF90CAF9), fontSize: 12),
                    ),
                  ],
                ),
              ),
              // Avatar
              GestureDetector(
                onTap: _logout,
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFF4FC3F7), width: 2),
                  ),
                  child: CircleAvatar(
                    radius: 18,
                    backgroundColor: const Color(0xFF1B2A4A),
                    child: Icon(
                      isSeller ? Icons.sell_rounded : Icons.camera_rounded,
                      color: const Color(0xFF4FC3F7),
                      size: 18,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  Widget _buildDashboard() {
    if (widget.role == 'SUPER_ADMIN') {
      return _buildSuperAdminDashboard();
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Saudação
          Text(
            isSeller ? 'Olá, Vendedor! 👋' : 'Olá, Fotógrafo! 👋',
            style: const TextStyle(
                color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            isSeller
                ? 'Escaneie fichas e registre vendas.'
                : 'Gerencie seus clientes e books.',
            style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 14),
          ),
          const SizedBox(height: 24),

          // Stats cards
          Row(
            children: [
              Expanded(
                child: _statCard(
                  icon: Icons.people_alt_rounded,
                  value: isSeller ? '24' : '138',
                  label: isSeller ? 'Clientes hoje' : 'Clientes',
                  color: const Color(0xFF4FC3F7),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _statCard(
                  icon: isSeller
                      ? Icons.attach_money_rounded
                      : Icons.photo_library_rounded,
                  value: isSeller ? 'R\$ 4.280' : '312',
                  label: isSeller ? 'Vendas hoje' : 'books tiradas',
                  color: const Color(0xFF66BB6A),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _statCard(
                  icon: Icons.cancel_rounded,
                  value: isSeller ? '3' : '8',
                  label: isSeller ? 'Não vendas' : 'Remarcações',
                  color: const Color(0xFFEF5350),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _statCard(
                  icon: Icons.calendar_month_rounded,
                  value: isSeller ? '5' : '2',
                  label: isSeller ? 'Agendamentos' : 'Pendentes',
                  color: const Color(0xFFAB47BC),
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),

          // Ação principal
          _buildPrimaryAction(),
          const SizedBox(height: 24),

          // Atividade recente
          const Text('Atividade Recente',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          ..._recentActivity(),
        ],
      ),
    );
  }

  Widget _statCard({
    required IconData icon,
    required String value,
    required String label,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2535),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withOpacity(0.2), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(height: 14),
          Text(value,
              style: TextStyle(
                  color: color,
                  fontSize: 20,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildPrimaryAction() {
    if (isSeller) {
      return _actionButton(
        icon: Icons.qr_code_scanner_rounded,
        title: 'Escanear Ficha QR',
        subtitle: 'Abra a câmera para ler a ficha do cliente',
        gradientColors: const [Color(0xFF0288D1), Color(0xFF4FC3F7)],
        onTap: () => _showComingSoon('Scanner QR'),
      );
    } else {
      return _actionButton(
        icon: Icons.camera_alt_rounded,
        title: 'Registrar Sessão',
        subtitle: 'Adicionar novo cliente ou sessão fotográfica',
        gradientColors: const [Color(0xFF6A1B9A), Color(0xFFAB47BC)],
        onTap: () => _showComingSoon('Registrar Sessão'),
      );
    }
  }

  Widget _actionButton({
    required IconData icon,
    required String title,
    required String subtitle,
    required List<Color> gradientColors,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: gradientColors),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: gradientColors.last.withOpacity(0.35),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: Colors.white, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  Text(subtitle,
                      style: TextStyle(
                          color: Colors.white.withOpacity(0.8),
                          fontSize: 12)),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios_rounded,
                color: Colors.white, size: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildSuperAdminDashboard() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Olá, Super Admin! 👑',
            style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          const Text(
            'Escolha qual ambiente você deseja testar.',
            style: TextStyle(color: Color(0xFF90CAF9), fontSize: 14),
          ),
          const SizedBox(height: 24),
          _actionButton(
            icon: Icons.admin_panel_settings_rounded,
            title: 'Painel Admin',
            subtitle: 'Acesso total a relatórios, configurações e caixa.',
            gradientColors: const [Color(0xFF00796B), Color(0xFF26A69A)],
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AdminDashboard())),
          ),
          const SizedBox(height: 16),
          _actionButton(
            icon: Icons.sell_rounded,
            title: 'Painel Vendedor',
            subtitle: 'Escanear fichas e realizar vendas.',
            gradientColors: const [Color(0xFF0288D1), Color(0xFF4FC3F7)],
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SellerDashboard())),
          ),
          const SizedBox(height: 16),
          _actionButton(
            icon: Icons.camera_alt_rounded,
            title: 'Painel Fotógrafo',
            subtitle: 'Registrar sessões e novas crianças.',
            gradientColors: const [Color(0xFF6A1B9A), Color(0xFFAB47BC)],
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PhotographerDashboard())),
          ),
        ],
      ),
    );
  }

  List<Widget> _recentActivity() {
    final items = isSeller
        ? [
            const _ActivityItem(
                icon: Icons.attach_money_rounded,
                color: Color(0xFF66BB6A),
                title: 'Venda registrada \u2013 Maria Silva',
                subtitle: 'R\$ 380,00 \u00b7 h\u00e1 12 min'),
            const _ActivityItem(
                icon: Icons.cancel_rounded,
                color: Color(0xFFEF5350),
                title: 'N\u00e3o-venda \u2013 Jo\u00e3o Costa',
                subtitle: 'Sem interesse \u00b7 h\u00e1 35 min'),
            const _ActivityItem(
                icon: Icons.calendar_month_rounded,
                color: Color(0xFFAB47BC),
                title: 'Agendamento \u2013 Ana Ferreira',
                subtitle: '15/06 \u00e0s 14h \u00b7 h\u00e1 1h'),
          ]
        : [
            const _ActivityItem(
                icon: Icons.camera_rounded,
                color: Color(0xFF4FC3F7),
                title: 'Sess\u00e3o conclu\u00edda \u2013 Carlos Mendes',
                subtitle: '24 books \u00b7 h\u00e1 20 min'),
            const _ActivityItem(
                icon: Icons.camera_rounded,
                color: Color(0xFF4FC3F7),
                title: 'Sess\u00e3o conclu\u00edda \u2013 Fam\u00edlia Rocha',
                subtitle: '31 books \u00b7 h\u00e1 1h'),
            const _ActivityItem(
                icon: Icons.pending_rounded,
                color: Color(0xFFFFA726),
                title: 'Aguardando confirma\u00e7\u00e3o \u2013 Lucia B.',
                subtitle: 'Remarcado para 16/06'),
          ];

    return items
        .map((item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _buildActivityCard(item),
            ))
        .toList();
  }

  Widget _buildActivityCard(_ActivityItem item) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2535),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: item.color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(item.icon, color: item.color, size: 18),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.title,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(item.subtitle,
                    style: const TextStyle(
                        color: Color(0xFF90CAF9), fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Perfil ────────────────────────────────────────────────────────────────
  Widget _buildProfile() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(4),
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                  colors: [Color(0xFF4FC3F7), Color(0xFF0288D1)]),
            ),
            child: CircleAvatar(
              radius: 44,
              backgroundColor: const Color(0xFF1B2A4A),
              child: Icon(
                isSeller ? Icons.sell_rounded : Icons.camera_rounded,
                color: const Color(0xFF4FC3F7),
                size: 40,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            isSeller ? 'Vendedor Teste' : 'Fotógrafo Teste',
            style: const TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            isSeller ? 'vendedor@teste.com' : 'fotografo@teste.com',
            style:
                const TextStyle(color: Color(0xFF90CAF9), fontSize: 14),
          ),
          const SizedBox(height: 8),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF0288D1).withOpacity(0.2),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFF4FC3F7).withOpacity(0.4)),
            ),
            child: Text(
              isSeller ? 'VENDEDOR' : 'FOTÓGRAFO',
              style: const TextStyle(
                  color: Color(0xFF4FC3F7),
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2),
            ),
          ),
          const SizedBox(height: 32),
          _profileTile(Icons.badge_outlined, 'Função',
              isSeller ? 'Vendedor' : 'Fotógrafo'),
          _profileTile(Icons.location_city_rounded, 'Filial', 'Equipe 1 – SP'),
          _profileTile(Icons.calendar_today_rounded, 'Membro desde',
              'Janeiro de 2024'),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _logout,
              icon: const Icon(Icons.logout_rounded, color: Color(0xFFEF5350)),
              label: const Text('Sair da conta',
                  style: TextStyle(color: Color(0xFFEF5350))),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side:
                    const BorderSide(color: Color(0xFFEF5350), width: 1.5),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _profileTile(IconData icon, String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2535),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF4FC3F7), size: 20),
          const SizedBox(width: 14),
          Text(label,
              style: const TextStyle(
                  color: Color(0xFF90CAF9), fontSize: 13)),
          const Spacer(),
          Text(value,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  // ── Bottom Nav ────────────────────────────────────────────────────────────
  Widget _buildBottomNav() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF0D1B2A),
        border: Border(
            top: BorderSide(color: Colors.white.withOpacity(0.08), width: 1)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _navItem(0, Icons.dashboard_rounded, 'Início'),
              _navItem(1, Icons.person_rounded, 'Perfil'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon, String label) {
    final selected = _selectedIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _selectedIndex = index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF0288D1).withOpacity(0.15)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon,
                color: selected
                    ? const Color(0xFF4FC3F7)
                    : const Color(0xFF546E7A),
                size: 24),
            const SizedBox(height: 4),
            Text(label,
                style: TextStyle(
                    color: selected
                        ? const Color(0xFF4FC3F7)
                        : const Color(0xFF546E7A),
                    fontSize: 11,
                    fontWeight: selected
                        ? FontWeight.bold
                        : FontWeight.normal)),
          ],
        ),
      ),
    );
  }

  void _showComingSoon(String feature) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$feature – em breve na versão completa!'),
        backgroundColor: const Color(0xFF0288D1),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

class _ActivityItem {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  const _ActivityItem(
      {required this.icon,
      required this.color,
      required this.title,
      required this.subtitle});
}
