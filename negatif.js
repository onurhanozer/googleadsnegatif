/**
 * WHATSAPP + SATIŞ ODAKLI NEGATİF KELİME SCRIPT
 * Gelişmiş verimsizlik tespiti - BÜYÜK/KÜÇÜK HARFE DUYARLI
 * © 2025
 */

function main() {

  /* ==== GENEL AYARLAR ==== */
  const DAYS_BACK              = 60;
  const MIN_COST               = 50.0;      // ₺ (daha düşük eşik)
  const MIN_CLICKS             = 10;        // Daha düşük eşik
  const WHATSAPP_TO_SALE_RATIO = 10;        // 10 WA ≈ 1 satış
  const MAX_CPA                = 400.0;     // ₺
  
  // Verimsizlik kriterleri
  const MIN_SIGNIFICANCE_DAYS  = 14;        // En az 14 gün aktif
  const HIGH_COST_THRESHOLD    = 200.0;     // ₺200+ harcama = yüksek risk
  const ZERO_CONV_MIN_COST     = 80.0;      // Hiç dönüşümü olmayan minimum maliyet
  const BAD_CTR_THRESHOLD      = 0.005;     // %0.5'den düşük CTR
  const HIGH_CPC_MULTIPLIER    = 5.0;       // Ortalama CPC'nin 5 katı

  const SALES_CONV_1  = 'Google Shopping App Purchase';
  const SALES_CONV_2  = 'Purchase - Enhanced - 3';
  const WHATSAPP_CONV = 'Whatsapp Click';

  const EMAIL_TO      = 'onurhanozer@gmail.com';
  const TEST_MODE     = false;
  const NEG_LIST_NAME = 'Script Liste';

  Logger.log('=== GELİŞMİŞ VERİMSİZLİK ANALİZİ BAŞLADI ===');
  Logger.log('Test Modu: ' + (TEST_MODE ? 'AÇIK' : 'KAPALI'));
  Logger.log('MOD: BÜYÜK/KÜÇÜK HARFE DUYARLI - Aynı kelimeler farklı yazımlarıyla ayrı analiz edilecek');

  const data = collectEnhancedData(DAYS_BACK, SALES_CONV_1, SALES_CONV_2, WHATSAPP_CONV);
  
  const analysis = performAdvancedAnalysis(data, {
    minCost: MIN_COST,
    minClicks: MIN_CLICKS,
    whatsappRatio: WHATSAPP_TO_SALE_RATIO,
    maxCPA: MAX_CPA,
    minSignificanceDays: MIN_SIGNIFICANCE_DAYS,
    highCostThreshold: HIGH_COST_THRESHOLD,
    zeroCostThreshold: ZERO_CONV_MIN_COST,
    badCTRThreshold: BAD_CTR_THRESHOLD,
    highCPCMultiplier: HIGH_CPC_MULTIPLIER
  });

  let sync = {added:0, removed:0};
  if (!TEST_MODE && analysis.wastefulTerms.length > 0){
    sync = rebuildSharedNegList(analysis.wastefulTerms, NEG_LIST_NAME);
  }

  sendEnhancedReport(analysis, EMAIL_TO, TEST_MODE, sync, NEG_LIST_NAME);
}

