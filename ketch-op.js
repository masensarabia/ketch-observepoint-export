// ketch‑observepoint-export/ketch‑op.js
// 📥 Loads Ketch export logic, then prompts for OP API key to Export/Import/Update.
(async function(){
  console.log('ketch-op.js loaded');

  // 1) Pull Ketch consent config & build our data.categories, cookieRows, tagRows
  const u = performance.getEntriesByType('resource')
    .map(r=>r.name)
    .find(n=>/\/config\/.*\/config\.json/.test(n));
  if(!u) {
    alert('⚠️ Open & save the Ketch consent modal first');
    return;
  }
  const [cfg, db] = await Promise.all([
    fetch(u).then(r=>r.json()),
    fetch('https://cdn.jsdelivr.net/gh/jkwakman/Open-Cookie-Database@master/open-cookie-database.json')
      .then(r=>r.json())
  ]);
  const flat = Object.values(db).flat();
  const hostname = location.hostname.replace(/^www\./,'');

  // build cookieRows: [ Consent Category, Cookie Name, Cookie Domain, Vendor ]
  const cookieRows = (cfg.purposes||cfg.categories||[]).flatMap(cat=>{
    const catName = cat.title||cat.name||'';
    return (cat.cookies||[]).map(c=>{
      const name   = c.name||c.code||c.ID||'';
      const vendor = c.serviceProvider||'';
      const raw    = (flat.find(d=>d.cookie===name || (d.wildcardMatch==='1' && name.indexOf(d.cookie)===0))||{}).domain||'';
      const m      = raw.match(/([a-z0-9\.-]+\.[a-z]{2,})(?=(?:\s|\(|$))/i);
      const domain = vendor
        ? (m ? m[1] : '')
        : hostname;
      return [catName, name, domain, vendor];
    });
  });

  // build tagRows: [ Consent Category, Tag Name ]
  const tagMap = new Map();
  (cfg.purposes||cfg.categories||[]).forEach(cat=>{
    const catName = cat.title||cat.name||'';
    (cat.cookies||[]).forEach(c=>{
      const vendor = c.serviceProvider||'';
      if(vendor) tagMap.set(catName + '‖' + vendor, [catName, vendor]);
    });
  });
  const tagRows = Array.from(tagMap.values());

  // derive categories array for import/update flows
  const categories = Array.from(new Set(cookieRows.map(r=>r[0]))).map(catName=>({
    name: catName,
    cookies: cookieRows.filter(r=>r[0]===catName),
    tags:    tagRows.filter(r=>r[0]===catName)
  }));

  // helper to download the two CSVs (Export-only mode)
  function downloadCSVs(){
    function dl(rows, filename, headers){
      const csv = [headers, ...rows]
        .map(row => row.map(f=> `"${(f||'').toString().replace(/"/g,'""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob([csv], { type:'text/csv' });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    dl(cookieRows, `ketch_cookies_${hostname}.csv`,
       ['Consent Category','Cookie Name','Cookie Domain','Vendor']);
    dl(tagRows,    `ketch_tags_${hostname}.csv`,
       ['Consent Category','Tag Name']);
  }

  // Our collected data
  const data = { categories, cookieRows, tagRows, domain: hostname };

  // 2) Prompt for ObservePoint API key
  const apiKey = prompt('Enter ObservePoint API Key (leave blank to Export only):');
  if(!apiKey) {
    return downloadCSVs();
  }

  // 3) Prompt: Import vs Update
  const action = prompt('Choose action: Import or Update').toLowerCase();
  if(!['import','update'].includes(action)) {
    return alert('Invalid action – must be Import or Update');
  }

  // 4) Helper to call ObservePoint API
  const opFetch = (url, opts={}) =>
    fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept':        'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    }).then(r=>r.json());

  if(action === 'import') {
    // --- IMPORT FLOW ---
    const doTags    = confirm('Include tags?');
    const doCookies = confirm('Include cookies?');

    for(const cat of data.categories) {
      // 1) Create new category
      const created = await opFetch(
        'https://app.observepoint.com/api/v3/consent-categories',
        {
          method: 'POST',
          body: JSON.stringify({
            name:       cat.name,
            notes:      '',
            type:       'approved',
            isDefaultCC:false
          })
        }
      );
      const id = created.id;

      // 2) Patch cookies
      if(doCookies && cat.cookies.length) {
        const ops = cat.cookies.map((c,i)=>({
          op:   'add',
          path: `/${i}`,
          value: {
            nameType:   'name_exact_match',
            name:       c[1],
            domainType: 'domain_exact_match',
            domain:     c[2]
          }
        }));
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method:'PATCH', body: JSON.stringify(ops) }
        );
      }

      // 3) Patch tags
      if(doTags && cat.tags.length) {
        // NOTE: OP expects numeric tagId. You’ll need to map vendor names (cat.tags[i][1])
        // to real tagId values. For now we pass them as-is.
        const ops = cat.tags.map((t,i)=>({
          op:   'add',
          path: `/${i}`,
          value: { tagId: t[1], accounts: [] }
        }));
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
          { method:'PATCH', body: JSON.stringify(ops) }
        );
      }
    }

    alert('Import complete!');

  } else {
    // --- UPDATE FLOW ---
    // 1) Fetch existing library
    const lib = await opFetch(
      'https://app.observepoint.com/api/v3/consent-categories/library?page=0&pageSize=100&sortBy=updated_at&sortDesc=true'
    );
    // 2) Ask user to pick matching existing names
    const names = data.categories.map(c=>c.name).join(', ');
    const pick  = prompt(
      `Found ${data.categories.length} categories on the site: [${names}]\n`+
      'Enter the SAME N existing category names (comma‑separated) to update:'
    );
    const selectedNames = pick.split(',').map(n=>n.trim());
    if(selectedNames.length !== data.categories.length) {
      return alert(`You must select exactly ${data.categories.length} names.`);
    }

    // 3) Loop & sync each
    for(let i=0; i<data.categories.length; i++){
      const newCat  = data.categories[i];
      const existing = lib.consentCategories.find(ec=>
        selectedNames[i] && ec.name.includes(selectedNames[i])
      );
      if(!existing) {
        alert(`Could not match "${selectedNames[i]}"`); 
        return;
      }
      const id = existing.id;

      // a) Remove old cookies
      const oldCookies = await opFetch(
        `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`
      );
      const remOps = oldCookies.cookies.map((_,idx)=>({
        op:'remove', path:'/0'
      }));
      if(remOps.length){
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method:'PATCH', body: JSON.stringify(remOps) }
        );
      }
      // b) Add new cookies
      const addOps = newCat.cookies.map((c,j)=>({
        op:'add',
        path:`/${j}`,
        value:{
          nameType:   'name_exact_match',
          name:       c[1],
          domainType: 'domain_exact_match',
          domain:     c[2]
        }
      }));
      if(addOps.length){
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method:'PATCH', body: JSON.stringify(addOps) }
        );
      }

      // c) Tags sync (similar remove+add if desired)
      // …you can mirror the cookie logic here…
    }

    alert('Update complete!');
  }
})();
