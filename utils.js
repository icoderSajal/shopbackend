const axios = require("axios");
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b, c, d) => {
  const x =
    Math.sin(rad(c - a) / 2) ** 2 +
    Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const cache = {};
async function geo(pin) {
  if (cache[pin]) return cache[pin];
  const { data } = await axios.get(
    "https://nominatim.openstreetmap.org/search",
    {
      params: { postalcode: pin, country: "India", format: "json", limit: 1 },
      headers: { "User-Agent": "sanitary-shop" },
      timeout: 8000,
    },
  );
  if (!data[0]) throw new Error("Pincode not found");
  return (cache[pin] = { lat: +data[0].lat, lon: +data[0].lon });
}
// EDIT THESE: distance slabs (km -> base Rs) + Rs per kg
const SLABS = [
    [5, 30],
    [15, 60],
    [30, 100],
    [100, 200],
  ],
  PER_KG = 3,
  FREE_ABOVE = 10000;
exports.shipping = async (pin, weight, subtotal) => {
  let d;
  try {
    const a = await geo(process.env.SHOP_PINCODE),
      b = await geo(pin);
    d = km(a.lat, a.lon, b.lat, b.lon);
  } catch {
    d = 10;
  }
  const slab = SLABS.find((s) => d <= s[0]);
  if (!slab) throw new Error("Delivery not available for this distance");
  return {
    distanceKm: Math.round(d),
    shipping:
      subtotal >= FREE_ABOVE ? 0 : Math.round(slab[1] + weight * PER_KG),
  };
};
exports.sms = async (number, message) => {
  if (!process.env.FAST2SMS_KEY) return console.log("[SMS]", number, message);
  try {
    await axios.post(
      "https://www.fast2sms.com/dev/bulkV2",
      { route: "q", message, numbers: number },
      { headers: { authorization: process.env.FAST2SMS_KEY } },
    );
  } catch (e) {
    console.error("SMS failed", e.message);
  }
};
