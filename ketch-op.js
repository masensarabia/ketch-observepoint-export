/*
 * Ketch → ObservePoint Bookmarklet
 * Loads ketchExport.js from CDN, then runs the script.
 * Usage: add this as a bookmark URL:
 * javascript:(()=>{var s=document.createElement('script');s.src='https://cdn.example.com/ketchExport.js';document.body.appendChild(s);})();
 */

(async function() {
  // Prompt for API Key or Export only
  const apiKey = prompt('Enter ObservePoint API Key (leave blank for Export only):');
  // Load Ketch export logic
  const ketch = await import('https://cdn.example.com/ketchExport.js');
  const data = await ketch.exportConsentData(); // { cookieRows, tagRows, categories }

  if (!apiKey) {
    // Just download CSVs
    ketch.downloadCSVs(data);
    return;
  }

  // Next: choose Import or Update
  const action = prompt('Choose action: Import or Update').toLowerCase();
  if (!['import','update'].includes(action)) return alert('Invalid action');

  // Helper: call ObservePoint API
  const opFetch = (url, opts) => fetch(url, {
    ...opts,
    headers: {
      'Content-Type': opts.body ? 'application/json' : 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    }
  }).then(r => r.json());

  if (action === 'import') {
    const doTags = confirm('Include tags?');
    const doCookies = confirm('Include cookies?');
    for (const cat of data.categories) {
      // 1) create category
      const create = await opFetch('https://app.observepoint.com/api/v3/consent-categories', {
        method: 'POST',
        body: JSON.stringify({ name: cat.name, notes: '', type: 'approved', isDefaultCC: false })
      });
      const id = create.id;
      // 2) patch cookies
      if (doCookies && data.cookieRows[cat.name]) {
        const ops = data.cookieRows[cat.name].map((c,i) => ({ op: 'add', path: '/' + i, value: { nameType: 'name_exact_match', name: c[1], domainType: 'domain_exact_match', domain: c[2] } }));
        await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`, { method: 'PATCH', body: JSON.stringify(ops) });
      }
      // 3) patch tags
      if (doTags && data.tagRows[cat.name]) {
        const tOps = data.tagRows[cat.name].map((t,i) => ({ op: 'add', path: '/' + i, value: { tagId: t[1], accounts: [] } }));
        await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/tags`, { method: 'PATCH', body: JSON.stringify(tOps) });
      }
    }
    alert('Import complete!');
  }
  else {
    // Update flow: fetch library
    const lib = await opFetch('https://app.observepoint.com/api/v3/consent-categories/library?page=0&pageSize=100&sortBy=updated_at&sortDesc=true');
    // Let user pick existing categories via prompt (comma-separated names)
    const pick = prompt('Enter the existing category names to match, separated by commas:');
    const names = pick.split(',').map(s=>s.trim());
    if (names.length !== data.categories.length) return alert('Must select ' + data.categories.length + ' categories');
    const selected = lib.consentCategories.filter(c => names.some(n => c.name.includes(n)));
    for (let i = 0; i < selected.length; i++) {
      const id = selected[i].id;
      const cat = data.categories[i];
      // remove old cookies
      const old = await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`);
      const remOps = old.cookies.map((_, idx) => ({ op: 'remove', path: '/0' }));
      if (remOps.length) await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`, { method: 'PATCH', body: JSON.stringify(remOps) });
      // add new cookies
      const addOps = data.cookieRows[cat.name].map((c,i) => ({ op: 'add', path: '/' + i, value: { nameType: 'name_exact_match', name: c[1], domainType: 'domain_exact_match', domain: c[2] } }));
      await opFetch(`https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`, { method: 'PATCH', body: JSON.stringify(addOps) });
      // similar for tags if selected...
    }
    alert('Update complete!');
  }
})();
