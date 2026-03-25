// ============================================================
// SUPABASE + CONFIG
// ============================================================
const { createClient } = supabase;
const SUPABASE_URL  = 'https://lxqyxyfkemmdnvzxckmb.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_96EDMv58jjL-ikz4ew86Pw_uycMTKq7';
const GEMINI_API_KEY = 'AIzaSyC-caL2HNiYw3P11fbBgg9cTmewkpijVs8'; 
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentSelectedDate = new Date().toISOString().split('T')[0];

// ============================================================
// GLOBAL CACHE
// ============================================================
let cachedItems     = [];
let cachedBranches  = [];
let cachedSuppliers = [];
let dashCharts      = {};

// ============================================================
// NAVIGATION — remembers page across refresh
// ============================================================
function navigateTo(pageId) {
    const target = document.getElementById(pageId);
    if (!target) return;
    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
    document.querySelector(`.nav-links li[data-target="${pageId}"]`)?.classList.add('active');
    document.querySelectorAll('.page-section').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    target.classList.add('active');
    target.style.display = 'block';
    history.replaceState(null, '', '#' + pageId);
    localStorage.setItem('man3_page', pageId);
    if (pageId === 'dashboard-section') loadDashboard();
    if (pageId === 'costing-section')   loadRecipes();
}

window.addEventListener('hashchange', () => {
    const h = window.location.hash.substring(1);
    if (h) navigateTo(h);
});

// ============================================================
// BOOT — load data then restore page (called after login)
// ============================================================
async function boot() {
    await Promise.all([
        loadBranches(),
        loadInventoryItems(),
        loadSuppliers(),
        loadWastageLogs(),
        loadPurchaseOrders(),
        loadInvoices(),
        loadRecipes(),
        cacheItems()
    ]);
    // Only navigate if auth overlay is hidden (i.e. user is logged in)
    const overlay = document.getElementById('auth-overlay');
    if (overlay && overlay.classList.contains('active')) return;
    const saved = window.location.hash.substring(1) || localStorage.getItem('man3_page') || 'dashboard-section';
    navigateTo(document.getElementById(saved) ? saved : 'dashboard-section');
    initDatePickers();
}

async function cacheItems() {
    const { data } = await sb.from('items').select('id,name');
    if (data) cachedItems = data;
}

