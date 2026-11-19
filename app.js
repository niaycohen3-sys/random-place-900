// מקום רנדומלי — Vanilla JS + Leaflet + OpenStreetMap / Overpass / Nominatim
// עיקרון: רנדומליות מלאה. אין מיון לפי דירוג/מרחק/פופולריות — הגרלה אחידה מתוך כל התוצאות ברדיוס.
const RADIUS = 900;
const CAT_LABEL = { cafe: "☕ קפה", restaurant: "🍽️ מסעדה", bar: "🍺 בר" };
// pub נחשב בר; cafe/restaurant כפשוטם. לא כולל fast_food כדי לשמור על 3 הקטגוריות בלבד.
const AMENITY_TO_CAT = { cafe: "cafe", restaurant: "restaurant", bar: "bar", pub: "bar" };

let center = { lat: 32.0853, lon: 34.7818 }; // ברירת מחדל: מרכז תל אביב, עד שהמשתמש בוחר נקודה
let lastPickId = null;
let cached = []; // תוצאות אחרונות לאותו מרכז+קטגוריות, כדי ש"נסה שוב" יהיה מיידי

const map = L.map("map").setView([center.lat, center.lon], 15);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap contributors",
}).addTo(map);

const centerMarker = L.marker([center.lat, center.lon], { draggable: true }).addTo(map);
const circle = L.circle([center.lat, center.lon], { radius: RADIUS, color: "#f59e0b", weight: 2, fillOpacity: 0.08 }).addTo(map);
let resultMarker = null;

const $ = (id) => document.getElementById(id);
const status = (t) => { $("status").textContent = t || ""; };

function setCenter(lat, lon, label) {
  center = { lat, lon }; cached = []; lastPickId = null;
  centerMarker.setLatLng([lat, lon]); circle.setLatLng([lat, lon]);
  map.setView([lat, lon], Math.max(map.getZoom(), 15));
  $("centerLabel").textContent = label || `מרכז החיפוש: ${lat.toFixed(5)}, ${lon.toFixed(5)} · רדיוס ${RADIUS} מטר`;
}
map.on("click", (e) => setCenter(e.latlng.lat, e.latlng.lng));
centerMarker.on("dragend", () => { const p = centerMarker.getLatLng(); setCenter(p.lat, p.lng); });
setCenter(center.lat, center.lon);

