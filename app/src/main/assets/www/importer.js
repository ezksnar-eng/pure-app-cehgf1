/* =====================================================================
   importer.js — محرك الاستيراد (سحب كامل من موقع عبر تطبيق البروكسي)
   =====================================================================
   - يقرأ الصفحات عن طريق البروكسي:  PROXY/?url=<الرابط>
   - يكتشف أعمال الموقع (أرشيف + ترقيم صفحات) أو يستورد عمل واحد لو الرابط عمل
   - 70 عامل (الافتراضي): كل عامل ياخذ عمل واحد "حصرياً" من الطابور ولا يتركه
     إلا بعد ما يخلص كل فصوله، وبعدها ياخذ العمل اللي بعده.
   - عدم التكرار مضمون بثلاث طبقات:
       1) الرابط الواحد ما ينضاف للطابور مرتين
       2) اسم العمل (بعد التطبيع) ما يستورده أكثر من عامل
       3) رقم المستند بقاعدة البيانات مشتق من اسم العمل (نفس العمل = نفس المستند)
          فأي تشغيل ثاني يتخطى المكتمل ويكمّل الناقص فقط
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------- أدوات عامة ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cyrb53(str, seed) {
    seed = seed || 0;
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // تطبيع الاسم لمنع التكرار: يشيل التشكيل والرموز والمسافات ويوحّد الألف/الياء/التاء المربوطة
  function normKey(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function toWestern(s) {
    return String(s || '')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  }

  function abs(href, base) {
    if (!href || !String(href).trim()) return ''; // new URL('', base) كان يرجّع الصفحة نفسها بدل فراغ
    try { return new URL(String(href).trim(), base).href; } catch (e) { return ''; }
  }
  function hostOf(u) { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function sameHost(a, b) { return hostOf(a) === hostOf(b); }
  function pathOf(u) {
    try { return decodeURIComponent(new URL(u).pathname).replace(/\/+$/, ''); } catch (e) { return ''; }
  }
  // مفتاح الرابط للمقارنة (بدون www / hash / query / سلاش أخير)
  function normUrl(u) {
    try { const x = new URL(u); return x.host.replace(/^www\./, '').toLowerCase() + decodeURIComponent(x.pathname).replace(/\/+$/, ''); }
    catch (e) { return String(u || ''); }
  }
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function firstEl(root2, sels) {
    for (const s of sels) { try { const e = root2.querySelector(s); if (e) return e; } catch (e) { /* selector غير مدعوم */ } }
    return null;
  }
  function parseHtml(html) { return new root.DOMParser().parseFromString(html, 'text/html'); }
  function metaContent(doc, name) {
    const e = doc.querySelector('meta[property="' + name + '"]') || doc.querySelector('meta[name="' + name + '"]');
    return e ? (e.getAttribute('content') || '').trim() : '';
  }
  function inChrome(el) {
    try { return !!el.closest('nav,header,footer,aside,[class*="menu"],[class*="filter"],[class*="dropdown"],[class*="sidebar"]'); }
    catch (e) { return false; }
  }
  function clean(obj) {
    const o = {};
    Object.keys(obj).forEach((k) => { if (obj[k] !== undefined && obj[k] !== null && !(typeof obj[k] === 'number' && isNaN(obj[k]))) o[k] = obj[k]; });
    return o;
  }

  function imgSrc(img, base) {
    const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'data-url', 'data-lazy', 'src'];
    for (const a of attrs) {
      const v = img.getAttribute(a);
      if (v && v.trim() && !/^data:/i.test(v.trim())) return abs(v.trim().split(/\s+/)[0], base);
    }
    const ss = img.getAttribute('data-srcset') || img.getAttribute('srcset');
    if (ss) return abs(ss.split(',')[0].trim().split(/\s+/)[0], base);
    return '';
  }

  /* ---------------- ترقيم الفصول ---------------- */
  function parseNumber(text, href) {
    const t = toWestern(text);
    let m = t.match(/(?:chapter|chap|ch|episode|ep|فصل|الفصل|حلقة|الحلقة|#)\s*[:\-.]?\s*(\d+(?:[.,_]\d+)?)/i);
    if (!m) m = t.match(/(\d+(?:[.,]\d+)?)/);
    if (!m && href) {
      let h = href; try { h = decodeURIComponent(href); } catch (e) { /* */ }
      m = h.match(/(?:chapter|chap|ch|فصل|الفصل|episode)[-_/ ]*(\d+(?:[-_.]\d+)?)/i) || h.match(/(\d+(?:[-_.]\d+)?)\/?$/);
    }
    if (!m) return null;
    const n = parseFloat(m[1].replace(/[,_-]/, '.'));
    return isNaN(n) ? null : n;
  }
  function cleanChapterTitle(raw) {
    const t = toWestern(raw || '').trim();
    const rest = t.replace(/^\s*(?:chapter|chap|ch\.?|episode|ep\.?|فصل|الفصل|حلقة|الحلقة|#)\s*\d+(?:[.,]\d+)?\s*[:\-–—.]?\s*/i, '').trim();
    if (!rest || rest === t || /^\d+(?:[.,]\d+)?$/.test(rest)) return '';
    return rest.slice(0, 120);
  }

  const CH_SELECTORS = [
    // قوالب معروفة (قوية)
    ['li.wp-manga-chapter > a', true], ['.wp-manga-chapter a', true], ['#chapterlist li a', true], ['.eplister li a', true], ['#chapter_list a', true],
    // عامة
    ['.chapter-list a', false], ['.listing-chapters_wrap a', false], ['ul.main.version-chap li a', false], ['.chbox a', false], ['.lchx a', false],
    ['.list-chapter a', false], ['.chapters a', false], ['.chapter-item a', false], ['.series-chapterlist li a', false], ['ul.chapter-list li a', false],
    ['[class*="chapter-list"] a', false], ['[class*="chapters-list"] a', false], ['[class*="chapterList"] a', false], ['[id*="chapter"] a', false],
  ];
  const CH_SEG = /^(?:chapter|chap|ch|episode|ep|فصل|الفصل|حلقة|الحلقة)[-_ ]?\d|^\d+(?:[.\-_]\d+)?$/i;

  function extractChapters(doc, pageUrl) {
    let anchors = [], via = '';
    const okHref = (a) => { const h = a.getAttribute('href'); return h && h.trim() && h[0] !== '#' && !/^javascript:/i.test(h); };

    for (const [sel, strong] of CH_SELECTORS) {
      let a; try { a = [...doc.querySelectorAll(sel)]; } catch (e) { continue; }
      a = a.filter(okHref);
      if (a.length) { anchors = a; via = strong ? 'selector-strong' : 'selector'; break; }
    }
    const base = pathOf(pageUrl);
    if (!anchors.length && base) {
      const kids = [...doc.querySelectorAll('a[href]')].filter((a) => {
        if (!okHref(a)) return false;
        const u = abs(a.getAttribute('href'), pageUrl);
        if (!u || !sameHost(u, pageUrl)) return false;
        const p = pathOf(u);
        if (!p.startsWith(base + '/')) return false;
        const rest = p.slice(base.length + 1);
        return rest.indexOf('/') < 0 && CH_SEG.test(rest);
      });
      if (kids.length) { anchors = kids; via = 'descendant'; }
    }
    if (!anchors.length && base) {
      const slug = base.split('/').pop().toLowerCase();
      const kw = [...doc.querySelectorAll('a[href]')].filter((a) => {
        if (!okHref(a)) return false;
        const u = abs(a.getAttribute('href'), pageUrl);
        if (!u || !sameHost(u, pageUrl) || normUrl(u) === normUrl(pageUrl)) return false;
        const p = pathOf(u).toLowerCase();
        return slug && p.indexOf(slug) >= 0 && /chapter|فصل|الفصل|episode/.test(p);
      });
      if (kw.length) { anchors = kw; via = 'keyword'; }
    }

    const seen = new Set(), list = [];
    for (const a of anchors) {
      const href = abs(a.getAttribute('href'), pageUrl).split('#')[0];
      if (!href || seen.has(href) || normUrl(href) === normUrl(pageUrl)) continue;
      seen.add(href);
      const numEl = a.querySelector('.chapternum,.chapter-num,.ch-num,.num');
      const raw = txt(numEl || a);
      list.push({ url: href, number: parseNumber(raw, href), title: cleanChapterTitle(raw) });
    }
    // نسبة الروابط اللي هي أبناء مباشرين لمسار الصفحة (تُستخدم للتفريق بين صفحة عمل وصفحة أرشيف)
    const kidRatio = list.length && base
      ? list.filter((c) => { const p = pathOf(c.url); return p.startsWith(base + '/'); }).length / list.length : 0;
    return { list, via, kidRatio };
  }

  function orderChapters(list) {
    if (!list.length) return [];
    if (list.every((c) => c.number != null)) {
      return list.map((c, i) => Object.assign({ _i: i }, c)).sort((a, b) => (a.number - b.number) || (a._i - b._i));
    }
    // بدون أرقام كاملة: المواقع غالباً تعرض الأحدث أولاً فنقلب الترتيب ونرقّم تسلسلياً
    const rev = list.slice().reverse().map((c) => Object.assign({}, c));
    let prev = 0;
    rev.forEach((c) => { if (c.number == null) c.number = prev + 1; prev = c.number; });
    return rev;
  }
  function assignChapterIds(ordered) {
    const used = new Map();
    return ordered.map((c, i) => {
      const base = 'c' + String(c.number).replace('.', '_');
      let id = base;
      if (used.has(base)) { const n = used.get(base) + 1; used.set(base, n); id = base + '_d' + n; }
      else used.set(base, 1);
      return { id, number: c.number, title: c.title || '', url: c.url, order: i + 1 };
    });
  }

  /* ---------------- تحليل صفحة العمل ---------------- */
  function parseRating(doc, isMadara) {
    const sels = ['[itemprop=ratingValue]', '#averagerating', '.post-total-rating .score', '.numscore', '.rating .num',
      '[class*="rating"] [class*="value"]', '[class*="rating"]', '[class*="score"]', '.score'];
    let value = null;
    for (const s of sels) {
      let els; try { els = [...doc.querySelectorAll(s)].slice(0, 6); } catch (e) { continue; }
      for (const el of els) {
        if (inChrome(el)) continue;
        const raw = el.getAttribute('content') || txt(el);
        if (!raw || raw.length > 24) continue;
        const m = toWestern(raw).match(/(\d{1,3}(?:[.,]\d{1,3})?)/);
        if (!m) continue;
        const v = parseFloat(m[1].replace(',', '.'));
        if (!isNaN(v) && v > 0 && v <= 100) { value = v; break; }
      }
      if (value != null) break;
    }
    if (value == null) return undefined;
    const bestEl = doc.querySelector('[itemprop=bestRating]');
    const best = bestEl ? parseFloat(bestEl.getAttribute('content') || txt(bestEl)) : NaN;
    let r;
    if (!isNaN(best) && best > 0) r = value / best * 10;
    else if (isMadara && value <= 5) r = value * 2;
    else if (value > 10) r = value / 10;
    else r = value;
    r = Math.max(0, Math.min(10, r));
    return Math.round(r * 100) / 100;
  }

  function pickStatus(doc) {
    const parts = [];
    doc.querySelectorAll('.post-content_item, .imptdt, .tsinfo > div, .info-item, [class*="status"]').forEach((e) => {
      const t = txt(e);
      if (t && t.length < 80) parts.push(t);
    });
    const t = parts.join(' | ').toLowerCase();
    if (/مكتمل|completed|finished|ended|منتهي/.test(t)) return 'مكتمل';
    if (/متوقف|hiatus|dropped|cancel|ملغ/.test(t)) return 'متوقف';
    if (/مستمر|ongoing|publishing|يتم النشر|جاري/.test(t)) return 'مستمر';
    return undefined;
  }
  function pickType(doc, genres, url) {
    const cells = [];
    doc.querySelectorAll('.post-content_item, .imptdt, .info-item, [class*="type"]').forEach((e) => { const t = txt(e); if (t && t.length < 60) cells.push(t); });
    const hay = (cells.join(' | ') + ' | ' + genres.join(' | ') + ' | ' + url).toLowerCase();
    if (/ويبتون|webtoon/.test(hay)) return 'ويبتون';
    if (/مانها|manhua|صيني/.test(hay)) return 'مانها';
    if (/مانهوا|manhwa|كوري/.test(hay)) return 'مانهوا';
    if (/رواية|novel/.test(hay)) return 'رواية';
    if (/مانجا|manga|ياباني/.test(hay)) return 'مانجا';
    return undefined;
  }

  function parseWorkPage(html, url) {
    const doc = parseHtml(html);
    const isMadara = !!doc.querySelector('.wp-manga-chapter, .summary_image, body.wp-manga, .post-title');

    // العنوان
    let title = '';
    const tEl = firstEl(doc, ['.post-title h1', '.post-title h3', 'h1.entry-title', '.seriestuheader h1', '.infox h1', '.series-title', '.manga-title', 'h1']);
    if (tEl) {
      const c = tEl.cloneNode(true);
      c.querySelectorAll('.manga-title-badges, span.hot, span.new, span.up').forEach((x) => x.remove());
      title = (c.textContent || '').replace(/\s+/g, ' ').trim();
    }
    if (!title) title = metaContent(doc, 'og:title').split(/\s[|\-–—]\s/)[0].trim();
    if (!title) { const dt = doc.querySelector('title'); title = txt(dt).split(/\s[|\-–—]\s/)[0].trim(); }

    // الغلاف
    let cover = '';
    const cEl = firstEl(doc, ['.summary_image img', '.seriestucontent .thumb img', '.infox .thumb img', '.series-thumb img', '.thumb img', 'img.wp-post-image', '[itemprop=image]']);
    if (cEl) cover = cEl.tagName === 'IMG' ? imgSrc(cEl, url) : abs(cEl.getAttribute('content') || '', url);
    if (!cover) cover = abs(metaContent(doc, 'og:image'), url);
    if (!cover) {
      const alt = [...doc.querySelectorAll('img[alt]')].find((i) => title && (i.getAttribute('alt') || '').indexOf(title.slice(0, 12)) >= 0);
      if (alt) cover = imgSrc(alt, url);
    }

    // القصة
    let desc = '';
    const dEl = firstEl(doc, ['.summary__content', '.manga-excerpt', '[itemprop=description]', '.sinopsis', '.synops', '.series-synops',
      '[class*="synopsis"]', '[class*="description"]', '[class*="summary"]', '[class*="desc"]']);
    if (dEl) {
      const ps = [...dEl.querySelectorAll('p')].map(txt).filter(Boolean);
      desc = (ps.length ? ps.join('\n\n') : txt(dEl));
    }
    if (!desc || desc.length < 15) desc = metaContent(doc, 'og:description') || metaContent(doc, 'description') || desc;
    desc = desc.slice(0, 4000);

    // التصنيفات (نتجاهل القوائم العامة بالموقع)
    let genres = [];
    const gSels = ['.genres-content a', '.mgen a', '.seriestugenre a', '.series-genres a', '.genres a', '.wp-manga-tags-list a',
      'a[href*="genres="]', 'a[href*="/genre/"]', 'a[href*="/genres/"]', 'a[href*="manga-genre"]', 'a[href*="/category/"]', 'a[rel="tag"]'];
    for (const s of gSels) {
      let els; try { els = [...doc.querySelectorAll(s)]; } catch (e) { continue; }
      els = els.filter((e) => !inChrome(e));
      const names = [...new Set(els.map(txt).filter((t) => t && t.length <= 30))];
      if (names.length && names.length <= 25) { genres = names; break; }
    }

    const status = pickStatus(doc);
    const type = pickType(doc, genres, url);
    const rating = parseRating(doc, isMadara);
    const chRes = extractChapters(doc, url);

    return { title, cover, desc, genres, status, type, rating, isMadara, chRes, chapters: orderChapters(chRes.list) };
  }

  /* ---------------- تحليل صفحة الفصل (الصور) ---------------- */
  const JUNK = /(logo|avatar|emoji|favicon|spinner|loader|loading|placeholder|banner|sprite|icon|ads?|advert)[^/]*\.(png|jpe?g|gif|webp|svg)(\?|$)/i;

  function parseChapterPage(html, url) {
    const doc = parseHtml(html);
    let imgs = [];
    const trusted = ['.reading-content', '#readerarea', '.reader-area', '#chapter-images', '.chapter-content', '#chapter_body',
      '.container-chapter-reader', '.chapter-container', '[class*="reader"]', '[id*="reader"]', '[class*="chapter-img"]', '[class*="pages"]'];
    for (const s of trusted) {
      let sc; try { sc = doc.querySelector(s); } catch (e) { continue; }
      if (!sc) continue;
      const arr = [...sc.querySelectorAll('img')].map((i) => imgSrc(i, url)).filter(Boolean);
      if (arr.length) { imgs = arr; break; }
    }
    // JSON داخل سكربت (ts_reader وأمثاله)
    if (!imgs.length) {
      const scripts = [...doc.querySelectorAll('script')].map((s) => s.textContent || '');
      for (const sc of scripts) {
        const m = sc.match(/"images"\s*:\s*(\[[^\]]*\])/);
        if (m) {
          try { const a = JSON.parse(m[1]).filter((x) => typeof x === 'string').map((x) => abs(x, url)).filter(Boolean); if (a.length) { imgs = a; break; } } catch (e) { /* */ }
        }
      }
    }
    // احتياط عام: صور المحتوى الرئيسي (بدون هيدر/فوتر/قوائم)
    if (!imgs.length) {
      const scope = doc.querySelector('main, article, .entry-content, #content, .content') || doc.body;
      const arr = [...(scope ? scope.querySelectorAll('img') : [])].filter((i) => !inChrome(i)).map((i) => imgSrc(i, url)).filter((s) => s && !JUNK.test(s));
      if (arr.length >= 2) imgs = arr;
    }
    // آخر حل: روابط صور داخل النص الخام (بيانات JSON بالصفحة)
    if (!imgs.length) {
      const found = (html.match(/https?:\\?\/\\?\/[^"'\s<>\\]+(?:\\\/[^"'\s<>\\]+)*\.(?:jpe?g|png|webp|avif)/gi) || [])
        .map((s) => s.replace(/\\\//g, '/')).filter((s) => !JUNK.test(s));
      if (found.length >= 2) imgs = found.map((s) => abs(s, url));
    }
    const seen = new Set(), out = [];
    imgs.forEach((s) => { if (s && !seen.has(s)) { seen.add(s); out.push(s); } });
    return out;
  }

  /* ---------------- اكتشاف أعمال الأرشيف ---------------- */
  const BAD_SEG = new Set(['page', 'genre', 'genres', 'tag', 'tags', 'author', 'authors', 'artist', 'category', 'categories', 'feed',
    'login', 'register', 'signup', 'search', 'user', 'users', 'profile', 'bookmarks', 'chapter', 'chapters', 'wp-content', 'wp-json', 'wp-admin']);

  function extractWorkLinks(doc, pageUrl) {
    const all = [];
    doc.querySelectorAll('a[href]').forEach((a) => {
      const h = a.getAttribute('href');
      if (!h || h[0] === '#' || /^(javascript|mailto|tel):/i.test(h)) return;
      const u = abs(h, pageUrl).split('#')[0].split('?')[0];
      if (!u || !sameHost(u, pageUrl)) return;
      const segs = pathOf(u).split('/').filter(Boolean);
      if (segs.length < 2) return;
      if (segs.some((s) => BAD_SEG.has(s.toLowerCase()))) return;
      if (CH_SEG.test(segs[segs.length - 1])) return;
      let card = !!a.querySelector('img');
      if (!card) { let p = a.parentElement; for (let i = 0; i < 3 && p && !card; i++, p = p.parentElement) card = /card|item|post|manga|series|comic|poster|thumb|entry|bs\b|bsx/i.test(p.className || ''); }
      all.push({ u, segs, card, chrome: inChrome(a) });
    });
    const pool = all.filter((x) => x.card && !x.chrome);
    const use = pool.length ? pool : all.filter((x) => !x.chrome);
    if (!use.length) return [];
    const cnt = {};
    use.forEach((x) => { const k = x.segs[0].toLowerCase() + '|' + x.segs.length; cnt[k] = (cnt[k] || new Set()).add(x.u); });
    let best = null, bestN = 0;
    Object.keys(cnt).forEach((k) => { if (cnt[k].size > bestN) { bestN = cnt[k].size; best = k; } });
    const out = [], seen = new Set();
    use.forEach((x) => {
      if ((x.segs[0].toLowerCase() + '|' + x.segs.length) !== best) return;
      const k = normUrl(x.u);
      if (!seen.has(k)) { seen.add(k); out.push(x.u); }
    });
    return out;
  }

  function findNextPage(doc, pageUrl) {
    const rel = firstEl(doc, ['link[rel=next]', 'a[rel=next]', 'a.next.page-numbers', 'a.nextpostslink', '.pagination a.next', '.pagination .next a', 'li.next a', 'a.next', '.next a']);
    if (rel && rel.getAttribute('href')) { const u = abs(rel.getAttribute('href'), pageUrl); if (u && normUrl(u) + (new URL(u).search) !== normUrl(pageUrl) + (new URL(pageUrl).search)) return u; }
    // أزرار نصية: التالي / next / › / »
    const nx = [...doc.querySelectorAll('a[href]')].find((a) => /^(?:التالي|التالية|next|›|»|>|>>)$/i.test(txt(a)) && !inChrome2(a));
    if (nx) return abs(nx.getAttribute('href'), pageUrl);
    // ترقيم رقمي بدون زر "التالي"
    const cur = (() => { try { const u = new URL(pageUrl); const q = parseInt(u.searchParams.get('page') || u.searchParams.get('p') || '', 10); if (q) return q; const m = u.pathname.match(/\/page\/(\d+)/i); return m ? parseInt(m[1], 10) : 1; } catch (e) { return 1; } })();
    const nums = [...doc.querySelectorAll('.pagination a, .page-numbers a, a.page-numbers, .wp-pagenavi a, [class*="paginat"] a, nav a')]
      .map((a) => ({ a, n: parseInt(toWestern(txt(a)), 10) })).filter((x) => !isNaN(x.n) && x.a.getAttribute('href'));
    const want = nums.find((x) => x.n === cur + 1);
    if (want) return abs(want.a.getAttribute('href'), pageUrl);
    // "صفحة 1 من 49"
    const m = toWestern(doc.body ? doc.body.textContent : '').match(/صفحة\s*(\d+)\s*من\s*(\d+)/);
    if (m && parseInt(m[1], 10) < parseInt(m[2], 10)) {
      const u = new URL(pageUrl);
      if (/\/page\/\d+/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/page\/\d+/i, '/page/' + (cur + 1));
      else u.searchParams.set('page', String(cur + 1));
      return u.href;
    }
    return '';
  }
  function inChrome2(a) { try { return !!a.closest('header,footer'); } catch (e) { return false; } }

  function isWorkPage(chRes) {
    if (!chRes.list.length) return false;
    if (chRes.via === 'selector') return chRes.kidRatio >= 0.5;
    return true;
  }

  /* =====================================================================
     المحرك
     ===================================================================== */
  function createImporter(deps) {
    deps = deps || {};
    const Store = deps.Store;
    const doFetch = deps.fetch || ((...a) => root.fetch(...a));

    let cfg = null;
    let ctl = { stopping: false, paused: false };
    let queue = [], seen = new Set(), claimed = new Set(), counter = 0, runBase = 0;
    let listeners = [];

    const state = {
      phase: 'idle', // idle | discovering | running | done | stopped
      siteUrl: '', workersTotal: 0, startedAt: 0, finishedAt: 0,
      discovery: { pages: 0, found: 0, done: false, error: '' },
      stats: { imported: 0, resumed: 0, skipped: 0, failed: 0, partial: 0, chapters: 0 },
      workers: [], log: [],
    };

    function notify() { listeners.forEach((f) => { try { f(state); } catch (e) { /* */ } }); }
    function onUpdate(f) { listeners.push(f); return () => { listeners = listeners.filter((x) => x !== f); }; }
    function log(msg, lvl) {
      state.log.push({ t: Date.now(), lvl: lvl || 'info', msg });
      if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
      notify();
    }
    function resetState() {
      state.phase = 'idle'; state.startedAt = 0; state.finishedAt = 0;
      state.discovery = { pages: 0, found: 0, done: false, error: '' };
      state.stats = { imported: 0, resumed: 0, skipped: 0, failed: 0, partial: 0, chapters: 0 };
      state.workers = []; state.log = [];
    }

    /* ---- جلب نص صفحة عبر البروكسي (مع إعادة محاولة تلقائية) ---- */
    async function fetchText(url, proxyBase, timeoutMs) {
      const base = String(proxyBase || cfg.proxyBase || '').replace(/\/+$/, '') + '/';
      const endpoint = base + '?url=' + encodeURIComponent(url);
      let lastErr;
      for (let a = 0; a < 4; a++) {
        if (ctl.stopping) throw new Error('تم الإيقاف');
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), timeoutMs || (cfg && cfg.timeoutMs) || 30000);
        try {
          const res = await doFetch(endpoint, { signal: ctrl.signal });
          const body = await res.text();
          clearTimeout(tm);
          if (res.status === 404 || res.status === 410) { const e = new Error('404 — الصفحة غير موجودة'); e.fatal = true; throw e; }
          if (!res.ok) throw new Error('HTTP ' + res.status + (body && body.length < 200 ? ' — ' + body : ''));
          if (/<title>\s*(Just a moment|Attention Required)/i.test(body.slice(0, 3000))) throw new Error('الموقع يطلب تحقق Cloudflare');
          return body;
        } catch (e) {
          clearTimeout(tm);
          lastErr = e.name === 'AbortError' ? new Error('انتهت مهلة الطلب') : e;
          if (e.fatal) throw lastErr;
          if (a < 3) await sleep(800 * Math.pow(2, a));
        }
      }
      throw lastErr;
    }

    /* ---- طابور الأعمال (كل عنصر يأخذه عامل واحد فقط) ---- */
    function enqueueWork(url) {
      const k = normUrl(url);
      if (seen.has(k)) return false;
      seen.add(k);
      queue.push({ url, idx: counter++, attempts: 0 });
      state.discovery.found++;
      notify();
      return true;
    }

    async function discover() {
      const D = state.discovery;
      const maxPages = cfg.maxPages || 500;
      try {
        let url = cfg.siteUrl, first = true, grace = 0;
        const visited = new Set();
        while (url && !ctl.stopping && D.pages < maxPages) {
          const key = url;
          if (visited.has(key)) break;
          visited.add(key);
          while (ctl.paused && !ctl.stopping) await sleep(400);
          const html = await fetchText(url);
          const doc = parseHtml(html);
          D.pages++;
          if (first) {
            first = false;
            const chRes = extractChapters(doc, url);
            if (isWorkPage(chRes)) { enqueueWork(url); log('الرابط يخص عمل واحد — راح يُستورد مباشرة'); break; }
          }
          const links = extractWorkLinks(doc, url);
          let added = 0;
          links.forEach((l) => { if (enqueueWork(l)) added++; });
          log('📄 صفحة أرشيف ' + D.pages + ' — ' + links.length + ' عمل (' + added + ' جديد)');
          let next = findNextPage(doc, url);
          // لو الرابط الرئيسي للموقع: ننتقل لصفحة الأرشيف الكاملة (نفس مجلد روابط الأعمال)
          if (D.pages === 1 && pathOf(url) === '' && links.length) {
            const seg = pathOf(links[0]).split('/').filter(Boolean)[0];
            if (seg) { next = new URL(url).origin + '/' + seg; grace = 1; }
          }
          if (!next) break;
          if (added === 0 && grace === 0 && D.pages > 1) break; // ما كو جديد = نهاية الأرشيف
          if (grace > 0) grace--;
          url = next;
        }
        if (D.found === 0 && !ctl.stopping) log('ما لقيت أي عمل بالرابط — تأكد انه رابط أرشيف/قائمة أعمال أو رابط عمل', 'err');
      } catch (e) {
        D.error = e.message || String(e);
        log('فشل اكتشاف الأعمال: ' + D.error, 'err');
      } finally { D.done = true; notify(); }
    }

    /* ---- العامل: ياخذ عمل → يخلصه بالكامل → ينتقل للي بعده ---- */
    async function workerLoop(w) {
      while (!ctl.stopping) {
        if (ctl.paused) { w.status = 'paused'; notify(); await sleep(400); continue; }
        const item = queue.shift(); // أخذ حصري: العنصر يطلع من الطابور فما يوصل لعامل ثاني
        if (!item) {
          if (state.discovery.done) break;
          w.status = 'wait'; notify(); await sleep(400); continue;
        }
        await processWork(w, item);
      }
      w.status = 'idle'; w.title = ''; w.cur = 0; w.total = 0; notify();
    }

    async function processWork(w, item) {
      w.status = 'fetch'; w.title = ''; w.cur = 0; w.total = 0; w.url = item.url; w.done = 0; notify();
      let key = '', docId = '', info = null, planned = [], saved = 0, failed = 0, existing = null, claimedHere = false;
      try {
        const html = await fetchText(item.url);
        info = parseWorkPage(html, item.url);
        if (!info.title) throw new Error('ما لقيت اسم العمل بالصفحة');
        let list = info.chapters;
        if (!list.length) { // بعض القوالب تجيب الفصول بطلب منفصل
          try {
            const frag = await fetchText(item.url.replace(/\/?$/, '/') + 'ajax/chapters/');
            list = orderChapters(extractChapters(parseHtml(frag), item.url).list);
          } catch (e) { /* مو كل المواقع تدعمها */ }
        }
        if (!list.length) throw new Error('ما لقيت فصول لهذا العمل');

        key = normKey(info.title);
        if (!key) throw new Error('اسم العمل غير صالح');
        if (claimed.has(key)) { state.stats.skipped++; log('⏭ «' + info.title + '» — مكرر داخل نفس العملية، تم التخطي', 'warn'); return; }
        claimed.add(key); claimedHere = true;
        docId = 'w' + cyrb53(key).toString(36);
        w.title = info.title;

        existing = await Store.getWork(docId);
        if (existing && existing.importState === 'done') {
          state.stats.skipped++; log('⏭ «' + info.title + '» — موجود مسبقاً بقاعدة البيانات، تم التخطي'); return;
        }
        let have = new Set();
        if (existing) {
          const old = await Store.getChapters(docId);
          have = new Set(old.filter((c) => c.pages && c.pages.length).map((c) => c.id));
          log('↻ «' + info.title + '» — نسخة ناقصة سابقة، راح أكمّل (' + have.size + ' فصل موجود)');
        }

        planned = assignChapterIds(list);
        w.total = planned.length; w.status = 'chapters'; notify();

        for (const ch of planned) {
          if (ctl.stopping) break;
          while (ctl.paused && !ctl.stopping) { w.status = 'paused'; notify(); await sleep(400); }
          w.status = 'chapters';
          if (have.has(ch.id)) { saved++; w.cur++; continue; }
          try {
            const chHtml = await fetchText(ch.url);
            const pages = parseChapterPage(chHtml, ch.url);
            if (!pages.length) throw new Error('الفصل بدون صور');
            await Store.putChapter(clean({ id: ch.id, workId: docId, number: ch.number, title: ch.title, pages, sourceUrl: ch.url, order: ch.order }));
            saved++; state.stats.chapters++;
          } catch (e) {
            if (ctl.stopping) break;
            failed++;
            log('⚠ «' + info.title + '» الفصل ' + ch.number + ': ' + e.message, 'warn');
          }
          w.cur++; notify();
        }

        const complete = !ctl.stopping && failed === 0 && saved === planned.length;
        const docOut = clean({
          id: docId, title: info.title, cover: info.cover, desc: info.desc, genres: info.genres,
          status: info.status, type: info.type, avgRating: info.rating,
          source: hostOf(item.url), sourceUrl: item.url,
          chapters: saved, importState: complete ? 'done' : 'partial', failedChapters: failed, importedAt: Date.now(),
          createdAt: (existing && existing.createdAt) || (runBase - item.idx),
        });
        if (saved > 0) await Store.putWork(docOut);
        if (complete) {
          state.stats[existing ? 'resumed' : 'imported']++;
          log('✅ «' + info.title + '» — ' + saved + ' فصل');
        } else if (saved > 0) {
          state.stats.partial++;
          log('◐ «' + info.title + '» — ' + saved + ' من ' + planned.length + ' فصل (ناقص، يكمل بالتشغيل الجاي)', 'warn');
        } else {
          throw new Error('ما انحفظ أي فصل');
        }
      } catch (e) {
        if (claimedHere && !(existing && existing.importState === 'done')) claimed.delete(key);
        if (ctl.stopping) return;
        item.attempts++;
        if (item.attempts < 2) { queue.push(item); log('↺ إعادة محاولة لاحقاً: ' + (info && info.title || item.url) + ' — ' + e.message, 'warn'); }
        else { state.stats.failed++; log('❌ فشل: ' + (info && info.title || item.url) + ' — ' + e.message, 'err'); }
      } finally { w.status = 'idle'; notify(); }
    }

    /* ---- التحكم ---- */
    async function start(opts) {
      if (state.phase === 'discovering' || state.phase === 'running') throw new Error('الاستيراد شغال حالياً');
      let site;
      try { site = new URL(opts.siteUrl); if (!/^https?:$/.test(site.protocol)) throw 0; } catch (e) { throw new Error('رابط الموقع غير صالح'); }
      const n = Math.max(1, Math.min(70, parseInt(opts.workers, 10) || 70));
      cfg = { siteUrl: site.href, proxyBase: opts.proxyBase, workers: n, maxPages: parseInt(opts.maxPages, 10) || 500, timeoutMs: 30000 };
      resetState();
      ctl = { stopping: false, paused: false };
      queue = []; seen = new Set(); claimed = new Set(); counter = 0; runBase = Date.now();
      state.siteUrl = cfg.siteUrl; state.workersTotal = n; state.startedAt = Date.now(); state.phase = 'discovering';
      for (let i = 0; i < n; i++) state.workers.push({ id: i + 1, status: 'idle', title: '', cur: 0, total: 0, url: '' });
      log('▶ بدأ الاستيراد: ' + n + ' عامل — ' + cfg.siteUrl);
      const disc = discover();
      const ws = state.workers.map((w) => workerLoop(w));
      state.phase = 'running'; notify();
      await Promise.all([disc, ...ws]);
      state.phase = ctl.stopping ? 'stopped' : 'done'; state.finishedAt = Date.now();
      const s = state.stats;
      log((ctl.stopping ? '⏹ تم الإيقاف' : '🏁 انتهى الاستيراد') + ' — جديد: ' + s.imported + ' | مُكمَّل: ' + s.resumed + ' | متخطى: ' + s.skipped + ' | ناقص: ' + s.partial + ' | فشل: ' + s.failed + ' | فصول: ' + s.chapters);
    }
    function pause() { if (state.phase === 'running' || state.phase === 'discovering') { ctl.paused = true; log('⏸ إيقاف مؤقت (العمال يخلصون الطلب الحالي)'); } }
    function resume() { if (ctl.paused) { ctl.paused = false; log('▶ استئناف'); } }
    function stop() { if (state.phase === 'running' || state.phase === 'discovering') { ctl.stopping = true; ctl.paused = false; log('⏹ جاري الإيقاف...'); } }
    function isRunning() { return state.phase === 'running' || state.phase === 'discovering'; }
    function isPaused() { return ctl.paused; }

    /* ---- فحص الرابط قبل البدء ---- */
    async function probe(siteUrl, proxyBase) {
      cfg = cfg || {};
      const prevStop = ctl.stopping; ctl.stopping = false;
      try {
        const html = await fetchText(siteUrl, proxyBase, 20000);
        const doc = parseHtml(html);
        const chRes = extractChapters(doc, siteUrl);
        if (isWorkPage(chRes)) {
          const info = parseWorkPage(html, siteUrl);
          return { ok: true, kind: 'work', title: info.title, chapters: info.chapters.length, cover: !!info.cover, rating: info.rating, genres: info.genres.length, hasDesc: !!info.desc };
        }
        const links = extractWorkLinks(doc, siteUrl);
        return { ok: links.length > 0, kind: 'listing', works: links.length, sample: links.slice(0, 3), next: findNextPage(doc, siteUrl), bytes: html.length };
      } finally { ctl.stopping = prevStop; }
    }

    return { state, start, pause, resume, stop, isRunning, isPaused, onUpdate, probe };
  }

  const api = {
    createImporter, cyrb53, normKey, normUrl, parseWorkPage, parseChapterPage, extractWorkLinks, findNextPage,
    extractChapters, orderChapters, assignChapterIds, parseNumber, isWorkPage,
  };
  root.PureImporter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