/* ---------- Gelişmiş veri toplama (CASE-SENSITIVE) ---------- */
function collectEnhancedData(daysBack, conv1, conv2, waConv) {
  const data = {};
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - daysBack);

  const s = Utilities.formatDate(start, 'UTC', 'yyyy-MM-dd');
  const e = Utilities.formatDate(end, 'UTC', 'yyyy-MM-dd');

  /* 1) Günlük detaylı metrikler */
  const q1 = `
    SELECT search_term_view.search_term,
           segments.search_term_match_type,
           segments.date,
           metrics.clicks,
           metrics.cost_micros,
           metrics.impressions
    FROM   search_term_view
    WHERE  segments.date BETWEEN '${s}' AND '${e}'
      AND  segments.search_term_match_type IN ('EXACT','NEAR_EXACT')
      AND  metrics.impressions > 0`;

  const it1 = AdsApp.report(q1).rows();
  while (it1.hasNext()) {
    const r = it1.next();
    const term = r['search_term_view.search_term'];
    const date = r['segments.date'];
    
    if (!term || term.length < 2) continue;

    // BÜYÜK/KÜÇÜK HARFE DUYARLI - Terimi olduğu gibi kullan
    const termKey = term; // Artık normalize etmiyoruz, tam halini key olarak kullanıyoruz

    if (!data[termKey]) {
      data[termKey] = {
        originalTerm: term,
        clicks: 0, cost: 0, impressions: 0, totalSales: 0, wa: 0,
        activeDays: new Set(), firstSeen: date, lastSeen: date,
        dailyStats: {}
      };
    }

    const clicks = +r['metrics.clicks'] || 0;
    const cost = (+r['metrics.cost_micros'] || 0) / 1e6;
    const impressions = +r['metrics.impressions'] || 0;

    data[termKey].clicks += clicks;
    data[termKey].cost += cost;
    data[termKey].impressions += impressions;
    
    if (impressions > 0) {
      data[termKey].activeDays.add(date);
    }
    
    // İlk ve son görülme tarihleri
    if (date < data[termKey].firstSeen) data[termKey].firstSeen = date;
    if (date > data[termKey].lastSeen) data[termKey].lastSeen = date;

    // Günlük istatistikler
    if (!data[termKey].dailyStats[date]) {
      data[termKey].dailyStats[date] = {clicks: 0, cost: 0, impressions: 0};
    }
    data[termKey].dailyStats[date].clicks += clicks;
    data[termKey].dailyStats[date].cost += cost;
    data[termKey].dailyStats[date].impressions += impressions;
  }

  /* 2) Dönüşüm verileri */
  const q2 = `
    SELECT search_term_view.search_term,
           segments.search_term_match_type,
           segments.conversion_action_name,
           metrics.all_conversions,
           metrics.conversions_value
    FROM   search_term_view
    WHERE  segments.date BETWEEN '${s}' AND '${e}'
      AND  segments.search_term_match_type IN ('EXACT','NEAR_EXACT')
      AND  metrics.all_conversions > 0`;

  const it2 = AdsApp.report(q2).rows();
  while (it2.hasNext()) {
    const r = it2.next();
    const term = r['search_term_view.search_term'];
    
    // BÜYÜK/KÜÇÜK HARFE DUYARLI - Terimi olduğu gibi kullan
    const termKey = term;
    
    if (!data[termKey]) continue;

    const name = r['segments.conversion_action_name'];
    const conversions = +r['metrics.all_conversions'] || 0;
    const value = +r['metrics.conversions_value'] || 0;

    if (name === conv1 || name === conv2) {
      data[termKey].totalSales += conversions;
      data[termKey].salesValue = (data[termKey].salesValue || 0) + value;
    } else if (name === waConv) {
      data[termKey].wa += conversions;
    }
  }

  return data;
}