// --- מיקום בזמן אמת ---
$("geoBtn").onclick = () => {
  if (!navigator.geolocation) return status("הדפדפן לא תומך במיקום בזמן אמת.");
  status("מאתר מיקום…");
  navigator.geolocation.getCurrentPosition(
    (pos) => { setCenter(pos.coords.latitude, pos.coords.longitude, "📍 המיקום שלך עכשיו · רדיוס 900 מטר"); status("המיקום עודכן. אפשר להגריל."); },
    () => status("לא הצלחתי לקבל מיקום. אפשר להקליד כתובת או ללחוץ על המפה."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

// --- כתובת ידנית: השלמה אוטומטית + גיאוקודינג (Nominatim, חינמי) ---
let debounce;
$("addrInput").addEventListener("input", (e) => {
  clearTimeout(debounce);
  const q = e.target.value.trim();
  if (q.length < 3) { $("suggestions").hidden = true; return; }
  debounce = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=he&q=${encodeURIComponent(q)}`;
      const items = await (await fetch(url)).json();
      const box = $("suggestions"); box.innerHTML = "";
      items.forEach((it) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = it.display_name;
        b.onclick = () => { box.hidden = true; $("addrInput").value = it.display_name; setCenter(+it.lat, +it.lon, `📍 ${it.display_name}`); status("הכתובת נקבעה. אפשר להגריל."); };
        box.appendChild(b);
      });
      box.hidden = items.length === 0;
    } catch { status("חיפוש הכתובת נכשל כרגע, נסה שוב או לחץ על המפה."); }
  }, 350);
});

// --- שליפת מקומות (Overpass API, חינמי, בלי מפתח) ---
function selectedCats() {
  return [...document.querySelectorAll("#catChips input:checked")].map((i) => i.value);
}
async function fetchPlaces() {
  const cats = selectedCats();
  if (!cats.length) throw new Error("בחר לפחות קטגוריה אחת.");
  const amenities = Object.keys(AMENITY_TO_CAT).filter((a) => cats.includes(AMENITY_TO_CAT[a]));
  const filter = `["amenity"~"^(${amenities.join("|")})$"]["name"]`;
  const q = `[out:json][timeout:25];(node${filter}(around:${RADIUS},${center.lat},${center.lon});way${filter}(around:${RADIUS},${center.lat},${center.lon}););out center tags 250;`;
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  let data = null, lastErr = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q) });
      if (!res.ok) throw new Error("bad status");
      data = await res.json(); break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw new Error("שירות המקומות לא הגיב כרגע, נסה שוב בעוד רגע.");
  return (data.elements || []).map((el) => {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon, t = el.tags || {};
    const addr = [t["addr:street"] && `${t["addr:street"]} ${t["addr:housenumber"] || ""}`.trim(), t["addr:city"]].filter(Boolean).join(", ");
    // דירוג: ב-OSM כמעט לא קיים; אם קיים כשדה חופשי — קוראים אותו, אחרת null (מוצג כ"לא זמין")
    const rating = t.rating ? parseFloat(t.rating) : null;
    return { id: `${el.type}/${el.id}`, lat, lon, name: t.name, cat: AMENITY_TO_CAT[t.amenity], addr, rating, hours: t.opening_hours || null };
  }).filter((p) => p.lat && p.lon && p.name);
}

function haversine(a, b) {
  const R = 6371000, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// פתוח/סגור: מ-opening_hours רק הערכה גסה (פורמט נפוץ "Mo-Su 08:00-22:00"); כשלא בטוחים — לא ממציאים.
function openStatus(hours) {
  if (!hours) return null;
  const m = hours.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return `שעות: ${hours}`;
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const from = +m[1] * 60 + +m[2]; let to = +m[3] * 60 + +m[4]; if (to <= from) to += 1440;
  const open = cur >= from && cur <= to;
  return `${open ? "🟢 פתוח עכשיו" : "🔴 סגור עכשיו"} · שעות היום: ${m[1]}:${m[2]}–${m[3]}:${m[4]}`;
}

async function roll() {
  status("מחפש מקומות ברדיוס 900 מטר…");
  try {
    if (!cached.length) cached = await fetchPlaces();
    let pool = cached;
    if ($("ratingToggle").checked) pool = pool.filter((p) => p.rating !== null && p.rating >= 3);
    if (!pool.length) {
      $("result").hidden = true;
      return status($("ratingToggle").checked
        ? "לא נמצאו מקומות עם דירוג ידוע של 3+ ברדיוס הזה (ב-OSM הדירוג חלקי מאוד). כבה את הסינון או הזז את הסיכה."
        : "לא נמצאו מקומות מהקטגוריות האלה ברדיוס 900 מטר מהנקודה. נסה להזיז את הסיכה למקום מרכזי יותר.");
    }
    // הגרלה אחידה מלאה; ב"נסה שוב" לא חוזרים על אותו מקום אם יש חלופה
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && pick.id === lastPickId) pick = pool[(pool.indexOf(pick) + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length];
    lastPickId = pick.id;
    showResult(pick);
    status(`הוגרל מתוך ${pool.length} מקומות ברדיוס — בהגרלה אחידה, בלי מיון.`);
  } catch (e) { status(e.message || "משהו השתבש, נסה שוב."); }
}

function showResult(p) {
  if (resultMarker) resultMarker.remove();
  resultMarker = L.marker([p.lat, p.lon]).addTo(map).bindPopup(p.name).openPopup();
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15));
  $("rCat").textContent = CAT_LABEL[p.cat];
  $("rName").textContent = p.name;
  $("rAddr").textContent = p.addr ? `📍 ${p.addr}` : "📍 כתובת מדויקת לא רשומה במקור — אפשר לנווט לפי הסיכה";
  $("rMeta").textContent = `מרחק מהנקודה: כ-${haversine(center, p)} מטר · דירוג: ${p.rating !== null ? p.rating + " ★" : "לא זמין במקור החינמי"}`;
  const os = openStatus(p.hours);
  $("rHours").textContent = os || "סטטוס פתוח/סגור: לא זמין במקור החינמי";
  $("gmapsBtn").href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
  $("wazeBtn").href = `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`;
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("rollBtn").onclick = roll;
$("againBtn").onclick = roll;
document.querySelectorAll("#catChips input").forEach((i) => i.addEventListener("change", () => { cached = []; }));
$("ratingToggle").addEventListener("change", () => { /* pool מסונן בזמן ההגרלה, בלי שליפה מחדש */ });