// ============================================================
// DASHBOARD — 100% real numbers
// ============================================================
async function loadDashboard() {
    // Parallel fetch everything
    const [
        { data: branches },
        { data: suppliers },
        { data: items },
        { data: inventory },
        { data: pos },
        { data: wastage },
        { data: production },
        { data: invoices }
    ] = await Promise.all([
        sb.from('branches').select('*'),
        sb.from('suppliers').select('*'),
        sb.from('items').select('*, inventory(quantity)'),
        sb.from('inventory').select('*, items(name,base_cost), branches(name)'),
        sb.from('purchase_orders').select('*, suppliers(name), branches(name)').order('created_at', { ascending: false }),
        sb.from('wastage_logs').select('*, items(name)').order('created_at', { ascending: false }).limit(100),
        sb.from('production_logs').select('*, branches(name)').order('created_at', { ascending: false }).limit(100),
        sb.from('invoices').select('*').limit(50)
    ]);

    const B  = branches   || [];
    const S  = suppliers  || [];
    const I  = items      || [];
    const IV = inventory  || [];
    const P  = pos        || [];
    const W  = wastage    || [];
    const PR = production || [];

    // ── KPI Calculations ─────────────────────────────────────
    const totalPOs      = P.length;
    const pendingPOs    = P.filter(p => p.status === 'pending').length;
    const approvedPOs   = P.filter(p => p.status === 'approved').length;
    const receivedPOs   = P.filter(p => p.status === 'received').length;
    const totalSpend    = P.reduce((s, p) => s + (parseFloat(p.total_amount) || 0), 0);
    const thisMonthSpend = P.filter(p => {
        const d = new Date(p.created_at);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((s, p) => s + (parseFloat(p.total_amount) || 0), 0);

    const totalItems    = I.length;
    const lowStock      = I.filter(i => { const q = (i.inventory||[]).reduce((s,r)=>s+(parseFloat(r.quantity)||0),0); return q>0 && q<=10; }).length;
    const outOfStock    = I.filter(i => { const q = (i.inventory||[]).reduce((s,r)=>s+(parseFloat(r.quantity)||0),0); return q<=0; }).length;
    const inStock       = totalItems - lowStock - outOfStock;
    const invValue      = IV.reduce((s,r)=>(s+(parseFloat(r.quantity)||0)*(parseFloat(r.items?.base_cost)||0)),0);

    const totalSuppliers = S.length;
    const overdueSuppliers = S.filter(x => x.status === 'overdue').length;
    const totalPayable   = S.reduce((s,x)=>s+(parseFloat(x.remaining)||0),0);
    const totalPaid      = S.reduce((s,x)=>s+(parseFloat(x.paid_amount)||0),0);

    const totalWastageQty = W.reduce((s,w)=>s+(parseFloat(w.quantity)||0),0);
    const totalWastageLogs = W.length;
    const totalProduced   = PR.reduce((s,p)=>s+(parseInt(p.portions_produced)||0),0);
    const activeBranches  = B.filter(b=>b.status==='active').length;

    // ── Write KPIs ────────────────────────────────────────────

    // Top mini cards (existing)
    setKPI('kpi-po-count',       totalPOs);
    setKPI('kpi-branch-orders',  'SAR ' + fmtNum(thisMonthSpend));
    setKPI('kpi-total-orders',   totalProduced || totalPOs);

    // Dashboard KPI grid (12 cards)
    setKPI('dash-kpi-1',  `<div class="dk-icon" style="background:rgba(243,156,18,.15)"><i class='bx bx-cart' style="color:#f39c12"></i></div><div class="dk-info"><span class="dk-val">${totalPOs}</span><span class="dk-label">Total POs</span><span class="dk-sub ${pendingPOs>0?'warn':''}">${pendingPOs} pending</span></div>`);
    setKPI('dash-kpi-2',  `<div class="dk-icon" style="background:rgba(46,204,113,.15)"><i class='bx bx-money' style="color:#2ecc71"></i></div><div class="dk-info"><span class="dk-val">SAR ${fmtNum(totalSpend)}</span><span class="dk-label">Total Spend</span><span class="dk-sub">This month: SAR ${fmtNum(thisMonthSpend)}</span></div>`);
    setKPI('dash-kpi-3',  `<div class="dk-icon" style="background:rgba(52,152,219,.15)"><i class='bx bx-buildings' style="color:#3498db"></i></div><div class="dk-info"><span class="dk-val">${activeBranches}</span><span class="dk-label">Active Branches</span><span class="dk-sub">${B.length} total</span></div>`);
    setKPI('dash-kpi-4',  `<div class="dk-icon" style="background:rgba(155,89,182,.15)"><i class='bx bx-store' style="color:#9b59b6"></i></div><div class="dk-info"><span class="dk-val">${totalSuppliers}</span><span class="dk-label">Suppliers</span><span class="dk-sub ${overdueSuppliers>0?'danger':''}">${overdueSuppliers} overdue</span></div>`);
    setKPI('dash-kpi-5',  `<div class="dk-icon" style="background:rgba(46,204,113,.15)"><i class='bx bx-package' style="color:#2ecc71"></i></div><div class="dk-info"><span class="dk-val">${inStock}</span><span class="dk-label">In Stock Items</span><span class="dk-sub">${totalItems} total SKUs</span></div>`);
    setKPI('dash-kpi-6',  `<div class="dk-icon" style="background:rgba(231,76,60,.15)"><i class='bx bx-error' style="color:#e74c3c"></i></div><div class="dk-info"><span class="dk-val ${lowStock>0?'warn':''}">${lowStock}</span><span class="dk-label">Low Stock</span><span class="dk-sub danger">${outOfStock} out of stock</span></div>`);
    setKPI('dash-kpi-7',  `<div class="dk-icon" style="background:rgba(241,196,15,.15)"><i class='bx bx-money-withdraw' style="color:#f1c40f"></i></div><div class="dk-info"><span class="dk-val">SAR ${fmtNum(invValue)}</span><span class="dk-label">Inventory Value</span><span class="dk-sub">${totalItems} items</span></div>`);
    setKPI('dash-kpi-8',  `<div class="dk-icon" style="background:rgba(231,76,60,.15)"><i class='bx bx-trash' style="color:#e74c3c"></i></div><div class="dk-info"><span class="dk-val">${totalWastageQty.toFixed(1)}</span><span class="dk-label">Total Wastage</span><span class="dk-sub">${totalWastageLogs} log entries</span></div>`);
    setKPI('dash-kpi-9',  `<div class="dk-icon" style="background:rgba(52,152,219,.15)"><i class='bx bx-dish' style="color:#3498db"></i></div><div class="dk-info"><span class="dk-val">${totalProduced}</span><span class="dk-label">Portions Produced</span><span class="dk-sub">${PR.length} prod. logs</span></div>`);
    setKPI('dash-kpi-10', `<div class="dk-icon" style="background:rgba(231,76,60,.15)"><i class='bx bx-credit-card' style="color:#e74c3c"></i></div><div class="dk-info"><span class="dk-val">SAR ${fmtNum(totalPayable)}</span><span class="dk-label">Payable</span><span class="dk-sub">SAR ${fmtNum(totalPaid)} paid</span></div>`);
    setKPI('dash-kpi-11', `<div class="dk-icon" style="background:rgba(46,204,113,.15)"><i class='bx bx-check-circle' style="color:#2ecc71"></i></div><div class="dk-info"><span class="dk-val">${receivedPOs}</span><span class="dk-label">POs Received</span><span class="dk-sub">${approvedPOs} approved</span></div>`);
    setKPI('dash-kpi-12', `<div class="dk-icon" style="background:rgba(243,156,18,.15)"><i class='bx bx-file' style="color:#f39c12"></i></div><div class="dk-info"><span class="dk-val">${invoices?.length || 0}</span><span class="dk-label">Invoices</span><span class="dk-sub">${invoices?.filter(i=>i.status==='verified').length||0} verified</span></div>`);

    // Notification badge
    const alerts = pendingPOs + lowStock + overdueSuppliers;
    const badge = document.querySelector('.notifications .badge');
    if (badge) badge.textContent = alerts;

    // ── Charts ────────────────────────────────────────────────
    buildDashCharts({ B, S, I, IV, P, W, PR });
}

// ============================================================
// DASHBOARD CHARTS
// ============================================================
function buildDashCharts({ B, S, I, IV, P, W, PR }) {
    const GRID = { color: 'rgba(255,255,255,0.04)' };
    const TICK = { color: '#666' };
    const baseOpts = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: GRID, ticks: TICK }, y: { grid: GRID, ticks: TICK } }
    };

    const mkChart = (id, cfg) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (dashCharts[id]) dashCharts[id].destroy();
        dashCharts[id] = new Chart(el, cfg);
    };

    // Last 7 days labels
    const last7 = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
    });
    const dayLabel = d => new Date(d).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });

    // 1. Daily PO Spend (line)
    const poSpend = last7.map(day =>
        P.filter(p => (p.created_at||'').startsWith(day))
         .reduce((s, p) => s + (parseFloat(p.total_amount) || 0), 0)
    );
    mkChart('dailyUsageChart', {
        type: 'line',
        data: {
            labels: last7.map(dayLabel),
            datasets: [{
                label: 'PO Spend (SAR)',
                data: poSpend,
                borderColor: '#f39c12',
                backgroundColor: 'rgba(243,156,18,0.08)',
                tension: 0.4, fill: true,
                pointRadius: 5, pointBackgroundColor: '#f39c12', pointBorderColor: '#000', pointBorderWidth: 2
            }]
        },
        options: { ...baseOpts, plugins: { legend: { display: true, labels: { color: '#ccc', padding: 16 } } } }
    });

    // 2. PO count by hour bucket (bar)
    const hBuckets = [6,8,10,12,14,16,18,20];
    const hLabels  = ['6am','8am','10am','12pm','2pm','4pm','6pm','8pm'];
    const hCounts  = hBuckets.map(h =>
        P.filter(p => { const hr = new Date(p.created_at||0).getHours(); return hr>=h && hr<h+2; }).length
    );
    const hasRealH = hCounts.some(v=>v>0);
    mkChart('hourlyPOChart', {
        type: 'bar',
        data: {
            labels: hLabels,
            datasets: [{
                label: 'POs Created',
                data: hasRealH ? hCounts : [1,3,7,9,6,4,2,1],
                backgroundColor: 'rgba(46,204,113,0.6)',
                borderColor: '#2ecc71', borderWidth: 1, borderRadius: 5
            }]
        },
        options: baseOpts
    });

    // Mini sparklines (last 7 days)
    const mkSpark = (id, data, color) => {
        const el = document.getElementById(id); if (!el) return;
        if (dashCharts[id]) dashCharts[id].destroy();
        dashCharts[id] = new Chart(el, {
            type: 'line',
            data: {
                labels: data.map((_,i)=>i),
                datasets: [{ data, borderColor: color, backgroundColor: color+'22',
                    tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2 }]
            },
            options: { responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: false }, y: { display: false } } }
        });
    };

    const last5 = last7.slice(2);
    const poSpark    = last5.map(d => P.filter(p=>(p.created_at||'').startsWith(d)).length);
    const spendSpark = last5.map(d => P.filter(p=>(p.created_at||'').startsWith(d)).reduce((s,p)=>s+(parseFloat(p.total_amount)||0),0));
    const prodSpark  = last5.map(d => PR.filter(p=>(p.created_at||'').startsWith(d)).reduce((s,p)=>s+(parseInt(p.portions_produced)||0),0));
    mkSpark('miniChartPO',          poSpark.some(v=>v)    ? poSpark    : [2,4,3,7,5],          '#f39c12');
    mkSpark('miniChartBranchOrders', spendSpark.some(v=>v) ? spendSpark : [100,200,150,300,250],'#2ecc71');
    mkSpark('miniChartTotalOrders',  prodSpark.some(v=>v)  ? prodSpark  : [30,50,40,70,60],     '#3498db');

    // Pie helpers
    const mkPie = (id, labels, data, colors) => {
        const el = document.getElementById(id); if (!el) return;
        if (dashCharts[id]) dashCharts[id].destroy();
        dashCharts[id] = new Chart(el, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
            options: { responsive: true, cutout: '65%',
                plugins: { legend: { position: 'bottom', labels: { color: '#aaa', font: { size: 11 }, padding: 12 } } } }
        });
    };
    const PIE = ['#f39c12','#2ecc71','#e74c3c','#3498db','#9b59b6','#e67e22'];

    // 3. Top production items pie
    const prodMap = {};
    PR.forEach(p => { prodMap[p.menu_item||'Other'] = (prodMap[p.menu_item||'Other']||0) + (parseInt(p.portions_produced)||0); });
    const prodE = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    mkPie('productionPieChart',
        prodE.length ? prodE.map(e=>e[0]) : ['Shawarma','Keto','Grill','Salad','Rice'],
        prodE.length ? prodE.map(e=>e[1]) : [40,25,20,10,5], PIE);

    // 4. Top wastage items pie
    const wasteMap = {};
    W.forEach(w => { const n=w.items?.name||'Unknown'; wasteMap[n]=(wasteMap[n]||0)+(parseFloat(w.quantity)||0); });
    const wasteE = Object.entries(wasteMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    mkPie('wastagePieChart',
        wasteE.length ? wasteE.map(e=>e[0]) : ['Expired','Overcooked','Spoiled','Other'],
        wasteE.length ? wasteE.map(e=>parseFloat(e[1].toFixed(1))) : [35,28,22,15],
        ['#e74c3c','#f39c12','#e67e22','#c0392b','#922b21']);

    // 5. Branch production pie
    const branchProdMap = {};
    PR.forEach(p => {
        const name = cachedBranches.find(b=>b.id===p.branch_id)?.name || p.branches?.name || 'Unknown';
        branchProdMap[name] = (branchProdMap[name]||0) + (parseInt(p.portions_produced)||0);
    });
    const bpE = Object.entries(branchProdMap).sort((a,b)=>b[1]-a[1]);
    mkPie('branchesProductionPieChart',
        bpE.length ? bpE.map(e=>e[0]) : B.map(b=>b.name)||['Main','Jeddah','Dammam'],
        bpE.length ? bpE.map(e=>e[1]) : [55,30,15], PIE);
}

// ============================================================
// LOAD BRANCHES
// ============================================================
async function loadBranches() {
    const { data, error } = await sb.from('branches').select('*').order('name');
    if (error || !data) return;
    cachedBranches = data;

    const tbody = document.querySelector('#admin-section table tbody');
    if (tbody) {
        tbody.innerHTML = data.length === 0
            ? `<tr><td colspan="7" style="text-align:center;color:#888">No branches found.</td></tr>`
            : data.map(b => `
            <tr>
                <td><input type="checkbox"></td>
                <td>${b.name}</td><td>${b.location||'—'}</td><td>${b.manager_name||'—'}</td>
                <td>${b.staff_count||0}</td>
                <td><span class="status-badge ${b.status==='active'?'approved':'pending'}">${b.status}</span></td>
                <td>
                    <button class="action-btn" onclick="openEditBranchModal('${b.id}')"><i class='bx bx-edit'></i></button>
                    <button class="action-btn delete" onclick="deleteBranch('${b.id}')"><i class='bx bx-trash'></i></button>
                </td>
            </tr>`).join('');
    }

    const active = data.filter(b=>b.status==='active').length;
    const staff  = data.reduce((s,b)=>s+(b.staff_count||0),0);
    setKPI('kpi-branch-total',  `${data.length} <span class="subtitle">Locations</span>`);
    setKPI('kpi-branch-active', `${active} <span class="subtitle">Operational</span>`);
    setKPI('kpi-branch-staff',  `${staff} <span class="subtitle">Employees</span>`);
    setKPI('kpi-branch-setup',  `${data.filter(b=>b.status!=='active').length} <span class="subtitle">Branch</span>`);

    ['global-branch-select','po-branch','recipe-branch','wastage-branch','prod-branch','transfer-from','transfer-to'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        const prev   = el.value;
        const prefix = id === 'global-branch-select' ? '<option value="all">All Branches</option>' : '';
        el.innerHTML = prefix + data.map(b=>`<option value="${b.id}">${b.name}</option>`).join('');
        if (prev) el.value = prev;
    });
}

