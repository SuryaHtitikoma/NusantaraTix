/**
 * app.js — NusantaraTix Frontend State, RBAC UI Rendering, Concurrency Tester
 */

// ============= STATE =============
const state = {
  sessionId: null,
  user: null,
  activeTab: null,
  clusterStatus: null,
  events: [],
  targetNode: null,
};

const API = '';

// ============= HELPERS =============
function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (state.sessionId) h['x-session-id'] = state.sessionId;
  if (state.targetNode) h['x-target-node'] = state.targetNode;
  return h;
}

async function api(method, path, body = null) {
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

function $(id) { return document.getElementById(id); }
function esc(s) { if (s === null || s === undefined) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function formatDate(d) { if (!d) return '-'; return new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); }
function statusBadge(val) {
  const cls = { ONLINE: 'badge-success', PAID: 'badge-success', SUCCESS: 'badge-success', PENDING: 'badge-warn', EXPIRED: 'badge-danger', CANCELLED: 'badge-danger', FAILED: 'badge-danger', OFFLINE: 'badge-danger', REFUNDED: 'badge-warn' };
  return `<span class="badge ${cls[val] || 'badge-info'}">${esc(val)}</span>`;
}

// ============= CLUSTER STATUS =============
async function refreshCluster() {
  try {
    const res = await fetch(`${API}/api/cluster/status`);
    const data = await res.json();
    if (data.success) {
      state.clusterStatus = data.cluster;
      data.cluster.nodes.forEach(n => {
        const dot = $(`dot-${n.port}`);
        const pill = $(`node-${n.port}`);
        if (dot) {
          dot.className = `w-2 h-2 rounded-full ${n.status === 'ONLINE' ? 'bg-emerald pulse-online' : 'bg-crimson'}`;
        }
        if (pill) {
          pill.className = `node-pill flex items-center gap-1 px-3 py-1 rounded-full border text-xs ${n.status === 'ONLINE' ? 'border-emerald bg-emerald/5' : 'border-crimson bg-crimson/5'}`;
        }
        const landingBadge = $(`badge-node-${n.port}`);
        if (landingBadge) {
          landingBadge.innerHTML = n.status === 'ONLINE'
            ? '<span class="badge badge-success">ONLINE</span>'
            : '<span class="badge badge-danger">OFFLINE</span>';
        }
      });
    }
  } catch (e) { console.warn('Cluster status fetch failed:', e); }
}

// ============= AUTH =============
function showLoginModal() { $('loginModal').classList.remove('hidden'); $('loginUsername').focus(); }
function hideLoginModal() { $('loginModal').classList.add('hidden'); $('loginError').classList.add('hidden'); }

async function doLogin() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value.trim();
  if (!username || !password) return;

  try {
    const res = await api('POST', '/api/auth/login', { username, password });
    if (res.success) {
      state.sessionId = res.sessionId;
      state.user = res.user;
      hideLoginModal();
      updateUserDisplay();
      renderTabs();
      switchTab(getDefaultTab());
    } else {
      $('loginError').textContent = res.message;
      $('loginError').classList.remove('hidden');
    }
  } catch (e) {
    $('loginError').textContent = 'Gagal terhubung ke server.';
    $('loginError').classList.remove('hidden');
  }
}

function doLogout() {
  api('POST', '/api/auth/logout');
  state.sessionId = null;
  state.user = null;
  updateUserDisplay();
  renderTabs();
  switchTab('landing');
}

async function quickLoginAs(username, password) {
  $('loginUsername').value = username;
  $('loginPassword').value = password;
  await doLogin();
}

function updateUserDisplay() {
  const quickSelector = `
    <select onchange="if(this.value){ const parts=this.value.split(':'); quickLoginAs(parts[0], parts[1]); }" class="px-2 py-1 rounded text-xs bg-bg border border-border text-gray-300">
      <option value="">⚡ Switch Role...</option>
      <option value="admin_pusat:admin123">👑 ADMIN (admin_pusat)</option>
      <option value="operator_jkt:op123">🎫 OPERATOR (operator_jkt)</option>
      <option value="analyst_uas:analyst123">📊 ANALYST (analyst_uas)</option>
      <option value="user_5:pass123">👤 CUSTOMER (user_5)</option>
    </select>`;

  if (state.user) {
    $('userArea').innerHTML = `
      ${quickSelector}
      <span class="badge badge-info">${esc(state.user.role)}</span>
      <span class="text-sm text-gray-300">${esc(state.user.username)}</span>
      <button class="btn btn-sm bg-gray-700 text-white" onclick="doLogout()">Logout</button>`;
  } else {
    $('userArea').innerHTML = `
      ${quickSelector}
      <button class="btn btn-primary btn-sm" onclick="showLoginModal()">Login</button>`;
  }
}

// ============= TABS =============
const TAB_CONFIG = [
  { id: 'landing', label: '🏠 Beranda', roles: ['ADMIN', 'OPERATOR', 'CUSTOMER', 'ANALYST', 'GUEST'] },
  { id: 'war', label: '⚔️ War Tiket & Live Booking', roles: ['ADMIN', 'OPERATOR', 'CUSTOMER'] },
  { id: 'data', label: '📊 Data Perang (1M+ Explorer)', roles: ['ADMIN', 'OPERATOR', 'ANALYST'] },
  { id: 'admin', label: '🛡️ Admin & Quota Control', roles: ['ADMIN'] },
  { id: 'uas', label: '📦 UAS DuckDB Staging Prep', roles: ['ADMIN', 'ANALYST'] },
];

function getDefaultTab() {
  if (!state.user) return 'landing';
  if (state.user.role === 'ADMIN') return 'admin';
  if (state.user.role === 'OPERATOR') return 'war';
  if (state.user.role === 'ANALYST') return 'data';
  return 'war';
}

function renderTabs() {
  const nav = $('navTabs');
  const userRole = state.user?.role || 'GUEST';
  nav.innerHTML = TAB_CONFIG
    .filter(t => t.roles.includes(userRole))
    .map(t => `<button class="tab-btn px-4 py-2 rounded-lg text-sm font-medium ${state.activeTab === t.id ? 'active' : 'text-gray-400 hover:text-white hover:bg-bg'}" onclick="switchTab('${t.id}')">${t.label}</button>`)
    .join('');
}

function switchTab(tabId) {
  state.activeTab = tabId;
  renderTabs();
  const main = $('mainContent');
  main.innerHTML = '<div class="text-center py-10 text-gray-500">Loading...</div>';

  switch (tabId) {
    case 'landing': renderLandingTab(); break;
    case 'war': renderWarTab(); break;
    case 'data': renderDataTab(); break;
    case 'admin': renderAdminTab(); break;
    case 'uas': renderUASTab(); break;
    default: renderLandingTab(); break;
  }
}

