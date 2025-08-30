/* ----------------- Config & Patterns (unchanged logic) ----------------- */
const KEYS = ["title","url","snippet","matched_text","alt"];
const PAIR_RE = new RegExp(String.raw`^\s*"?` + `(title|url|snippet|matched_text|alt)` + String.raw`"?\s*:\s*(["“])(.*?)(["”])\s*,?\s*$`, "i");
const URL_RE   = /https?:\/\/\S+|www\.\S+/gi;
const EMAIL_RE = /\b[\w.-]+@[\w.-]+\.\w+\b/g;
const TOKEN_RE = /\b[a-zA-Z]{2,}\b/g;

const DEFAULT_STOP = new Set(["a","an","the","and","or","but","if","then","else","when","while","for","to","from","in","on","at","by","of","off","over","under","with","without","within","into","out","is","am","are","was","were","be","been","being","do","does","did","doing","have","has","had","i","you","he","she","it","we","they","me","him","her","them","my","your","his","its","our","their","as","that","this","these","those","there","here","so","than","too","very","can","cannot","could","should","would","may","might","must","will","just","not","no","yes","also"]);
const DEFAULT_BLACK = new Set(["http","https","www","com","url","chatgpt","utm","source","amp","html","pdf","title","snippet"]);

/* ----------------- State ----------------- */
let rawText = "";
let extractedDict = null;
let extractedTxt = "";
let caches = { bi:[], tri:[], four:[] };

/* ----------------- Utils (unchanged) ----------------- */
function escapeHtml(s){ return s.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function dedupeKeepOrder(arr){ const seen=new Set(), out=[]; for(const v of arr){ if(!seen.has(v)){ seen.add(v); out.push(v); } } return out; }
function blobDownload(filename, data, mime){ const url = URL.createObjectURL(new Blob([data], {type: mime || 'text/plain'})); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 1500); }
function toast(msg){ const el = document.getElementById('toast'); el.textContent = msg; el.classList.remove('hidden'); el.classList.add('show'); setTimeout(()=>{ el.classList.remove('show'); el.classList.add('hidden'); }, 1800); }

/* ----------------- Extraction (unchanged) ----------------- */
function extractPairs(text){
  const res = { title:[], url:[], snippet:[], matched_text:[], alt:[] };
  const lines = text.split(/\r?\n/);
  for(const line of lines){
    const m = line.match(PAIR_RE);
    if(m){
      const key = m[1].toLowerCase();
      let val = (m[3]||"").trim().replace(/[“”]/g,'"');
      res[key].push(val);
    }
  }
  for(const k of KEYS){ res[k] = dedupeKeepOrder(res[k]); }
  return res;
}
function sectionedText(results){
  const out=[]; for(const k of KEYS){ for(const v of results[k]) out.push(`${k}: ${v}`); out.push(""); } return out.join("\n");
}

/* ----------------- N-grams (unchanged) ----------------- */
function cleanAndTokenize(text, extraStop=[], extraBlack=[]){
  text = text.replace(URL_RE," ").replace(EMAIL_RE," ").toLowerCase().replaceAll("-"," ");
  const tokens = (text.match(TOKEN_RE) || []);
  const stop = new Set([...DEFAULT_STOP, ...extraStop.map(s=>s.trim().toLowerCase()).filter(Boolean)]);
  const black= new Set([...DEFAULT_BLACK, ...extraBlack.map(s=>s.trim().toLowerCase()).filter(Boolean)]);
  return tokens.filter(t => !stop.has(t) && !black.has(t) && t.length>=2);
}
function ngramCounts(tokens, n){
  const map = new Map(); if(tokens.length < n) return map;
  for(let i=0;i<=tokens.length-n;i++){ const gram = tokens.slice(i,i+n).join(" "); map.set(gram, (map.get(gram)||0)+1); }
  return map;
}
function topRows(map, topK, minFreq){
  const arr = [...map.entries()].filter(([_,c])=>c>=minFreq);
  arr.sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
  return arr.slice(0, topK);
}
function renderTable(tbodyId, rows){
  const tb = document.getElementById(tbodyId);
  tb.innerHTML = rows.map(([p,c])=>`<tr><td class="px-3 py-2">${escapeHtml(p)}</td><td class="px-3 py-2">${c}</td></tr>`).join("");
}

/* ----------------- Theme toggle ----------------- */
function applyTheme(mode){
  document.body.setAttribute('data-theme', mode);
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if(mode === 'dark'){ icon.textContent = '🌙'; label.textContent = 'Dark'; document.body.classList.add('bg-surface'); }
  else { icon.textContent = '🌞'; label.textContent = 'Light'; document.body.classList.add('bg-surface'); }
}