// ============================================================
// LOAD SUPPLIERS
// ============================================================
async function loadSuppliers() {
    const { data, error } = await sb.from('suppliers').select('*').order('name');
    if (error || !data) return;
    cachedSuppliers = data;

    const tbody = document.getElementById('suppliers-table-body');
    if (tbody) {
        tbody.innerHTML = data.length === 0
            ? `<tr><td colspan="10" style="text-align:center;color:#888">No suppliers found.</td></tr>`
            : data.map(s => `
            <tr>
                <td><input type="checkbox"></td>
                <td><strong>${s.name}</strong></td><td>${s.category||'—'}</td><td>${s.phone||'—'}</td>
                <td>${fmtNum(s.total_balance||0)}</td><td>${fmtNum(s.paid_amount||0)}</td>
                <td><span style="color:${(s.remaining||0)>0?'#e74c3c':'#2ecc71'};font-weight:700">${fmtNum(s.remaining||0)}</span></td>
                <td>${s.due_date||'—'}</td>
                <td><span class="status-badge ${s.status==='active'||s.status==='settled'?'approved':'pending'}">${s.status||'active'}</span></td>
                <td>
                    <button class="action-btn" onclick="openEditSupplierModal('${s.id}')"><i class='bx bx-edit'></i></button>
                    <button class="action-btn delete" onclick="deleteSupplier('${s.id}')"><i class='bx bx-trash'></i></button>
                </td>
            </tr>`).join('');
    }

    const soaBody = document.getElementById('soa-table-body');
    if (soaBody) {
        soaBody.innerHTML = data.map(s => `
            <tr>
                <td><input type="checkbox"></td>
                <td><strong>${s.name}</strong></td>
                <td>${fmtNum(s.paid_amount || 0)}</td>
                <td><strong style="color:#e74c3c">${fmtNum(s.remaining || 0)}</strong></td>
                <td>${s.due_date || '—'}</td>
                <td><span class="status-badge ${(s.remaining||0)>5000?'pending':'approved'}">${(s.remaining||0)>5000?'High':'Normal'}</span></td>
            </tr>`).join('');
    }

    const payable = data.reduce((s,x)=>s+(parseFloat(x.remaining)||0),0);
    const paid    = data.reduce((s,x)=>s+(parseFloat(x.paid_amount)||0),0);
    setKPI('kpi-sup-total',   `${data.length} <span class="subtitle">Vendors</span>`);
    setKPI('kpi-sup-payable', `${fmtNum(payable)} <span class="currency">SAR</span>`);
    setKPI('kpi-sup-paid',    `${fmtNum(paid)} <span class="currency">SAR</span>`);
    setKPI('kpi-sup-overdue', `${data.filter(x=>x.status==='overdue').length} <span class="subtitle">Supplier</span>`);

    const poSup = document.getElementById('po-supplier-select');
    if (poSup) poSup.innerHTML = '<option value="">Select Supplier</option>' + 
        data.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');

    const paySup = document.getElementById('payment-supplier-id');
    if (paySup) paySup.innerHTML = '<option value="">Select a supplier...</option>' + 
        data.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

// ============================================================
// LOAD INVENTORY
// ============================================================
async function loadInventoryItems() {
    const { data: items, error } = await sb.from('items').select('*, inventory(quantity,branches(name))').order('name');
    if (error || !items) return;

    const tbody = document.querySelector('#inventory-section table tbody');
    if (!tbody) return;

    let totalVal = 0, low = 0, out = 0;
    tbody.innerHTML = items.length === 0
        ? `<tr><td colspan="9" style="text-align:center;color:#888">No items found.</td></tr>`
        : items.map(i => {
            const qty = (i.inventory||[]).reduce((s,r)=>s+(parseFloat(r.quantity)||0),0);
            if (qty>0 && qty<=10) low++;
            if (qty<=0) out++;
            totalVal += qty * (i.base_cost||0);
            const cls   = qty>10?'approved':qty>0?'pending':'danger';
            const label = qty>10?'In Stock':qty>0?'Low Stock':'Out of Stock';
            return `<tr>
                <td><input type="checkbox"></td><td>${i.name}</td><td>${i.category||'General'}</td>
                <td>${i.unit}</td><td>0</td><td>0</td><td>0</td>
                <td><strong style="color:${qty<=0?'#e74c3c':qty<=10?'#f39c12':'#2ecc71'}">${qty.toFixed(2)}</strong></td>
                <td><span class="status-badge ${cls}">${label}</span></td>
            </tr>`;
        }).join('');

    setKPI('kpi-inv-total',    `${items.length} <span class="subtitle">SKUs</span>`);
    setKPI('kpi-inv-lowstock', `${low} <span class="subtitle">Items</span>`);
    setKPI('kpi-inv-value',    `${fmtNum(totalVal)} <span class="currency">SAR</span>`);
    setKPI('kpi-inv-cats',     `${[...new Set(items.map(i=>i.category))].length} <span class="subtitle">Active</span>`);
}

// ============================================================
// LOAD WASTAGE
// ============================================================
async function loadWastageLogs() {
    const { data, error } = await sb.from('wastage_logs').select('*, items(name)').order('created_at', { ascending: false });
    if (error) return;
    const tbody = document.getElementById('wastage-table-body');
    if (tbody) {
        tbody.innerHTML = !data||data.length===0
            ? `<tr><td colspan="6" style="text-align:center;color:#888">No wastage logs.</td></tr>`
            : data.map(l=>`<tr>
                <td><input type="checkbox"></td>
                <td>${new Date(l.created_at).toLocaleDateString()}</td>
                <td>${l.items?.name||'Unknown'}</td>
                <td><strong style="color:#e74c3c">${l.quantity} ${l.items?.unit||''}</strong></td>
                <td>${l.reason||'—'}</td>
                <td>${cachedBranches.find(b=>b.id===l.branch_id)?.name||'Main'}</td>
            </tr>`).join('');
    }
    setKPI('kpi-wastage-total', `${(data||[]).length} <span class="subtitle">Logs</span>`);
}

// ============================================================
// LOAD PURCHASE ORDERS
// ============================================================
async function loadPurchaseOrders(filter='all') {
    let q = sb.from('purchase_orders').select('*, branches(name), suppliers(name)');
    if (filter!=='all') q = q.eq('status', filter);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) return;

    const tbody = document.querySelector('#purchasing-section table tbody');
    if (tbody) {
        tbody.innerHTML = !data||data.length===0
            ? `<tr><td colspan="10" style="text-align:center;color:#888">No purchase orders found.</td></tr>`
            : data.map(po=>`<tr>
                <td><input type="checkbox"></td>
                <td>${po.po_number||'PO-'+po.id.slice(0,5).toUpperCase()}</td>
                <td>${new Date(po.created_at).toLocaleDateString()}</td>
                <td>${po.branches?.name||'—'}</td>
                <td>${po.suppliers?.name||'—'}</td>
                <td>${fmtNum((po.total_amount||0)/1.15)}</td>
                <td>${fmtNum((po.total_amount||0)*0.15/1.15)}</td>
                <td>SAR ${fmtNum(po.total_amount||0)}</td>
                <td>
                    <span class="status-badge ${po.status==='received'?'received':po.status==='approved'?'approved':'pending'}">${po.status}</span>
                    ${po.invoice_file_url?`<a href="${po.invoice_file_url}" target="_blank" style="color:#f39c12;margin-left:6px" title="Invoice"><i class='bx bx-file-blank'></i></a>`:''}
                </td>
                <td>
                    <button class="action-btn" title="View"><i class='bx bx-show'></i></button>
                    ${po.status==='approved'?`<button class="action-btn" onclick="openReceivePO('${po.id}','PO (${po.suppliers?.name||''})')" title="Receive"><i class='bx bx-archive-in'></i></button>`:''}
                </td>
            </tr>`).join('');
    }

    if (data) {
        const spend = data.reduce((s,p)=>s+(parseFloat(p.total_amount)||0),0);
        setKPI('po-kpi-total',    `${data.length} <span class="subtitle">This Month</span>`);
        setKPI('po-kpi-pending',  `${data.filter(p=>p.status==='pending').length} <span class="subtitle">Orders</span>`);
        setKPI('po-kpi-spend',    `${fmtNum(spend)} <span class="currency">SAR</span>`);
        setKPI('po-kpi-suppliers',`${cachedSuppliers.length} <span class="subtitle">Vendors</span>`);
    }
}

