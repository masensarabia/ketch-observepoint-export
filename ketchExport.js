// ketchExport.js
;(function(){
  console.log('✅ ketchExport.js loaded');

  /** 
   * Pull Ketch config + Cookie‑Database → build cookieRows, tagRows, categories, domain
   */
  async function exportConsentData() {
    // find the Ketch config JSON URL
    const u = performance.getEntriesByType("resource")
      .map(r=>r.name)
      .find(n=>/\/config\/.*\/config\.json/.test(n));
    if (!u) {
      alert("⚠️ Open & save the Ketch consent modal first");
      throw new Error("Ketch config not found");
    }

    // fetch Ketch config + Open‑Cookie‑Database
    const [cfg, db] = await Promise.all([
      fetch(u).then(r=>r.json()),
      fetch("https://cdn.jsdelivr.net/gh/jkwakman/Open-Cookie-Database@master/open-cookie-database.json").then(r=>r.json())
    ]);

    const flat = Object.values(db).flat();
    const domain = location.hostname.replace(/^www\./, "");

    // build cookieRows: [ categoryName, cookieName, cookieDomain, vendor ]
    const cookieRows = (cfg.purposes||cfg.categories||[]).flatMap(cat=>{
      const catName = cat.title||cat.name||"";
      return (cat.cookies||[]).map(c=>{
        const name   = c.name||c.code||c.ID||"";
        const vendor = c.serviceProvider||"";
        const raw    = (flat.find(d=>
          d.cookie===name
          ||(d.wildcardMatch==="1" && name.indexOf(d.cookie)===0)
        )||{}).domain||"";
        const m      = raw.match(/([a-z0-9\.-]+\.[a-z]{2,})(?=(?:\s|\(|$))/i);
        const dom    = vendor
          ? m ? m[1] : ""
          : domain;
        return [ catName, name, dom, vendor ];
      });
    });

    // build tagRows: [ categoryName, tagName ]
    const tagMap = new Map();
    (cfg.purposes||cfg.categories||[]).forEach(cat=>{
      const catName = cat.title||cat.name||"";
      (cat.cookies||[]).forEach(c=>{
        const vendor = c.serviceProvider||"";
        if (vendor) tagMap.set(catName+"‖"+vendor, [catName, vendor]);
      });
    });
    const tagRows = Array.from(tagMap.values());

    // build categories array for import/update
    const categories = Array.from(
      new Set(cookieRows.map(r=>r[0]))
    ).map(catName=>({
      name: catName,
      cookies: cookieRows.filter(r=>r[0]===catName),
      tags:    tagRows.filter(r=>r[0]===catName)
    }));

    return { categories, cookieRows, tagRows, domain };
  }

  /**
   * Download two CSVs exactly as your original downloader did.
   */
  function downloadCSVs({ cookieRows, tagRows, domain }) {
    function dl(rows, fn, headers) {
      const csv = [ headers, ...rows ]
        .map(r=>r.map(f=>"\""+(f||"")+"\"").join(","))
        .join("\r\n");
      const b = new Blob([csv], { type:"text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = fn;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    dl(cookieRows, `ketch_cookies_${domain}.csv`,
       ["Consent Category","Cookie Name","Cookie Domain","Vendor"]);
    dl(tagRows,    `ketch_tags_${domain}.csv`,
       ["Consent Category","Tag Name"]);
  }

  // expose to your loader
  window.ketch = { exportConsentData, downloadCSVs };
})();
