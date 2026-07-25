const fs = require('fs');
const path = require('path');

const TPL_DIR = path.join(__dirname, '..', 'templates');
const cache = {};

function loadTemplate(id) {
  if (!cache[id]) {
    const file = { basic: 'basic.html', cinematic: 'cinematic.html' }[id];
    if (!file) throw new Error('Unknown template: ' + id);
    cache[id] = fs.readFileSync(path.join(TPL_DIR, file), 'utf8');
  }
  return cache[id];
}

const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const cleanNum = n => (n||'').replace(/\D/g,'').replace(/^(\d{10})$/, '91$1');

// remove a marker-wrapped block entirely
function stripBlock(html, name){
  const re = new RegExp(`<!--${name}_START-->[\\s\\S]*?<!--${name}_END-->`, 'g');
  return html.replace(re, '');
}
function stripDot(html, name){
  const re = new RegExp(`<!--${name}_DOT-->[\\s\\S]*?<!--/${name}_DOT-->`, 'g');
  return html.replace(re, '');
}

function render(templateId, data, opts = {}) {
  // opts.mediaBase = url prefix where photos/music for this invite are served (e.g. /media/abc123)
  let html = loadTemplate(templateId);
  const d = data || {};
  const R = [];

  const groom = (d.groom || 'Vineet').trim();
  const bride = (d.bride || 'Simran').trim();

  R.push(['Vineet &amp; Simran', `${esc(groom)} &amp; ${esc(bride)}`]);
  R.push(['Vineet', esc(groom)]);
  R.push(['Simran', esc(bride)]);

  const gp = d.groomParents || {}, bp = d.brideParents || {};
  R.push(['Mr. Rajesh Sharma', esc(gp.father || 'Mr. Rajesh Sharma')]);
  R.push(['Mrs. Sunita Sharma', esc(gp.mother || 'Mrs. Sunita Sharma')]);
  R.push(['Mr. Manoj Kapoor', esc(bp.father || 'Mr. Manoj Kapoor')]);
  R.push(['Mrs. Bina Kapoor', esc(bp.mother || 'Mrs. Bina Kapoor')]);
  R.push(['Sharma &amp; Kapoor Families', `${esc(d.groomFamily||'Sharma')} &amp; ${esc(d.brideFamily||'Kapoor')} Families`]);

  const venueName = d.venueName || 'The Grand Utsav';
  const venueAddr = d.venueAddress || 'Sector 70, Gurugram, Haryana';
  R.push(['The Grand Utsav, Sector 70, Gurugram, Haryana', esc(`${venueName}, ${venueAddr}`)]);
  R.push(['The Grand Utsav', esc(venueName)]);
  R.push(['Gurugram, India', esc(d.city || 'Gurugram, India')]);
  const mapsQ = encodeURIComponent(`${venueName} ${venueAddr}`).replace(/%20/g,'+');
  R.push(['Sector+70+Gurugram+Haryana', mapsQ]);

  const mainHash = d.hashtag ? (d.hashtag.startsWith('#') ? d.hashtag : '#'+d.hashtag)
    : `#${groom.split(' ')[0]}Ki${bride.split(' ')[0]}`;
  R.push(['#VineetKiSimran', esc(mainHash)]);

  // Event date formatting
  const evs = d.events || {};
  const formatDatePill = (dateStr, timeStr) => {
    if (!dateStr) return '';
    const [y,m,d_] = dateStr.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dayNum = parseInt(d_, 10);
    const suffix = dayNum % 10 === 1 && dayNum !== 11 ? 'st' : dayNum % 10 === 2 && dayNum !== 12 ? 'nd' : dayNum % 10 === 3 && dayNum !== 13 ? 'rd' : 'th';
    const date = `${dayNum}${suffix} ${months[parseInt(m,10)-1]} ${y}`;
    return timeStr ? `${date} · ${timeStr}` : date;
  };
  // Basic template event date pills
  if (evs.mehendi?.date) R.push(['21st Nov 2026 &nbsp;|&nbsp; 4:00 PM', esc(formatDatePill(evs.mehendi.date, evs.mehendi.time))]);
  if (evs.sangeet?.date) R.push(['22nd Nov 2026 &nbsp;|&nbsp; 8:00 PM', esc(formatDatePill(evs.sangeet.date, evs.sangeet.time))]);
  if (evs.wedding?.date) R.push(['23rd Nov 2026', esc(formatDatePill(evs.wedding.date, evs.wedding.time))]);
  // Cinematic template date range
  if (evs.mehendi?.date && evs.wedding?.date) {
    const [ym,mm,dm] = evs.mehendi.date.split('-');
    const [yw,mw,dw] = evs.wedding.date.split('-');
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const startDay = parseInt(dm,10);
    const endDay = parseInt(dw,10);
    const startMonth = months[parseInt(mm,10)-1];
    const endMonth = months[parseInt(mw,10)-1];
    const dateRange = mm === mw ? `${startDay} — ${endDay} ${startMonth} ${yw}` : `${startDay} ${startMonth} — ${endDay} ${endMonth} ${yw}`;
    R.push(['21 — 23 NOV 2026', esc(dateRange)]);
  }
  // Cinematic template individual event pills
  if (evs.haldi?.date) R.push(['__HALDI_DATETIME__', esc(formatDatePill(evs.haldi.date, evs.haldi.time))]);
  if (evs.mehendi?.date) R.push(['__MEHENDI_DATETIME__', esc(formatDatePill(evs.mehendi.date, evs.mehendi.time))]);
  if (evs.sangeet?.date) R.push(['__SANGEET_DATETIME__', esc(formatDatePill(evs.sangeet.date, evs.sangeet.time))]);
  if (evs.wedding?.date) {
    R.push(['__WEDDING_DATETIME__', esc(formatDatePill(evs.wedding.date, evs.wedding.time))]);
    R.push(['__WEDDING_DATE__', esc(formatDatePill(evs.wedding.date, evs.wedding.time))]); // cinematic uses date only, or date+time
  }
  // Footer date range
  if (evs.mehendi?.date && evs.wedding?.date) {
    const mehStart = formatDatePill(evs.mehendi.date, null);
    const wedEnd = formatDatePill(evs.wedding.date, null);
    R.push(['21st — 23rd November 2026', esc(mehStart.split(' ')[0] + ' — ' + wedEnd)]);
    R.push(['__DATE_RANGE__', esc(mehStart.split(' ')[0] + ' — ' + wedEnd)]);
  }

  // WhatsApp contact numbers
  if (d.whatsapp) {
    const p = cleanNum(d.whatsapp);
    R.push(['919876543210', p]);
    R.push(['919812345678', p]);
  }

  // Countdown target from wedding event or weddingDate
  const wEv = (d.events && d.events.wedding) || {};
  const cdDate = wEv.date || d.weddingDate;
  if (cdDate) {
    const cdVal = `${cdDate}T${wEv.time || '10:00'}:00`;
    R.push(["countdownTarget:'2026-11-21T10:00:00'", `countdownTarget:'${cdVal}'`]);
    R.push(["countdownTarget: '2026-11-21T10:00:00'", `countdownTarget: '${cdVal}'`]);
  }

  // Custom music: replace bgm src
  if (d.showMusic && opts.musicUrl) {
    html = html.replace(/<audio id="bgm"[^>]*src="[^"]*"/, `<audio id="bgm" loop preload="auto" src="${opts.musicUrl}"`);
  }

  for (const [from,to] of R) html = html.split(from).join(to);

  /* ---------- DYNAMIC SECTIONS via markers ---------- */

  // STORY
  if (d.showStory && (d.howWeMet || d.perfectMorning || d.description)) {
    html = html
      .replace('__STORY_HOW__', esc(d.howWeMet || '—'))
      .replace('__STORY_MORNING__', esc(d.perfectMorning || '—'))
      .replace('__STORY_TEXT__', d.description ? esc(d.description).replace(/\n/g,'<br>') : '')
      .replace('__STORY_HASHTAG__', d.customHashtag ? esc(d.customHashtag.startsWith('#')?d.customHashtag:'#'+d.customHashtag) : esc(mainHash));
  } else {
    html = stripBlock(html, 'DYN_STORY');
    html = stripDot(html, 'DYN_STORY');
  }

  // GALLERY — photoUrls passed via opts (server saves base64 → files)
  const photoUrls = opts.photoUrls || [];
  if (d.showGallery && photoUrls.length) {
    const items = photoUrls.map((u,i)=>`<div class="gal-item"><img src="${u}" alt="Moment ${i+1}" loading="lazy"></div>`).join('');
    html = html.replace('__GALLERY_ITEMS__', items);
  } else {
    html = stripBlock(html, 'DYN_GALLERY');
    html = stripDot(html, 'DYN_GALLERY');
  }

  // CUSTOM EVENTS
  const cevs = (d.customEvents||[]).filter(e => e && e.on !== false && e.name);
  if (cevs.length) {
    const items = cevs.map(e=>`
      <div class="cev-card">
        <h4>${esc(e.name)}</h4>
        ${e.date?`<div class="cev-meta">📅 ${esc(e.date)}${e.time?` · ${esc(e.time)}`:''}</div>`:''}
        ${e.venue?`<div class="cev-meta">📍 ${esc(e.venue)}</div>`:''}
        ${e.desc?`<div class="cev-desc">${esc(e.desc)}</div>`:''}
      </div>`).join('');
    html = html.replace('__CUSTOM_EVENTS__', items);
  } else {
    html = stripBlock(html, 'DYN_CUSTOMEV');
  }

  // INFO CARDS
  const ic = d.infoCards || {};
  const cards = [];
  if (ic.address?.on && ic.address.value) cards.push({i:'📍',t:'Address',c:esc(ic.address.value).replace(/\n/g,'<br>')});
  if (ic.parking?.on && ic.parking.value) cards.push({i:'🅿️',t:'Parking',c:esc(ic.parking.value).replace(/\n/g,'<br>')});
  if (ic.registry?.on && ic.registry.value) cards.push({i:'🎁',t:'Gift Registry',c:`<a href="${esc(ic.registry.value)}" target="_blank" rel="noopener">Open Registry →</a>`});
  if (ic.stayInfo?.on && ic.stayInfo.value) cards.push({i:'🏨',t:'Where to Stay',c:esc(ic.stayInfo.value).replace(/\n/g,'<br>')});
  if (cards.length) {
    html = html.replace('__INFO_CARDS__', cards.map(c=>`
      <div class="info-card"><div class="ic">${c.i}</div><h4>${c.t}</h4><p>${c.c}</p></div>`).join(''));
  } else {
    html = stripBlock(html, 'DYN_INFO');
  }

  // RSVP
  if (d.rsvpWhatsapp) {
    const link = `https://wa.me/${cleanNum(d.rsvpWhatsapp)}?text=${encodeURIComponent(d.rsvpMessage || `Hi! I'll be attending ${groom} & ${bride}'s wedding. 🎉`)}`;
    html = html.replace('__RSVP_LINK__', link);
  } else {
    html = stripBlock(html, 'DYN_RSVP');
    html = stripDot(html, 'DYN_RSVP');
  }

  // asset paths
  html = html.split('src="images/').join('src="/assets/images/');
  html = html.split('src="sounds/').join('src="/assets/sounds/');

  return html;
}

module.exports = { render };