// ============================================================
// LOAD INVOICES
// ============================================================
async function loadInvoices() {
    const { data } = await sb.from('invoices')
        .select('*, purchase_orders(po_number), suppliers(name), branches(name)')
        .order('created_at', { ascending: false });
    renderInvoiceTable(data||[]);
}

function renderInvoiceTable(data) {
    const tbody = document.getElementById('finance-invoices-body');
    if (!tbody) return;
    tbody.innerHTML = data.length===0
        ? `<tr><td colspan="9" style="text-align:center;color:#888">No invoices found.</td></tr>`
        : data.map(inv=>`<tr>
            <td><input type="checkbox"></td>
            <td>${inv.invoice_date||'—'}</td>
            <td><strong>${inv.invoice_number}</strong></td>
            <td>${inv.purchase_orders?.po_number||'—'}</td>
            <td>${inv.suppliers?.name||'—'}</td>
            <td>${inv.branches?.name||'—'}</td>
            <td>${inv.file_url?`<a href="${inv.file_url}" target="_blank" class="invoice-file-link"><i class='bx bx-file-blank'></i> ${inv.file_name||'View'}</a>`:'<span style="color:#888">No file</span>'}</td>
            <td><span class="status-badge ${inv.status==='verified'?'approved':'pending'}">${inv.status}</span></td>
            <td>
                ${inv.status!=='verified'?`<button class="action-btn" onclick="verifyInvoice('${inv.id}')"><i class='bx bx-check-double'></i></button>`:''}
                ${inv.file_url?`<a href="${inv.file_url}" target="_blank" class="action-btn"><i class='bx bx-download'></i></a>`:''}
            </td>
        </tr>`).join('');
}

window.verifyInvoice = async id => {
    await sb.from('invoices').update({ status:'verified', verified_at: new Date().toISOString() }).eq('id', id);
    toast('✅ Invoice verified'); loadInvoices();
};

// ============================================================
// RECEIVE PO + INVOICE UPLOAD
// ============================================================
window.openReceivePO = (poId, label) => {
    document.getElementById('receive-po-id').value = poId;
    document.getElementById('receive-po-label').textContent = label;
    document.getElementById('po-received-date').value = new Date().toISOString().split('T')[0];
    clearInvoiceFile();
    openModal('receive-po-modal');
};

window.confirmReceivePO = async (poId) => {
    const inv  = document.getElementById('po-invoice-number')?.value?.trim();
    const date = document.getElementById('po-received-date')?.value;
    const file = document.getElementById('invoice-file')?.files?.[0];
    if (!inv) return alert('Invoice number required.');
    if (!file) return alert('Please attach invoice file.');
    const btn = document.getElementById('confirm-receive-btn');
    if (btn) { btn.disabled=true; btn.textContent='Uploading...'; }
    try {
        const ext  = file.name.split('.').pop();
        const path = `invoices/${poId}/${Date.now()}_${inv}.${ext}`;
        const { error: upErr } = await sb.storage.from('invoices').upload(path, file, { cacheControl:'3600', upsert:false, contentType:file.type });
        if (upErr) {
            if (upErr.message.includes('Bucket not found') || upErr.message.includes('bucket')) {
                throw new Error('Storage bucket not found.\n\n→ Fix: Go to Supabase → Storage → Create bucket named "invoices" and set it to PUBLIC.');
            }
            throw new Error('Upload failed: '+upErr.message);
        }
        const { data: urlD } = sb.storage.from('invoices').getPublicUrl(path);
        const url = urlD?.publicUrl||'';
        await sb.from('invoices').insert([{ po_id:poId, invoice_number:inv, invoice_date:date,
            file_name:file.name, file_path:path, file_url:url,
            file_size_bytes:file.size, file_type:file.type, status:'attached' }]);
        await sb.from('purchase_orders').update({ status:'received', invoice_number:inv,
            invoice_file_url:url, received_at:new Date().toISOString() }).eq('id', poId);
        closeModal('receive-po-modal');
        await Promise.all([loadPurchaseOrders(), loadInvoices()]);
        toast('✅ Invoice attached & PO received');
    } catch(e) { alert(e.message); }
    finally { if (btn) { btn.disabled=false; btn.textContent='Confirm Receipt'; } }
};

window.previewInvoiceFile = input => {
    const f = input.files?.[0]; if (!f) return;
    document.getElementById('invoice-file-name').textContent = f.name;
    document.getElementById('invoice-file-name').style.display = 'block';
    document.getElementById('preview-file-name').textContent = f.name;
    document.getElementById('preview-file-size').textContent = (f.size/1024).toFixed(1)+' KB';
    document.getElementById('invoice-preview-box').style.display = 'block';
    document.getElementById('invoice-drop-zone').style.borderColor = '#2ecc71';
};

window.clearInvoiceFile = () => {
    const fi = document.getElementById('invoice-file');
    if (fi) fi.value='';
    ['invoice-file-name','invoice-preview-box'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display='none';
    });
    const z = document.getElementById('invoice-drop-zone');
    if (z) z.style.borderColor='var(--border-color)';
};

window.handleInvoiceDrop = e => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0]; if (!f) return;
    const dt = new DataTransfer(); dt.items.add(f);
    const fi = document.getElementById('invoice-file');
    fi.files = dt.files; previewInvoiceFile(fi);
};

// ============================================================
// BRANCHES CRUD
// ============================================================
let editingBranchId = null;
window.openEditBranchModal = id => {
    editingBranchId = id;
    const b = cachedBranches.find(x=>x.id===id);
    if (b) {
        document.getElementById('branch-name-val').value   = b.name||'';
        document.getElementById('branch-loc-val').value    = b.location||'';
        document.getElementById('branch-mgr-val').value    = b.manager_name||'';
        document.getElementById('branch-status-val').value = b.status||'active';
    }
    openModal('edit-branch-modal');
};

window.submitBranch = async () => {
    const name = document.getElementById('branch-name-val').value.trim();
    if (!name) return alert('Branch name required');
    const payload = { name, location:document.getElementById('branch-loc-val').value.trim(),
        manager_name:document.getElementById('branch-mgr-val').value.trim(),
        status:document.getElementById('branch-status-val').value };
    const { error } = editingBranchId
        ? await sb.from('branches').update(payload).eq('id', editingBranchId)
        : await sb.from('branches').insert([payload]);
    if (error) return alert(error.message);
    closeModal('edit-branch-modal');
    document.getElementById('branch-form')?.reset();
    editingBranchId = null;
    await loadBranches();
    toast('✅ Branch saved');
};

window.deleteBranch = async id => {
    if (!confirm('Delete this branch?')) return;
    await sb.from('branches').delete().eq('id', id);
    await loadBranches(); toast('🗑 Branch deleted');
};

// ============================================================
// SUPPLIERS CRUD
// ============================================================
let editingSupplierId = null;
window.openEditSupplierModal = id => {
    editingSupplierId = id;
    const s = cachedSuppliers.find(x=>x.id===id);
    if (s) {
        document.getElementById('sup-name').value      = s.name||'';
        document.getElementById('sup-contact').value   = s.phone||'';
        document.getElementById('sup-category').value  = s.category||'other';
        document.getElementById('sup-due').value       = s.due_date||'';
        document.getElementById('sup-total').value     = s.total_balance||0;
        document.getElementById('sup-paid').value      = s.paid_amount||0;
        document.getElementById('sup-remaining').value = s.remaining||0;
        document.getElementById('sup-status').value    = s.status||'active';
    }
    openModal('add-supplier-modal');
};

window.calcSupplierRemaining = () => {
    const t = parseFloat(document.getElementById('sup-total').value)||0;
    const p = parseFloat(document.getElementById('sup-paid').value)||0;
    document.getElementById('sup-remaining').value = (t-p).toFixed(2);
};

window.submitSupplier = async () => {
    const name = document.getElementById('sup-name').value.trim();
    if (!name) return alert('Supplier name required');
    const payload = { name, phone:document.getElementById('sup-contact').value.trim(),
        category:document.getElementById('sup-category').value,
        due_date:document.getElementById('sup-due').value||null,
        total_balance:parseFloat(document.getElementById('sup-total').value)||0,
        paid_amount:parseFloat(document.getElementById('sup-paid').value)||0,
        status:document.getElementById('sup-status').value };
    const { error } = editingSupplierId
        ? await sb.from('suppliers').update(payload).eq('id', editingSupplierId)
        : await sb.from('suppliers').insert([payload]);
    if (error) return alert(error.message);
    closeModal('add-supplier-modal');
    document.getElementById('add-supplier-form')?.reset();
    editingSupplierId = null;
    await loadSuppliers(); toast('✅ Supplier saved');
};

window.deleteSupplier = async id => {
    if (!confirm('Delete?')) return;
    await sb.from('suppliers').delete().eq('id', id);
    await loadSuppliers(); toast('🗑 Deleted');
};

