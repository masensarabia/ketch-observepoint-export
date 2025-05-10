// ketchExport.js
(async function(){
  console.log('ketchExport.js loaded');

  // 1) Find the Ketch config.json URL
  const u = performance.getEntriesByType('resource')
    .map(r => r.name)
    .find(n => /\/config\/.*\/config\.json/.test(n));
  if (!u) {
    alert('⚠️ Open & save the Ketch consent modal first');
    return;
  }

  // 2) Fetch Ketch config + open‑cookie‑database
  const [cfg, db] = await Promise.all([
    fetch(u).then(r => r.json()),
    fetch('https://cdn.jsdelivr.net/gh/jkwakman/Open-Cookie-Database@master/open-cookie-database.json')
      .then(r => r.json())
  ]);
  const flat = Object.values(db).flat();
  const host = location.hostname.replace(/^www\./, '');

  // 3) Build cookieRows
  const cookieRows = (cfg.purposes || cfg.categories || []).flatMap(cat => {
    const catName = cat.title || cat.name || '';
    return (cat.cookies || []).map(c => {
      const name   = c.name || c.code || c.ID || '';
      const vendor = c.serviceProvider || '';
      const raw    = (flat.find(d => d.cookie === name ||
                       (d.wildcardMatch === '1' && name.indexOf(d.cookie) === 0)) || {}).domain || '';
      const m      = raw.match(/([a-z0-9\.-]+\.[a-z]{2,})(?=(?:\s|\(|$))/i);
      const dom    = vendor ? (m ? m[1] : '') : host;
      return [catName, name, dom, vendor];
    });
  });

  // 4) Build tagRows
  const tagMap = new Map();
  (cfg.purposes || cfg.categories || []).forEach(cat => {
    const catName = cat.title || cat.name || '';
    (cat.cookies || []).forEach(c => {
      const v = c.serviceProvider || '';
      if (v) tagMap.set(catName + '‖' + v, [catName, v]);
    });
  });
  const tagRows = Array.from(tagMap.values());

  // 5) Export the data to window.ketch
  window.ketch = {
    exportConsentData: async () => ({
      categories: Array.from(
        new Set(cookieRows.map(r => r[0]))
      ).map(name => ({
        name,
        cookies: cookieRows.filter(r => r[0] === name),
        tags:    tagRows.filter(r => r[0] === name)
      }))
    }),

    downloadCSVs: ({ cookieRows, tagRows, domain }) => {
      function dl(rows, fn, hd) {
        const csv = [hd, ...rows]
          .map(r => r.map(f => `"${(f||'')}"`).join(','))
          .join('\r\n');
        const b = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = fn;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      dl(cookieRows, `ketch_cookies_${domain}.csv`, ['Consent Category','Cookie Name','Cookie Domain','Vendor']);
      dl(tagRows,    `ketch_tags_${domain}.csv`,    ['Consent Category','Tag Name']);
    }
  };

  console.log('ketchExport.js ready');
})();