/* ---------- Gelişmiş performans analizi (CASE-SENSITIVE) ---------- */
function performAdvancedAnalysis(data, config) {
  const wastefulTerms = [];
  const successfulTerms = [];
  const suspiciousTerms = [];
  
  let totalCost = 0, totalSales = 0, totalWA = 0, totalClicks = 0, totalImpressions = 0;
  let avgCPC = 0, avgCTR = 0;

  // Genel ortalamalar için ilk geçiş
  let termCount = 0;
  for (const term in data) {
    const r = data[term];
    totalCost += r.cost;
    totalSales += r.totalSales;
    totalWA += r.wa;
    totalClicks += r.clicks;
    totalImpressions += r.impressions;
    termCount++;
  }
  
  avgCPC = totalClicks > 0 ? totalCost / totalClicks : 0;
  avgCTR = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  // Detaylı analiz - HER KELİME EŞİT MUAMELE (CASE-SENSITIVE)
  for (const termKey in data) {
    const r = data[termKey];
    const activeDays = r.activeDays.size;
    const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
    const cpc = r.clicks > 0 ? r.cost / r.clicks : 0;
    
    const totalValue = r.totalSales + (r.wa / config.whatsappRatio);
    const cpa = totalValue > 0 ? r.cost / totalValue : null;
    const roas = (r.salesValue || 0) > 0 ? (r.salesValue || 0) / r.cost : 0;

    // Verimsizlik kriterleri - HER KELİME İÇİN AYNI
    const reasons = [];
    let riskLevel = 'LOW';
    
    // Temel filtreler
    if (r.cost < config.minCost && r.clicks < config.minClicks) continue;
    if (activeDays < config.minSignificanceDays && r.cost < config.highCostThreshold) continue;

    // Kritik verimsizlik durumları
    if (totalValue === 0 && r.cost >= config.zeroCostThreshold) {
      reasons.push('Hiç dönüşüm yok (₺' + r.cost.toFixed(0) + ' harcama)');
      riskLevel = 'HIGH';
    }
    
    // CPA kontrolü - TÜM KELİMELER İÇİN AYNI KRITER
    if (cpa !== null && cpa > config.maxCPA) {
      reasons.push('CPA çok yüksek (₺' + cpa.toFixed(0) + ')');
      riskLevel = 'HIGH';
    }
    
    // CTR çok düşükler
    if (ctr < config.badCTRThreshold && r.cost >= config.minCost) {
      reasons.push('CTR çok düşük (%' + (ctr * 100).toFixed(3) + ')');
      riskLevel = riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM';
    }
    
    // CPC çok yüksek olanlar
    if (cpc > avgCPC * config.highCPCMultiplier && r.cost >= config.minCost) {
      reasons.push('CPC çok yüksek (₺' + cpc.toFixed(2) + ' vs ort. ₺' + avgCPC.toFixed(2) + ')');
      riskLevel = riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM';
    }

    // Çok tıklayıp dönüştürmeyen
    if (r.clicks > 50 && totalValue === 0) {
      reasons.push('50+ tık, hiç dönüşüm yok');
      riskLevel = 'HIGH';
    }

    // Kısa sürede çok harcama
    if (activeDays < 7 && r.cost > config.highCostThreshold) {
      reasons.push('7 günde ₺' + r.cost.toFixed(0) + ' harcama');
      riskLevel = 'HIGH';
    }

    // Sınıflandırma
    if (reasons.length > 0) {
      const termData = {
        term: r.originalTerm, // Orijinal terimi göster (case-sensitive)
        cost: r.cost,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: ctr,
        cpc: cpc,
        cpa: cpa,
        totalValue: totalValue,
        sales: r.totalSales,
        wa: r.wa,
        activeDays: activeDays,
        reasons: reasons,
        riskLevel: riskLevel,
        priority: calculatePriority(r.cost, cpa, totalValue, reasons.length)
      };

      if (riskLevel === 'HIGH') {
        wastefulTerms.push(termData);
      } else {
        suspiciousTerms.push(termData);
      }
    } else if (totalValue > 0) {
      successfulTerms.push({
        term: r.originalTerm,
        totalValue: totalValue,
        sales: r.totalSales,
        wa: r.wa,
        cost: r.cost,
        cpa: cpa,
        roas: roas
      });
    }
  }

  // Sıralama
  wastefulTerms.sort((a, b) => b.priority - a.priority);
  suspiciousTerms.sort((a, b) => b.cost - a.cost);
  successfulTerms.sort((a, b) => b.totalValue - a.totalValue);

  const wastefulCost = wastefulTerms.reduce((sum, t) => sum + t.cost, 0);

  return {
    wastefulTerms: wastefulTerms,
    suspiciousTerms: suspiciousTerms,
    successfulTerms: successfulTerms,
    summary: {
      totalTerms: Object.keys(data).length,
      totalCost: totalCost,
      totalSales: totalSales,
      totalWhatsApp: totalWA,
      wastefulCost: wastefulCost,
      potentialSavings: wastefulCost,
      wastefulCount: wastefulTerms.length,
      suspiciousCount: suspiciousTerms.length,
      successfulCount: successfulTerms.length,
      avgCPC: avgCPC,
      avgCTR: avgCTR
    }
  };
}