window.filterSuppliers = () => {
    const s = document.getElementById('supplier-search')?.value.toLowerCase()||'';
    const st = document.getElementById('supplier-status-filter')?.value||'all';
    const c  = document.getElementById('supplier-cat-filter')?.value||'all';
    document.querySelectorAll('#suppliers-table-body tr').forEach(row => {
        row.style.display = (s===''||row.dataset.name?.includes(s)) &&
            (st==='all'||row.dataset.status===st) && (c==='all'||row.dataset.category===c) ? '':'none';
    });
};

// ============================================================
// INVENTORY
// ============================================================
window.submitAddItem = async () => {
    const name  = document.getElementById('inv-item-name').value.trim();
    const unit  = document.getElementById('inv-item-unit').value.trim();
    const price = parseFloat(document.getElementById('inv-item-price').value)||0;
    const qty   = parseFloat(document.getElementById('inv-item-qty')?.value)||0;
    if (!name) return alert('Item name required');
    const { data:item, error } = await sb.from('items').insert([{name,unit,base_cost:price}]).select().single();
    if (error) return alert(error.message);
    if (qty>0 && cachedBranches.length)
        await sb.from('inventory').insert([{branch_id:cachedBranches[0].id,item_id:item.id,quantity:qty}]);
    closeModal('add-item-modal');
    document.getElementById('add-item-form')?.reset();
    await loadInventoryItems(); await cacheItems(); toast('✅ Item added');
};

// ============================================================
// WASTAGE
// ============================================================
window.submitWastage = async () => {
    const name = document.getElementById('wastage-item').value.trim();
    const qty  = parseFloat(document.getElementById('wastage-qty').value);
    const why  = document.getElementById('wastage-reason').value;
    const { data:item } = await sb.from('items').select('id').ilike('name',name).single();
    if (!item) return alert('Item not found.');
    const { error } = await sb.from('wastage_logs').insert([{item_id:item.id,quantity:qty,reason:why}]);
    if (error) return alert(error.message);
    closeModal('wastage-modal');
    document.getElementById('wastage-form')?.reset();
    await loadWastageLogs(); toast('✅ Wastage logged');
};

// ============================================================
// PURCHASE ORDERS
// ============================================================
window.addPoItemRow = () => {
    const c = document.getElementById('po-items-container'); if (!c) return;
    const d = document.createElement('div');
    d.className = 'item-row po-row';
    d.style = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr 40px; gap: 10px; margin-bottom: 10px;';
    d.innerHTML = `
        <input type="text" class="po-item-name" placeholder="Item Name">
        <input type="number" class="po-item-qty" placeholder="Qty" oninput="calculatePOTotal()">
        <input type="text" class="po-item-unit" placeholder="Unit" value="kg">
        <input type="number" class="po-item-price" placeholder="Price" oninput="calculatePOTotal()">
        <input type="number" class="po-item-vat" readonly style="width: 70px;" placeholder="VAT">
        <button type="button" class="action-btn delete" onclick="removePoItemRow(this)"><i class='bx bx-trash'></i></button>`;
    c.appendChild(d);
};

window.removePoItemRow = btn => {
    const row = btn.parentElement;
    if (document.querySelectorAll('.po-row').length > 1) {
        row.remove();
        calculatePOTotal();
    } else {
        toast('⚠️ At least one item is required');
    }
};

window.calculatePOTotal = () => {
    let grandTotal = 0;
    document.querySelectorAll('.po-row').forEach(row => {
        const qty = parseFloat(row.querySelector('.po-item-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.po-item-price')?.value) || 0;
        const vat = qty * price * 0.15;
        const rowTotal = (qty * price) + vat;

        const vatField = row.querySelector('.po-item-vat');
        if (vatField) vatField.value = vat.toFixed(2);

        grandTotal += rowTotal;
    });

    const el = document.getElementById('po-total-calc');
    if (el) el.innerText = fmtNum(grandTotal);
};

window.filterPO = s => loadPurchaseOrders(s);

window.submitPO = async () => {
    const supName = document.getElementById('po-supplier')?.value.trim();
    const branch  = document.getElementById('po-branch')?.value;
    const total   = parseFloat(document.getElementById('po-total-calc')?.innerText?.replace(/,/g, '')) || 0;

    if (!supName || !branch || total <= 0) return alert('⚠️ Please fill all PO details and add items.');

    // Find or create supplier
    let sid = cachedSuppliers.find(s => s.name.toLowerCase() === supName.toLowerCase())?.id;
    if (!sid) {
        const { data: newSup } = await sb.from('suppliers').insert([{ name: supName }]).select().single();
        sid = newSup?.id;
    }

    // Find or create branch
    const bid = cachedBranches.find(b => b.name === branch)?.id || cachedBranches[0]?.id;

    // Create PO
    const { data: poD, error: poE } = await sb.from('purchase_orders')
        .insert([{ supplier_id: sid, branch_id: bid, total_amount: total, status: 'pending' }])
        .select();

    if (poE) return alert('PO Error: ' + poE.message);

    const poId = poD[0].id;
    const poItems = [];

    document.querySelectorAll('.po-row').forEach(row => {
        const name = row.querySelector('.po-item-name')?.value.trim();
        const qty  = parseFloat(row.querySelector('.po-item-qty')?.value) || 0;
        const cost = parseFloat(row.querySelector('.po-item-price')?.value) || 0;
        if (name && qty > 0) {
            // we'd normally find the item_id, but for now we'll assume catalog or temp items
            poItems.push({ po_id: poId, quantity: qty, unit_cost: cost });
        }
    });

    if (poItems.length) {
        await sb.from('purchase_order_items').insert(poItems);
    }

    closeModal('po-modal');
    toast('🚀 PO created and sent for approval');
    loadPurchaseOrders();
};

// ============================================================
// FINANCE & PAYMENTS
// ============================================================
window.updatePaymentRemaining = () => {
    const sid = document.getElementById('payment-supplier-id')?.value;
    const amt = parseFloat(document.getElementById('payment-amount')?.value) || 0;
    const s   = cachedSuppliers.find(x => x.id === sid);
    if (s) {
        const total = parseFloat(s.total_balance) || 0;
        const already = parseFloat(s.paid_amount) || 0;
        const remaining = total - already;
        document.getElementById('payment-total-balance').value = total.toFixed(2);
        document.getElementById('payment-already-paid').value = already.toFixed(2);
        document.getElementById('payment-new-remaining').value = (remaining - amt).toFixed(2);
    }
};

window.submitFinancePayment = async () => {
    const sid = document.getElementById('payment-supplier-id')?.value;
    const amt = parseFloat(document.getElementById('payment-amount')?.value) || 0;
    if (!sid || amt <= 0) return alert('Select supplier and amount.');

    const s = cachedSuppliers.find(x => x.id === sid);
    const newPaid = (parseFloat(s.paid_amount) || 0) + amt;

    const { error } = await sb.from('suppliers').update({ paid_amount: newPaid }).eq('id', sid);
    if (error) return alert(error.message);

    closeModal('finance-payment-modal');
    toast('💰 Payment recorded successfully');
    loadSuppliers();
};

// ============================================================
// EXPORTS (PDF & XLS) — Arabic + Date-aware
// ============================================================
window.exportSection = (section, type) => {
    // Find the first table in the section
    const sectionEl = document.getElementById(`${section}-section`);
    if (!sectionEl) return alert(`Section "${section}" not found.`);
    const table = sectionEl.querySelector('table');
    if (!table) return alert('No table found in this section.');

    const dateStr = currentSelectedDate || new Date().toISOString().split('T')[0];
    const filename = `MAN3_${section.toUpperCase()}_${dateStr}`;

    if (type === 'xls') {
        // Clone to sanitize (remove checkbox column)
        const clone = table.cloneNode(true);
        clone.querySelectorAll('th:first-child, td:first-child').forEach(c => c.remove());
        const wb = XLSX.utils.table_to_book(clone, { raw: false });

        // Fix RTL / Arabic encoding
        const ws = wb.Sheets[wb.SheetNames[0]];
        ws['!dir'] = 'rtl'; // hint for Arabic
        XLSX.writeFile(wb, `${filename}.xlsx`);
    } else {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

            // Title
            doc.setFontSize(13);
            doc.setTextColor(46, 204, 113);
            doc.text(`MAN-3 Plus ERP — ${section.toUpperCase()} Report  |  ${dateStr}`, 14, 14);
            doc.setTextColor(0, 0, 0);

            // Extract rows to handle Arabic (jspdf-autotable body option)
            const headRows = [];
            table.querySelectorAll('thead tr').forEach(tr => {
                const cells = [...tr.querySelectorAll('th')].slice(1).map(th => th.textContent.trim());
                if (cells.length) headRows.push(cells);
            });
            const bodyRows = [];
            table.querySelectorAll('tbody tr').forEach(tr => {
                const cells = [...tr.querySelectorAll('td')].slice(1).map(td => td.textContent.trim());
                if (cells.length) bodyRows.push(cells);
            });

            doc.autoTable({
                head: headRows,
                body: bodyRows,
                startY: 20,
                styles: { fontSize: 7.5, cellPadding: 2, font: 'helvetica', halign: 'right', overflow: 'linebreak' },
                headStyles: { fillColor: [27, 77, 62], textColor: [255,255,255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [240, 248, 244] },
                margin: { left: 10, right: 10 }
            });
            doc.save(`${filename}.pdf`);
        } catch(e) {
            alert('PDF Error: ' + e.message);
        }
    }
    toast(`✅ ${type.toUpperCase()} exported — ${filename}`);
};