/* ----------------- Handlers ----------------- */
document.addEventListener('DOMContentLoaded', () => {
  // init theme
  const saved = localStorage.getItem('aeo-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  document.getElementById('themeToggle').addEventListener('click', ()=>{
    const next = (document.body.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    applyTheme(next); localStorage.setItem('aeo-theme', next);
  });

  const fileInput = document.getElementById('fileInput');
  const pasteArea = document.getElementById('pasteArea');
  const inputInfo = document.getElementById('inputInfo');
  const extractStatus = document.getElementById('extractStatus');
  const extractedPreview = document.getElementById('extractedPreview');

  fileInput.addEventListener('change', async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    rawText = await f.text();
    inputInfo.textContent = `loaded file: ${f.name} (${(f.size/1024).toFixed(1)} KB)`;
    toast('File loaded');
  });

  document.getElementById('resetBtn').addEventListener('click', ()=>{
    fileInput.value = "";
    pasteArea.value = "";
    rawText = ""; extractedDict = null; extractedTxt = ""; caches = {bi:[], tri:[], four:[]};
    inputInfo.textContent = "no input loaded";
    extractStatus.textContent = ""; extractedPreview.textContent = "";
    document.getElementById('tblBi').innerHTML = "";
    document.getElementById('tblTri').innerHTML = "";
    document.getElementById('tblFour').innerHTML = "";
    document.getElementById('ngStatus').textContent = "";
    toast('Reset complete');
  });

  document.getElementById('runExtract').addEventListener('click', ()=>{
    const pasted = (pasteArea.value||"").trim();
    const source = (rawText && rawText.trim()) ? rawText : pasted;
    if(!source){ extractStatus.textContent = "❌ Provide a file or paste text first."; toast('No input'); return; }
    extractedDict = extractPairs(source);
    extractedTxt = sectionedText(extractedDict);
    extractStatus.textContent = `✅ Extraction complete. title=${extractedDict.title.length}, url=${extractedDict.url.length}, snippet=${extractedDict.snippet.length}, matched_text=${extractedDict.matched_text.length}, alt=${extractedDict.alt.length}`;
    extractedPreview.textContent = extractedTxt.slice(0, 2000);
    toast('Extraction complete');
  });

  document.getElementById('dlExtracted').addEventListener('click', ()=>{
    if(!extractedTxt){ toast('Run extraction first'); return; }
    blobDownload('extracted.txt', extractedTxt, 'text/plain;charset=utf-8');
  });

  document.getElementById('runNgrams').addEventListener('click', ()=>{
    if(!extractedDict){ toast('Run extraction first'); return; }
    const topK = Math.max(1, parseInt(document.getElementById('topK').value||"50",10));
    const minFreq = Math.max(1, parseInt(document.getElementById('minFreq').value||"1",10));
    const extraStop = (document.getElementById('extraStop').value||"").split(',').filter(Boolean);
    const extraBlack = (document.getElementById('extraBlack').value||"").split(',').filter(Boolean);

    const fields = ["title","snippet","matched_text","alt"]; // exclude URLs
    const corpus = fields.map(k => (extractedDict[k]||[]).join("\n")).join("\n");
    const tokens = cleanAndTokenize(corpus, extraStop, extraBlack);

    const biMap   = ngramCounts(tokens, 2);
    const triMap  = ngramCounts(tokens, 3);
    const fourMap = ngramCounts(tokens, 4);

    caches.bi   = topRows(biMap, topK, minFreq);
    caches.tri  = topRows(triMap, topK, minFreq);
    caches.four = topRows(fourMap, topK, minFreq);

    renderTable('tblBi', caches.bi);
    renderTable('tblTri', caches.tri);
    renderTable('tblFour', caches.four);

    document.getElementById('ngStatus').textContent = `Done. Tokens=${tokens.length.toLocaleString()} • Unique: bi=${biMap.size}, tri=${triMap.size}, four=${fourMap.size}`;
    toast('N-grams ready');
  });

  document.getElementById('dlBi').addEventListener('click', ()=>{
    if(!caches.bi.length){ toast('Run N-grams first'); return; }
    const csv = "phrase,frequency\n" + caches.bi.map(([p,c])=>`"${p.replaceAll('"','""')}",${c}`).join("\n");
    blobDownload('bigrams.csv', csv, 'text/csv;charset=utf-8');
  });
  document.getElementById('dlTri').addEventListener('click', ()=>{
    if(!caches.tri.length){ toast('Run N-grams first'); return; }
    const csv = "phrase,frequency\n" + caches.tri.map(([p,c])=>`"${p.replaceAll('"','""')}",${c}`).join("\n");
    blobDownload('trigrams.csv', csv, 'text/csv;charset=utf-8');
  });
  document.getElementById('dlFour').addEventListener('click', ()=>{
    if(!caches.four.length){ toast('Run N-grams first'); return; }
    const csv = "phrase,frequency\n" + caches.four.map(([p,c])=>`"${p.replaceAll('"','""')}",${c}`).join("\n");
    blobDownload('fourgrams.csv', csv, 'text/csv;charset=utf-8');
  });
});