/* ---------- Öncelik hesaplama (basitleştirilmiş) ---------- */
function calculatePriority(cost, cpa, totalValue, reasonCount) {
  let priority = 0;
  
  // Maliyet ağırlığı
  priority += Math.min(cost / 100, 10) * 10;
  
  // CPA ağırlığı
  if (cpa !== null && cpa > 400) {
    priority += Math.min((cpa - 400) / 100, 10) * 5;
  }
  
  // Dönüşüm eksikliği
  if (totalValue === 0) {
    priority += 25;
  }
  
  // Problem sayısı
  priority += reasonCount * 5;
  
  return Math.max(priority, 0);
}

/* ---------- Paylaşılan listeyi güncelle (CASE-SENSITIVE) ---------- */
function rebuildSharedNegList(terms, listName) {
  const it = AdsApp.negativeKeywordLists()
           .withCondition('Name="' + listName.replace(/"/g, '\\"') + '"').get();
  const list = it.hasNext() ? it.next()
           : AdsApp.newNegativeKeywordListBuilder().withName(listName).build().getResult();

  let removed = 0;
  const iter = list.negativeKeywords().get();
  while (iter.hasNext()) { 
    iter.next().remove(); 
    removed++; 
  }

  let added = 0;
  // Tüm yüksek riskli terimleri ekle (limit: 200)
  const termsToAdd = terms.filter(t => t.riskLevel === 'HIGH').slice(0, 200);
  
  termsToAdd.forEach(function(termData) {
    try { 
      // Orijinal halini (case-sensitive) negatif listeye ekle
      list.addNegativeKeyword('[' + termData.term + ']'); 
      added++; 
    } catch(e) {
      Logger.log('Negatif kelime eklenirken hata: ' + termData.term + ' - ' + e.message);
    }
  });

  Logger.log('Liste temizlendi (–' + removed + '), yeniden yazıldı (+' + added + ').');
  return {added: added, removed: removed};
}

/* ---------- Gelişmiş HTML raporu (CASE-SENSITIVE) ---------- */
function sendEnhancedReport(analysis, emailTo, testMode, sync, listName) {
  const summary = analysis.summary;
  const dateStr = Utilities.formatDate(new Date(), 'Europe/Istanbul', 'dd.MM.yyyy HH:mm');

  function createBox(bg, border, content) {
    return '<div style="background:' + bg + ';padding:12px 14px;border-left:5px solid ' + border + ';margin:18px 0;">' + content + '</div>';
  }

  function createKPI(label, value, color) {
    return '<td style="width:20%;padding:12px;text-align:center;">' +
           '<div style="font-size:14px;color:#6c757d">' + label + '</div>' +
           '<div style="font-size:20px;font-weight:600;color:' + color + '">' + value + '</div></td>';
  }

  function createHeader(title) {
    return '<div style="background:linear-gradient(90deg,#0d6efd,#6610f2);padding:16px 24px;border-radius:6px;margin-bottom:20px;color:#fff;">' +
           '<h2 style="margin:0;font-size:22px;">' + title + '</h2>' +
           '</div>';
  }

  let html = '<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:900px;margin:0 auto;">' +
             createHeader('🎯 Negatif Kelime Raporu (CASE-SENSITIVE)') +
             '<p style="margin:4px 0 18px;color:#666;">' + dateStr + '</p>';

  // Durum kutusu
  html += testMode
    ? createBox('#fff3cd', '#ffc107', '<strong>TEST MODU:</strong> Liste değişmedi.')
    : createBox('#e7f5ff', '#0d6efd', '<strong>Liste güncellendi</strong> → ' +
       '<span style="color:#198754">' + sync.added + ' eklendi</span> / ' +
       '<span style="color:#dc3545">' + sync.removed + ' silindi</span> ' +
       '<em>(' + listName + ')</em>');

  // Uyarı kutusu
  html += createBox('#d4edda', '#198754', '<strong>✅ BÜYÜK/KÜÇÜK HARFE DUYARLI:</strong> Arama terimleri tam eşleşme ve yakın varyasyonlarıyla analiz edildi.');

  // KPI tablosu
  html += '<table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:6px;margin-bottom:22px;"><tr>' +
          createKPI('Toplam Harcama', '₺' + summary.totalCost.toFixed(0), '#0d6efd') +
          createKPI('Gerçek Satış', summary.totalSales.toFixed(0), '#198754') +
          createKPI('WhatsApp Lead', summary.totalWhatsApp.toFixed(0), '#fd7e14') +
          createKPI('Tasarruf', '₺' + summary.potentialSavings.toFixed(0), '#dc3545') +
          createKPI('Ort. CPC', '₺' + summary.avgCPC.toFixed(2), '#6f42c1') +
          '</tr><tr>' +
          createKPI('Toplam Terim', summary.totalTerms, '#6c757d') +
          createKPI('Negatiflenen', summary.wastefulCount, '#dc3545') +
          createKPI('Şüpheli', summary.suspiciousCount, '#fd7e14') +
          createKPI('Başarılı', summary.successfulCount, '#198754') +
          createKPI('Ort. CTR', (summary.avgCTR * 100).toFixed(2) + '%', '#0d6efd') +
          '</tr></table>';

  // Verimsiz terimler
  if (analysis.wastefulTerms.length > 0) {
    html += '<h3 style="margin:20px 0 8px;color:#dc3545;">🔴 Negatiflenecek Terimler (İlk 20)</h3>' +
            '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
            '<tr style="background:#dee2e6;"><th style="padding:8px;">Terim</th>' +
            '<th style="padding:8px;text-align:center;">Kelime</th>' +
            '<th style="padding:8px;text-align:right;">Maliyet</th>' +
            '<th style="padding:8px;text-align:right;">Tık</th>' +
            '<th style="padding:8px;text-align:right;">CTR</th>' +
            '<th style="padding:8px;text-align:right;">CPC</th>' +
            '<th style="padding:8px;text-align:left;">Sorunlar</th></tr>';
    
    analysis.wastefulTerms.slice(0, 20).forEach(function(w, i) {
      html += '<tr' + (i % 2 ? ' style="background:#f8f9fa;"' : '') + '>' +
              '<td style="padding:8px;max-width:200px;word-break:break-word;">' + w.term + '</td>' +
              '<td style="padding:8px;text-align:center;">' + w.term.trim().split(/\s+/).length + '</td>' +
              '<td style="padding:8px;text-align:right;color:#dc3545;font-weight:600;">₺' + w.cost.toFixed(0) + '</td>' +
              '<td style="padding:8px;text-align:right;">' + w.clicks + '</td>' +
              '<td style="padding:8px;text-align:right;">%' + (w.ctr * 100).toFixed(2) + '</td>' +
              '<td style="padding:8px;text-align:right;">₺' + w.cpc.toFixed(2) + '</td>' +
              '<td style="padding:8px;font-size:12px;">' + w.reasons.join(', ') + '</td></tr>';
    });
    html += '</table>';
  }

  // Şüpheli terimler
  if (analysis.suspiciousTerms.length > 0) {
    html += '<h3 style="margin:20px 0 8px;color:#fd7e14;">⚠️ Şüpheli Terimler (İlk 10)</h3>' +
            '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
            '<tr style="background:#dee2e6;"><th style="padding:8px;">Terim</th>' +
            '<th style="padding:8px;text-align:center;">Kelime</th>' +
            '<th style="padding:8px;text-align:right;">Maliyet</th>' +
            '<th style="padding:8px;">Durum</th></tr>';
    
    analysis.suspiciousTerms.slice(0, 10).forEach(function(s, i) {
      html += '<tr' + (i % 2 ? ' style="background:#f8f9fa;"' : '') + '>' +
              '<td style="padding:8px;">' + s.term + '</td>' +
                '<td style="padding:8px;text-align:center;">' + s.term.trim().split(/\s+/).length + '</td>' +
              '<td style="padding:8px;text-align:right;color:#fd7e14;">₺' + s.cost.toFixed(0) + '</td>' +
              '<td style="padding:8px;font-size:12px;">' + s.reasons.join(', ') + '</td></tr>';
    });
    html += '</table>';
  }

  // Başarılı terimler
  if (analysis.successfulTerms.length > 0) {
    html += '<h3 style="margin:20px 0 8px;color:#198754;">🟢 En Başarılı Terimler (İlk 10)</h3>' +
            '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
            '<tr style="background:#dee2e6;"><th style="padding:8px;">Terim</th>' +
            '<th style="padding:8px;text-align:center;">Kelime</th>' +
            '<th style="padding:8px;text-align:right;">Satış</th>' +
            '<th style="padding:8px;text-align:right;">WhatsApp</th>' +
            '<th style="padding:8px;text-align:right;">CPA</th>' +
            '<th style="padding:8px;text-align:right;">ROAS</th></tr>';
    
    analysis.successfulTerms.slice(0, 10).forEach(function(s, i) {
      html += '<tr' + (i % 2 ? ' style="background:#f8f9fa;"' : '') + '>' +
              '<td style="padding:8px;">' + s.term + '</td>' +
                '<td style="padding:8px;text-align:center;">' + s.term.trim().split(/\s+/).length + '</td>' +
              '<td style="padding:8px;text-align:right;color:#198754;">' + s.sales.toFixed(1) + '</td>' +
              '<td style="padding:8px;text-align:right;color:#fd7e14;">' + s.wa.toFixed(1) + '</td>' +
              '<td style="padding:8px;text-align:right;">₺' + (s.cpa || 0).toFixed(0) + '</td>' +
              '<td style="padding:8px;text-align:right;">' + s.roas.toFixed(2) + '</td></tr>';
    });
    html += '</table>';
  }

  html += '<p style="margin-top:30px;padding:15px;background:#e9ecef;border-radius:5px;font-size:12px;color:#495057;">' +
          '🔧 Script çalışma modu: BÜYÜK/KÜÇÜK HARFE DUYARLI - Arama terimleri tam eşleşme ve yakın varyasyonlarıyla analiz edildi<br>' +
          '📊 Analiz aralığı: Son 60 gün | Min. maliyet: ₺50 | Max CPA: ₺400<br>' +
          '🔤 "iPhone" ve "iphone" farklı terimler olarak değerlendirildi<br>' +
          '⚙️ Negatif liste: "' + listName + '" | Rapor: ' + dateStr + '</p>' +
          '<p style="margin-top:10px;font-size:12px;color:#6c757d;">Bu rapor özet niteliğindedir. Detaylı veriler Google Ads arayüzünden incelenebilir.</p>';

  html += '</body></html>';

  if (!testMode) {
    MailApp.sendEmail({
      to: emailTo,
      subject: '🎯 Negatif Kelime Raporu (CASE-SENSITIVE) – ₺' + summary.potentialSavings.toFixed(0) + ' Tasarruf',
      htmlBody: html
    });
  }
  
  Logger.log('Rapor hazırlandı. CASE-SENSITIVE - Verimsiz terim sayısı: ' + analysis.wastefulTerms.length);
}