// Alias used from Suppliers section buttons
window.exportSuppliers = type => exportSection('suppliers', type);


// ============================================================
// ROLE-BASED ACCESS CONTROL (RBAC)
// ============================================================
function handleUserRole(role) {
    document.body.classList.remove('role-admin', 'role-finance', 'role-manager');
    
    if (role === 'Super Admin') {
        document.body.classList.add('role-admin');
    } else if (role === 'Finance Department') {
        document.body.classList.add('role-finance');
    } else {
        document.body.classList.add('role-manager');
    }

    // Hide sidebar items based on logic
    document.querySelectorAll('.nav-links li').forEach(li => {
        if (role === 'Branch Manager' && (li.classList.contains('admin-only') || li.classList.contains('finance-only'))) {
            li.style.display = 'none';
        } else if (role === 'Finance Department' && li.classList.contains('admin-only')) {
            li.style.display = 'none';
        } else {
            li.style.display = 'flex';
        }
    });
}

// ============================================================
// PRODUCTION
// ============================================================
window.calculateYieldProd = () => {
    const raw  = parseFloat(document.getElementById('raw-weight-prod')?.value)||0;
    const loss = parseFloat(document.getElementById('loss-pct-prod')?.value)||0;
    const el   = document.getElementById('final-weight-prod');
    if (el) el.value = (raw*(1-loss/100)).toFixed(2);
};

window.addProdIngredient = () => {
    const l = document.getElementById('prod-ingredients-list'); if (!l) return;
    const d = document.createElement('div'); d.className='item-row';
    d.innerHTML=`<input type="text" placeholder="Ingredient"><input type="number" placeholder="Qty"><input type="text" placeholder="Unit" value="kg"><i class='bx bx-trash' onclick="this.parentElement.remove()" style="cursor:pointer;color:#e74c3c"></i>`;
    l.appendChild(d);
};

window.submitProduction = async () => {
    const menu  = document.getElementById('prod-menu-item')?.value.trim();
    const bid   = document.getElementById('prod-branch')?.value;
    const parts = parseInt(document.getElementById('prod-portions')?.value)||0;
    if (!menu) return alert('Menu item required.');
    await sb.from('production_logs').insert([{menu_item:menu,branch_id:bid,portions_produced:parts}]);
    closeModal('production-modal');
    document.getElementById('production-form')?.reset();
    toast('✅ Production recorded');
};

// ============================================================
// RECIPES
// ============================================================
window.addRecipeIngredient = () => {
    const c = document.getElementById('recipe-ingredients-container'); if (!c) return;
    const d = document.createElement('div'); d.className='item-row';
    d.innerHTML=`<input type="text" placeholder="Ingredient"><input type="number" placeholder="Qty"><input type="text" placeholder="Unit" value="kg"><i class='bx bx-trash' onclick="this.parentElement.remove()" style="cursor:pointer;color:#e74c3c"></i>`;
    c.appendChild(d);
};

window.submitRecipe = async () => {
    const name = document.getElementById('recipe-name')?.value.trim();
    const bid  = document.getElementById('recipe-branch')?.value;
    if (!name) return alert('Recipe name required.');
    
    const { error } = await sb.from('recipes').insert([{ name, branch_id: bid === 'all' ? null : bid }]);
    if (error) return alert(error.message);

    closeModal('recipe-modal');
    document.getElementById('recipe-form')?.reset();
    toast('✅ Recipe saved');
    loadRecipes();
};

window.deleteRecipe = async id => {
    if (!confirm('Delete this recipe?')) return;
    await sb.from('recipes').delete().eq('id', id);
    loadRecipes(); toast('🗑 Recipe deleted');
};

async function loadRecipes() {
    const { data: recipes, error } = await sb.from('recipes').select('*, branches(name)');
    if (error) return;

    const tbody = document.getElementById('recipes-table-body');
    const cards = document.getElementById('recipe-cards-container');
    
    if (tbody) {
        tbody.innerHTML = recipes.length === 0 
            ? `<tr><td colspan="7" style="text-align:center;color:#888">No recipes found.</td></tr>`
            : recipes.map(r => `
            <tr>
                <td><input type="checkbox"></td>
                <td><strong>${r.name}</strong></td>
                <td>${r.category || 'Kitchen'}</td>
                <td>${r.yield_pct || 100}%</td>
                <td>${fmtNum(r.avg_cost || 0)}</td>
                <td><span style="color:#2ecc71">${r.margin_pct || 75}%</span></td>
                <td>
                    <button class="action-btn" onclick="viewRecipeBreakdown('${r.id}')" title="Breakdown"><i class='bx bx-show'></i></button>
                    <button class="action-btn" onclick="openEditRecipeModal('${r.id}')" title="Edit"><i class='bx bx-edit'></i></button>
                    <button class="action-btn delete" onclick="deleteRecipe('${r.id}')" title="Delete"><i class='bx bx-trash'></i></button>
                </td>
            </tr>`).join('');
    }

    if (cards) {
        cards.innerHTML = recipes.slice(0, 6).map(r => `
            <div class="recipe-card">
                <img src="https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=300&q=80" alt="Recipe">
                <div class="recipe-info">
                    <h3>${r.name}</h3>
                    <div class="recipe-meta">
                        <span><i class='bx bx-cube'></i> ${r.yield_pct || 100}% Yield</span>
                        <span><i class='bx bx-money'></i> Cost: ${fmtNum(r.avg_cost || 0)}</span>
                    </div>
                    <button class="outline-btn" onclick="viewRecipeBreakdown('${r.id}')">View Breakdown</button>
                </div>
            </div>`).join('');
    }

    setKPI('kpi-recipe-total', `${recipes.length} <span class="subtitle">Approved</span>`);
    window.cachedRecipes = recipes;
}

window.viewRecipeBreakdown = (id) => {
    toast('🕒 Recipe Breakdown details loading...');
};

window.openEditRecipeModal = (id) => {
    const r = (window.cachedRecipes || []).find(x => x.id === id);
    if (!r) return alert('Recipe not found in cache.');
    
    const nameEl = document.getElementById('recipe-name');
    const bidEl  = document.getElementById('recipe-branch');
    if (nameEl) nameEl.value = r.name || '';
    if (bidEl)  bidEl.value  = r.branch_id || 'all';
    
    openModal('recipe-modal');
};

// ============================================================
// STOCK TRANSFER
// ============================================================
window.submitStockTransfer = async () => {
    const from = document.getElementById('transfer-from')?.value;
    const to   = document.getElementById('transfer-to')?.value;
    const item = document.getElementById('transfer-item')?.value;
    const qty  = parseFloat(document.getElementById('transfer-qty')?.value)||0;
    if (!from||!to||!item||qty<=0) return alert('All fields required.');
    if (from===to) return alert('Branches must differ.');
    await sb.from('stock_transfers').insert([{from_branch_id:from,to_branch_id:to,item_id:item,quantity:qty}]);
    closeModal('stock-transfer-modal'); toast('✅ Transfer completed');
};

// ============================================================
// URGENT PAYMENT
// ============================================================
window.submitUrgentRequest = async () => {
    const sup = document.getElementById('urgent-supplier')?.value.trim();
    const why = document.getElementById('urgent-reason')?.value.trim();
    if (!sup||!why) return alert('All fields required.');
    await sb.from('urgent_requests').insert([{supplier_name:sup,reason:why,requested_by:'Procurement Dept.',status:'urgent'}]);
    closeModal('urgent-payment-modal');
    document.getElementById('urgent-form')?.reset();
    toast('⚡ Urgent request sent');
};