// ============= TAB 0: LANDING PAGE =============
async function renderLandingTab() {
  const main = $('mainContent');

  const getStatusBadge = (port) => {
    const node = state.clusterStatus?.nodes?.find(n => n.port === port);
    const isOnline = node?.status === 'ONLINE';
    return isOnline
      ? '<span class="badge badge-success">ONLINE</span>'
      : '<span class="badge badge-danger">OFFLINE</span>';
  };

  main.innerHTML = `
    <div class="fade-in space-y-12 pb-16">
      <!-- HERO SECTION -->
      <section class="text-center py-12 md:py-18 hero-glow rounded-3xl border border-border/50 px-4 relative overflow-hidden">
        <div class="max-w-4xl mx-auto">
          <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-primary/10 border border-primary/30 text-primary mb-6 animate-pulse">
            <span class="w-2 h-2 rounded-full bg-emerald"></span>
            CockroachDB Multi-Region Distributed Cluster • TLS Secure Mode
          </div>
          <h1 class="text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight mb-6">
            Solusi War Tiket Konser Nasional<br>
            <span class="text-transparent bg-clip-text bg-gradient-to-r from-gold via-amber-200 to-yellow-500">Anti-Down & Zero Overselling</span>
          </h1>
          <p class="text-gray-400 text-sm md:text-base max-w-3xl mx-auto mb-8 leading-relaxed">
            Platform pemesanan tiket terdistribusi yang berjalan di atas cluster 3-Node regional (<strong class="text-gray-200">Jakarta, Surabaya, Bali</strong>). Menjamin konsistensi transaksi ACID 100%, kuota tiket tidak pernah minus, dan auto-failover tetap aktif saat salah satu server regional terputus.
          </p>
          <div class="flex flex-wrap items-center justify-center gap-3">
            <button class="btn btn-primary text-sm md:text-base px-6 py-3 shadow-lg shadow-primary/25" onclick="quickGoWar()">
              ⚔️ Mulai Simulasi War Tiket
            </button>
            <a href="#landingEvents" class="btn btn-gold text-sm md:text-base px-6 py-3">
              🎪 Jadwal Konser & Event
            </a>
            <button class="btn bg-card border border-border text-gray-300 hover:text-white px-6 py-3" onclick="quickGoData()">
              📊 Eksplorasi 1 Juta+ Baris Data
            </button>
          </div>
        </div>

        <!-- METRIC COUNTERS -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mt-12 pt-8 border-t border-border/40">
          <div class="bg-card/60 backdrop-blur border border-border rounded-xl p-4">
            <div class="text-2xl md:text-3xl font-extrabold text-gold">3 Node</div>
            <div class="text-xs text-gray-400 mt-1">Regional Multi-Master</div>
          </div>
          <div class="bg-card/60 backdrop-blur border border-border rounded-xl p-4">
            <div class="text-2xl md:text-3xl font-extrabold text-white">1.000.000+</div>
            <div class="text-xs text-gray-400 mt-1">Baris Tiap Tabel Perang</div>
          </div>
          <div class="bg-card/60 backdrop-blur border border-border rounded-xl p-4">
            <div class="text-2xl md:text-3xl font-extrabold text-emerald">0 Kuota Minus</div>
            <div class="text-xs text-gray-400 mt-1">Strict ACID Quota Lock</div>
          </div>
          <div class="bg-card/60 backdrop-blur border border-border rounded-xl p-4">
            <div class="text-2xl md:text-3xl font-extrabold text-primary">&lt; 50 ms</div>
            <div class="text-xs text-gray-400 mt-1">Latensi Query Terindeks</div>
          </div>
        </div>
      </section>

      <!-- TOPOLOGY / NODES SECTION -->
      <section class="space-y-4">
        <div class="flex justify-between items-end flex-wrap gap-2">
          <div>
            <h2 class="text-xl md:text-2xl font-bold text-white">🌐 Status Topologi Cluster CockroachDB</h2>
            <p class="text-xs text-gray-400 mt-1">Node regional terdistribusi dengan enkripsi TLS (Secure Mode) & otomatis failover.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Node 1 Jakarta -->
          <div class="bg-card border border-border rounded-2xl p-5 glow-card relative overflow-hidden">
            <div class="flex justify-between items-start mb-3">
              <div>
                <span class="text-xs text-primary font-semibold tracking-wider uppercase">Region 1</span>
                <h3 class="text-lg font-bold text-white">🇮🇩 Jakarta (Node 1)</h3>
              </div>
              <span id="badge-node-26257">${getStatusBadge(26257)}</span>
            </div>
            <p class="text-xs text-gray-400 mb-4">Pintu gerbang trafik wilayah barat & administrasi cluster pusat.</p>
            <div class="space-y-1.5 text-xs font-mono bg-bg p-3 rounded-lg border border-border/60">
              <div class="flex justify-between"><span class="text-gray-500">SQL Port:</span><span class="text-gold font-bold">localhost:26257</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Admin UI:</span><span class="text-gray-300">https://localhost:8080</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Locality:</span><span class="text-emerald">region=jakarta</span></div>
            </div>
          </div>

          <!-- Node 2 Surabaya -->
          <div class="bg-card border border-border rounded-2xl p-5 glow-card relative overflow-hidden">
            <div class="flex justify-between items-start mb-3">
              <div>
                <span class="text-xs text-primary font-semibold tracking-wider uppercase">Region 2</span>
                <h3 class="text-lg font-bold text-white">🇮🇩 Surabaya (Node 2)</h3>
              </div>
              <span id="badge-node-26258">${getStatusBadge(26258)}</span>
            </div>
            <p class="text-xs text-gray-400 mb-4">Relay transaksi cepat untuk Jawa Timur & Indonesia Tengah.</p>
            <div class="space-y-1.5 text-xs font-mono bg-bg p-3 rounded-lg border border-border/60">
              <div class="flex justify-between"><span class="text-gray-500">SQL Port:</span><span class="text-gold font-bold">localhost:26258</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Admin UI:</span><span class="text-gray-300">https://localhost:8081</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Locality:</span><span class="text-emerald">region=surabaya</span></div>
            </div>
          </div>

          <!-- Node 3 Bali -->
          <div class="bg-card border border-border rounded-2xl p-5 glow-card relative overflow-hidden">
            <div class="flex justify-between items-start mb-3">
              <div>
                <span class="text-xs text-primary font-semibold tracking-wider uppercase">Region 3</span>
                <h3 class="text-lg font-bold text-white">🇮🇩 Bali (Node 3)</h3>
              </div>
              <span id="badge-node-26259">${getStatusBadge(26259)}</span>
            </div>
            <p class="text-xs text-gray-400 mb-4">Pusat transaksi event pariwisata & failover high-availability.</p>
            <div class="space-y-1.5 text-xs font-mono bg-bg p-3 rounded-lg border border-border/60">
              <div class="flex justify-between"><span class="text-gray-500">SQL Port:</span><span class="text-gold font-bold">localhost:26259</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Admin UI:</span><span class="text-gray-300">https://localhost:8082</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Locality:</span><span class="text-emerald">region=bali</span></div>
            </div>
          </div>
        </div>

        <div class="bg-card/40 border border-border rounded-xl p-3 flex items-center gap-3 text-xs text-gray-400">
          <span class="text-lg">💡</span>
          <div>
            <strong class="text-gold">Skenario Demo Failover:</strong> Kamu dapat mematikan (Ctrl+C) salah satu terminal node saat simulasi War Tiket berjalan. Sistem NusantaraTix akan secara otomatis mengalihkan query ke node yang masih hidup tanpa menyebabkan transaksi gagal.
          </div>
        </div>
      </section>

      <!-- EVENTS & CONCERTS SHOWCASE -->
      <section id="landingEvents" class="space-y-4">
        <div class="flex justify-between items-end flex-wrap gap-2">
          <div>
            <h2 class="text-xl md:text-2xl font-bold text-white">🎪 Jadwal Konser & Event Nasional</h2>
            <p class="text-xs text-gray-400 mt-1">Daftar konser terintegrasi langsung dengan database CockroachDB secara real-time.</p>
          </div>
          <button class="btn btn-sm btn-primary" onclick="loadLandingEvents()">🔄 Muat Ulang Event</button>
        </div>

        <div id="landingEventsList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div class="text-gray-500 text-sm py-8 text-center col-span-3">Memuat event...</div>
        </div>
      </section>

      <!-- ARCHITECTURAL PILLARS -->
      <section class="space-y-4">
        <div>
          <h2 class="text-xl md:text-2xl font-bold text-white">🛡️ Keunggulan & Arsitektur NusantaraTix</h2>
          <p class="text-xs text-gray-400 mt-1">Dirancang khusus untuk memenuhi standar tugas besar Distribusi Database & Data Warehouse (DDDW).</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-card border border-border rounded-2xl p-5 glow-card">
            <div class="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center text-xl mb-4">🔒</div>
            <h3 class="text-base font-bold text-white mb-2">Strict ACID Quota Lock</h3>
            <p class="text-xs text-gray-400 leading-relaxed">
              Eksekusi transaksi menggunakan <code>WHERE available_quota &gt;= $1</code> dengan rollback instan saat kuota habis. Menjamin tidak ada overselling tiket.
            </p>
          </div>

          <div class="bg-card border border-border rounded-2xl p-5 glow-card">
            <div class="w-10 h-10 rounded-xl bg-emerald/20 text-emerald flex items-center justify-center text-xl mb-4">🔄</div>
            <h3 class="text-base font-bold text-white mb-2">Auto-Failover Multi-Node</h3>
            <p class="text-xs text-gray-400 leading-relaxed">
              Koneksi terhubung ke 3 node regional. Jika salah satu server mati, pool koneksi otomatis mengalihkan query ke node yang aktif secara instan.
            </p>
          </div>

          <div class="bg-card border border-border rounded-2xl p-5 glow-card">
            <div class="w-10 h-10 rounded-xl bg-gold/20 text-gold flex items-center justify-center text-xl mb-4">🛡️</div>
            <h3 class="text-base font-bold text-white mb-2">Two-Layer RBAC</h3>
            <p class="text-xs text-gray-400 leading-relaxed">
              Hak akses tidak hanya disembunyikan di UI, tetapi ditegakkan langsung di level CockroachDB SQL Role (<code>admin_role</code>, <code>operator_role</code>, <code>analyst_role</code>).
            </p>
          </div>

          <div class="bg-card border border-border rounded-2xl p-5 glow-card">
            <div class="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center text-xl mb-4">🦆</div>
            <h3 class="text-base font-bold text-white mb-2">DuckDB (UAS) Ready</h3>
            <p class="text-xs text-gray-400 leading-relaxed">
              Modul analitik bawaan untuk mengekspor jutaan baris data ke format CSV/JSON batch, siap di-ingest ke DuckDB untuk data profiling & star schema.
            </p>
          </div>
        </div>
      </section>

      <!-- DEMO ROLE PLAYGROUND -->
      <section class="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-6">
        <div>
          <span class="text-xs text-gold font-bold uppercase tracking-wider">Akses Pengujian Cepat</span>
          <h2 class="text-xl md:text-2xl font-bold text-white mt-1">🎯 Coba Langsung dengan Akun Demo</h2>
          <p class="text-xs text-gray-400 mt-1">Pilih salah satu peran di bawah ini untuk menguji hak akses database dan fitur secara langsung:</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Card Admin -->
          <div class="bg-bg border border-border/80 hover:border-gold rounded-2xl p-4 transition cursor-pointer group" onclick="quickLoginAs('admin_pusat', 'admin123'); switchTab('admin');">
            <div class="flex justify-between items-center mb-2">
              <span class="text-2xl">👑</span>
              <span class="badge badge-warn">ADMIN</span>
            </div>
            <h4 class="font-bold text-white group-hover:text-gold transition text-sm">Administrator Pusat</h4>
            <p class="text-xs text-gray-500 font-mono mt-0.5">admin_pusat / admin123</p>
            <p class="text-xs text-gray-400 mt-2">Akses penuh: buat event & tier, set kuota war tiket, dan atur cluster.</p>
            <button class="btn btn-sm btn-gold w-full mt-3">Masuk sebagai Admin →</button>
          </div>

          <!-- Card Operator -->
          <div class="bg-bg border border-border/80 hover:border-primary rounded-2xl p-4 transition cursor-pointer group" onclick="quickLoginAs('operator_jkt', 'op123'); switchTab('war');">
            <div class="flex justify-between items-center mb-2">
              <span class="text-2xl">🎫</span>
              <span class="badge badge-info">OPERATOR</span>
            </div>
            <h4 class="font-bold text-white group-hover:text-primary transition text-sm">Operator Loket</h4>
            <p class="text-xs text-gray-500 font-mono mt-0.5">operator_jkt / op123</p>
            <p class="text-xs text-gray-400 mt-2">Jalankan war tiket, proses pembelian, dan check-in barcode tiket.</p>
            <button class="btn btn-sm btn-primary w-full mt-3">Masuk sebagai Operator →</button>
          </div>

          <!-- Card Analyst -->
          <div class="bg-bg border border-border/80 hover:border-purple-400 rounded-2xl p-4 transition cursor-pointer group" onclick="quickLoginAs('analyst_uas', 'analyst123'); switchTab('uas');">
            <div class="flex justify-between items-center mb-2">
              <span class="text-2xl">📊</span>
              <span class="badge badge-info">ANALYST</span>
            </div>
            <h4 class="font-bold text-white group-hover:text-purple-400 transition text-sm">Data Analyst (UAS)</h4>
            <p class="text-xs text-gray-500 font-mono mt-0.5">analyst_uas / analyst123</p>
            <p class="text-xs text-gray-400 mt-2">Read-only 1M+ baris, lihat agregasi regional, dan ekspor ke DuckDB.</p>
            <button class="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white w-full mt-3">Masuk sebagai Analyst →</button>
          </div>

          <!-- Card Customer -->
          <div class="bg-bg border border-border/80 hover:border-emerald rounded-2xl p-4 transition cursor-pointer group" onclick="quickLoginAs('user_5', 'pass123'); switchTab('war');">
            <div class="flex justify-between items-center mb-2">
              <span class="text-2xl">👤</span>
              <span class="badge badge-success">CUSTOMER</span>
            </div>
            <h4 class="font-bold text-white group-hover:text-emerald transition text-sm">Pengunjung Konser</h4>
            <p class="text-xs text-gray-500 font-mono mt-0.5">user_5 / pass123</p>
            <p class="text-xs text-gray-400 mt-2">Beli tiket konser resmi (1-4 tiket) & periksa e-ticket pribadi.</p>
            <button class="btn btn-sm bg-emerald hover:bg-emerald-600 text-white w-full mt-3">Masuk sebagai Customer →</button>
          </div>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="border-t border-border/50 pt-8 text-center text-xs text-gray-500 space-y-2">
        <p class="font-semibold text-gray-400">NusantaraTix &bull; Distributed OLTP Ticketing System</p>
        <p>Tugas Besar Distribusi Database & Data Warehouse (CockroachDB 3-Node TLS + Node.js + DuckDB OLAP Ready)</p>
      </footer>
    </div>
  `;

  await loadLandingEvents();
}

