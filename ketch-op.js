// ketch-op.js
(async function(){
  console.log('✅ ketchOp.js loaded');
  try {
    // 1) pull your Ketch data
    const data = await window.ketch.exportConsentData();

    // 2) ask for OP API Key (or export only)
    const apiKey = prompt('Enter ObservePoint API Key (leave blank to Export only):');
    if (!apiKey) {
      return window.ketch.downloadCSVs(data);
    }

    // 3) import vs update?
    const action = prompt('Choose action: import or update').toLowerCase();
    if (!['import','update'].includes(action)) {
      return alert('Invalid action – must be import or update');
    }

    // 4) helper to call OP API
    const opFetch = (url, opts={}) =>
      fetch(url, {
        ...opts,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept':        'application/json',
          ...(opts.body?{'Content-Type':'application/json'}:{})
        }
      }).then(r=>r.json());

    if (action === 'import') {
      // —— IMPORT FLOW ——
      const doCookies = confirm('Include cookies?');
      const doTags    = confirm('Include tags?');

      for (const cat of data.categories) {
        // a) create new category
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

        // b) patch cookies
        if (doCookies && cat.cookies.length) {
          const ckOps = cat.cookies.map((c,i)=>({
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
            { method:'PATCH', body:JSON.stringify(ckOps) }
          );
        }

        // c) patch tags
        if (doTags && cat.tags.length) {
          const tagOps = cat.tags.map((t,i)=>({
            op:   'add',
            path: `/${i}`,
            value:{ tagId:t[1], accounts:[] }
          }));
          await opFetch(
            `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
            { method:'PATCH', body:JSON.stringify(tagOps) }
          );
        }
      }
      alert('✅ Import complete');
    }
    else {
      // —— UPDATE FLOW ——
      // fetch library
      const lib = await opFetch(
        'https://app.observepoint.com/api/v3/consent-categories/library?page=0&pageSize=100&sortBy=updated_at&sortDesc=true'
      );

      // prompt to pick existing N names
      const names = data.categories.map(c=>c.name).join(', ');
      const pick  = prompt(
        `Found ${data.categories.length} categories: [${names}]\n`+
        'Enter the SAME N existing category names (comma separated):'
      );
      const selected = pick.split(',').map(s=>s.trim());
      if (selected.length !== data.categories.length) {
        return alert(`Must select exactly ${data.categories.length} names`);
      }

      // loop & sync
      for (let i=0; i<data.categories.length; i++) {
        const newCat = data.categories[i];
        const ec     = lib.consentCategories.find(e=> selected[i] && e.name.includes(selected[i]));
        if (!ec) return alert(`Could not match "${selected[i]}"`);
        const id = ec.id;

        // a) remove old cookies
        const oldC = await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`);
        const remC = oldC.cookies.map((_,j)=>({op:'remove',path:'/0'}));
        if (remC.length) {
          await opFetch(
            `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
            { method:'PATCH', body:JSON.stringify(remC) }
          );
        }

        // b) add new cookies
        const addC = newCat.cookies.map((c,j)=>({
          op:    'add',
          path:  `/${j}`,
          value: {
            nameType:   'name_exact_match',
            name:       c[1],
            domainType: 'domain_exact_match',
            domain:     c[2]
          }
        }));
        if (addC.length) {
          await opFetch(
            `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
            { method:'PATCH', body:JSON.stringify(addC) }
          );
        }

        // c) remove old tags
        const oldT = await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/tags`);
        const remT = oldT.tags.map((_,j)=>({op:'remove',path:'/0'}));
        if (remT.length) {
          await opFetch(
            `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
            { method:'PATCH', body:JSON.stringify(remT) }
          );
        }

        // d) add new tags
        const addT = newCat.tags.map((t,j)=>({
          op:    'add',
          path:  `/${j}`,
          value: { tagId:t[1], accounts:[] }
        }));
        if (addT.length) {
          await opFetch(
            `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
            { method:'PATCH', body:JSON.stringify(addT) }
          );
        }
      }

      alert('✅ Update complete');
    }
  }
  catch (e) {
    console.error(e);
    alert('Error: '+(e.message||e));
  }
})();
