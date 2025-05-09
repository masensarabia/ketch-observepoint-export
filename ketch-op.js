// ketch‑op.js
(async function(){
  console.log('ketch-op.js loaded');

  //
  // 1) KETCH EXPORTER (exactly your original bookmarklet logic)
  //
  const u = performance.getEntriesByType("resource")
    .map(r=>r.name)
    .find(n=>/\/config\/.*\/config\.json/.test(n));
  if(!u) return alert("⚠️ Open & save the Ketch consent modal first");

  const [cfg, db] = await Promise.all([
    fetch(u).then(r=>r.json()),
    fetch("https://cdn.jsdelivr.net/gh/jkwakman/Open-Cookie-Database@master/open-cookie-database.json")
      .then(r=>r.json())
  ]);

  const flat = Object.values(db).flat();
  const h = location.hostname.replace(/^www\./,"");

  // build cookieRows
  const cookieRows = (cfg.purposes||cfg.categories||[]).flatMap(cat=>{
    const catName = cat.title||cat.name||"";
    return (cat.cookies||[]).map(c=>{
      const name   = c.name||c.code||c.ID||"";
      const vendor = c.serviceProvider||"";
      const raw    = (flat.find(d=>d.cookie===name||(d.wildcardMatch==="1"&&name.indexOf(d.cookie)===0))||{}).domain||"";
      const m      = raw.match(/([a-z0-9\.-]+\.[a-z]{2,})(?=(?:\s|\(|$))/i);
      const dom    = vendor
        ? (m? m[1] : "")
        : h;
      return [catName, name, dom, vendor];
    });
  });

  // build tagRows
  const tagMap = new Map();
  (cfg.purposes||cfg.categories||[]).forEach(cat=>{
    const catName = cat.title||cat.name||"";
    (cat.cookies||[]).forEach(c=>{
      const vendor = c.serviceProvider||"";
      if(vendor) tagMap.set(catName+"‖"+vendor, [catName, vendor]);
    });
  });
  const tagRows = Array.from(tagMap.values());

  // build categories array for import/update
  const categories = Array.from(
    new Set(cookieRows.map(r=>r[0]))
  ).map(catName=>({
    name:    catName,
    cookies: cookieRows.filter(r=>r[0]===catName),
    tags:    tagRows.filter(r=>r[0]===catName)
  }));

  // CSV download helper
  function downloadCSVs(){
    function dl(rows, fn, headers){
      const csv = [headers, ...rows]
        .map(r=>r.map(f=>"\""+(f||"")+"\"").join(","))
        .join("\r\n");
      const b = new Blob([csv], { type:"text/csv" });
      const a = document.createElement("a");
      a.href        = URL.createObjectURL(b);
      a.download    = fn;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    dl(cookieRows, `ketch_cookies_${h}.csv`,
       ["Consent Category","Cookie Name","Cookie Domain","Vendor"]);
    dl(tagRows,    `ketch_tags_${h}.csv`,
       ["Consent Category","Tag Name"]);
  }

  const data = { categories, cookieRows, tagRows, domain: h };

  //
  // 2) PROMPT FOR OBSERVEPOINT API KEY
  //
  const apiKey = prompt('Enter ObservePoint API Key (leave blank to Export only):');
  if(!apiKey){
    return downloadCSVs();
  }

  //
  // 3) IMPORT vs UPDATE
  //
  const action = prompt('Choose action: Import or Update').toLowerCase();
  if(!['import','update'].includes(action)){
    return alert('Invalid action – must be Import or Update');
  }

  // OP API helper
  const opFetch = (url, opts={}) =>
    fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept':        'application/json',
        ...(opts.body? { 'Content-Type':'application/json' } : {})
      }
    }).then(r=>r.json());

  if(action === 'import'){
    //
    // 4a) IMPORT FLOW
    //
    const doTags    = confirm('Include tags?');
    const doCookies = confirm('Include cookies?');

    for(const cat of data.categories){
      // create category
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

      // patch cookies
      if(doCookies && cat.cookies.length){
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

      // patch tags
      if(doTags && cat.tags.length){
        const ops = cat.tags.map((t,i)=>({
          op:   'add',
          path: `/${i}`,
          value:{ tagId: t[1], accounts: [] }
        }));
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
          { method:'PATCH', body: JSON.stringify(ops) }
        );
      }
    }

    alert('Import complete!');

  } else {
    //
    // 4b) UPDATE FLOW
    //
    // fetch library
    const lib = await opFetch(
      'https://app.observepoint.com/api/v3/consent-categories/library?page=0&pageSize=100&sortBy=updated_at&sortDesc=true'
    );

    // select existing names
    const names = data.categories.map(c=>c.name).join(', ');
    const pick  = prompt(
      `Found ${data.categories.length} categories on the site: [${names}]\n`+
      'Enter the SAME N existing category names (comma‑separated) to update:'
    );
    const selected = pick.split(',').map(n=>n.trim());
    if(selected.length !== data.categories.length){
      return alert(`You must select exactly ${data.categories.length} names.`);
    }

    // loop & sync
    for(let i=0; i<data.categories.length; i++){
      const newCat = data.categories[i];
      const ec     = lib.consentCategories.find(x=>
        selected[i] && x.name.includes(selected[i])
      );
      if(!ec){
        alert(`Could not match "${selected[i]}"`);
        return;
      }
      const id = ec.id;

      // remove old cookies
      const oldC = await opFetch(
        `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`
      );
      const remC = oldC.cookies.map((_,j)=>({ op:'remove', path:'/0' }));
      if(remC.length){
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method:'PATCH', body: JSON.stringify(remC) }
        );
      }
      // add new cookies
      const addC = newCat.cookies.map((c,j)=>({
        op:'add', path:`/${j}`, value:{
          nameType:'name_exact_match', name:c[1],
          domainType:'domain_exact_match', domain:c[2]
        }
      }));
      if(addC.length){
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method:'PATCH', body: JSON.stringify(addC) }
        );
      }

      // remove old tags
      const oldT = await opFetch(
        `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`
      );
      const remT = oldT.tags.map((_,j)=>({ op:'remove', path:'/0' }));
      if(remT.length){
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
          { method:'PATCH', body: JSON.stringify(remT) }
        );
      }
      // add new tags
      const addT = newCat.tags.map((t,j)=>({
        op:'add', path:`/${j}`, value:{ tagId:t[1], accounts: [] }
      }));
      if(addT.length){
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
          { method:'PATCH', body: JSON.stringify(addT) }
        );
      }
    }

    alert('Update complete!');
  }
})();