function quickGoWar() {
  if (!state.user) {
    quickLoginAs('operator_jkt', 'op123');
  }
  switchTab('war');
}

function quickGoData() {
  if (!state.user) {
    quickLoginAs('analyst_uas', 'analyst123');
  }
  switchTab('data');
}

async function quickBuyEvent(tierId) {
  if (!state.user) {
    await quickLoginAs('user_5', 'pass123');
  }
  switchTab('war');
  setTimeout(() => {
    const sel = $('purchaseTier');
    if (sel && tierId) sel.value = tierId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 350);
}

async function loadLandingEvents() {
  const container = $('landingEventsList');
  if (!container) return;

  try {
    const res = await api('GET', '/api/events?limit=6');
    if (res.success && res.data && res.data.length > 0) {
      container.innerHTML = res.data.map(ev => {
        const totalQuota = ev.tiers?.reduce((acc, t) => acc + parseInt(t.total_quota || 0), 0) || 0;
        const availQuota = ev.tiers?.reduce((acc, t) => acc + parseInt(t.available_quota || 0), 0) || 0;
        const percent = totalQuota > 0 ? Math.round((availQuota / totalQuota) * 100) : 0;
        const firstTierId = ev.tiers?.[0]?.tier_id || '';

        return `
          <div class="bg-card border border-border rounded-2xl p-5 glow-card flex flex-col justify-between">
            <div>
              <div class="flex justify-between items-start gap-2 mb-2">
                <span class="badge badge-info text-xs">${esc(ev.region || ev.city)}</span>
                <span class="badge ${availQuota > 0 ? 'badge-success' : 'badge-danger'}">
                  ${availQuota > 0 ? `${availQuota} Tiket Tersisa` : 'SOLD OUT'}
                </span>
              </div>
              <h3 class="text-lg font-bold text-white mb-1">${esc(ev.event_name)}</h3>
              <p class="text-xs text-gray-400 mb-1">📍 ${esc(ev.venue)} — ${esc(ev.city)}</p>
              <p class="text-xs text-gray-500 mb-3">📅 ${formatDate(ev.event_date)}</p>

              <div class="space-y-1.5 my-3">
                ${(ev.tiers || []).slice(0, 3).map(t => `
                  <div class="flex justify-between items-center text-xs bg-bg/80 px-2.5 py-1.5 rounded-lg border border-border/40">
                    <span class="text-gray-300 font-medium">${esc(t.tier_name)}</span>
                    <span class="text-gold font-semibold">Rp ${Number(t.price).toLocaleString('id-ID')}</span>
                    <span class="${parseInt(t.available_quota) > 0 ? 'text-emerald' : 'text-crimson'} text-[11px] font-mono">
                      ${t.available_quota} sisa
                    </span>
                  </div>
                `).join('')}
              </div>

              <div class="mt-2 mb-4">
                <div class="flex justify-between text-[11px] text-gray-400 mb-1">
                  <span>Ketersediaan Tiket</span>
                  <span>${percent}%</span>
                </div>
                <div class="w-full bg-bg rounded-full h-1.5 overflow-hidden">
                  <div class="bg-gradient-to-r from-primary to-emerald h-1.5 rounded-full" style="width: ${percent}%"></div>
                </div>
              </div>
            </div>

            <div>
              <button class="btn btn-primary w-full text-xs font-semibold py-2.5" onclick="quickBuyEvent('${firstTierId}')">
                🎟️ Beli Tiket Konser Ini
              </button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = `
        <div class="col-span-3 bg-card border border-border rounded-xl p-8 text-center text-gray-400">
          <p class="text-base font-semibold text-white mb-1">Belum Ada Event Aktif</p>
          <p class="text-xs text-gray-500 mb-4">Masuk sebagai Admin untuk membuat konser baru atau jalankan seed database.</p>
          <button class="btn btn-gold btn-sm" onclick="quickLoginAs('admin_pusat', 'admin123'); switchTab('admin');">
            👑 Buat Event Pertama sebagai Admin
          </button>
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `<div class="col-span-3 text-crimson text-sm text-center py-4">Gagal memuat event: ${err.message}</div>`;
  }
}

// ============= TAB 1: WAR TIKET & LIVE BOOKING =============
async function renderWarTab() {
  const main = $('mainContent');
  main.innerHTML = `<div class="fade-in space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Event Cards -->
      <div>
        <h2 class="text-lg font-bold text-gold mb-3">🎪 Active Events</h2>
        <div id="eventCards" class="space-y-3"><div class="text-gray-500 text-sm">Loading events...</div></div>
      </div>
      <!-- Purchase + Simulator -->
      <div class="space-y-4">
        <!-- Quick Purchase -->
        <div class="bg-card border border-border rounded-xl p-4">
          <h3 class="text-md font-bold text-primary mb-3">🎟️ Quick Purchase</h3>
          <div class="space-y-2">
            <select id="purchaseTier" class="w-full px-3 py-2 rounded text-sm">
              <option value="">Pilih Tier...</option>
            </select>
            <div class="flex gap-2">
              <input type="number" id="purchaseQty" value="1" min="1" max="4" class="w-20 px-3 py-2 rounded text-sm" placeholder="Qty">
              <select id="purchasePayment" class="flex-1 px-3 py-2 rounded text-sm">
                <option value="QRIS">QRIS</option>
                <option value="VA_BCA">VA BCA</option>
                <option value="VA_MANDIRI">VA Mandiri</option>
                <option value="GOPAY">GoPay</option>
                <option value="OVO">OVO</option>
              </select>
            </div>
            <button class="btn btn-primary w-full" onclick="doPurchase()">🛒 Beli Tiket</button>
            <div id="purchaseResult" class="text-sm mt-2"></div>
          </div>
        </div>

        <!-- War Tiket Simulator -->
        ${state.user?.role !== 'CUSTOMER' ? `
        <div class="bg-card border border-border rounded-xl p-4">
          <h3 class="text-md font-bold text-crimson mb-3">⚔️ War Tiket Stress Simulator</h3>
          <div class="space-y-2">
            <select id="warTier" class="w-full px-3 py-2 rounded text-sm">
              <option value="">Pilih Tier untuk War...</option>
            </select>
            <div class="flex gap-2">
              <input type="number" id="warConcurrent" value="20" min="1" max="200" class="w-24 px-3 py-2 rounded text-sm" placeholder="Requests">
              <select id="warRegion" class="flex-1 px-3 py-2 rounded text-sm">
                <option value="RANDOM">Random Nodes</option>
                <option value="JAKARTA">Jakarta Only</option>
                <option value="SURABAYA">Surabaya Only</option>
                <option value="BALI">Bali Only</option>
              </select>
            </div>
            <button class="btn btn-danger w-full" onclick="doWarSimulate()">🔥 MULAI WAR TIKET!</button>
            <div id="warResult" class="text-sm mt-2"></div>
          </div>
        </div>` : ''}
      </div>
    </div>

    <!-- Transaction Log -->
    <div class="bg-card border border-border rounded-xl p-4">
      <h3 class="text-md font-bold text-gold mb-3">📜 Live Transaction Log</h3>
      <div id="txLog" class="max-h-60 overflow-y-auto space-y-1 text-xs font-mono">
        <div class="text-gray-600">Belum ada transaksi...</div>
      </div>
    </div>

    <!-- My Bookings & E-Tickets -->
    <div class="bg-card border border-border rounded-xl p-4" id="myTicketsSection">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-md font-bold text-gold">🎟️ My Bookings & E-Tickets</h3>
        <button class="btn btn-sm btn-primary" onclick="loadMyTickets()">🔄 Refresh</button>
      </div>
      <div id="myTicketsContent" class="text-xs text-gray-500">Loading your tickets...</div>
    </div>
  </div>`;

  await loadEvents();
  loadMyTickets();
}

async function loadEvents() {
  try {
    const res = await api('GET', '/api/events?limit=10');
    if (res.success) {
      state.events = res.data;
      renderEventCards();
      populateTierSelects();
    }
  } catch (e) { console.error(e); }
}

async function loadMyTickets() {
  const container = $('myTicketsContent');
  if (!container) return;
  try {
    const res = await api('GET', '/api/bookings/my-tickets');
    if (res.success) {
      if (!res.data || res.data.length === 0) {
        container.innerHTML = '<div class="text-gray-500 py-2">Belum ada tiket yang dibeli pada akun ini.</div>';
        return;
      }
      container.innerHTML = `
        <div class="overflow-x-auto"><table>
          <thead><tr><th>Ticket Code</th><th>Event</th><th>Tier</th><th>Attendee</th><th>Status</th><th>Purchased</th></tr></thead>
          <tbody>${res.data.map(t => `<tr>
            <td class="font-mono text-gold font-bold">${esc(t.ticket_code)}</td>
            <td>${esc(t.event_name)}</td>
            <td>${esc(t.tier_name)}</td>
            <td>${esc(t.attendee_name)}</td>
            <td>${t.is_checked_in ? '<span class="badge badge-success">CHECKED-IN</span>' : '<span class="badge badge-info">VALID</span>'}</td>
            <td class="text-gray-400 text-xs">${formatDate(t.created_at)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } else {
      container.innerHTML = `<div class="text-crimson">Gagal memuat tiket: ${res.message}</div>`;
    }
  } catch (e) {
    container.innerHTML = `<div class="text-crimson">Error: ${e.message}</div>`;
  }
}

function renderEventCards() {
  const container = $('eventCards');
  if (!state.events.length) {
    container.innerHTML = '<div class="text-gray-500 text-sm">Belum ada event.</div>';
    return;
  }
  container.innerHTML = state.events.map(ev => `
    <div class="bg-bg border border-border rounded-lg p-3">
      <div class="flex justify-between items-start">
        <div>
          <h4 class="font-bold text-white text-sm">${esc(ev.event_name)}</h4>
          <p class="text-xs text-gray-400">${esc(ev.venue)} — ${esc(ev.city)}, ${esc(ev.region)}</p>
          <p class="text-xs text-gray-500">${formatDate(ev.event_date)}</p>
        </div>
        <span class="badge badge-info">#${ev.event_id}</span>
      </div>
      ${ev.tiers?.length ? `<div class="mt-2 space-y-1">${ev.tiers.map(t => `
        <div class="flex justify-between items-center text-xs bg-card px-2 py-1 rounded">
          <span class="text-gray-300">${esc(t.tier_name)}</span>
          <span class="text-gold font-semibold">Rp ${Number(t.price).toLocaleString('id-ID')}</span>
          <span class="${parseInt(t.available_quota) > 0 ? 'text-emerald' : 'text-crimson'} font-bold">${t.available_quota} / ${t.total_quota}</span>
        </div>`).join('')}</div>` : '<p class="text-xs text-gray-600 mt-1">Belum ada tier.</p>'}
    </div>`).join('');
}

function populateTierSelects() {
  const options = state.events.flatMap(ev =>
    (ev.tiers || []).map(t => `<option value="${t.tier_id}">[${esc(ev.event_name)}] ${esc(t.tier_name)} — Rp ${Number(t.price).toLocaleString('id-ID')} (sisa: ${t.available_quota})</option>`)
  ).join('');
  const purchaseSel = $('purchaseTier');
  const warSel = $('warTier');
  if (purchaseSel) purchaseSel.innerHTML = `<option value="">Pilih Tier...</option>${options}`;
  if (warSel) warSel.innerHTML = `<option value="">Pilih Tier untuk War...</option>${options}`;
}

function addTxLog(msg, type = 'info') {
  const log = $('txLog');
  if (!log) return;
  const colors = { success: 'text-emerald', error: 'text-crimson', info: 'text-primary', warn: 'text-gold' };
  const time = new Date().toLocaleTimeString('id-ID');
  const entry = document.createElement('div');
  entry.className = colors[type] || 'text-gray-400';
  entry.textContent = `[${time}] ${msg}`;
  if (log.firstChild?.textContent === 'Belum ada transaksi...') log.innerHTML = '';
  log.prepend(entry);
}

async function doPurchase() {
  const tierId = $('purchaseTier')?.value;
  const qty = parseInt($('purchaseQty')?.value || 1);
  const method = $('purchasePayment')?.value || 'QRIS';
  if (!tierId) return alert('Pilih tier dulu!');

  const resultDiv = $('purchaseResult');
  resultDiv.innerHTML = '<span class="text-gray-400">Processing...</span>';

  try {
    const res = await api('POST', '/api/bookings/purchase', { tier_id: parseInt(tierId), qty, payment_method: method });
    if (res.success) {
      const d = res.data;
      resultDiv.innerHTML = `<div class="text-emerald">✅ Booking #${d.booking_id} berhasil! ${d.qty} tiket, Rp ${Number(d.total_amount).toLocaleString('id-ID')}</div>
        <div class="text-xs text-gray-400 mt-1">Node: ${res.handledByNode} | Tickets: ${d.tickets.map(t => t.ticket_code).join(', ')}</div>`;
      addTxLog(`✅ Purchase OK — Booking #${d.booking_id}, ${d.qty}x, Node: ${res.handledByNode}`, 'success');
      await loadEvents();
      loadMyTickets();
    } else {
      resultDiv.innerHTML = `<div class="text-crimson">❌ ${res.message}</div>`;
      addTxLog(`❌ Purchase FAILED — ${res.message}`, 'error');
    }
  } catch (e) {
    resultDiv.innerHTML = `<div class="text-crimson">❌ Error: ${e.message}</div>`;
    addTxLog(`❌ Error: ${e.message}`, 'error');
  }
}

async function doWarSimulate() {
  const tierId = $('warTier')?.value;
  const concurrent = parseInt($('warConcurrent')?.value || 20);
  const regionMode = $('warRegion')?.value || 'RANDOM';
  if (!tierId) return alert('Pilih tier dulu!');

  const resultDiv = $('warResult');
  resultDiv.innerHTML = '<span class="text-gold animate-pulse">⚔️ War sedang berlangsung... Tunggu hasilnya!</span>';
  addTxLog(`⚔️ WAR TIKET dimulai! ${concurrent} requests, mode: ${regionMode}`, 'warn');

  try {
    const res = await api('POST', '/api/bookings/war-ticket/simulate', { tier_id: parseInt(tierId), concurrent_requests: concurrent, region_mode: regionMode });
    if (res.success) {
      const r = res.battleReport;
      resultDiv.innerHTML = `
        <div class="bg-bg border border-gold/30 rounded-lg p-3 mt-2 space-y-2">
          <h4 class="text-gold font-bold text-sm">📋 Battle Report</h4>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>Total Requests: <span class="text-white font-bold">${r.total_requests}</span></div>
            <div>Execution Time: <span class="text-gold font-bold">${r.execution_time_ms}ms</span></div>
            <div>Succeeded: <span class="text-emerald font-bold">${r.total_succeeded}</span></div>
            <div>Sold Out: <span class="text-crimson font-bold">${r.total_sold_out}</span></div>
            <div>Errors: <span class="text-crimson font-bold">${r.total_errors}</span></div>
            <div>Final Quota: <span class="${r.final_available_quota >= 0 ? 'text-emerald' : 'text-crimson'} font-bold">${r.final_available_quota}</span></div>
          </div>
          <div class="text-xs text-gray-400 mt-1">
            <span class="font-semibold text-gold">Node Distribution:</span>
            ${Object.entries(r.node_distribution).map(([k, v]) => `${k}: ${v}`).join(' | ')}
          </div>
          <div class="text-xs ${r.quota_never_negative ? 'text-emerald' : 'text-crimson'} font-bold">
            ${r.quota_never_negative ? '✅ ACID PROOF: Quota never went negative!' : '⚠️ WARNING: Quota integrity issue!'}
          </div>
        </div>`;
      addTxLog(`📋 WAR RESULT: ${r.total_succeeded} OK, ${r.total_sold_out} Sold Out, ${r.execution_time_ms}ms, Quota: ${r.final_available_quota}`, r.quota_never_negative ? 'success' : 'error');
      await loadEvents();
    } else {
      resultDiv.innerHTML = `<div class="text-crimson">❌ ${res.message}</div>`;
    }
  } catch (e) {
    resultDiv.innerHTML = `<div class="text-crimson">❌ Error: ${e.message}</div>`;
  }
}

// ============= TAB 2: DATA PERANG (1M+ Explorer) =============
function renderDataTab() {
  const main = $('mainContent');
  main.innerHTML = `<div class="fade-in space-y-4">
    <div class="flex gap-2 mb-4">
      <button class="btn btn-sm ${state._dataSubTab === 'bookings' || !state._dataSubTab ? 'btn-primary' : 'bg-card text-gray-400 border border-border'}" onclick="state._dataSubTab='bookings'; renderDataTable('bookings')">📄 Bookings</button>
      <button class="btn btn-sm ${state._dataSubTab === 'booking_tickets' ? 'btn-primary' : 'bg-card text-gray-400 border border-border'}" onclick="state._dataSubTab='booking_tickets'; renderDataTable('booking_tickets')">🎫 Booking Tickets</button>
      <button class="btn btn-sm ${state._dataSubTab === 'payment_transactions' ? 'btn-primary' : 'bg-card text-gray-400 border border-border'}" onclick="state._dataSubTab='payment_transactions'; renderDataTable('payment_transactions')">💳 Payments</button>
    </div>
    <div id="dataTableArea"><div class="text-gray-500 text-sm">Loading...</div></div>
  </div>`;
  renderDataTable(state._dataSubTab || 'bookings');
}

async function renderDataTable(table) {
  state._dataSubTab = table;
  const area = $('dataTableArea');
  if (!area) return;

  const pkCol = table === 'bookings' ? 'booking_id' : table === 'booking_tickets' ? 'ticket_id' : 'payment_id';
  const page = state[`_${table}_page`] || 0;
  const limit = 20;

  area.innerHTML = `
    <div class="bg-card border border-border rounded-xl p-4">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-md font-bold text-gold">${table} <span id="dataRowCount" class="text-xs text-gray-400 font-normal"></span></h3>
        <div class="flex gap-2 items-center">
          <input type="text" id="dataSearch" placeholder="Search by ID..." class="px-3 py-1 rounded text-sm w-40" onkeydown="if(event.key==='Enter') searchDataById('${table}','${pkCol}')">
          <button class="btn btn-sm btn-primary" onclick="searchDataById('${table}','${pkCol}')">🔍</button>
        </div>
      </div>
      <div class="overflow-x-auto" id="dataTableContent"><div class="text-gray-500 text-sm py-4 text-center">Loading...</div></div>
      <div class="flex justify-between items-center mt-3" id="dataPagination"></div>
    </div>`;

  await fetchDataTable(table, page, limit);
}

async function fetchDataTable(table, page, limit = 20) {
  const pkCol = table === 'bookings' ? 'booking_id' : table === 'booking_tickets' ? 'ticket_id' : 'payment_id';
  const endpoint = table === 'bookings' ? '/api/bookings' : table === 'booking_tickets' ? '/api/bookings/tickets' : '/api/bookings/payments';

  try {
    const res = await api('GET', `${endpoint}?limit=${limit}&offset=${page * limit}`);
    if (res.success) {
      const countEl = $('dataRowCount');
      if (countEl) countEl.textContent = `(${Number(res.total).toLocaleString('id-ID')} rows total — Showing ${page * limit + 1}-${page * limit + res.data.length})`;

      const content = $('dataTableContent');
      if (res.data.length === 0) {
        content.innerHTML = '<div class="text-gray-500 text-sm py-4 text-center">Tidak ada data.</div>';
      } else {
        const cols = Object.keys(res.data[0]);
        const isOperatorOrAdmin = ['ADMIN', 'OPERATOR'].includes(state.user?.role);
        content.innerHTML = `<table>
          <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}${table === 'booking_tickets' && isOperatorOrAdmin ? '<th>Aksi</th>' : ''}</tr></thead>
          <tbody>${res.data.map(row => `<tr>${cols.map(c => {
            const v = row[c];
            if (['booking_status', 'payment_status'].includes(c)) return `<td>${statusBadge(v)}</td>`;
            if (c === 'is_checked_in') return `<td>${v ? '<span class="badge badge-success">✓ Checked-In</span>' : '<span class="badge badge-warn">Belum</span>'}</td>`;
            if (c.endsWith('_at') || c === 'paid_at' || c === 'event_date') return `<td class="text-xs text-gray-400">${formatDate(v)}</td>`;
            return `<td>${esc(v)}</td>`;
          }).join('')}${table === 'booking_tickets' && isOperatorOrAdmin ? `<td>${row.is_checked_in ? '<span class="text-xs text-gray-500">Selesai</span>' : `<button class="btn btn-sm btn-gold" onclick="checkinTicket(${row.ticket_id})">Check-in</button>`}</td>` : ''}</tr>`).join('')}</tbody>
        </table>`;
      }

      // Pagination
      const pag = $('dataPagination');
      const totalPages = Math.ceil(res.total / limit);
      pag.innerHTML = `
        <span class="text-xs text-gray-400">Page ${page + 1} of ${totalPages}</span>
        <div class="flex gap-1">
          <button class="btn btn-sm bg-card text-gray-400 border border-border" ${page === 0 ? 'disabled' : ''} onclick="state['_${table}_page']=${page - 1}; fetchDataTable('${table}', ${page - 1})">← Prev</button>
          <button class="btn btn-sm bg-card text-gray-400 border border-border" ${page >= totalPages - 1 ? 'disabled' : ''} onclick="state['_${table}_page']=${page + 1}; fetchDataTable('${table}', ${page + 1})">Next →</button>
        </div>`;

      if (res.handledByNode) {
        pag.innerHTML += `<span class="text-xs text-gray-600">Node: ${res.handledByNode}</span>`;
      }
    }
  } catch (e) {
    const content = $('dataTableContent');
    if (content) content.innerHTML = `<div class="text-crimson text-sm py-4 text-center">Error: ${e.message}</div>`;
  }
}

async function searchDataById(table, pkCol) {
  const val = $('dataSearch')?.value?.trim();
  if (!val) { fetchDataTable(table, 0); return; }

  const endpoint = table === 'bookings' ? '/api/bookings' : table === 'booking_tickets' ? '/api/bookings/tickets' : '/api/bookings/payments';
  try {
    const res = await api('GET', `${endpoint}?${pkCol}=${val}`);
    if (res.success) {
      const content = $('dataTableContent');
      if (res.data.length === 0) {
        content.innerHTML = `<div class="text-gray-500 text-sm py-4 text-center">ID #${esc(val)} tidak ditemukan.</div>`;
      } else {
        const cols = Object.keys(res.data[0]);
        content.innerHTML = `<table>
          <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${res.data.map(row => `<tr>${cols.map(c => `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>`;
      }
      const countEl = $('dataRowCount');
      if (countEl) countEl.textContent = `(Search: ID #${val})`;
    }
  } catch (e) { console.error(e); }
}

async function checkinTicket(ticketId) {
  try {
    const res = await api('PUT', `/api/bookings/tickets/${ticketId}/checkin`);
    if (res.success) {
      alert(`Tiket #${ticketId} berhasil check-in!\nHandled by: ${res.handledByNode}`);
      fetchDataTable('booking_tickets', state['_booking_tickets_page'] || 0);
    } else {
      alert(`Gagal check-in: ${res.message}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

// ============= TAB 3: ADMIN & QUOTA CONTROL =============
function renderAdminTab() {
  const main = $('mainContent');
  main.innerHTML = `<div class="fade-in space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Create Event -->
      <div class="bg-card border border-border rounded-xl p-4">
        <h3 class="text-md font-bold text-gold mb-3">📌 Create New Event</h3>
        <div class="space-y-2">
          <input type="text" id="newEventName" placeholder="Event Name" class="w-full px-3 py-2 rounded text-sm">
          <input type="text" id="newVenue" placeholder="Venue" class="w-full px-3 py-2 rounded text-sm">
          <div class="flex gap-2">
            <input type="text" id="newCity" placeholder="City" class="flex-1 px-3 py-2 rounded text-sm">
            <select id="newRegion" class="flex-1 px-3 py-2 rounded text-sm">
              <option value="Jakarta">Jakarta</option>
              <option value="Surabaya">Surabaya</option>
              <option value="Bali">Bali</option>
              <option value="Bandung">Bandung</option>
              <option value="Yogyakarta">Yogyakarta</option>
            </select>
          </div>
          <input type="datetime-local" id="newEventDate" class="w-full px-3 py-2 rounded text-sm">
          <button class="btn btn-gold w-full" onclick="createEvent()">➕ Create Event</button>
          <div id="createEventResult" class="text-sm"></div>
        </div>
      </div>

      <!-- Create Tier -->
      <div class="bg-card border border-border rounded-xl p-4">
        <h3 class="text-md font-bold text-gold mb-3">🎫 Add Ticket Tier</h3>
        <div class="space-y-2">
          <select id="tierEventId" class="w-full px-3 py-2 rounded text-sm">
            <option value="">Pilih Event...</option>
          </select>
          <input type="text" id="tierName" placeholder="Tier Name (e.g. VIP, Regular)" class="w-full px-3 py-2 rounded text-sm">
          <div class="flex gap-2">
            <input type="number" id="tierPrice" placeholder="Price" class="flex-1 px-3 py-2 rounded text-sm">
            <input type="number" id="tierQuota" placeholder="Quota (e.g. 15)" class="flex-1 px-3 py-2 rounded text-sm">
          </div>
          <button class="btn btn-gold w-full" onclick="createTier()">➕ Add Tier</button>
          <div id="createTierResult" class="text-sm"></div>
        </div>
      </div>
    </div>

    <!-- Quota Reset -->
    <div class="bg-card border border-border rounded-xl p-4">
      <h3 class="text-md font-bold text-gold mb-3">🔄 Reset Quota (for War Tiket Demo)</h3>
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <label class="text-xs text-gray-400">Tier ID</label>
          <input type="number" id="resetTierId" placeholder="Tier ID" class="w-full px-3 py-2 rounded text-sm">
        </div>
        <div class="flex-1">
          <label class="text-xs text-gray-400">New Quota</label>
          <input type="number" id="resetQuota" placeholder="e.g. 15" class="w-full px-3 py-2 rounded text-sm">
        </div>
        <button class="btn btn-primary" onclick="resetQuota()">Reset</button>
      </div>
      <div id="resetQuotaResult" class="text-sm mt-2"></div>
    </div>

    <!-- RBAC Test -->
    <div class="bg-card border border-border rounded-xl p-4">
      <h3 class="text-md font-bold text-primary mb-3">🔐 RBAC Permission Test</h3>
      <p class="text-xs text-gray-400 mb-2">Tes apakah role saat ini bisa INSERT ke tabel events (hanya ADMIN yang seharusnya bisa).</p>
      <button class="btn btn-primary" onclick="rbacTest()">🧪 Test INSERT Permission</button>
      <div id="rbacResult" class="text-sm mt-2"></div>
    </div>
  </div>`;

  loadAdminEvents();
}

async function loadAdminEvents() {
  try {
    const res = await api('GET', '/api/events?limit=50');
    if (res.success) {
      const sel = $('tierEventId');
      if (sel) {
        sel.innerHTML = `<option value="">Pilih Event...</option>` +
          res.data.map(e => `<option value="${e.event_id}">${esc(e.event_name)} (${esc(e.city)})</option>`).join('');
      }
    }
  } catch (e) { /* */ }
}

async function createEvent() {
  const body = {
    event_name: $('newEventName')?.value,
    venue: $('newVenue')?.value,
    city: $('newCity')?.value,
    region: $('newRegion')?.value,
    event_date: $('newEventDate')?.value,
  };
  if (!body.event_name || !body.venue || !body.city || !body.event_date) return alert('Semua field wajib diisi!');
  try {
    const res = await api('POST', '/api/events', body);
    $('createEventResult').innerHTML = res.success
      ? `<span class="text-emerald">✅ Event #${res.data.event_id} created! Node: ${res.handledByNode}</span>`
      : `<span class="text-crimson">❌ ${res.message}</span>`;
    if (res.success) loadAdminEvents();
  } catch (e) { $('createEventResult').innerHTML = `<span class="text-crimson">❌ ${e.message}</span>`; }
}

async function createTier() {
  const eventId = $('tierEventId')?.value;
  if (!eventId) return alert('Pilih event dulu!');
  const body = {
    tier_name: $('tierName')?.value,
    price: parseFloat($('tierPrice')?.value),
    total_quota: parseInt($('tierQuota')?.value),
  };
  if (!body.tier_name || !body.price || !body.total_quota) return alert('Semua field wajib!');
  try {
    const res = await api('POST', `/api/events/${eventId}/tiers`, body);
    $('createTierResult').innerHTML = res.success
      ? `<span class="text-emerald">✅ Tier "${res.data.tier_name}" added! Quota: ${res.data.total_quota}</span>`
      : `<span class="text-crimson">❌ ${res.message}</span>`;
  } catch (e) { $('createTierResult').innerHTML = `<span class="text-crimson">❌ ${e.message}</span>`; }
}

async function resetQuota() {
  const tierId = $('resetTierId')?.value;
  const quota = $('resetQuota')?.value;
  if (!tierId || quota === '') return alert('Tier ID dan Quota wajib!');
  try {
    const res = await api('PUT', `/api/events/tiers/${tierId}/quota`, { available_quota: parseInt(quota) });
    $('resetQuotaResult').innerHTML = res.success
      ? `<span class="text-emerald">✅ Tier #${tierId} quota reset to ${res.data.available_quota}</span>`
      : `<span class="text-crimson">❌ ${res.message}</span>`;
  } catch (e) { $('resetQuotaResult').innerHTML = `<span class="text-crimson">❌ ${e.message}</span>`; }
}

async function rbacTest() {
  try {
    const res = await api('POST', '/api/events/rbac-test');
    $('rbacResult').innerHTML = res.permitted
      ? `<span class="text-emerald">✅ ${res.message}</span>`
      : `<span class="text-crimson">🚫 ${res.message}</span>`;
  } catch (e) { $('rbacResult').innerHTML = `<span class="text-crimson">❌ ${e.message}</span>`; }
}

// ============= TAB 4: UAS DuckDB Staging Prep =============
function renderUASTab() {
  const main = $('mainContent');
  main.innerHTML = `<div class="fade-in space-y-6">
    <div class="bg-card border border-border rounded-xl p-4">
      <h2 class="text-lg font-bold text-gold mb-2">📦 UAS DuckDB Staging — Data Export</h2>
      <p class="text-xs text-gray-400 mb-4">Export batch data dari tabel perang untuk diimpor ke DuckDB (Data Lake → Star Schema).</p>

      <div id="uasSummary" class="mb-4"><div class="text-gray-500 text-sm">Loading summary...</div></div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${['bookings', 'booking_tickets', 'payment_transactions'].map(table => `
          <div class="bg-bg border border-border rounded-lg p-3">
            <h4 class="font-bold text-primary text-sm mb-2">${table}</h4>
            <div class="space-y-2">
              <div class="flex gap-2">
                <select id="export_format_${table}" class="flex-1 px-2 py-1 rounded text-xs">
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
                <input type="number" id="export_limit_${table}" value="10000" class="w-24 px-2 py-1 rounded text-xs" placeholder="Limit">
              </div>
              <button class="btn btn-primary btn-sm w-full" onclick="exportTable('${table}')">📥 Export</button>
            </div>
            <div id="export_preview_${table}" class="mt-2"></div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Preview -->
    <div class="bg-card border border-border rounded-xl p-4">
      <h3 class="text-md font-bold text-gold mb-3">🔍 Data Preview</h3>
      <div class="flex gap-2 mb-3">
        ${['bookings', 'booking_tickets', 'payment_transactions'].map(t => `
          <button class="btn btn-sm bg-bg text-gray-400 border border-border" onclick="previewUAS('${t}')">${t}</button>`).join('')}
      </div>
      <div id="uasPreviewTable"><div class="text-gray-500 text-sm">Klik tabel di atas untuk preview.</div></div>
    </div>
  </div>`;

  loadUASSummary();
}

async function loadUASSummary() {
  try {
    const res = await api('GET', '/api/analyst/summary');
    if (res.success) {
      const d = res.data;
      $('uasSummary').innerHTML = `
        <div class="grid grid-cols-3 gap-3 text-center">
          ${Object.entries(d.table_counts).map(([t, c]) => `
            <div class="bg-bg border border-border rounded-lg p-3">
              <div class="text-2xl font-bold text-gold">${Number(c).toLocaleString('id-ID')}</div>
              <div class="text-xs text-gray-400">${t}</div>
            </div>`).join('')}
        </div>`;
    }
  } catch (e) { $('uasSummary').innerHTML = `<div class="text-crimson text-sm">Error: ${e.message}</div>`; }
}

async function exportTable(table) {
  const format = $(`export_format_${table}`)?.value || 'json';
  const limit = $(`export_limit_${table}`)?.value || 10000;
  const preview = $(`export_preview_${table}`);

  try {
    if (format === 'csv') {
      // Download as file
      const url = `${API}/api/analyst/export?table=${table}&format=csv&limit=${limit}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${table}_export.csv`;

      // Need to add session header - use fetch instead
      const response = await fetch(url, { headers: headers() });
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.click();
      URL.revokeObjectURL(blobUrl);
      if (preview) preview.innerHTML = `<span class="text-emerald text-xs">✅ CSV downloaded!</span>`;
    } else {
      const res = await api('GET', `/api/analyst/export?table=${table}&format=json&limit=${limit}`);
      if (res.success) {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${table}_export.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (preview) preview.innerHTML = `<span class="text-emerald text-xs">✅ JSON downloaded (${res.count} rows)!</span>`;
      }
    }
  } catch (e) {
    if (preview) preview.innerHTML = `<span class="text-crimson text-xs">❌ ${e.message}</span>`;
  }
}

async function previewUAS(table) {
  const area = $('uasPreviewTable');
  area.innerHTML = '<div class="text-gray-500 text-sm">Loading...</div>';

  try {
    const res = await api('GET', `/api/analyst/preview/${table}?limit=10`);
    if (res.success && res.data.length > 0) {
      const cols = Object.keys(res.data[0]);
      area.innerHTML = `
        <div class="text-xs text-gray-400 mb-2">${table} — Showing 10 of ${Number(res.total).toLocaleString('id-ID')} rows</div>
        <div class="overflow-x-auto"><table>
          <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${res.data.map(row => `<tr>${cols.map(c => `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
    } else {
      area.innerHTML = '<div class="text-gray-500 text-sm">Tidak ada data.</div>';
    }
  } catch (e) {
    area.innerHTML = `<div class="text-crimson text-sm">Error: ${e.message}</div>`;
  }
}

// ============= INIT =============
$('targetNodeSelect').addEventListener('change', (e) => {
  state.targetNode = e.target.value || null;
});

// Enter key on login
$('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('loginUsername').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginPassword').focus(); });

// Initial setup
updateUserDisplay();
renderTabs();
switchTab('landing');
refreshCluster();
setInterval(refreshCluster, 10000);
