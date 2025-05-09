(async function(){
  console.log('ketch‑op.js loaded');
  // 1) Pull ketch cookie+tag data
  const ketch = await (async()=>{
    // Inline your Ketch exporter logic here (the same code that
    // fetched config.json, parsed cookies/tags, and built CSVs).
    // For brevity: call your existing exportConsentData() function.
    return /* your exportConsentData module */;
  })();

  // 2) Prompt for OP API key
  const apiKey = prompt('Enter ObservePoint API Key (leave blank to Export only):');
  if (!apiKey) {
    return ketch.downloadCSVs();       // your CSV‑download routine
  }

  // 3) Prompt Import vs Update
  const action = prompt('Choose action: Import or Update').toLowerCase();
  if (!['import','update'].includes(action)) {
    return alert('Invalid action');
  }

  // 4) Set up helper to call OP API
  const opFetch = (url, opts={}) => fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': opts.body ? 'application/json' : undefined
    }
  }).then(r=>r.json());

  if (action==='import') {
    // … your POST + PATCH logic from earlier …
  } else {
    // … your UPDATE flow from earlier …
  }
})();