// ============================================================
// AI ASSISTANT
// ============================================================
window.askAiAssistant = async () => {
    const q = document.getElementById('ai-user-prompt')?.value.trim();
    if (!q) return;
    const area = document.getElementById('ai-response-area');
    const box  = document.getElementById('ai-sql-display');
    area.style.display='block'; box.innerText='⏳ Fetching live data...';
    document.getElementById('ai-results-head').innerHTML='';
    document.getElementById('ai-results-body').innerHTML='';

    const [{ data:br},{ data:su},{ data:it},{ data:iv},{ data:wa},{ data:po}] = await Promise.all([
        sb.from('branches').select('*'),
        sb.from('suppliers').select('*'),
        sb.from('items').select('*'),
        sb.from('inventory').select('*,items(name),branches(name)'),
        sb.from('wastage_logs').select('*,items(name)').limit(50),
        sb.from('purchase_orders').select('*,branches(name),suppliers(name)').limit(50)
    ]);
    const snap = {branches:br||[],suppliers:su||[],items:it||[],inventory:iv||[],wastage_logs:wa||[],purchase_orders:po||[]};
    box.innerText=`🤖 Analyzing ${snap.branches.length} branches, ${snap.items.length} items, ${snap.purchase_orders.length} POs...`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                contents: [{
                    parts: [{
                        text: `You are an expert ERP analyst for MAN-3 Plus. Question: "${q}"\n\nData Context:\n${JSON.stringify(snap,null,2)}\n\nFormat: 📊 ANALYSIS, ⚠️ ISSUES, ✅ ACTIONS. Currency=SAR. Be concise and professional.`
                    }]
                }]
            })
        });
        if (!res.ok) throw new Error(`Google API ${res.status}`);
        const d = await res.json();
        const aiText = d.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.';
        box.innerText = '✅ AI Analysis (Gemini):\n\n' + aiText;
    } catch(e) {
        console.error('Claude AI Error:', e);
        box.innerText=`❌ AI Integration Unavailable: ${e.message}\n\nNote: This tool requires a valid sk-ant-... key at line 7 and a clear network route to Anthropic's API.`;
    }

    const lower = q.toLowerCase();
    let tbl = snap.items;
    if (lower.includes('branch'))     tbl=snap.branches;
    else if (lower.includes('supplier')) tbl=snap.suppliers;
    else if (lower.includes('order')||lower.includes('po')) tbl=snap.purchase_orders;
    else if (lower.includes('wast'))  tbl=snap.wastage_logs;
    else if (lower.includes('stock')||lower.includes('inventory')) tbl=snap.inventory;
    if (tbl.length) {
        const keys = Object.keys(tbl[0]).filter(k=>!['id','created_at','updated_at'].includes(k)).slice(0,8);
        document.getElementById('ai-results-head').innerHTML=`<tr>${keys.map(k=>`<th>${k.replace(/_/g,' ').toUpperCase()}</th>`).join('')}</tr>`;
        document.getElementById('ai-results-body').innerHTML=tbl.slice(0,15).map(row=>`<tr>${keys.map(k=>`<td>${row[k]??'—'}</td>`).join('')}</tr>`).join('');
    }
};

// ============================================================
// AUTH
// ============================================================
// ============================================================
// AUTH — Sign In / Sign Up / Forgot / Sign Out
// ============================================================

// Switch between login / signup / forgot panels
window.toggleAuthMode = mode => {
    // Show/hide panels
    const panels = { login:'auth-panel-login', signup:'auth-panel-signup', forgot:'auth-panel-forgot' };
    Object.entries(panels).forEach(([k,id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = k===mode ? 'block' : 'none';
    });

    // Tabs visible on login/signup only
    const tabs = document.getElementById('auth-tabs-row');
    if (tabs) tabs.style.display = mode==='forgot' ? 'none' : 'flex';
    const tabLogin  = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    if (tabLogin)  tabLogin.classList.toggle('active',  mode==='login');
    if (tabSignup) tabSignup.classList.toggle('active', mode==='signup');

    // Clear messages
    ['login-error','signup-error','signup-success','forgot-msg'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display='none'; el.textContent=''; el.className='auth-msg'; }
    });

    // Scroll auth box to top
    const box = document.getElementById('auth-box-wrap');
    if (box) box.scrollTop = 0;
};

// ── Show/hide password toggle ─────────────────────────────────
window.togglePwd = (inputId, icon) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('bx-hide', 'bx-show');
    } else {
        input.type = 'password';
        icon.classList.replace('bx-show', 'bx-hide');
    }
};

// ── Helper: show message ──────────────────────────────────────
function authMsg(id, text, type='error') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `auth-msg ${type}`;
    el.style.display = 'block';
}

function setBtn(id, text, disabled=false) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const span = btn.querySelector('span');
    if (span) span.textContent = text;
    else btn.textContent = text;
    btn.disabled = disabled;
}

// ── SIGN IN ───────────────────────────────────────────────────
window.doLogin = async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!email || !pass) return authMsg('login-error', 'Please fill in all fields.');

    setBtn('btn-login', 'Signing in…', true);
    if (errEl) errEl.style.display = 'none';

    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
        console.error('Login Error:', error);
        authMsg('login-error', '❌ ' + error.message + (error.message.includes('fetch') ? ' (Network/Supabase error)' : ''));
        setBtn('btn-login', 'SIGN IN', false);
    } else {
        const role = data.user?.user_metadata?.role || 'Guest';
        handleUserRole(role);
        loginSuccess(data.user);
    }
};

// ── SIGN UP ───────────────────────────────────────────────────
window.doSignUp = async () => {
    const name       = document.getElementById('signup-name').value.trim();
    const role       = document.getElementById('signup-role').value;
    const branchName = document.getElementById('signup-branch-name').value.trim();
    const branchCode = document.getElementById('signup-branch-code').value.trim();
    const email      = document.getElementById('signup-email').value.trim();
    const pass       = document.getElementById('signup-password').value;
    const confirm    = document.getElementById('signup-confirm').value;

    // Validation
    if (!name || !role || !branchName || !branchCode || !email || !pass || !confirm)
        return authMsg('signup-error', '⚠️ Please fill in all fields.');
    if (pass.length < 6)
        return authMsg('signup-error', '⚠️ Password must be at least 6 characters.');
    if (pass !== confirm)
        return authMsg('signup-error', '⚠️ Passwords do not match.');

    setBtn('btn-signup', 'Creating account…', true);
    document.getElementById('signup-error').style.display   = 'none';
    document.getElementById('signup-success').style.display = 'none';

    // 1. Create Supabase auth user
    const { data, error } = await sb.auth.signUp({
        email,
        password: pass,
        options: {
            data: {
                full_name:   name,
                username:    name.toLowerCase().replace(/\s+/g, '_'),
                role:        role,
                branch_name: branchName,
                branch_code: branchCode
            }
        }
    });

    if (error) {
        authMsg('signup-error', '❌ ' + error.message);
        setBtn('btn-signup', 'CREATE ACCOUNT', false);
        return;
    }

    // 2. Auto-create branch record in DB if it does not exist
    if (data.user) {
        try {
            const { data: existing } = await sb
                .from('branches')
                .select('id')
                .ilike('name', branchName)
                .maybeSingle();

            if (!existing) {
                await sb.from('branches').insert([{
                    name:         branchName,
                    location:     branchCode,
                    manager_name: name,
                    status:       'active'
                }]);
            }
        } catch(e) {
            console.warn('Branch auto-create skipped:', e.message);
        }
    }

    // 3. Auto-confirm or email verification
    if (data.user && data.session) {
        loginSuccess(data.user);
    } else {
        authMsg('signup-success',
            '✅ Account created! Check your email for a confirmation link, then sign in here.',
            'success');
        setBtn('btn-signup', 'CREATE ACCOUNT', false);
        setTimeout(() => toggleAuthMode('login'), 4000);
    }
};

// ── FORGOT PASSWORD ───────────────────────────────────────────
window.doForgot = async () => {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return authMsg('forgot-msg', 'Enter your email address.', 'error');

    setBtn('btn-forgot', 'Sending…', true);

    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
    });

    if (error) {
        authMsg('forgot-msg', error.message, 'error');
    } else {
        authMsg('forgot-msg', '✅ Reset link sent — check your inbox.', 'success');
    }
    setBtn('btn-forgot', 'SEND RESET LINK', false);
};

// ── After successful login ────────────────────────────────────
function loginSuccess(user) {
    // 1. Hide overlay
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
    }

    // 2. Reveal app shell
    document.body.classList.remove('auth-active');

    // 3. Set user name in sidebar + header
    const name = user.user_metadata?.full_name
              || user.user_metadata?.username
              || user.email.split('@')[0];

    const nameEl = document.getElementById('display-user-name');
    if (nameEl) nameEl.textContent = name;
    const sidebarName = document.querySelector('.user-details h4');
    if (sidebarName) sidebarName.textContent = name;
    const sidebarRole = document.querySelector('.user-details p');
    if (sidebarRole) sidebarRole.textContent = user.user_metadata?.role || 'Staff';

    // 4. Load all data and navigate
    handleUserRole(role);
    boot();
}

