(async function(){
  console.log('ketch-op.js loaded');

  // 1) Pull Ketch cookie + tag data
  // Paste your existing bookmarklet’s logic here in place of this stub:
  // — fetch the /config/.../config.json
  // — merge with the open-cookie-database
  // — build cookieRows and tagRows arrays
  // — provide downloadCSVs() that triggers the two CSV downloads
  // For example:
  const ketch = {
    async exportConsentData() {
      // …your one‑liner code logic, modified slightly to return:
      // { categories: [ { name, cookies: [...], tags: [...] }, … ] }
    },
    downloadCSVs({ cookieRows, tagRows, domain }) {
      // …your existing CSV download implementation
    }
  };
  const data = await ketch.exportConsentData();

  // 2) Prompt for API key
  const apiKey = prompt('Enter ObservePoint API Key (leave blank to Export only):');
  if (!apiKey) {
    // no key → just do your CSV export and exit
    return ketch.downloadCSVs(data);
  }

  // 3) Prompt Import vs Update
  const action = prompt('Choose action: Import or Update').toLowerCase();
  if (!['import','update'].includes(action)) {
    return alert('Invalid action – must be Import or Update');
  }

  // 4) Helper for OP fetch calls
  const opFetch = (url, opts={}) =>
    fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept':        'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    }).then(r => r.json());

  if (action === 'import') {
    // --- IMPORT FLOW ---
    const doTags    = confirm('Include tags?');
    const doCookies = confirm('Include cookies?');

    for (const cat of data.categories) {
      // 1) POST new consent category
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

      // 2) PATCH cookies
      if (doCookies && cat.cookies.length) {
        const ops = cat.cookies.map((c,i) => ({
          op:    'add',
          path:  `/${i}`,
          value: {
            nameType:   'name_exact_match',
            name:       c[1],
            domainType: 'domain_exact_match',
            domain:     c[2]
          }
        }));
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method: 'PATCH', body: JSON.stringify(ops) }
        );
      }

      // 3) PATCH tags
      if (doTags && cat.tags.length) {
        const ops = cat.tags.map((t,i) => ({
          op:    'add',
          path:  `/${i}`,
          value: { tagId: t[1], accounts: [] }
        }));
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/tags`,
          { method: 'PATCH', body: JSON.stringify(ops) }
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
    const names = data.categories.map(c=>c.name).join(', ');
    const pick  = prompt(
      `Found ${data.categories.length} categories on the site: [${names}]\n` +
      'Enter the SAME N existing category names (comma‑separated) to update:'
    );
    const selectedNames = pick.split(',').map(n=>n.trim());
    if (selectedNames.length !== data.categories.length) {
      return alert(`You must select exactly ${data.categories.length} names.`);
    }
    // 2) Match and update each
    for (let i=0; i<data.categories.length; i++) {
      const newCat = data.categories[i];
      const existing = lib.consentCategories.find(ec =>
        selectedNames[i] && ec.name.includes(selectedNames[i])
      );
      if (!existing) {
        alert(`Could not match "${selectedNames[i]}"`);
        return;
      }
      const id = existing.id;

      // Remove old cookies
      const oldCookies = await opFetch(
        `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`
      );
      const remOps = oldCookies.cookies.map((_,idx) => ({
        op: 'remove',
        path: '/0'
      }));
      if (remOps.length) {
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method: 'PATCH', body: JSON.stringify(remOps) }
        );
      }
      // Add new cookies
      const addOps = newCat.cookies.map((c,j) => ({
        op:    'add',
        path:  `/${j}`,
        value: {
          nameType:   'name_exact_match',
          name:       c[1],
          domainType: 'domain_exact_match',
          domain:     c[2]
        }
      }));
      if (addOps.length) {
        await opFetch(
          `https://app.observepoint.com/api/v3/consent-categories/${id}/cookies`,
          { method: 'PATCH', body: JSON.stringify(addOps) }
        );
      }

      // Tags: similar remove & add logic if doTags confirmed above
      // …
    }
    alert('Update complete!');
  }
})();
 