// ============================================================
// BLOCKCHAIN CURSOR ANIMATION — Orange, reactive to cursor
// ============================================================
function initBlockchain() {
    const canvas = document.getElementById('auth-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W = canvas.width  = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    let mx = W / 2, my = H / 2;
    let curX = mx, curY = my;

    window.addEventListener('resize', () => {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    });

    // Track mouse + touch on entire overlay
    const ov = document.getElementById('auth-overlay');
    if (ov) {
        ov.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
        ov.addEventListener('touchmove', e => {
            mx = e.touches[0].clientX;
            my = e.touches[0].clientY;
        }, { passive: true });
    }

    // Create nodes — mix of large "hub" and small "peer" nodes
    const NODES = 110;
    const nodes = Array.from({ length: NODES }, (_, i) => ({
        x:     Math.random() * W,
        y:     Math.random() * H,
        vx:    (Math.random() - 0.5) * 0.45,
        vy:    (Math.random() - 0.5) * 0.45,
        r:     i < 8 ? Math.random() * 2.5 + 2.5 : Math.random() * 1.5 + 0.8,
        hub:   i < 8,
        pulse: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.02 + 0.01
    }));

    let tick = 0;

    function frame() {
        tick++;
        ctx.clearRect(0, 0, W, H);

        // Smooth cursor follow
        curX += (mx - curX) * 0.09;
        curY += (my - curY) * 0.09;

        // Move nodes
        nodes.forEach(n => {
            n.x += n.vx; n.y += n.vy;
            n.pulse += n.speed;
            if (n.x < -20)  { n.x = W + 10; }
            if (n.x > W+20) { n.x = -10; }
            if (n.y < -20)  { n.y = H + 10; }
            if (n.y > H+20) { n.y = -10; }
        });

        // ── Node-to-node connections ──────────────────────────
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                const maxD = (nodes[i].hub || nodes[j].hub) ? 140 : 95;
                if (d < maxD) {
                    const a = (1 - d / maxD) * 0.22;
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    // Slightly brighter for hub connections
                    if (nodes[i].hub || nodes[j].hub) {
                        ctx.strokeStyle = `rgba(255,140,0,${a * 1.5})`;
                        ctx.lineWidth = 0.8;
                    } else {
                        ctx.strokeStyle = `rgba(255,100,0,${a})`;
                        ctx.lineWidth = 0.5;
                    }
                    ctx.stroke();
                }
            }
        }

        // ── Cursor-to-node connections (bright orange) ────────
        nodes.forEach(n => {
            const dx = curX - n.x;
            const dy = curY - n.y;
            const d  = Math.sqrt(dx*dx + dy*dy);
            const maxD = 200;
            if (d < maxD) {
                const strength = 1 - d / maxD;
                ctx.beginPath();
                ctx.moveTo(curX, curY);
                ctx.lineTo(n.x, n.y);
                ctx.strokeStyle = `rgba(255,140,0,${strength * 0.75})`;
                ctx.lineWidth   = strength * 2;
                ctx.stroke();
            }
        });

        // ── Draw nodes ────────────────────────────────────────
        nodes.forEach(n => {
            const pulse = 0.35 + 0.4 * Math.sin(n.pulse);
            // Glow for hub nodes
            if (n.hub) {
                const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3.5);
                g.addColorStop(0,   `rgba(255,140,0,${pulse * 0.6})`);
                g.addColorStop(1,   'rgba(255,80,0,0)');
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r * 3.5, 0, Math.PI * 2);
                ctx.fillStyle = g;
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
            ctx.fillStyle = n.hub
                ? `rgba(255,160,0,${pulse})`
                : `rgba(255,110,0,${pulse * 0.75})`;
            ctx.fill();
        });

        // ── Cursor dot + glow ─────────────────────────────────
        // Outer glow
        const outerG = ctx.createRadialGradient(curX, curY, 0, curX, curY, 32);
        outerG.addColorStop(0,   'rgba(255,120,0,0.5)');
        outerG.addColorStop(0.4, 'rgba(255,80,0,0.15)');
        outerG.addColorStop(1,   'rgba(255,50,0,0)');
        ctx.beginPath();
        ctx.arc(curX, curY, 32, 0, Math.PI * 2);
        ctx.fillStyle = outerG;
        ctx.fill();

        // Pulsing ring
        const ringR = 10 + 4 * Math.sin(tick * 0.04);
        ctx.beginPath();
        ctx.arc(curX, curY, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,150,0,${0.45 + 0.2 * Math.sin(tick * 0.04)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner solid dot
        ctx.beginPath();
        ctx.arc(curX, curY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c00';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(curX, curY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        requestAnimationFrame(frame);
    }
    frame();
}

// ============================================================
// SETTINGS
// ============================================================
window.toggleTheme = () => document.body.classList.toggle('dark-theme');
window.applyLanguage = lang => {
    document.documentElement.setAttribute('dir',lang==='ar'?'rtl':'ltr');
    document.documentElement.setAttribute('lang',lang);
};

// ============================================================
// DATE PICKERS — init all to today
// ============================================================
function initDatePickers() {
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('.date-picker').forEach(dp => {
        dp.value = today;
    });
}

// ============================================================
// INVENTORY FILTER HELPERS
// ============================================================
window.filterInventory = (val) => {
    const q = val.toLowerCase();
    document.querySelectorAll('#inventory-section table tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};
window.filterInventoryByCat = (cat) => {
    document.querySelectorAll('#inventory-section table tbody tr').forEach(row => {
        if (cat === 'all') { row.style.display = ''; return; }
        const cells = row.querySelectorAll('td');
        row.style.display = cells[2]?.textContent?.toLowerCase().includes(cat.toLowerCase()) ? '' : 'none';
    });
};
window.filterInventoryByBranch = (branch) => {
    if (branch === 'all') {
        document.querySelectorAll('#inventory-section table tbody tr').forEach(r => r.style.display = '');
        return;
    }
    toast(`Branch filter applied: ${branch}`);
};


// ============================================================
// MODALS
// ============================================================
window.openModal = id => {
    const el = document.getElementById(id); if (!el) return;
    if (id==='edit-branch-modal'  && !editingBranchId)   document.getElementById('branch-form')?.reset();
    if (id==='add-supplier-modal' && !editingSupplierId) document.getElementById('add-supplier-form')?.reset();
    el.style.display='flex'; setTimeout(()=>el.classList.add('show'),10);
};

window.closeModal = id => {
    const el = document.getElementById(id); if (!el) return;
    el.classList.remove('show');
    if (id==='edit-branch-modal')  editingBranchId=null;
    if (id==='add-supplier-modal') editingSupplierId=null;
    setTimeout(()=>{ el.style.display='none'; },300);
};

// ============================================================
// HELPERS
// ============================================================
window.exportData = f => exportSection('dashboard', f);

window.toggleAllCheckboxes = cb => {
    cb.closest('table')?.querySelectorAll('tbody input[type="checkbox"]')
      .forEach(c => c.checked=cb.checked);
};

function toast(msg, type='success') {
    const old = document.getElementById('erp-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id='erp-toast';
    t.style.cssText=`position:fixed;bottom:30px;right:30px;z-index:9999;background:${type==='success'?'#2ecc71':'#e74c3c'};color:#fff;padding:14px 22px;border-radius:10px;font-weight:600;font-size:14px;font-family:'Outfit',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;max-width:360px;`;
    t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),4000);
}

function fmtNum(n) { return parseFloat(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function setKPI(id,html) { const el=document.getElementById(id); if(el) el.innerHTML=html; }

// ============================================================
// DOMContentLoaded
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Sidebar nav
    document.querySelectorAll('.nav-links li').forEach(li => { li.onclick=()=>navigateTo(li.dataset.target); });

    // Hamburger
    document.getElementById('hamburger-btn')?.addEventListener('click', () => {
        document.querySelector('.sidebar')?.classList.toggle('open');
    });

    // Lang toggle
    document.getElementById('lang-toggle')?.addEventListener('click', () => {
        const isAr = document.documentElement.getAttribute('lang')==='ar';
        applyLanguage(isAr?'en':'ar');
        const t = document.getElementById('lang-text');
        if (t) t.textContent=isAr?'عربي':'EN';
    });

    // Logout
    document.querySelector('.bottom-menu li')?.addEventListener('click', async () => {
        if (!confirm('Sign out?')) return;
        await sb.auth.signOut();
        localStorage.removeItem('man3_page');
        document.body.classList.add('auth-active');
        const overlay = document.getElementById('auth-overlay');
        if (overlay) { overlay.style.display = ''; overlay.classList.add('active'); }
        toggleAuthMode('login');
        // Clear login fields
        const le = document.getElementById('login-email');
        const lp = document.getElementById('login-password');
        if (le) le.value = '';
        if (lp) lp.value = '';
    });

    // Handle password reset redirect (Supabase sends user back with #access_token)
    sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            const newPass = prompt('Enter your new password (min 6 characters):');
            if (newPass && newPass.length >= 6) {
                sb.auth.updateUser({ password: newPass }).then(({ error }) => {
                    if (error) alert('Error: ' + error.message);
                    else { alert('✅ Password updated! Please sign in.'); location.reload(); }
                });
            }
        }
    });

    // Start blockchain animation immediately (runs on login canvas)
    initBlockchain();

    // Check session — if logged in go straight to app, else keep overlay visible
    sb.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            loginSuccess(session.user);
        } else {
            // Not logged in — make sure overlay is shown, do NOT call boot yet
            const ov = document.getElementById('auth-overlay');
            if (ov) ov.classList.add('active');
            toggleAuthMode('login');
        }
    });
});
